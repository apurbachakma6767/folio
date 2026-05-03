'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useDynamicContext, useUserWallets } from '@dynamic-labs/sdk-react-core';
import { authFetch } from '@/lib/use-auth-fetch';
import { useHederaKey } from './use-hedera-key';
import { hasKeypair, getStoredPublicKey } from './hedera-keystore';

export interface FolioUser {
  email: string;
  name: string;
  hederaAccountId: string;
  publicKey?: string;
}

type RegistrationStatus =
  | 'idle'
  | 'generating-key'
  | 'needs-passphrase'
  | 'creating-account'
  | 'signing-association'
  | 'completing'
  | 'encrypting-key'
  | 'recovering-key'
  | 'done'
  | 'error';

export function useUserRegistration() {
  const { user } = useDynamicContext();
  const userWallets = useUserWallets();
  const { publicKeyDer, generateKey, signTransaction, encryptAndStore, recoverKey } = useHederaKey();
  const [folioUser, setFolioUser] = useState<FolioUser | null>(null);
  const [status, setStatus] = useState<RegistrationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const registrationInFlight = useRef(false);

  // Called by UI when user submits passphrase for new registration
  const submitPassphrase = useCallback(async (passphrase: string) => {
    if (!user?.email) return;
    setNeedsPassphrase(false);

    try {
      // Generate keypair
      setStatus('generating-key');
      const pubKey = await generateKey();

      // Register with server
      setStatus('creating-account');
      const res = await authFetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          name: user.firstName || '',
          publicKey: pubKey,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || 'Registration failed');
      }

      const data = await res.json();

      // Sign token association if needed
      if (data.needsTokenAssociation) {
        setStatus('signing-association');
        const signedTxBytes = await signTransaction(data.tokenAssocTxBytes);

        setStatus('completing');
        const completeRes = await authFetch('/api/users/register/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, signedTxBytes }),
        });

        if (!completeRes.ok) {
          const err = await completeRes.json().catch(() => ({}));
          throw new Error(err.details || err.error || 'Token association failed');
        }
      }

      // Encrypt key and store in Supabase
      setStatus('encrypting-key');
      await encryptAndStore(user.email, passphrase);
      // Cache passphrase in sessionStorage so refreshes within same tab don't re-prompt
      try { sessionStorage.setItem('folio:passphrase-cache', passphrase); } catch { /* private browsing */ }

      setFolioUser(data.user);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      setStatus('error');
    }
  }, [user, generateKey, signTransaction, encryptAndStore]);

  // Called by UI when user submits passphrase for key recovery
  const submitRecoveryPassphrase = useCallback(async (passphrase: string) => {
    if (!user?.email) return;
    setNeedsRecovery(false);

    try {
      setStatus('recovering-key');
      await recoverKey(user.email, passphrase);
      // Cache passphrase in sessionStorage so refreshes within same tab don't re-prompt
      try { sessionStorage.setItem('folio:passphrase-cache', passphrase); } catch { /* private browsing */ }
      setStatus('idle');
    } catch {
      setError('Wrong passphrase. Please try again.');
      setNeedsRecovery(true);
      setStatus('error');
    }
  }, [user, recoverKey]);

  useEffect(() => {
    if (!user?.email) return;
    // Prevent StrictMode double-execution — if registration is already in flight, skip
    if (registrationInFlight.current) return;
    registrationInFlight.current = true;

    let cancelled = false;

    async function register() {
      try {
        // If we already have a key locally, try normal registration
        // Read directly from localStorage to avoid race with useEffect state
        const localHasKey = hasKeypair();
        const pubKey = localHasKey ? getStoredPublicKey() : publicKeyDer;
        if (localHasKey && pubKey) {
          setStatus('creating-account');
          const res = await authFetch('/api/users/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: user!.email,
              name: user!.firstName || '',
              publicKey: pubKey,
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.details || err.error || 'Registration failed');
          }

          const data = await res.json();
          if (cancelled) return;

          if (!data.needsTokenAssociation) {
            setFolioUser(data.user);
            setStatus('done');
            return;
          }

          setStatus('signing-association');
          const signedTxBytes = await signTransaction(data.tokenAssocTxBytes);
          if (cancelled) return;

          setStatus('completing');
          const completeRes = await authFetch('/api/users/register/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user!.email, signedTxBytes }),
          });

          if (!completeRes.ok) {
            const err = await completeRes.json().catch(() => ({}));
            throw new Error(err.details || err.error || 'Token association failed');
          }

          if (cancelled) return;
          setFolioUser(data.user);
          setStatus('done');
          return;
        }

        // No local key — check if user exists with an encrypted key backup
        const keyRes = await authFetch(`/api/users/key?email=${encodeURIComponent(user!.email!)}`);
        const keyData = await keyRes.json().catch(() => ({}));
        if (cancelled) return;

        if (keyData.hasEncryptedKey) {
          // Try auto-recovery with cached passphrase (same browser session)
          const cachedPassphrase = (() => { try { return sessionStorage.getItem('folio:passphrase-cache'); } catch { return null; } })();
          if (cachedPassphrase) {
            try {
              setStatus('recovering-key');
              await recoverKey(user!.email!, cachedPassphrase);
              if (cancelled) return;
              // Re-run registration with recovered key
              const recoveredPubKey = getStoredPublicKey();
              if (recoveredPubKey) {
                setStatus('creating-account');
                const regRes = await authFetch('/api/users/register', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: user!.email, name: user!.firstName || '', publicKey: recoveredPubKey }),
                });
                if (regRes.ok) {
                  const regData = await regRes.json();
                  if (cancelled) return;
                  // Handle token association if needed (new account after wipe/reset)
                  if (regData.needsTokenAssociation && regData.tokenAssocTxBytes) {
                    setStatus('signing-association');
                    const signedTxBytes = await signTransaction(regData.tokenAssocTxBytes);
                    if (cancelled) return;
                    setStatus('completing');
                    await authFetch('/api/users/register/complete', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: user!.email, signedTxBytes }),
                    });
                  }
                  if (!cancelled) { setFolioUser(regData.user); setStatus('done'); }
                  return;
                }
              }
            } catch {
              // Cached passphrase was wrong (changed?), clear it and prompt
              try { sessionStorage.removeItem('folio:passphrase-cache'); } catch { /* */ }
            }
          }
          if (cancelled) return;
          setNeedsRecovery(true);
          setStatus('needs-passphrase');
          return;
        }

        // New user — needs passphrase to encrypt key
        setIsNewUser(true);
        setNeedsPassphrase(true);
        setStatus('needs-passphrase');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Registration failed');
          setStatus('error');
        }
      }
    }

    register().finally(() => { registrationInFlight.current = false; });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  // Store EVM embedded wallet address when available (runs once per address)
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

  return {
    folioUser,
    registering: status !== 'idle' && status !== 'done' && status !== 'error' && status !== 'needs-passphrase',
    status,
    error,
    needsPassphrase,
    needsRecovery,
    isNewUser,
    submitPassphrase,
    submitRecoveryPassphrase,
  };
}
