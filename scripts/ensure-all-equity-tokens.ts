/**
 * Create Folio HTS equity tokens for every TRADE_STOCKS symbol.
 * - On-chain: "Tesla" / "TSLA" (never MOCK-*)
 * - Primary store: Supabase folio_equity_tokens
 * - Optional env: TSLA_TOKEN_ID=0.0.x
 *
 * Usage:
 *   npx tsx scripts/ensure-all-equity-tokens.ts
 *   npx tsx scripts/ensure-all-equity-tokens.ts --mainnet
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const mainnetEnv = path.resolve(process.cwd(), '.env.mainnet.local');
const localEnv = path.resolve(process.cwd(), '.env.local');
const useMainnet = process.argv.includes('--mainnet');

if (useMainnet && fs.existsSync(mainnetEnv)) {
  dotenv.config({ path: mainnetEnv });
  process.env.HEDERA_NETWORK = 'mainnet';
} else {
  dotenv.config({ path: localEnv });
  dotenv.config();
}

async function main() {
  const { TRADE_STOCKS } = await import('../src/lib/types');
  const {
    ensureEquityToken,
    hydrateTokenRegistryFromDb,
    envTokenId,
    envTokenKey,
    registerStockToken,
  } = await import('../src/lib/token-registry');
  const { resetHederaClientForTests } = await import('../src/lib/hedera');
  resetHederaClientForTests();

  if (!process.env.HEDERA_OPERATOR_ID || !process.env.HEDERA_OPERATOR_KEY) {
    throw new Error('HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY required');
  }

  console.log(`Network: ${process.env.HEDERA_NETWORK || 'testnet'}`);
  console.log(`Ensuring ${TRADE_STOCKS.length} equity HTS tokens…\n`);
  console.log('Primary store: Supabase folio_equity_tokens (env is optional seed only)\n');

  await hydrateTokenRegistryFromDb();
  for (const s of TRADE_STOCKS) {
    const id = envTokenId(s.symbol);
    if (id) registerStockToken(s.symbol, id, s.name);
  }

  const map: Record<string, string> = {};
  const failed: string[] = [];
  const envPath = useMainnet && fs.existsSync(mainnetEnv) ? mainnetEnv : localEnv;

  for (const s of TRADE_STOCKS) {
    try {
      const entry = await ensureEquityToken(s.symbol);
      map[s.symbol] = entry.tokenId;
      console.log(`  ${s.symbol.padEnd(6)} ${entry.tokenId}  (${s.name})`);
      // Persist progress to env after each success (resume-safe if HBAR runs out)
      writeEnvSeeds(envPath, { [s.symbol]: entry.tokenId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push(`${s.symbol}: ${msg}`);
      console.error(`  ${s.symbol.padEnd(6)} FAILED — ${msg}`);
    }
  }

  const lines = Object.entries(map).map(
    ([sym, id]) => `${envTokenKey(sym)}=${id}`
  );

  console.log('\n--- Optional env seeds ---\n');
  console.log(lines.join('\n') || '(none)');

  if (failed.length) {
    console.error(
      `\n${failed.length} symbol(s) failed (often INSUFFICIENT_PAYER_BALANCE).` +
        `\nFund operator with more HBAR and re-run — already-created IDs are saved.`
    );
    process.exit(1);
  }

  console.log(`\nAll ${TRADE_STOCKS.length} equity tokens ready.`);
}

function writeEnvSeeds(envPath: string, bySymbol: Record<string, string>) {
  if (!fs.existsSync(envPath)) return;
  let envText = fs.readFileSync(envPath, 'utf8');
  for (const [sym, id] of Object.entries(bySymbol)) {
    const key = `${sym.toUpperCase()}_TOKEN_ID`;
    // Drop legacy MOCK_ key for this symbol
    envText = envText.replace(new RegExp(`^MOCK_${sym.toUpperCase()}_TOKEN_ID=.*$`, 'gm'), '');
    const line = `${key}=${id}`;
    if (new RegExp(`^${key}=`, 'm').test(envText)) {
      envText = envText.replace(new RegExp(`^${key}=.*$`, 'm'), line);
    } else {
      envText += (envText.endsWith('\n') ? '' : '\n') + line + '\n';
    }
  }
  envText = envText.replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(envPath, envText);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
