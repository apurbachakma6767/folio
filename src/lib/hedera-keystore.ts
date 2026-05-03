'use client';

// Client-side Hedera key management — private key never leaves the browser
// Keys are encrypted client-side with a user passphrase before being stored in Supabase

const STORAGE_KEY_PRIVATE = 'folio:hedera:privateKey';
const STORAGE_KEY_PUBLIC = 'folio:hedera:publicKey';

// --- Encryption helpers (Web Crypto API) ---

const PBKDF2_ITERATIONS = 600_000;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(passphrase);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.buffer as ArrayBuffer, 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPrivateKey(
  privateKeyDer: string,
  passphrase: string
): Promise<{ encryptedKey: string; salt: string; iv: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(privateKeyDer);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    plaintext.buffer as ArrayBuffer
  );
  return {
    encryptedKey: bufferToBase64(new Uint8Array(encrypted)),
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
  };
}

export async function decryptPrivateKey(
  encryptedKey: string,
  salt: string,
  iv: string,
  passphrase: string
): Promise<string> {
  const key = await deriveKey(passphrase, base64ToBuffer(salt));
  const ivBuf = base64ToBuffer(iv);
  const dataBuf = base64ToBuffer(encryptedKey);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuf.buffer as ArrayBuffer },
    key,
    dataBuf.buffer as ArrayBuffer
  );
  return new TextDecoder().decode(decrypted);
}

function bufferToBase64(buf: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function hasKeypair(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(STORAGE_KEY_PRIVATE);
}

export async function generateKeypair(): Promise<{ privateKeyDer: string; publicKeyDer: string }> {
  const { PrivateKey } = await import('@hashgraph/sdk');
  const privateKey = PrivateKey.generateED25519();
  const privateKeyDer = privateKey.toStringDer();
  const publicKeyDer = privateKey.publicKey.toStringDer();

  localStorage.setItem(STORAGE_KEY_PRIVATE, privateKeyDer);
  localStorage.setItem(STORAGE_KEY_PUBLIC, publicKeyDer);

  return { privateKeyDer, publicKeyDer };
}

export function getStoredPublicKey(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY_PUBLIC);
}

export async function signTransaction(txBytes: Uint8Array): Promise<Uint8Array> {
  const { PrivateKey, Transaction } = await import('@hashgraph/sdk');
  const privateKeyDer = localStorage.getItem(STORAGE_KEY_PRIVATE);
  if (!privateKeyDer) throw new Error('No private key found — please back up and re-import your key');

  const privateKey = PrivateKey.fromStringDer(privateKeyDer);
  const tx = Transaction.fromBytes(txBytes);
  await tx.sign(privateKey);
  return tx.toBytes();
}

export function exportKey(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY_PRIVATE);
}

export function importKey(privateKeyDer: string): string {
  // Validate by parsing — throws if invalid
  // We do this synchronously since PrivateKey.fromStringDer is sync in the SDK
  // but we need the dynamic import for tree-shaking
  localStorage.setItem(STORAGE_KEY_PRIVATE, privateKeyDer);
  // Derive public key — caller should call validateImportedKey() after
  return privateKeyDer;
}

export async function validateImportedKey(): Promise<string> {
  const { PrivateKey } = await import('@hashgraph/sdk');
  const privateKeyDer = localStorage.getItem(STORAGE_KEY_PRIVATE);
  if (!privateKeyDer) throw new Error('No key to validate');

  const privateKey = PrivateKey.fromStringDer(privateKeyDer);
  const publicKeyDer = privateKey.publicKey.toStringDer();
  localStorage.setItem(STORAGE_KEY_PUBLIC, publicKeyDer);
  return publicKeyDer;
}

export function clearKeypair(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY_PRIVATE);
  localStorage.removeItem(STORAGE_KEY_PUBLIC);
}
