/**
 * Tests for Chainlink-first pricing logic in price.ts
 * Each test uses a unique symbol to avoid module-level cache interference.
 */

const mockGetChainlinkPrice = jest.fn();
const mockGetChainlinkCollar = jest.fn();

jest.mock('../chainlink', () => ({
  getChainlinkPrice: (...args: unknown[]) => mockGetChainlinkPrice(...args),
  getChainlinkCollar: (...args: unknown[]) => mockGetChainlinkCollar(...args),
}));

// Mock yahoo-finance2 to avoid real API calls
jest.mock('yahoo-finance2', () => {
  throw new Error('Yahoo unavailable in test');
});

// Must import AFTER mocks are set up
import { getStockPrice } from '../price';

describe('getStockPrice — Chainlink-first pricing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns Chainlink Price Feed data when fresh (Priority 1)', async () => {
    const now = new Date();
    mockGetChainlinkPrice.mockResolvedValue({
      symbol: 'SYM_A',
      price: 260,
      updatedAt: now,
      source: 'chainlink-feed',
    });
    mockGetChainlinkCollar.mockResolvedValue(null);

    const result = await getStockPrice('SYM_A');

    expect(result.source).toBe('chainlink');
    expect(result.price).toBe(260);
    expect(result.collar).toBeUndefined();
    expect(mockGetChainlinkPrice).toHaveBeenCalledWith('SYM_A');
  });

  it('attaches collar data from CRE when Price Feed is primary', async () => {
    const now = new Date();
    mockGetChainlinkPrice.mockResolvedValue({
      symbol: 'SYM_B',
      price: 260,
      updatedAt: now,
      source: 'chainlink-feed',
    });
    mockGetChainlinkCollar.mockResolvedValue({
      symbol: 'SYM_B',
      price: 258,
      floor: 206,
      cap: 320,
      volatility: 4500,
      updatedAt: now,
      source: 'chainlink',
    });

    const result = await getStockPrice('SYM_B');

    expect(result.source).toBe('chainlink');
    expect(result.price).toBe(260);
    expect(result.collar).toEqual({ floor: 206, cap: 320, volatility: 4500 });
  });

  it('falls to CRE oracle (Priority 2) when feed unavailable', async () => {
    const now = new Date();
    mockGetChainlinkPrice.mockResolvedValue(null);
    mockGetChainlinkCollar.mockResolvedValue({
      symbol: 'SYM_C',
      price: 180,
      floor: 144,
      cap: 225,
      volatility: 3200,
      updatedAt: now,
      source: 'chainlink',
    });

    const result = await getStockPrice('SYM_C');

    expect(result.source).toBe('chainlink');
    expect(result.price).toBe(180);
    expect(result.collar).toEqual({ floor: 144, cap: 225, volatility: 3200 });
  });

  it('skips stale CRE data (>10 min old) and falls to hardcoded', async () => {
    const staleTime = new Date(Date.now() - 15 * 60 * 1000);
    mockGetChainlinkPrice.mockResolvedValue(null);
    mockGetChainlinkCollar.mockResolvedValue({
      symbol: 'TSLA',
      price: 250,
      floor: 200,
      cap: 300,
      volatility: 4500,
      updatedAt: staleTime,
      source: 'chainlink',
    });

    // Use TSLA so it falls to the hardcoded fallback
    const result = await getStockPrice('SYM_D');
    // SYM_D has no hardcoded fallback, so it returns price: 0
    expect(result.source).toBe('fallback');
    expect(result.price).toBe(0);
  });

  it('skips stale Price Feed data (>5 min old) and tries CRE', async () => {
    const staleTime = new Date(Date.now() - 6 * 60 * 1000);
    const freshTime = new Date();

    // First call: getChainlinkPrice returns stale feed
    mockGetChainlinkPrice.mockResolvedValue({
      symbol: 'SYM_E',
      price: 255,
      updatedAt: staleTime,
      source: 'chainlink-feed',
    });
    // Second call: getChainlinkCollar returns fresh CRE data
    mockGetChainlinkCollar.mockResolvedValue({
      symbol: 'SYM_E',
      price: 258,
      floor: 206,
      cap: 320,
      volatility: 4500,
      updatedAt: freshTime,
      source: 'chainlink',
    });

    const result = await getStockPrice('SYM_E');

    expect(result.source).toBe('chainlink');
    expect(result.price).toBe(258);
    expect(result.collar).toBeDefined();
  });
});
