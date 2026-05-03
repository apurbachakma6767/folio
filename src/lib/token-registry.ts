// Token Registry — maps HTS token IDs to equity symbols
//
// Architecture: Folio uses HTS (Hedera Token Service) fungible tokens to
// represent tokenized public equities. This is the same standard used by
// Swarm (swarm.com), Hedera's partner for regulated tokenized securities.
//
// TESTNET (current): MOCK-TSLA, MOCK-AAPL tokens created via setup script
// PRODUCTION: Swap token IDs to Swarm's regulated HTS tokens (same interface)
//
// Swarm tokenizes AAPL, TSLA, NVDA, MSFT, MSTR, BLK, INTC, CPNG, COIN
// as 1:1 backed HTS tokens with KYC/compliance gating.
// Migration = change env vars + add Swarm KYC onboarding flow.

export interface TokenEntry {
  symbol: string;
  name: string;
  tokenId: string;          // HTS token ID (0.0.XXXXX)
  decimals: number;
  provider: 'mock' | 'swarm'; // mock = testnet demo, swarm = production
  type: 'stock' | 'crypto';
}

// Build registry from env vars
// In production, these would point to Swarm's HTS token IDs
export function getTokenRegistry(): TokenEntry[] {
  const entries: TokenEntry[] = [];

  if (process.env.MOCK_TSLA_TOKEN_ID) {
    entries.push({
      symbol: 'TSLA',
      name: 'Tesla',
      tokenId: process.env.MOCK_TSLA_TOKEN_ID,
      decimals: 6,
      provider: 'mock',
      type: 'stock',
    });
  }

  if (process.env.MOCK_AAPL_TOKEN_ID) {
    entries.push({
      symbol: 'AAPL',
      name: 'Apple',
      tokenId: process.env.MOCK_AAPL_TOKEN_ID,
      decimals: 6,
      provider: 'mock',
      type: 'stock',
    });
  }

  if (process.env.USDC_TEST_TOKEN_ID) {
    entries.push({
      symbol: 'USDC',
      name: 'USD Coin',
      tokenId: process.env.USDC_TEST_TOKEN_ID,
      decimals: 6,
      provider: 'mock',
      type: 'crypto',
    });
  }

  // Production Swarm tokens would be added here:
  // if (process.env.SWARM_TSLA_TOKEN_ID) {
  //   entries.push({
  //     symbol: 'TSLA',
  //     name: 'Tesla',
  //     tokenId: process.env.SWARM_TSLA_TOKEN_ID,
  //     decimals: 6,
  //     provider: 'swarm',
  //   });
  // }

  return entries;
}

// Lookup helpers
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
