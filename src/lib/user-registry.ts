// User registry — maps Dynamic auth users to Hedera accounts (Supabase-backed)

import { supabase } from './supabase';

export interface FolioUser {
  email: string;
  name: string;
  hederaAccountId: string;
  publicKey?: string;
  encryptedKey?: string;
  keySalt?: string;
  keyIv?: string;
  serverWalletKey?: string;
  /** Simulation-only: plaintext passphrase for automated unlock */
  walletPassphrase?: string;
  testnetHederaAccountId?: string;
  testnetPublicKey?: string;
  testnetServerWalletKey?: string;
  displayName?: string;
  birthDate?: string;
  phone?: string;
  country?: string;
  city?: string;
  evmWalletAddress?: string;
  delegationWalletId?: string;
  delegationApiKey?: string;
  delegationKeyShare?: string;
  createdAt: string;
}

interface UserRow {
  email: string;
  name: string;
  hedera_account_id: string;
  public_key: string | null;
  encrypted_key: string | null;
  key_salt: string | null;
  key_iv: string | null;
  server_wallet_key?: string | null;
  wallet_passphrase?: string | null;
  testnet_hedera_account_id?: string | null;
  testnet_public_key?: string | null;
  testnet_server_wallet_key?: string | null;
  display_name?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  country?: string | null;
  city?: string | null;
  evm_wallet_address: string | null;
  delegation_wallet_id: string | null;
  delegation_api_key: string | null;
  delegation_key_share: string | null;
  created_at: string;
}

function rowToUser(row: UserRow): FolioUser {
  return {
    email: row.email,
    name: row.name,
    hederaAccountId: row.hedera_account_id,
    publicKey: row.public_key ?? undefined,
    encryptedKey: row.encrypted_key ?? undefined,
    keySalt: row.key_salt ?? undefined,
    keyIv: row.key_iv ?? undefined,
    serverWalletKey: row.server_wallet_key ?? undefined,
    walletPassphrase: row.wallet_passphrase ?? undefined,
    testnetHederaAccountId: row.testnet_hedera_account_id ?? undefined,
    testnetPublicKey: row.testnet_public_key ?? undefined,
    testnetServerWalletKey: row.testnet_server_wallet_key ?? undefined,
    displayName: row.display_name ?? undefined,
    birthDate: row.birth_date ?? undefined,
    phone: row.phone ?? undefined,
    country: row.country ?? undefined,
    city: row.city ?? undefined,
    evmWalletAddress: row.evm_wallet_address ?? undefined,
    delegationWalletId: row.delegation_wallet_id ?? undefined,
    delegationApiKey: row.delegation_api_key ?? undefined,
    delegationKeyShare: row.delegation_key_share ?? undefined,
    createdAt: row.created_at,
  };
}

/** Extended profile fields when DB columns not migrated yet */
type ProfileExtras = {
  displayName?: string;
  birthDate?: string;
  phone?: string;
  country?: string;
  city?: string;
};

const PROFILE_BUCKET = 'folio-simulation';
const PROFILE_PATH = 'user-profiles.json';

async function loadProfileExtrasMap(): Promise<Record<string, ProfileExtras>> {
  try {
    const { data, error } = await supabase.storage
      .from(PROFILE_BUCKET)
      .download(PROFILE_PATH);
    if (error || !data) return {};
    const parsed = JSON.parse(await data.text()) as { profiles?: Record<string, ProfileExtras> };
    return parsed.profiles || {};
  } catch {
    return {};
  }
}

async function saveProfileExtras(email: string, extras: ProfileExtras): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!(buckets || []).some((b) => b.name === PROFILE_BUCKET)) {
      await supabase.storage.createBucket(PROFILE_BUCKET, { public: false });
    }
    const map = await loadProfileExtrasMap();
    map[email.toLowerCase()] = { ...map[email.toLowerCase()], ...extras };
    const body = JSON.stringify({ profiles: map, updatedAt: new Date().toISOString() }, null, 2);
    await supabase.storage.from(PROFILE_BUCKET).upload(PROFILE_PATH, body, {
      contentType: 'application/json',
      upsert: true,
    });
  } catch (e) {
    console.warn('[user-registry] profile extras storage failed', e);
  }
}

export async function updateUserProfile(
  email: string,
  profile: {
    displayName?: string;
    birthDate?: string;
    phone?: string;
    country?: string;
    city?: string;
    name?: string;
  }
): Promise<FolioUser> {
  const key = email.toLowerCase();
  const display = profile.displayName ?? profile.name;

  // Always try full column set first
  const fullRow: Record<string, string | null> = {};
  if (display !== undefined) {
    fullRow.display_name = display || null;
    if (display) fullRow.name = display;
  }
  if (profile.name !== undefined) fullRow.name = profile.name;
  if (profile.birthDate !== undefined) fullRow.birth_date = profile.birthDate || null;
  if (profile.phone !== undefined) fullRow.phone = profile.phone || null;
  if (profile.country !== undefined) fullRow.country = profile.country || null;
  if (profile.city !== undefined) fullRow.city = profile.city || null;

  let { data, error } = await supabase
    .from('users')
    .update(fullRow)
    .eq('email', key)
    .select()
    .single();

  // Fallback when profile columns not migrated: update name only + store extras in Storage
  if (error && /column|schema cache|does not exist/i.test(error.message || '')) {
    console.warn('[user-registry] profile columns missing — name + storage fallback');
    const nameOnly: Record<string, string> = {};
    if (display) nameOnly.name = display;
    else if (profile.name) nameOnly.name = profile.name;

    if (Object.keys(nameOnly).length) {
      const r2 = await supabase
        .from('users')
        .update(nameOnly)
        .eq('email', key)
        .select()
        .single();
      data = r2.data;
      error = r2.error;
    } else {
      // nothing to write to users row — load existing
      const existing = await getUser(email);
      if (!existing) throw new Error('User not found');
      data = null;
      error = null;
      await saveProfileExtras(key, {
        displayName: display,
        birthDate: profile.birthDate,
        phone: profile.phone,
        country: profile.country,
        city: profile.city,
      });
      const extras = (await loadProfileExtrasMap())[key] || {};
      return {
        ...existing,
        displayName: extras.displayName || existing.displayName || existing.name,
        birthDate: extras.birthDate || existing.birthDate,
        phone: extras.phone || existing.phone,
        country: extras.country || existing.country,
        city: extras.city || existing.city,
      };
    }

    await saveProfileExtras(key, {
      displayName: display,
      birthDate: profile.birthDate,
      phone: profile.phone,
      country: profile.country,
      city: profile.city,
    });
  }

  if (error) throw error;
  if (!data) {
    const existing = await getUser(email);
    if (!existing) throw new Error('User not found');
    return existing;
  }

  const user = rowToUser(data);
  // Merge storage extras if DB columns empty
  const extras = (await loadProfileExtrasMap())[key];
  if (extras) {
    return {
      ...user,
      displayName: user.displayName || extras.displayName || user.name,
      birthDate: user.birthDate || extras.birthDate,
      phone: user.phone || extras.phone,
      country: user.country || extras.country,
      city: user.city || extras.city,
    };
  }
  return user;
}

export async function getUser(email: string): Promise<FolioUser | undefined> {
  // Select * so missing optional columns don't break older DBs
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase())
    .single();
  if (error || !data) return undefined;

  const user = rowToUser(data as UserRow);
  const extras = (await loadProfileExtrasMap())[email.toLowerCase()];
  if (!extras) return user;
  return {
    ...user,
    displayName: user.displayName || extras.displayName || user.name,
    birthDate: user.birthDate || extras.birthDate,
    phone: user.phone || extras.phone,
    country: user.country || extras.country,
    city: user.city || extras.city,
  };
}

export async function registerUser(
  email: string,
  name: string,
  hederaAccountId: string,
  publicKey?: string
): Promise<FolioUser> {
  const key = email.toLowerCase();
  // Prefer a real display name; never invent placeholders like email-local-part only.
  // Empty name is allowed — UI can fall back to email for display.
  const cleanName = (name || '').trim();
  const row: Record<string, string> = {
    email: key,
    name: cleanName || key, // keep email as last-resort for search; not a fabricated nickname
    hedera_account_id: hederaAccountId,
  };
  if (cleanName) row.display_name = cleanName;
  if (publicKey) row.public_key = publicKey;
  const { data, error } = await supabase
    .from('users')
    .upsert(row, { onConflict: 'email' })
    .select()
    .single();
  if (error) throw error;
  return rowToUser(data);
}

export async function storeEncryptedKey(
  email: string,
  encryptedKey: string,
  keySalt: string,
  keyIv: string
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({
      encrypted_key: encryptedKey,
      key_salt: keySalt,
      key_iv: keyIv,
    })
    .eq('email', email.toLowerCase());
  if (error) throw error;
}

/** Server-encrypted private key backup (not shown in UI). */
export async function storeServerWalletKey(
  email: string,
  serverWalletKey: string
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ server_wallet_key: serverWalletKey })
    .eq('email', email.toLowerCase());
  if (error && !/server_wallet_key|column/i.test(error.message || '')) {
    throw error;
  }
  if (error) {
    console.warn('[user-registry] storeServerWalletKey:', error.message);
  }
}

/**
 * Store wallet passphrase in Supabase (all networks, including mainnet).
 * Used for device recovery and automated unlock. Also store encrypted_key separately.
 */
export async function storeWalletPassphrase(
  email: string,
  passphrase: string
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ wallet_passphrase: passphrase })
    .eq('email', email.toLowerCase());
  if (error && !/wallet_passphrase|column/i.test(error.message || '')) {
    throw error;
  }
  if (error) {
    console.warn('[user-registry] storeWalletPassphrase:', error.message);
  }
}

export async function storeTestnetAccount(
  email: string,
  accountId: string,
  publicKey?: string,
  serverWalletKey?: string
): Promise<void> {
  const row: Record<string, string> = {
    testnet_hedera_account_id: accountId,
  };
  if (publicKey) row.testnet_public_key = publicKey;
  if (serverWalletKey) row.testnet_server_wallet_key = serverWalletKey;
  const { error } = await supabase
    .from('users')
    .update(row)
    .eq('email', email.toLowerCase());
  if (error && !/testnet_|column/i.test(error.message || '')) {
    throw error;
  }
  if (error) {
    console.warn('[user-registry] storeTestnetAccount:', error.message);
  }
}

export async function updateEvmWallet(
  email: string,
  evmWalletAddress: string
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ evm_wallet_address: evmWalletAddress })
    .eq('email', email.toLowerCase());
  if (error) throw error;
}

export async function storeDelegationCredentials(
  email: string,
  walletId: string,
  apiKey: string,
  keyShare: string
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({
      delegation_wallet_id: walletId,
      delegation_api_key: apiKey,
      delegation_key_share: keyShare,
    })
    .eq('email', email.toLowerCase());
  if (error) throw error;
}

export async function searchUsers(query: string): Promise<FolioUser[]> {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const { data } = await supabase
    .from('users')
    .select('*')
    .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(20);
  return (data ?? []).map((row) => rowToUser(row as UserRow));
}

export async function getUserByAccountId(
  accountId: string
): Promise<FolioUser | undefined> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('hedera_account_id', accountId)
    .single();
  return data ? rowToUser(data as UserRow) : undefined;
}

export async function getAllUsers(): Promise<FolioUser[]> {
  const { data } = await supabase.from('users').select('*');
  return (data ?? []).map((row) => rowToUser(row as UserRow));
}
