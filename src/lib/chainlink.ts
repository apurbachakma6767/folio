// Chainlink CollarOracle integration — reads collar params AND live prices from on-chain
// Hedera EVM via HashIO (testnet 296 / mainnet 295). CRE optional for Thrive M2.

import { createPublicClient, http, parseAbi } from 'viem';
import {
  getHashscanBase,
  getHederaEvmChainId,
  getHederaNetwork,
  getHederaRpcUrl,
} from './network';

function hederaEvmChain() {
  const id = getHederaEvmChainId();
  const network = getHederaNetwork();
  const rpc = getHederaRpcUrl();
  return {
    id,
    name: network === 'mainnet' ? 'Hedera Mainnet' : 'Hedera Testnet',
    nativeCurrency: {
      decimals: 8,
      name: 'HBAR',
      symbol: 'HBAR',
    },
    rpcUrls: {
      default: { http: [rpc] },
      public: { http: [rpc] },
    },
    blockExplorers: {
      default: { name: 'HashScan', url: getHashscanBase() },
    },
  } as const;
}

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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** CollarOracle EVM address — empty / zero means skip on-chain reads (use Yahoo). */
function getCollarOracleAddress(): `0x${string}` | null {
  const raw = (process.env.COLLAR_ORACLE_ADDRESS || '').trim().toLowerCase();
  if (!raw || raw === ZERO_ADDRESS || raw === '0x0') return null;
  const with0x = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-f]{40}$/.test(with0x)) return null;
  return with0x as `0x${string}`;
}

function getClient() {
  return createPublicClient({
    chain: hederaEvmChain(),
    transport: http(getHederaRpcUrl()),
  });
}

/**
 * Read collar parameters from the on-chain CollarOracle contract.
 * Returns null if the oracle is not configured or has no data.
 */
export async function getChainlinkCollar(symbol: string): Promise<ChainlinkCollar | null> {
  const oracle = getCollarOracleAddress();
  if (!oracle) return null;

  try {
    const client = getClient();
    const result = await client.readContract({
      address: oracle,
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
    // Quiet fail — Yahoo/fallback handles pricing
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[chainlink] collar ${symbol}:`,
        error instanceof Error ? error.message : error
      );
    }
    return null;
  }
}

/**
 * Read the latest price directly from a Chainlink Price Feed via the CollarOracle.
 * This works independently of the CRE workflow — reads from AggregatorV3Interface.
 * Returns null if no price feed is configured for the symbol.
 */
export async function getChainlinkPrice(symbol: string): Promise<ChainlinkPrice | null> {
  const oracle = getCollarOracleAddress();
  if (!oracle) return null; // no mainnet oracle yet → skip, use Yahoo

  try {
    const client = getClient();
    const result = await client.readContract({
      address: oracle,
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
  } catch {
    // Expected when feed not configured for symbol — silent, Yahoo is next
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
