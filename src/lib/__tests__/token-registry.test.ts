/**
 * Tests for src/lib/token-registry.ts — HTS token ID ↔ symbol mapping
 */

describe('token-registry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear all equity env seeds so tests are isolated
    for (const sym of ['TSLA', 'AAPL', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'NFLX', 'AMD', 'INTC', 'CRM', 'COIN']) {
      delete process.env[`${sym}_TOKEN_ID`];
      delete process.env[`MOCK_${sym}_TOKEN_ID`];
    }
    delete process.env.USDC_TEST_TOKEN_ID;
    delete process.env.USDC_TOKEN_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadRegistry() {
    return require('../token-registry');
  }

  describe('getTokenRegistry', () => {
    it('returns empty array when no token env vars are set', () => {
      const { getTokenRegistry } = loadRegistry();
      expect(getTokenRegistry()).toEqual([]);
    });

    it('includes TSLA when TSLA_TOKEN_ID is set', () => {
      process.env.TSLA_TOKEN_ID = '0.0.11111';

      const { getTokenRegistry } = loadRegistry();
      const registry = getTokenRegistry();

      expect(registry).toHaveLength(1);
      expect(registry[0]).toMatchObject({
        symbol: 'TSLA',
        tokenId: '0.0.11111',
        decimals: 6,
        type: 'stock',
        provider: 'folio',
      });
    });

    it('still accepts legacy MOCK_*_TOKEN_ID env keys', () => {
      process.env.MOCK_TSLA_TOKEN_ID = '0.0.11111';

      const { getTokenRegistry } = loadRegistry();
      expect(getTokenRegistry()[0]).toMatchObject({
        symbol: 'TSLA',
        tokenId: '0.0.11111',
      });
    });

    it('prefers clean TSLA_TOKEN_ID over legacy MOCK_TSLA_TOKEN_ID', () => {
      process.env.TSLA_TOKEN_ID = '0.0.11111';
      process.env.MOCK_TSLA_TOKEN_ID = '0.0.99999';

      const { getTokenIdForSymbol } = loadRegistry();
      expect(getTokenIdForSymbol('TSLA')).toBe('0.0.11111');
    });

    it('includes all tokens when all env vars are set', () => {
      process.env.TSLA_TOKEN_ID = '0.0.11111';
      process.env.AAPL_TOKEN_ID = '0.0.22222';
      process.env.USDC_TEST_TOKEN_ID = '0.0.33333';

      const { getTokenRegistry } = loadRegistry();
      const registry = getTokenRegistry();

      expect(registry).toHaveLength(3);
      const symbols = registry.map((t: { symbol: string }) => t.symbol);
      expect(symbols).toContain('TSLA');
      expect(symbols).toContain('AAPL');
      expect(symbols).toContain('USDC');
    });

    it('marks USDC as crypto type', () => {
      process.env.USDC_TEST_TOKEN_ID = '0.0.33333';

      const { getTokenRegistry } = loadRegistry();
      const usdc = getTokenRegistry().find((t: { symbol: string }) => t.symbol === 'USDC');

      expect(usdc?.type).toBe('crypto');
    });

    it('marks stock tokens as stock type', () => {
      process.env.TSLA_TOKEN_ID = '0.0.11111';

      const { getTokenRegistry } = loadRegistry();
      const tsla = getTokenRegistry().find((t: { symbol: string }) => t.symbol === 'TSLA');

      expect(tsla?.type).toBe('stock');
    });
  });

  describe('getTokenBySymbol', () => {
    beforeEach(() => {
      process.env.TSLA_TOKEN_ID = '0.0.11111';
      process.env.AAPL_TOKEN_ID = '0.0.22222';
      process.env.USDC_TEST_TOKEN_ID = '0.0.33333';
    });

    it('finds token by exact symbol', () => {
      const { getTokenBySymbol } = loadRegistry();
      const token = getTokenBySymbol('TSLA');
      expect(token?.tokenId).toBe('0.0.11111');
    });

    it('is case-insensitive', () => {
      const { getTokenBySymbol } = loadRegistry();
      expect(getTokenBySymbol('tsla')?.tokenId).toBe('0.0.11111');
      expect(getTokenBySymbol('Aapl')?.tokenId).toBe('0.0.22222');
    });

    it('returns undefined for unknown symbol', () => {
      const { getTokenBySymbol } = loadRegistry();
      expect(getTokenBySymbol('GME')).toBeUndefined();
    });
  });

  describe('getTokenById', () => {
    beforeEach(() => {
      process.env.TSLA_TOKEN_ID = '0.0.11111';
    });

    it('finds token by HTS token ID', () => {
      const { getTokenById } = loadRegistry();
      expect(getTokenById('0.0.11111')?.symbol).toBe('TSLA');
    });

    it('returns undefined for unknown token ID', () => {
      const { getTokenById } = loadRegistry();
      expect(getTokenById('0.0.99999')).toBeUndefined();
    });
  });

  describe('getTokenIdForSymbol', () => {
    beforeEach(() => {
      process.env.TSLA_TOKEN_ID = '0.0.11111';
    });

    it('returns token ID string for known symbol', () => {
      const { getTokenIdForSymbol } = loadRegistry();
      expect(getTokenIdForSymbol('TSLA')).toBe('0.0.11111');
    });

    it('returns undefined for unknown symbol', () => {
      const { getTokenIdForSymbol } = loadRegistry();
      expect(getTokenIdForSymbol('GME')).toBeUndefined();
    });
  });
});
