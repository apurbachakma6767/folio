/**
 * Tests for src/lib/token-registry.ts — HTS token ID ↔ symbol mapping
 */

describe('token-registry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadRegistry() {
    return require('../token-registry');
  }

  describe('getTokenRegistry', () => {
    it('returns empty array when no token env vars are set', () => {
      delete process.env.MOCK_TSLA_TOKEN_ID;
      delete process.env.MOCK_AAPL_TOKEN_ID;
      delete process.env.USDC_TEST_TOKEN_ID;

      const { getTokenRegistry } = loadRegistry();
      expect(getTokenRegistry()).toEqual([]);
    });

    it('includes TSLA when MOCK_TSLA_TOKEN_ID is set', () => {
      process.env.MOCK_TSLA_TOKEN_ID = '0.0.11111';
      delete process.env.MOCK_AAPL_TOKEN_ID;
      delete process.env.USDC_TEST_TOKEN_ID;

      const { getTokenRegistry } = loadRegistry();
      const registry = getTokenRegistry();

      expect(registry).toHaveLength(1);
      expect(registry[0]).toMatchObject({
        symbol: 'TSLA',
        tokenId: '0.0.11111',
        decimals: 6,
        type: 'stock',
      });
    });

    it('includes all tokens when all env vars are set', () => {
      process.env.MOCK_TSLA_TOKEN_ID = '0.0.11111';
      process.env.MOCK_AAPL_TOKEN_ID = '0.0.22222';
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
      process.env.MOCK_TSLA_TOKEN_ID = '0.0.11111';

      const { getTokenRegistry } = loadRegistry();
      const tsla = getTokenRegistry().find((t: { symbol: string }) => t.symbol === 'TSLA');

      expect(tsla?.type).toBe('stock');
    });
  });

  describe('getTokenBySymbol', () => {
    beforeEach(() => {
      process.env.MOCK_TSLA_TOKEN_ID = '0.0.11111';
      process.env.MOCK_AAPL_TOKEN_ID = '0.0.22222';
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
      expect(getTokenBySymbol('NVDA')).toBeUndefined();
    });
  });

  describe('getTokenById', () => {
    beforeEach(() => {
      process.env.MOCK_TSLA_TOKEN_ID = '0.0.11111';
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
      process.env.MOCK_TSLA_TOKEN_ID = '0.0.11111';
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
