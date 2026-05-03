/**
 * Tests for Chainlink CollarOracle integration
 * Verifies on-chain collar reads and direct price feed reads via viem
 */

const mockReadContract = jest.fn();

jest.mock('viem', () => ({
  createPublicClient: () => ({ readContract: mockReadContract }),
  http: (url: string) => url,
  parseAbi: (abi: string[]) => abi,
}));

jest.mock('viem/chains', () => ({
  baseSepolia: { id: 84532, name: 'Base Sepolia' },
}));

// Set env before import
process.env.COLLAR_ORACLE_ADDRESS = '0x00A3cF51bA20eA6f1754BaFcecA6d144e3d1D00f';

import { getChainlinkCollar, getChainlinkCollars, getChainlinkPrice } from '../chainlink';

describe('chainlink oracle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getChainlinkCollar', () => {
    it('returns collar data when oracle has fresh data', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockReadContract.mockResolvedValue([
        BigInt(25000000000),   // price: $250 (8 decimals)
        BigInt(20000000000),   // floor: $200
        BigInt(30000000000),   // cap: $300
        BigInt(4500),          // volatility: 45% in bps
        BigInt(now),           // updatedAt: now
      ]);

      const result = await getChainlinkCollar('TSLA');

      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('TSLA');
      expect(result!.price).toBe(250);
      expect(result!.floor).toBe(200);
      expect(result!.cap).toBe(300);
      expect(result!.volatility).toBe(4500);
      expect(result!.source).toBe('chainlink');
    });

    it('returns null when oracle has no data (price = 0)', async () => {
      mockReadContract.mockResolvedValue([
        BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0),
      ]);

      const result = await getChainlinkCollar('UNKNOWN');
      expect(result).toBeNull();
    });

    it('returns null on RPC error (graceful degradation)', async () => {
      mockReadContract.mockRejectedValue(new Error('RPC timeout'));

      const result = await getChainlinkCollar('TSLA');
      expect(result).toBeNull();
    });
  });

  describe('getChainlinkPrice', () => {
    it('returns price from direct Chainlink Price Feed', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockReadContract.mockResolvedValue([
        BigInt(25500000000),   // $255.00 (8 decimals)
        BigInt(now),
      ]);

      const result = await getChainlinkPrice('TSLA');

      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('TSLA');
      expect(result!.price).toBe(255);
      expect(result!.source).toBe('chainlink-feed');
    });

    it('returns null when no price feed is configured', async () => {
      mockReadContract.mockRejectedValue(new Error('CollarOracle: no feed'));

      const result = await getChainlinkPrice('TSLA');
      expect(result).toBeNull();
    });

    it('returns null when price is zero', async () => {
      mockReadContract.mockResolvedValue([BigInt(0), BigInt(0)]);

      const result = await getChainlinkPrice('TSLA');
      expect(result).toBeNull();
    });
  });

  describe('getChainlinkCollars', () => {
    it('returns collars for multiple symbols', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockReadContract
        .mockResolvedValueOnce([
          BigInt(25000000000), BigInt(20000000000), BigInt(30000000000), BigInt(4500), BigInt(now),
        ])
        .mockResolvedValueOnce([
          BigInt(18000000000), BigInt(15000000000), BigInt(22000000000), BigInt(3200), BigInt(now),
        ]);

      const results = await getChainlinkCollars(['TSLA', 'AAPL']);

      expect(results.TSLA).toBeDefined();
      expect(results.TSLA.price).toBe(250);
      expect(results.AAPL).toBeDefined();
      expect(results.AAPL.price).toBe(180);
    });

    it('skips symbols that fail gracefully', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockReadContract
        .mockResolvedValueOnce([
          BigInt(25000000000), BigInt(20000000000), BigInt(30000000000), BigInt(4500), BigInt(now),
        ])
        .mockRejectedValueOnce(new Error('RPC error'));

      const results = await getChainlinkCollars(['TSLA', 'AAPL']);

      expect(results.TSLA).toBeDefined();
      expect(results.AAPL).toBeUndefined();
    });
  });
});
