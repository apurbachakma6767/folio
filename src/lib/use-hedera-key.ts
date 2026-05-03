'use client';

import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '@/lib/use-auth-fetch';
import {
  hasKeypair,
  generateKeypair,
  getStoredPublicKey,
  signTransaction as keystoreSign,
  exportKey,
  importKey,
  validateImportedKey,
  clearKeypair,
  encryptPrivateKey,
  decryptPrivateKey,
} from './hedera-keystore';

export function useHederaKey() {
  const [hasKey, setHasKey] = useState(false);
  const [publicKeyDer, setPublicKeyDer] = useState<string | null>(null);

  useEffect(() => {
    setHasKey(hasKeypair());
    setPublicKeyDer(getStoredPublicKey());
  }, []);

  const generateKey = useCallback(async () => {
    const { publicKeyDer: pub } = await generateKeypair();
    setHasKey(true);
    setPublicKeyDer(pub);
    return pub;
  }, []);

  const signTransaction = useCallback(async (txBytesBase64: string): Promise<string> => {
    const txBytes = Uint8Array.from(atob(txBytesBase64), (c) => c.charCodeAt(0));
    const signedBytes = await keystoreSign(txBytes);
    // Convert back to base64
    let binary = '';
    for (let i = 0; i < signedBytes.length; i++) {
      binary += String.fromCharCode(signedBytes[i]);
    }
    return btoa(binary);
  }, []);

  // Encrypt the current local key and store in Supabase
  const encryptAndStore = useCallback(async (email: string, passphrase: string) => {
    const privateKeyDer = exportKey();
    if (!privateKeyDer) throw new Error('No key to encrypt');

    const { encryptedKey, salt, iv } = await encryptPrivateKey(privateKeyDer, passphrase);

    const res = await authFetch('/api/users/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, encryptedKey, keySalt: salt, keyIv: iv }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to store encrypted key');
    }
  }, []);

  // Recover key from Supabase encrypted backup
  const recoverKey = useCallback(async (email: string, passphrase: string) => {
    const res = await authFetch(`/api/users/key?email=${encodeURIComponent(email)}`);
    const data = await res.json();

    if (!data.hasEncryptedKey) throw new Error('No encrypted key backup found');

    const privateKeyDer = await decryptPrivateKey(
      data.encryptedKey, data.keySalt, data.keyIv, passphrase
    );

    importKey(privateKeyDer);
    const pub = await validateImportedKey();
    setHasKey(true);
    setPublicKeyDer(pub);
    return pub;
  }, []);

  const doExportKey = useCallback(() => exportKey(), []);

  const doImportKey = useCallback(async (der: string) => {
    importKey(der);
    const pub = await validateImportedKey();
    setHasKey(true);
    setPublicKeyDer(pub);
    return pub;
  }, []);

  const doClearKey = useCallback(() => {
    clearKeypair();
    setHasKey(false);
    setPublicKeyDer(null);
  }, []);

  return {
    hasKey,
    publicKeyDer,
    generateKey,
    signTransaction,
    encryptAndStore,
    recoverKey,
    exportKey: doExportKey,
    importKey: doImportKey,
    clearKey: doClearKey,
  };
}
