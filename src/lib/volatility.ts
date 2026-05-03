// Volatility data fetcher — pulls real options chain + historical prices
// from Yahoo Finance to feed the AI collar optimizer with actual market data.

interface VolatilityData {
  symbol: string;
  currentPrice: number;
  // Implied volatility from options market
  impliedVolatility: {
    atmCall: number | null;    // IV of nearest ATM call
    atmPut: number | null;     // IV of nearest ATM put
    avgAtm: number | null;     // average of call + put IV
    skew: number | null;       // put IV - call IV (fear gauge)
  };
  // Historical (realized) volatility from daily returns
  historicalVolatility: {
    vol30d: number | null;     // 30-day annualized
    vol60d: number | null;     // 60-day annualized
  };
  // Options chain summary
  optionsChain: {
    nearestExpiry: string | null;
    putCallRatio: number | null;  // >1 = bearish sentiment
    atmStrike: number | null;
    atmCallBid: number | null;
    atmCallAsk: number | null;
    atmPutBid: number | null;
    atmPutAsk: number | null;
  };
}

// Cache to avoid hammering Yahoo
const volCache: Record<string, { data: VolatilityData; ts: number }> = {};
const VOL_CACHE_TTL = 60_000; // 1 minute

export async function getVolatilityData(symbol: string): Promise<VolatilityData> {
  const now = Date.now();
  if (volCache[symbol] && now - volCache[symbol].ts < VOL_CACHE_TTL) {
    return volCache[symbol].data;
  }

  const result: VolatilityData = {
    symbol,
    currentPrice: 0,
    impliedVolatility: { atmCall: null, atmPut: null, avgAtm: null, skew: null },
    historicalVolatility: { vol30d: null, vol60d: null },
    optionsChain: {
      nearestExpiry: null, putCallRatio: null, atmStrike: null,
      atmCallBid: null, atmCallAsk: null, atmPutBid: null, atmPutAsk: null,
    },
  };

  try {
    const yahooFinance = await import('yahoo-finance2');
    const YF = yahooFinance.default;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yf = new (YF as any)({ suppressNotices: ['yahooSurvey'] });

    // Fetch options chain and historical data in parallel
    const [optionsData, historicalData] = await Promise.allSettled([
      yf.options(symbol),
      yf.historical(symbol, {
        period1: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
        interval: '1d',
      }),
    ]);

    // Parse options chain
    if (optionsData.status === 'fulfilled' && optionsData.value) {
      const opts = optionsData.value;
      result.currentPrice = opts.quote?.regularMarketPrice ?? 0;

      if (opts.options?.[0]) {
        const chain = opts.options[0];
        const calls = chain.calls ?? [];
        const puts = chain.puts ?? [];
        const price = result.currentPrice;

        // Find ATM options (strike closest to current price)
        const atmCall = findAtm(calls, price);
        const atmPut = findAtm(puts, price);

        if (atmCall) {
          result.impliedVolatility.atmCall = atmCall.impliedVolatility ?? null;
          result.optionsChain.atmCallBid = atmCall.bid ?? null;
          result.optionsChain.atmCallAsk = atmCall.ask ?? null;
          result.optionsChain.atmStrike = atmCall.strike;
        }

        if (atmPut) {
          result.impliedVolatility.atmPut = atmPut.impliedVolatility ?? null;
          result.optionsChain.atmPutBid = atmPut.bid ?? null;
          result.optionsChain.atmPutAsk = atmPut.ask ?? null;
          if (!result.optionsChain.atmStrike) {
            result.optionsChain.atmStrike = atmPut.strike;
          }
        }

        // Average IV and skew
        if (result.impliedVolatility.atmCall != null && result.impliedVolatility.atmPut != null) {
          result.impliedVolatility.avgAtm =
            (result.impliedVolatility.atmCall + result.impliedVolatility.atmPut) / 2;
          result.impliedVolatility.skew =
            result.impliedVolatility.atmPut - result.impliedVolatility.atmCall;
        }

        // Put/call ratio (open interest)
        const totalCallOI = calls.reduce((s: number, c: OptionContract) => s + (c.openInterest ?? 0), 0);
        const totalPutOI = puts.reduce((s: number, p: OptionContract) => s + (p.openInterest ?? 0), 0);
        if (totalCallOI > 0) {
          result.optionsChain.putCallRatio = totalPutOI / totalCallOI;
        }

        result.optionsChain.nearestExpiry = chain.expirationDate
          ? new Date(chain.expirationDate).toISOString().split('T')[0]
          : null;
      }
    }

    // Calculate historical volatility from daily returns
    if (historicalData.status === 'fulfilled' && historicalData.value) {
      const prices: number[] = historicalData.value
        .map((d: { close?: number }) => d.close)
        .filter((p: number | undefined): p is number => p != null && p > 0);

      if (prices.length >= 20) {
        result.historicalVolatility.vol30d = calcHistoricalVol(prices.slice(-30));
      }
      if (prices.length >= 45) {
        result.historicalVolatility.vol60d = calcHistoricalVol(prices.slice(-60));
      }
    }
  } catch (error) {
    console.error(`Volatility data fetch failed for ${symbol}:`, error);
  }

  volCache[symbol] = { data: result, ts: now };
  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface OptionContract {
  strike: number;
  impliedVolatility?: number;
  bid?: number;
  ask?: number;
  openInterest?: number;
}

function findAtm(contracts: OptionContract[], price: number): OptionContract | null {
  if (contracts.length === 0) return null;
  return contracts.reduce((best, c) =>
    Math.abs(c.strike - price) < Math.abs(best.strike - price) ? c : best
  );
}

// Annualized historical volatility from daily closing prices
function calcHistoricalVol(prices: number[]): number | null {
  if (prices.length < 2) return null;

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const dailyVol = Math.sqrt(variance);

  // Annualize: daily vol * sqrt(252 trading days)
  return dailyVol * Math.sqrt(252);
}
