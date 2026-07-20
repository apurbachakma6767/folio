// Server-side wallet key encryption (AES-256-GCM)
// Keys stored in Supabase so users can restore without local browser state.
// Not surfaced in product UI.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

function getSecret(): Buffer {
  const raw =
    process.env.WALLET_KEY_SECRET ||
    process.env.HEDERA_OPERATOR_KEY ||
    'folio-dev-wallet-secret-change-me';
  return createHash('sha256').update(raw).digest();
}

export function encryptServerWalletKey(privateKeyDer: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getSecret(), iv);
  const enc = Buffer.concat([cipher.update(privateKeyDer, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptServerWalletKey(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getSecret(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
