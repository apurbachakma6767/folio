// Test getAllPrices dynamic symbols parameter acceptance
// Note: yahoo-finance2 dynamic import() isn't mockable in this jest config,
// so we test the function signature and fallback behavior rather than live fetching

import { getAllPrices } from '../price';

describe('getAllPrices', () => {
  jest.setTimeout(30_000);
  it('accepts symbols parameter without throwing', async () => {
    // getAllPrices(['NFLX']) will try to fetch, fail (no real API in test),
    // and gracefully return whatever it can (empty for unknown symbols, fallback for known)
    await expect(getAllPrices(['NFLX'])).resolves.toBeDefined();
  });

  it('returns fallback for TSLA when API unavailable', async () => {
    const prices = await getAllPrices(['TSLA']);
    // Should fall back to hardcoded TSLA price
    expect(prices.TSLA).toBeDefined();
    expect(prices.TSLA.symbol).toBe('TSLA');
    expect(prices.TSLA.price).toBeGreaterThan(0);
  });

  it('returns fallback for AAPL when API unavailable', async () => {
    const prices = await getAllPrices(['AAPL']);
    expect(prices.AAPL).toBeDefined();
    expect(prices.AAPL.symbol).toBe('AAPL');
  });

  it('defaults to TSLA and AAPL when no parameter passed', async () => {
    const prices = await getAllPrices();
    expect(Object.keys(prices).sort()).toEqual(['AAPL', 'TSLA']);
  });

  it('omits symbols with no fallback when API unavailable', async () => {
    const prices = await getAllPrices(['UNKNOWN_SYMBOL_XYZ']);
    // No fallback exists, API fails in test env — symbol should be omitted
    expect(prices['UNKNOWN_SYMBOL_XYZ']).toBeUndefined();
  });

  it('handles mixed known and unknown symbols', async () => {
    const prices = await getAllPrices(['TSLA', 'UNKNOWN_SYMBOL_XYZ']);
    expect(prices.TSLA).toBeDefined();
    expect(prices['UNKNOWN_SYMBOL_XYZ']).toBeUndefined();
  });
});
