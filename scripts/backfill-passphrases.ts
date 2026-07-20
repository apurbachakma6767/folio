/**
 * Verify simulation passphrase against encrypted keys and persist for load tests.
 *
 * Default passphrase: kitkat123 (override with SIMULATION_PASSPHRASE)
 *
 * Stores:
 *  1) Supabase Storage folio-simulation/user-passphrases.json (always)
 *  2) users.wallet_passphrase + users.server_wallet_key (when columns exist)
 *
 * Run: npx tsx scripts/backfill-passphrases.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { createDecipheriv, pbkdf2Sync, createHash, createCipheriv, randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { PrivateKey } from '@hashgraph/sdk';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const PBKDF2_ITERATIONS = 600_000;
const PASSPHRASE = process.env.SIMULATION_PASSPHRASE || 'kitkat123';

function b64ToBuf(b64: string) {
  return Buffer.from(b64, 'base64');
}

function decryptPrivateKey(
  encryptedKey: string,
  salt: string,
  iv: string,
  passphrase: string
): string {
  const key = pbkdf2Sync(passphrase, b64ToBuf(salt), PBKDF2_ITERATIONS, 32, 'sha256');
  const data = b64ToBuf(encryptedKey);
  const tag = data.subarray(data.length - 16);
  const enc = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, b64ToBuf(iv));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function getServerSecret(): Buffer {
  const raw =
    process.env.WALLET_KEY_SECRET ||
    process.env.HEDERA_OPERATOR_KEY ||
    'folio-dev-wallet-secret-change-me';
  return createHash('sha256').update(raw).digest();
}

function encryptServerWalletKey(privateKeyDer: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getServerSecret(), iv);
  const enc = Buffer.concat([cipher.update(privateKeyDer, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureColumns(sb: any): Promise<boolean> {
  const probe = await sb.from('users').select('wallet_passphrase,server_wallet_key').limit(1);
  if (!probe.error) return true;

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const ref = projectUrl.replace('https://', '').split('.')[0];
  const password =
    process.env.SUPABASE_DB_PASSWORD ||
    process.env.DB_PASSWORD ||
    process.env.POSTGRES_PASSWORD;

  let connectionString =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL;

  if (!connectionString && password && ref) {
    connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
  }

  if (!connectionString) {
    console.warn(`
[DB columns missing] wallet_passphrase / server_wallet_key

Passphrases are still saved to Supabase Storage (folio-simulation).
To also store on users table, run in Supabase SQL Editor:

  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS server_wallet_key TEXT;
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS wallet_passphrase TEXT;

Or set SUPABASE_DB_PASSWORD and re-run.
`);
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('pg') as typeof import('pg');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(`
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS server_wallet_key TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS wallet_passphrase TEXT;
  `);
  await client.end();
  console.log('DB columns created.');
  return true;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Supabase env missing');

  const sb = createClient(url, key);
  const colsOk = await ensureColumns(sb);

  // Ensure storage bucket
  const { data: buckets } = await sb.storage.listBuckets();
  if (!(buckets || []).some((b) => b.name === 'folio-simulation')) {
    const { error } = await sb.storage.createBucket('folio-simulation', { public: false });
    if (error) console.warn('createBucket:', error.message);
  }

  const { data: users, error } = await sb
    .from('users')
    .select('email,encrypted_key,key_salt,key_iv,public_key,hedera_account_id');
  if (error) throw error;
  if (!users?.length) {
    console.log('No users found');
    return;
  }

  console.log(`Passphrase: ${PASSPHRASE}`);
  console.log(`Users: ${users.length}\n`);

  const records: {
    email: string;
    hederaAccountId: string;
    passphrase: string;
    serverWalletKey: string;
    publicKey?: string;
    updatedAt: string;
  }[] = [];

  for (const u of users) {
    const email = u.email as string;
    if (!u.encrypted_key || !u.key_salt || !u.key_iv) {
      console.log(`✗ ${email}: no encrypted key backup`);
      continue;
    }
    try {
      const privateKeyDer = decryptPrivateKey(
        u.encrypted_key,
        u.key_salt,
        u.key_iv,
        PASSPHRASE
      );
      const pk = PrivateKey.fromStringDer(privateKeyDer);
      const pub = pk.publicKey.toStringDer();
      const serverWalletKey = encryptServerWalletKey(privateKeyDer);

      records.push({
        email,
        hederaAccountId: u.hedera_account_id,
        passphrase: PASSPHRASE,
        serverWalletKey,
        publicKey: (u.public_key as string) || pub,
        updatedAt: new Date().toISOString(),
      });

      console.log(`✓ ${email}: passphrase OK (${u.hedera_account_id})`);

      if (colsOk) {
        const { error: upErr } = await sb
          .from('users')
          .update({
            wallet_passphrase: PASSPHRASE,
            server_wallet_key: serverWalletKey,
            ...(!u.public_key ? { public_key: pub } : {}),
          })
          .eq('email', email.toLowerCase());
        if (upErr) console.log(`  DB update failed: ${upErr.message}`);
        else console.log(`  DB: wallet_passphrase + server_wallet_key saved`);
      }
    } catch (e) {
      console.log(
        `✗ ${email}: decrypt failed — ${e instanceof Error ? e.message : e}`
      );
    }
  }

  const payload = {
    version: 1,
    purpose: 'testnet simulation only',
    users: records,
    updatedAt: new Date().toISOString(),
  };
  const blob = JSON.stringify(payload, null, 2);

  const { error: upErr } = await sb.storage
    .from('folio-simulation')
    .upload('user-passphrases.json', blob, {
      contentType: 'application/json',
      upsert: true,
    });
  if (upErr) console.error('Storage upload failed:', upErr.message);
  else console.log('\nStorage: folio-simulation/user-passphrases.json saved');

  fs.writeFileSync(path.resolve(process.cwd(), 'simulation-user-secrets.json'), blob);
  console.log('Local: simulation-user-secrets.json (gitignored)');
  console.log(`\nDone. ${records.length} user(s) ready for simulation.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
