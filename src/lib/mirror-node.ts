// Mirror Node REST API client — query Hedera testnet transaction history
// https://docs.hedera.com/hedera/sdks-and-apis/rest-api

const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com';

export interface MirrorTransaction {
  transaction_id: string;
  consensus_timestamp: string;
  name: string;
  result: string;
  transfers: Array<{
    account: string;
    amount: number;
  }>;
  token_transfers: Array<{
    token_id: string;
    account: string;
    amount: number;
  }>;
}

export interface HcsMessage {
  sequence_number: number;
  consensus_timestamp: string;
  message: string; // base64-encoded
  payer_account_id: string;
}

// Get recent transactions for an account
export async function getAccountTransactions(
  accountId: string,
  limit: number = 25
): Promise<MirrorTransaction[]> {
  const res = await fetch(
    `${MIRROR_BASE}/api/v1/transactions?account.id=${accountId}&limit=${limit}&order=desc`
  );
  if (!res.ok) throw new Error(`Mirror Node error: ${res.status}`);
  const data = await res.json();
  return data.transactions ?? [];
}

// Get token balances for an account (alternative to SDK AccountBalanceQuery)
export async function getAccountTokenBalances(
  accountId: string
): Promise<Array<{ token_id: string; balance: number }>> {
  const res = await fetch(
    `${MIRROR_BASE}/api/v1/accounts/${accountId}/tokens`
  );
  if (!res.ok) throw new Error(`Mirror Node error: ${res.status}`);
  const data = await res.json();
  return data.tokens ?? [];
}

// Get NFTs owned by an account
export async function getAccountNfts(
  accountId: string,
  tokenId?: string
): Promise<Array<{ token_id: string; serial_number: number; metadata: string }>> {
  let url = `${MIRROR_BASE}/api/v1/accounts/${accountId}/nfts?limit=100`;
  if (tokenId) url += `&token.id=${tokenId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mirror Node error: ${res.status}`);
  const data = await res.json();
  return data.nfts ?? [];
}

// Get messages from an HCS topic
export async function getTopicMessages(
  topicId: string,
  limit: number = 25
): Promise<HcsMessage[]> {
  const res = await fetch(
    `${MIRROR_BASE}/api/v1/topics/${topicId}/messages?limit=${limit}&order=desc`
  );
  if (!res.ok) throw new Error(`Mirror Node error: ${res.status}`);
  const data = await res.json();
  return data.messages ?? [];
}

// Decode base64 HCS message to JSON
export function decodeHcsMessage(base64: string): Record<string, unknown> {
  const decoded = Buffer.from(base64, 'base64').toString('utf-8');
  return JSON.parse(decoded);
}

// Get token info (name, symbol, decimals, supply, custom fees)
export async function getTokenInfo(tokenId: string): Promise<{
  name: string;
  symbol: string;
  decimals: string;
  total_supply: string;
  custom_fees: { fixed_fees: unknown[]; fractional_fees: unknown[] };
  kyc_key: unknown;
  freeze_key: unknown;
}> {
  const res = await fetch(`${MIRROR_BASE}/api/v1/tokens/${tokenId}`);
  if (!res.ok) throw new Error(`Mirror Node error: ${res.status}`);
  return res.json();
}

// Get transaction details by ID
export async function getTransactionById(
  txId: string
): Promise<MirrorTransaction | null> {
  // Convert 0.0.12345@1234567890.000 → 0.0.12345-1234567890-000
  const normalized = txId.replace('@', '-').replace(/\.(\d+)$/, '-$1');
  const res = await fetch(
    `${MIRROR_BASE}/api/v1/transactions/${normalized}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.transactions?.[0] ?? null;
}
