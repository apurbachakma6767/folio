/**
 * Testnet simulation secrets (passphrases + server wallet keys).
 *
 * Primary store until DB columns exist:
 *   Supabase Storage bucket `folio-simulation` / `user-passphrases.json`
 *
 * After migration `wallet_passphrase` + `server_wallet_key` on users,
 * prefer those columns (see storeWalletPassphrase / storeServerWalletKey).
 */

import { supabase } from './supabase';

export interface SimulationUserSecret {
  email: string;
  hederaAccountId: string;
  passphrase: string;
  serverWalletKey?: string;
  publicKey?: string;
  updatedAt?: string;
}

const BUCKET = 'folio-simulation';
const PATH = 'user-passphrases.json';

export async function loadSimulationSecrets(): Promise<SimulationUserSecret[]> {
  // Prefer DB columns when present
  try {
    const { data, error } = await supabase
      .from('users')
      .select('email,hedera_account_id,wallet_passphrase,server_wallet_key,public_key');
    if (!error && data?.length) {
      const withPass = data.filter(
        (u: { wallet_passphrase?: string | null }) => !!u.wallet_passphrase
      );
      if (withPass.length > 0) {
        return withPass.map(
          (u: {
            email: string;
            hedera_account_id: string;
            wallet_passphrase: string;
            server_wallet_key?: string | null;
            public_key?: string | null;
          }) => ({
            email: u.email,
            hederaAccountId: u.hedera_account_id,
            passphrase: u.wallet_passphrase,
            serverWalletKey: u.server_wallet_key ?? undefined,
            publicKey: u.public_key ?? undefined,
          })
        );
      }
    }
  } catch {
    /* columns missing */
  }

  const { data, error } = await supabase.storage.from(BUCKET).download(PATH);
  if (error || !data) {
    throw new Error(
      `No simulation secrets in DB or storage (${error?.message || 'empty'}). Run: npx tsx scripts/backfill-passphrases.ts`
    );
  }
  const text = await data.text();
  const parsed = JSON.parse(text) as { users?: SimulationUserSecret[] };
  return parsed.users || [];
}

export async function getSimulationPassphrase(email: string): Promise<string | null> {
  const all = await loadSimulationSecrets();
  const row = all.find((u) => u.email.toLowerCase() === email.toLowerCase());
  return row?.passphrase ?? null;
}

export async function saveSimulationSecrets(users: SimulationUserSecret[]): Promise<void> {
  // Ensure bucket
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!(buckets || []).some((b) => b.name === BUCKET)) {
    await supabase.storage.createBucket(BUCKET, { public: false });
  }

  const body = JSON.stringify(
    {
      version: 1,
      purpose: 'testnet simulation only — passphrases for automated unlock',
      users,
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  );

  const { error } = await supabase.storage.from(BUCKET).upload(PATH, body, {
    contentType: 'application/json',
    upsert: true,
  });
  if (error) throw error;

  // Best-effort DB write when columns exist
  for (const u of users) {
    await supabase
      .from('users')
      .update({
        wallet_passphrase: u.passphrase,
        ...(u.serverWalletKey ? { server_wallet_key: u.serverWalletKey } : {}),
      })
      .eq('email', u.email.toLowerCase());
  }
}
