'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useDynamicContext, useUserWallets } from '@dynamic-labs/sdk-react-core';
import { authFetch } from '@/lib/use-auth-fetch';
import { useHederaKey } from './use-hedera-key';
import { hasKeypair, getStoredPublicKey, exportKey } from './hedera-keystore';

export interface FolioUser {
  email: string;
  name: string;
  hederaAccountId: string;
  publicKey?: string;
}

type RegistrationStatus =
  | 'idle'
  | 'loading'
  | 'generating-key'
  | 'needs-passphrase'
  | 'creating-account'
  | 'signing-association'
  | 'completing'
  | 'encrypting-key'
  | 'recovering-key'
  | 'done'
  | 'error';

type MeResponse = {
  exists?: boolean;
  user?: FolioUser;
  hasPassphraseBackup?: boolean;
  hasServerWalletKey?: boolean;
  hasWalletPassphrase?: boolean;
};

async function ensureServerKeyBackup(email: string) {
  const privateKeyDer = exportKey();
  if (!privateKeyDer) return;
  await authFetch('/api/users/key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, privateKeyDer }),
  }).catch(() => {});
}

function isBackupComplete(me: MeResponse): boolean {
  return !!(me.hasPassphraseBackup && me.hasWalletPassphrase && me.hasServerWalletKey);
}

export function useUserRegistration() {
  const { user } = useDynamicContext();
  const userWallets = useUserWallets();
  const {
    generateKey,
    signTransaction,
    encryptAndStore,
    recoverKey,
    restoreFromServer,
  } = useHederaKey();
  const [folioUser, setFolioUser] = useState<FolioUser | null>(null);
  const [status, setStatus] = useState<RegistrationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  /** Existing wallet restored, but DB missing encrypted_key / wallet_passphrase */
  const [needsBackupOnly, setNeedsBackupOnly] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const registrationInFlight = useRef(false);
  const bootedEmail = useRef<string | null>(null);

  function resolveUserName(): string {
    const u = user as {
      firstName?: string;
      lastName?: string;
      username?: string;
    } | null;
    if (!u) return '';
    const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    if (full) return full;
    if (u.username?.trim()) return u.username.trim();
    return '';
  }

  /** Write full key backups: encrypted_key + wallet_passphrase + server_wallet_key */
  const saveFullKeyBackup = useCallback(
    async (email: string, passphrase: string) => {
      setStatus('encrypting-key');
      await encryptAndStore(email, passphrase);
      try {
        sessionStorage.setItem('folio:passphrase-cache', passphrase);
      } catch { /* */ }
      // encryptAndStore already sends privateKeyDer; ensure once more if needed
      await ensureServerKeyBackup(email);
    },
    [encryptAndStore]
  );

  const finishWithRegister = useCallback(
    async (pubKey: string, passphrase?: string) => {
      setStatus('creating-account');
      const res = await authFetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user!.email,
          name: resolveUserName(),
          publicKey: pubKey,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || 'Registration failed');
      }

      const data = await res.json();
      if (data.user) setFolioUser(data.user);

      if (data.created && data.needsTokenAssociation && data.tokenAssocTxBytes) {
        try {
          setStatus('signing-association');
          const signedTxBytes = await signTransaction(data.tokenAssocTxBytes);
          setStatus('completing');
          const completeRes = await authFetch('/api/users/register/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user!.email, signedTxBytes }),
          });
          if (!completeRes.ok) {
            const err = await completeRes.json().catch(() => ({}));
            console.warn(
              '[registration] token association failed:',
              err.details || err.error
            );
          }
        } catch (assocErr) {
          console.warn(
            '[registration] association step failed:',
            assocErr instanceof Error ? assocErr.message : assocErr
          );
        }
      }

      if (passphrase) {
        await saveFullKeyBackup(user!.email!, passphrase);
      } else {
        await ensureServerKeyBackup(user!.email!);
      }

      try {
        const meRes = await authFetch('/api/users/me');
        const me = await meRes.json();
        if (me.user) setFolioUser(me.user);
        else if (data.user) setFolioUser(data.user);
      } catch {
        if (data.user) setFolioUser(data.user);
      }
      setNeedsBackupOnly(false);
      setStatus('done');
      bootedEmail.current = user!.email!;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, signTransaction, saveFullKeyBackup]
  );

  /**
   * Prompt: create (new user) OR unlock (recovery) OR save backup (existing, missing DB fields).
   * Never creates a second Hedera account for an existing email.
   */
  const submitPassphrase = useCallback(
    async (passphrase: string) => {
      if (!user?.email) return;
      setNeedsPassphrase(false);
      setError(null);

      try {
        const meRes = await authFetch('/api/users/me');
        const me = (await meRes.json().catch(() => ({}))) as MeResponse;

        // A) Existing user — only save backups (key already local or restorable)
        if (me.exists || needsBackupOnly) {
          setStatus('recovering-key');
          if (!hasKeypair() || !getStoredPublicKey()) {
            if (me.hasServerWalletKey) {
              await restoreFromServer(user.email);
            } else if (me.hasPassphraseBackup) {
              await recoverKey(user.email, passphrase);
            } else {
              throw new Error(
                'No wallet key backup found. Import your key from Wallet settings.'
              );
            }
          }
          if (!getStoredPublicKey()) {
            throw new Error('Could not restore wallet key');
          }
          await saveFullKeyBackup(user.email, passphrase);
          const me2 = await (await authFetch('/api/users/me')).json();
          if (me2.user) setFolioUser(me2.user);
          else if (me.user) setFolioUser(me.user);
          setNeedsBackupOnly(false);
          setNeedsRecovery(false);
          setIsNewUser(false);
          setStatus('done');
          bootedEmail.current = user.email;
          return;
        }

        // B) Brand-new email only
        setStatus('generating-key');
        const pubKey = await generateKey();
        await finishWithRegister(pubKey, passphrase);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Registration failed');
        setStatus('error');
        setNeedsPassphrase(true);
        if (needsBackupOnly || needsRecovery) {
          setIsNewUser(false);
        } else {
          setIsNewUser(true);
        }
      }
    },
    [
      user,
      needsBackupOnly,
      needsRecovery,
      generateKey,
      finishWithRegister,
      restoreFromServer,
      recoverKey,
      saveFullKeyBackup,
    ]
  );

  const submitRecoveryPassphrase = useCallback(
    async (passphrase: string) => {
      // Same path as backup/unlock — never creates a new account
      setNeedsRecovery(true);
      setNeedsBackupOnly(true);
      await submitPassphrase(passphrase);
    },
    [submitPassphrase]
  );

  /** After wallet is live, force passphrase form if DB backups incomplete */
  function requestBackupIfIncomplete(me: MeResponse, profile: FolioUser) {
    if (isBackupComplete(me)) return false;
    setFolioUser(profile);
    setIsNewUser(false);
    setNeedsRecovery(false);
    setNeedsBackupOnly(true);
    setNeedsPassphrase(true);
    setStatus('needs-passphrase');
    setError(null);
    return true;
  }

  useEffect(() => {
    if (!user?.email) {
      setStatus('idle');
      setFolioUser(null);
      bootedEmail.current = null;
      registrationInFlight.current = false;
      setNeedsBackupOnly(false);
      return;
    }

    if (bootedEmail.current === user.email && status === 'done' && folioUser) {
      return;
    }

    if (registrationInFlight.current) return;
    registrationInFlight.current = true;

    let cancelled = false;

    async function boot() {
      try {
        setStatus('loading');
        setError(null);

        const meRes = await authFetch('/api/users/me');
        const me = (await meRes.json().catch(() => ({}))) as MeResponse;
        if (cancelled) return;

        // 1) Local key + DB user
        if (hasKeypair() && getStoredPublicKey() && me.exists && me.user) {
          ensureServerKeyBackup(user!.email!).catch(() => {});
          // Prefer session passphrase to auto-complete missing backups
          if (!isBackupComplete(me)) {
            try {
              const cached = sessionStorage.getItem('folio:passphrase-cache');
              if (cached && cached.length >= 6) {
                await saveFullKeyBackup(user!.email!, cached);
                const me2 = (await (await authFetch('/api/users/me')).json()) as MeResponse;
                if (isBackupComplete(me2)) {
                  setFolioUser(me2.user || me.user);
                  setStatus('done');
                  bootedEmail.current = user!.email!;
                  setNeedsBackupOnly(false);
                  return;
                }
              }
            } catch (e) {
              console.warn('[registration] auto backup failed', e);
            }
            if (requestBackupIfIncomplete(me, me.user)) return;
          }
          setFolioUser(me.user);
          setStatus('done');
          bootedEmail.current = user!.email!;
          return;
        }

        // 2) Silent restore from server_wallet_key
        if (me.exists && me.hasServerWalletKey) {
          try {
            setStatus('recovering-key');
            await restoreFromServer(user!.email!);
            if (cancelled) return;
            const pub = getStoredPublicKey();
            if (pub && me.user) {
              // Must collect passphrase if backups incomplete (logout clears session cache)
              if (!isBackupComplete(me)) {
                try {
                  const cached = sessionStorage.getItem('folio:passphrase-cache');
                  if (cached && cached.length >= 6) {
                    await saveFullKeyBackup(user!.email!, cached);
                    const me2 = (await (await authFetch('/api/users/me')).json()) as MeResponse;
                    if (isBackupComplete(me2)) {
                      setFolioUser(me2.user || me.user);
                      setStatus('done');
                      bootedEmail.current = user!.email!;
                      return;
                    }
                  }
                } catch { /* */ }
                if (requestBackupIfIncomplete(me, me.user)) return;
              }
              setFolioUser(me.user);
              setStatus('done');
              bootedEmail.current = user!.email!;
              return;
            }
          } catch (e) {
            console.warn('[registration] server key restore failed', e);
          }
        }

        // 3) Encrypted backup exists → unlock with passphrase
        if (me.exists && me.hasPassphraseBackup) {
          const cached = (() => {
            try {
              return sessionStorage.getItem('folio:passphrase-cache');
            } catch {
              return null;
            }
          })();
          if (cached) {
            try {
              setStatus('recovering-key');
              await recoverKey(user!.email!, cached);
              if (cancelled) return;
              if (getStoredPublicKey() && me.user) {
                // Ensure wallet_passphrase column too
                if (!me.hasWalletPassphrase) {
                  await saveFullKeyBackup(user!.email!, cached);
                }
                setFolioUser(me.user);
                setStatus('done');
                bootedEmail.current = user!.email!;
                return;
              }
            } catch {
              try {
                sessionStorage.removeItem('folio:passphrase-cache');
              } catch { /* */ }
            }
          }
          if (cancelled) return;
          setIsNewUser(false);
          setNeedsBackupOnly(false);
          setNeedsRecovery(true);
          setNeedsPassphrase(true);
          setStatus('needs-passphrase');
          return;
        }

        // 4) Existing account, incomplete recovery options
        if (me.exists && me.user?.hederaAccountId) {
          if (me.hasServerWalletKey) {
            // restore failed above — ask passphrase only if they somehow have encrypted backup later
            setFolioUser(me.user);
            setIsNewUser(false);
            setNeedsBackupOnly(true);
            setNeedsPassphrase(true);
            setStatus('needs-passphrase');
            setError(
              'Verify your passphrase to secure recovery on this device. Your account stays the same.'
            );
            return;
          }
          setFolioUser(me.user);
          setIsNewUser(false);
          setNeedsRecovery(true);
          setNeedsPassphrase(true);
          setStatus('needs-passphrase');
          setError(
            'Unlock with your passphrase. A new wallet will not be created for this email.'
          );
          return;
        }

        // 5) Interrupted first signup (local key, no DB)
        if (hasKeypair() && getStoredPublicKey() && !me.exists) {
          await finishWithRegister(getStoredPublicKey()!);
          if (!cancelled) bootedEmail.current = user!.email!;
          return;
        }

        // 6) Brand-new user
        setIsNewUser(true);
        setNeedsRecovery(false);
        setNeedsBackupOnly(false);
        setNeedsPassphrase(true);
        setStatus('needs-passphrase');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Registration failed');
          setStatus('error');
        }
      } finally {
        registrationInFlight.current = false;
      }
    }

    boot();
    return () => {
      cancelled = true;
      if (status !== 'done') {
        registrationInFlight.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const [storedEvmAddress, setStoredEvmAddress] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.email || status !== 'done') return;
    const embeddedWallet = userWallets.find(
      (w) => w.connector?.isEmbeddedWallet === true
    );
    if (!embeddedWallet?.address || embeddedWallet.address === storedEvmAddress) return;

    setStoredEvmAddress(embeddedWallet.address);
    authFetch('/api/users/evm-wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evmAddress: embeddedWallet.address }),
    }).catch((err) => console.error('Failed to store EVM wallet:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, status, userWallets]);

  const registering =
    !!user?.email &&
    status !== 'done' &&
    status !== 'needs-passphrase' &&
    status !== 'error' &&
    !(status === 'idle' && !user?.email);

  return {
    folioUser,
    registering: registering || status === 'loading',
    status,
    error,
    needsPassphrase,
    needsRecovery,
    needsBackupOnly,
    isNewUser,
    submitPassphrase,
    submitRecoveryPassphrase,
  };
}
