// Stock price fetcher — Chainlink-first pricing
//
// Priority chain:
// 1. Chainlink Price Feed (via CollarOracle.getLatestPrice) — live, no CRE dependency
// 2. Chainlink CollarOracle (CRE workflow data) — includes collar params
// 3. Yahoo Finance — traditional market data fallback
// 4. Hardcoded prices — last resort when everything is down

import { getChainlinkCollar, getChainlinkPrice } from './chainlink';

export interface PriceData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  lastUpdated: string;
  source: 'live' | 'cached' | 'fallback' | 'chainlink';
  // Collar data from CRE workflow (present when Chainlink oracle has it)
  collar?: {
    floor: number;
    cap: number;
    volatility: number; // basis points
  };
}

// Hardcoded fallback prices — stale, only used when all sources are unreachable
const FALLBACK_PRICES: Record<string, PriceData> = {
  TSLA: {
    symbol: 'TSLA',
    price: 225.0,
    change: 0,
    changePercent: 0,
    lastUpdated: '2025-01-01T00:00:00Z',
    source: 'fallback',
  },
  AAPL: {
    symbol: 'AAPL',
    price: 178.5,
    change: 0,
    changePercent: 0,
    lastUpdated: '2025-01-01T00:00:00Z',
    source: 'fallback',
  },
};

// Cache to avoid hammering APIs (per-symbol timestamps)
const priceCache: Record<string, PriceData> = {};
const lastFetchPerSymbol: Record<string, number> = {};
const CACHE_TTL = 30_000; // 30 seconds

// Track previous Chainlink prices to compute change/changePercent
const previousChainlinkPrices: Record<string, number> = {};

// CRE workflow runs every 5 min — data older than 10 min is stale
const CRE_STALENESS_MS = 10 * 60 * 1000;
// Direct price feeds update more frequently — allow 5 min
const FEED_STALENESS_MS = 5 * 60 * 1000;

function computeChange(symbol: string, currentPrice: number): { change: number; changePercent: number } {
  const prev = previousChainlinkPrices[symbol];
  if (prev && prev > 0) {
    const change = currentPrice - prev;
    const changePercent = (change / prev) * 100;
    return { change, changePercent };
  }
  return { change: 0, changePercent: 0 };
}

function recordPrice(symbol: string, _newPrice: number) {
  // Shift current cached price → previous before we overwrite the cache
  if (priceCache[symbol] && priceCache[symbol].source === 'chainlink') {
    previousChainlinkPrices[symbol] = priceCache[symbol].price;
  }
}

export async function getStockPrice(symbol: string): Promise<PriceData> {
  const now = Date.now();

  // Return cached if fresh (per-symbol)
  if (priceCache[symbol] && now - (lastFetchPerSymbol[symbol] ?? 0) < CACHE_TTL) {
    return { ...priceCache[symbol], source: 'cached' };
  }

  // Chainlink only when COLLAR_ORACLE_ADDRESS is set (skipped quickly on mainnet without oracle)
  try {
    const feedPrice = await getChainlinkPrice(symbol);
    if (feedPrice && feedPrice.price > 0) {
      const ageMs = now - feedPrice.updatedAt.getTime();
      if (ageMs < FEED_STALENESS_MS) {
        recordPrice(symbol, feedPrice.price);
        const { change, changePercent } = computeChange(symbol, feedPrice.price);
        let collar: PriceData['collar'] | undefined;
        try {
          const collarData = await getChainlinkCollar(symbol);
          if (collarData) {
            const collarAgeMs = now - collarData.updatedAt.getTime();
            if (collarAgeMs < CRE_STALENESS_MS) {
              collar = {
                floor: collarData.floor,
                cap: collarData.cap,
                volatility: collarData.volatility,
              };
            }
          }
        } catch { /* optional */ }

        const data: PriceData = {
          symbol,
          price: feedPrice.price,
          change,
          changePercent,
          lastUpdated: feedPrice.updatedAt.toISOString(),
          source: 'chainlink',
          collar,
        };
        priceCache[symbol] = data;
        lastFetchPerSymbol[symbol] = now;
        return data;
      }
    }
  } catch {
    /* Yahoo next */
  }

  try {
    const collar = await getChainlinkCollar(symbol);
    if (collar && collar.price > 0) {
      const ageMs = now - collar.updatedAt.getTime();
      if (ageMs < CRE_STALENESS_MS) {
        recordPrice(symbol, collar.price);
        const { change, changePercent } = computeChange(symbol, collar.price);
        const data: PriceData = {
          symbol,
          price: collar.price,
          change,
          changePercent,
          lastUpdated: collar.updatedAt.toISOString(),
          source: 'chainlink',
          collar: {
            floor: collar.floor,
            cap: collar.cap,
            volatility: collar.volatility,
          },
        };
        priceCache[symbol] = data;
        lastFetchPerSymbol[symbol] = now;
        return data;
      }
    }
  } catch {
    /* Yahoo next */
  }

  // Yahoo Finance (primary path when no CollarOracle)
  try {
    const yahooFinance = await import('yahoo-finance2');
    const YF = yahooFinance.default;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yf = new (YF as any)({ suppressNotices: ['yahooSurvey'] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote: any = await yf.quote(symbol);

    const data: PriceData = {
      symbol,
      price: quote.regularMarketPrice ?? FALLBACK_PRICES[symbol]?.price ?? 0,
      change: quote.regularMarketChange ?? 0,
      changePercent: quote.regularMarketChangePercent ?? 0,
      lastUpdated: new Date().toISOString(),
      source: 'live',
    };

    priceCache[symbol] = data;
    lastFetchPerSymbol[symbol] = now;
    return data;
  } catch (error) {
    if (priceCache[symbol]) return { ...priceCache[symbol], source: 'cached' };
    return (
      FALLBACK_PRICES[symbol] ?? {
        symbol,
        price: 0,
        change: 0,
        changePercent: 0,
        lastUpdated: '2025-01-01T00:00:00Z',
        source: 'fallback',
      }
    );
  }
}

export async function getAllPrices(
  symbols: string[] = ['TSLA', 'AAPL']
): Promise<Record<string, PriceData>> {
  const results = await Promise.allSettled(
    symbols.map((s) => getStockPrice(s))
  );

  const prices: Record<string, PriceData> = {};
  symbols.forEach((symbol, i) => {
    const result = results[i];
    if (result.status === 'fulfilled') {
      // Skip unknown symbols that only got a zero-price generic fallback
      if (result.value.price > 0 || FALLBACK_PRICES[symbol]) {
        prices[symbol] = result.value;
      }
    } else if (FALLBACK_PRICES[symbol]) {
      prices[symbol] = FALLBACK_PRICES[symbol];
    }
  });

  return prices;
}
