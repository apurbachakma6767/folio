// Chainlink CollarOracle integration — reads collar params AND live prices from on-chain
// The CRE workflow writes collar params; Chainlink Price Feeds provide live prices.

import { createPublicClient, http, parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';

const COLLAR_ORACLE_ABI = parseAbi([
  'function getCollar(string symbol) external view returns (uint256 price, uint256 floor, uint256 cap, uint256 volatility, uint256 updatedAt)',
  'function getLatestPrice(string symbol) external view returns (int256, uint256)',
]);

export interface ChainlinkCollar {
  symbol: string;
  price: number;
  floor: number;
  cap: number;
  volatility: number; // basis points
  updatedAt: Date;
  source: 'chainlink';
}

export interface ChainlinkPrice {
  symbol: string;
  price: number;
  updatedAt: Date;
  source: 'chainlink-feed';
}

const COLLAR_ORACLE_ADDRESS = process.env.COLLAR_ORACLE_ADDRESS || '0x00A3cF51bA20eA6f1754BaFcecA6d144e3d1D00f';
const BASE_SEPOLIA_RPC = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

function getClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC),
  });
}

/**
 * Read collar parameters from the on-chain CollarOracle contract.
 * Returns null if the oracle is not configured or has no data.
 */
export async function getChainlinkCollar(symbol: string): Promise<ChainlinkCollar | null> {
  if (!COLLAR_ORACLE_ADDRESS) return null;

  try {
    const client = getClient();
    const result = await client.readContract({
      address: COLLAR_ORACLE_ADDRESS as `0x${string}`,
      abi: COLLAR_ORACLE_ABI,
      functionName: 'getCollar',
      args: [symbol],
    });

    const [price, floor, cap, volatility, updatedAt] = result as [bigint, bigint, bigint, bigint, bigint];

    // Skip if no data (price = 0 means never written)
    if (price === BigInt(0)) return null;

    return {
      symbol,
      price: Number(price) / 1e8,
      floor: Number(floor) / 1e8,
      cap: Number(cap) / 1e8,
      volatility: Number(volatility),
      updatedAt: new Date(Number(updatedAt) * 1000),
      source: 'chainlink',
    };
  } catch (error) {
    console.error(`[chainlink] Failed to read collar for ${symbol}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Read the latest price directly from a Chainlink Price Feed via the CollarOracle.
 * This works independently of the CRE workflow — reads from AggregatorV3Interface.
 * Returns null if no price feed is configured for the symbol.
 */
export async function getChainlinkPrice(symbol: string): Promise<ChainlinkPrice | null> {
  if (!COLLAR_ORACLE_ADDRESS) return null;

  try {
    const client = getClient();
    const result = await client.readContract({
      address: COLLAR_ORACLE_ADDRESS as `0x${string}`,
      abi: COLLAR_ORACLE_ABI,
      functionName: 'getLatestPrice',
      args: [symbol],
    });

    const [answer, updatedAt] = result as [bigint, bigint];

    if (answer === BigInt(0)) return null;

    return {
      symbol,
      price: Number(answer) / 1e8,
      updatedAt: new Date(Number(updatedAt) * 1000),
      source: 'chainlink-feed',
    };
  } catch (error) {
    // Expected when no price feed is configured for this symbol
    console.warn(`[chainlink] No price feed for ${symbol}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Read collars for multiple assets.
 */
export async function getChainlinkCollars(symbols: string[]): Promise<Record<string, ChainlinkCollar>> {
  const results: Record<string, ChainlinkCollar> = {};

  const collars = await Promise.allSettled(
    symbols.map((s) => getChainlinkCollar(s))
  );

  symbols.forEach((symbol, i) => {
    const result = collars[i];
    if (result.status === 'fulfilled' && result.value) {
      results[symbol] = result.value;
    }
  });

  return results;
}
