/**
 * Mock server for CRE workflow simulation.
 *
 * Mocks:
 * - Chainlink Data Streams v3 reports (ABI-encoded, proper schema)
 * - DoltHub options SQL API (volatility_history + option_chain)
 *
 * Run: npx tsx chainlink/mock-server/server.ts
 */

import { createServer } from 'http';

// ---------------------------------------------------------------------------
// Mock Data Streams prices (18 decimals, v3 Crypto Advanced schema)
// ---------------------------------------------------------------------------

const MOCK_ASSETS: Record<string, { price: bigint; symbol: string }> = {
  // Using ETH/BTC feed IDs as stand-ins for AAPL/TSLA on testnet
  '0x000359843a543ee2fe414dc14c7e7920ef10f4372990b79d6361cdc0dd1ba782': {
    price: BigInt('197500000000000000000'), // $197.50 (AAPL price) * 1e18
    symbol: 'AAPL',
  },
  '0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8': {
    price: BigInt('271200000000000000000'), // $271.20 (TSLA price) * 1e18
    symbol: 'TSLA',
  },
};

// Mock options volatility data (realistic values)
const MOCK_VOLATILITY: Record<string, {
  iv_current: string;
  hv_current: string;
  iv_year_high: string;
  iv_year_low: string;
  atm_vol: string;
}> = {
  AAPL: {
    iv_current: '0.2450',
    hv_current: '0.2100',
    iv_year_high: '0.3800',
    iv_year_low: '0.1600',
    atm_vol: '0.2380',
  },
  TSLA: {
    iv_current: '0.5800',
    hv_current: '0.5200',
    iv_year_high: '0.8500',
    iv_year_low: '0.3500',
    atm_vol: '0.5650',
  },
};

/** Encode positive bigint as 32-byte hex word */
function toHex64(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

/**
 * ABI-encode a v3 Data Streams report.
 * Matches: https://docs.chain.link/data-streams/reference/report-schema/v3
 */
function encodeV3Report(feedId: string, validFrom: number, observations: number, price: bigint): string {
  const bid = (price * BigInt(999)) / BigInt(1000);
  const ask = (price * BigInt(1001)) / BigInt(1000);
  const nativeFee = BigInt('10000000000000');
  const linkFee = BigInt('5000000000000000');
  const expiresAt = observations + 3600;

  const words = [
    feedId.slice(2).padStart(64, '0'),
    validFrom.toString(16).padStart(64, '0'),
    observations.toString(16).padStart(64, '0'),
    toHex64(nativeFee),
    toHex64(linkFee),
    expiresAt.toString(16).padStart(64, '0'),
    toHex64(price),
    toHex64(bid),
    toHex64(ask),
  ];

  return '0x' + words.join('');
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // ---------------------------------------------------------------------------
  // Data Streams: GET /api/v1/reports/latest?feedID=0x...
  // ---------------------------------------------------------------------------
  if (url.pathname === '/api/v1/reports/latest') {
    const feedId = url.searchParams.get('feedID') || '';
    const asset = MOCK_ASSETS[feedId];
    const now = Math.floor(Date.now() / 1000);

    if (!asset) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown feed ID: ${feedId}` }));
      return;
    }

    const fullReport = encodeV3Report(feedId, now - 1, now, asset.price);
    const response = {
      report: {
        feedID: feedId,
        validFromTimestamp: now - 1,
        observationsTimestamp: now,
        fullReport,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));

    const priceUsd = Number(asset.price / BigInt('1000000000000000000'));
    console.log(`[streams] ${asset.symbol}/USD = $${priceUsd}`);
    return;
  }

  // ---------------------------------------------------------------------------
  // DoltHub SQL API mock: GET /api/v1alpha1/post-no-preference/options/master?q=...
  // ---------------------------------------------------------------------------
  if (url.pathname === '/api/v1alpha1/post-no-preference/options/master') {
    const query = url.searchParams.get('q') || '';

    // Detect which table is being queried
    if (query.includes('volatility_history')) {
      // Extract symbol from query
      const symbolMatch = query.match(/act_symbol='(\w+)'/);
      const symbol = symbolMatch ? symbolMatch[1] : 'AAPL';
      const vol = MOCK_VOLATILITY[symbol] || MOCK_VOLATILITY['AAPL'];

      const response = {
        query_execution_status: 'Success',
        query_execution_message: '',
        repository_owner: 'post-no-preference',
        repository_name: 'options',
        commit_ref: 'master',
        sql_query: query,
        schema_: [
          { columnName: 'iv_current', columnType: 'decimal(5,4)' },
          { columnName: 'hv_current', columnType: 'decimal(5,4)' },
          { columnName: 'iv_year_high', columnType: 'decimal(5,4)' },
          { columnName: 'iv_year_low', columnType: 'decimal(5,4)' },
        ],
        rows: [vol],
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      console.log(`[dolthub] volatility_history for ${symbol}: IV=${vol.iv_current}`);
      return;
    }

    if (query.includes('option_chain')) {
      const symbolMatch = query.match(/act_symbol='(\w+)'/);
      const symbol = symbolMatch ? symbolMatch[1] : 'AAPL';
      const vol = MOCK_VOLATILITY[symbol] || MOCK_VOLATILITY['AAPL'];

      const response = {
        query_execution_status: 'Success',
        query_execution_message: '',
        repository_owner: 'post-no-preference',
        repository_name: 'options',
        commit_ref: 'master',
        sql_query: query,
        schema_: [
          { columnName: 'vol', columnType: 'decimal(5,4)' },
          { columnName: 'strike', columnType: 'decimal(7,2)' },
          { columnName: 'expiration', columnType: 'date' },
        ],
        rows: [
          { vol: vol.atm_vol, strike: '200.00', expiration: '2026-04-18' },
          { vol: String(parseFloat(vol.atm_vol) + 0.01), strike: '205.00', expiration: '2026-04-18' },
          { vol: String(parseFloat(vol.atm_vol) + 0.02), strike: '195.00', expiration: '2026-04-18' },
        ],
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      console.log(`[dolthub] option_chain for ${symbol}: ATM vol=${vol.atm_vol}`);
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unrecognized query' }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const PORT = 8787;
server.listen(PORT, () => {
  console.log('');
  console.log('=== Folio CRE Workflow — Mock Server ===');
  console.log(`http://localhost:${PORT}`);
  console.log('');
  console.log('Data Streams (v3 ABI-encoded):');
  for (const [id, asset] of Object.entries(MOCK_ASSETS)) {
    const priceUsd = Number(asset.price / BigInt('1000000000000000000'));
    console.log(`  ${asset.symbol}: $${priceUsd} — ${id.slice(0, 16)}...`);
  }
  console.log('');
  console.log('DoltHub Options:');
  for (const [sym, vol] of Object.entries(MOCK_VOLATILITY)) {
    console.log(`  ${sym}: IV=${vol.iv_current} HV=${vol.hv_current} ATM=${vol.atm_vol}`);
  }
  console.log('');
});
