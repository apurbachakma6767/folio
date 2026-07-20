// Token Registry — maps HTS token IDs to equity symbols
//
// One fungible HTS token per stock symbol (shared by all users).
// Source of truth: Supabase `folio_equity_tokens` (DB).
// Optional env seeds: TSLA_TOKEN_ID, AAPL_TOKEN_ID, … (legacy MOCK_*_TOKEN_ID still accepted).

import { TRADE_STOCKS } from './types';

export interface TokenEntry {
  symbol: string;
  name: string;
  tokenId: string; // HTS token ID (0.0.XXXXX)
  decimals: number;
  /** folio = Folio HTS equity; circle = USDC; swarm = future real RWA */
  provider: 'folio' | 'swarm' | 'circle' | 'mock';
  type: 'stock' | 'crypto';
}

/** Runtime cache (DB hydrate + env + newly created). */
const dynamicStockTokens = new Map<string, TokenEntry>();

/**
 * Env keys for equity token IDs (preferred first):
 *   TSLA_TOKEN_ID, AAPL_TOKEN_ID, …
 * Legacy:
 *   MOCK_TSLA_TOKEN_ID, MOCK_AAPL_TOKEN_ID, …
 */
export function envTokenId(symbol: string): string | undefined {
  const sym = symbol.toUpperCase();
  const preferred = process.env[`${sym}_TOKEN_ID`]?.trim();
  if (preferred) return preferred;
  const legacy = process.env[`MOCK_${sym}_TOKEN_ID`]?.trim();
  return legacy || undefined;
}

export function envTokenKey(symbol: string): string {
  return `${symbol.toUpperCase()}_TOKEN_ID`;
}

function stockName(symbol: string): string {
  return TRADE_STOCKS.find((s) => s.symbol === symbol.toUpperCase())?.name ?? symbol;
}

/** Register a stock token id in the runtime registry. */
export function registerStockToken(
  symbol: string,
  tokenId: string,
  name?: string
): TokenEntry {
  const sym = symbol.toUpperCase();
  const entry: TokenEntry = {
    symbol: sym,
    name: name || stockName(sym),
    tokenId,
    decimals: 6,
    provider: 'folio',
    type: 'stock',
  };
  dynamicStockTokens.set(sym, entry);
  return entry;
}

/** Preload all equity tokens from Supabase (primary store). */
export async function hydrateTokenRegistryFromDb(): Promise<void> {
  try {
    const { supabase } = await import('./supabase');
    const { data } = await supabase.from('folio_equity_tokens').select('symbol,name,token_id');
    for (const row of data ?? []) {
      if (row.token_id && row.symbol) {
        registerStockToken(row.symbol, row.token_id, row.name);
      }
    }
  } catch {
    /* table may not exist yet */
  }
}

// Build registry from DB cache + env seeds
export function getTokenRegistry(): TokenEntry[] {
  const bySymbol = new Map<string, TokenEntry>();

  // Dynamic / DB-loaded first
  for (const [sym, entry] of dynamicStockTokens) {
    bySymbol.set(sym, entry);
  }

  // Env seeds (fill gaps only)
  for (const s of TRADE_STOCKS) {
    if (bySymbol.has(s.symbol)) continue;
    const id = envTokenId(s.symbol);
    if (id) {
      bySymbol.set(s.symbol, {
        symbol: s.symbol,
        name: s.name,
        tokenId: id,
        decimals: 6,
        provider: 'folio',
        type: 'stock',
      });
    }
  }

  // USDC
  const usdcFromNative = process.env.USDC_TOKEN_ID?.trim();
  const usdcId = usdcFromNative || process.env.USDC_TEST_TOKEN_ID?.trim();
  const entries = Array.from(bySymbol.values());
  if (usdcId) {
    entries.push({
      symbol: 'USDC',
      name: 'USD Coin',
      tokenId: usdcId,
      decimals: 6,
      provider: usdcFromNative ? 'circle' : 'folio',
      type: 'crypto',
    });
  }

  return entries;
}

export function getTokenBySymbol(symbol: string): TokenEntry | undefined {
  return getTokenRegistry().find(
    (t) => t.symbol.toUpperCase() === symbol.toUpperCase()
  );
}

export function getTokenById(tokenId: string): TokenEntry | undefined {
  return getTokenRegistry().find((t) => t.tokenId === tokenId);
}

export function getTokenIdForSymbol(symbol: string): string | undefined {
  return getTokenBySymbol(symbol)?.tokenId;
}

async function persistEquityToken(
  symbol: string,
  tokenId: string,
  name: string
): Promise<void> {
  try {
    const { supabase } = await import('./supabase');
    await supabase.from('folio_equity_tokens').upsert({
      symbol: symbol.toUpperCase(),
      name,
      token_id: tokenId,
      decimals: 6,
    });
  } catch (e) {
    console.warn(
      `[token-registry] Could not persist ${symbol}=${tokenId} to DB:`,
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * Ensure an HTS equity token exists for `symbol` (create on Hedera if needed).
 * Same token ID is shared by all users for that stock.
 * On-chain name/symbol are clean (e.g. Tesla / TSLA) — never "MOCK-TSLA".
 */
export async function ensureEquityToken(symbol: string): Promise<TokenEntry> {
  const sym = symbol.toUpperCase();

  // Runtime / env
  let existing = getTokenBySymbol(sym);
  if (existing && existing.type === 'stock') return existing;

  // DB
  try {
    const { supabase } = await import('./supabase');
    const { data } = await supabase
      .from('folio_equity_tokens')
      .select('symbol,name,token_id,decimals')
      .eq('symbol', sym)
      .maybeSingle();
    if (data?.token_id) {
      return registerStockToken(sym, data.token_id, data.name || stockName(sym));
    }
  } catch {
    /* */
  }

  // Env seed
  const envId = envTokenId(sym);
  if (envId) {
    const entry = registerStockToken(sym, envId, stockName(sym));
    await persistEquityToken(sym, envId, entry.name);
    return entry;
  }

  if (!process.env.HEDERA_OPERATOR_ID || !process.env.HEDERA_OPERATOR_KEY) {
    throw new Error('Hedera not configured — cannot create equity token');
  }

  const { createEquityStockToken } = await import('./hedera');
  const name = stockName(sym);
  const tokenId = await createEquityStockToken(name, sym);
  const entry = registerStockToken(sym, tokenId, name);
  await persistEquityToken(sym, tokenId, name);

  console.log(`[token-registry] Created HTS ${sym} (${name}): ${tokenId}`);
  return entry;
}

/** Create every TRADE_STOCKS equity token (DB + chain). Returns map symbol → tokenId. */
export async function ensureAllTradeEquityTokens(): Promise<Record<string, string>> {
  await hydrateTokenRegistryFromDb();
  // seed env
  for (const s of TRADE_STOCKS) {
    const id = envTokenId(s.symbol);
    if (id) registerStockToken(s.symbol, id, s.name);
  }

  const out: Record<string, string> = {};
  for (const s of TRADE_STOCKS) {
    const entry = await ensureEquityToken(s.symbol);
    out[s.symbol] = entry.tokenId;
  }
  return out;
}
