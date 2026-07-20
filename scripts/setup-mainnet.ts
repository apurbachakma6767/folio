/**
 * Thrive Milestone 2 — bootstrap Folio artifacts on Hedera MainNet.
 *
 * Creates Folio equity HTS tokens (TSLA/AAPL bootstrap), Spend Note NFT, HCS audit topic.
 * Remaining Trade symbols: npx tsx scripts/ensure-all-equity-tokens.ts --mainnet
 * Uses Circle native USDC (0.0.456858) — does NOT create a fake USDC token.
 *
 * Prerequisites:
 *   - HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY for a funded mainnet account
 *   - Enough HBAR for token creates + later vault deploy
 *
 * Run:
 *   HEDERA_NETWORK=mainnet USE_NATIVE_USDC=true npx tsx scripts/setup-mainnet.ts
 *
 * Or: npm run setup:mainnet
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// Force mainnet + native USDC for this entrypoint
process.env.HEDERA_NETWORK = 'mainnet';
process.env.USE_NATIVE_USDC = 'true';
if (!process.env.USDC_TOKEN_ID) {
  process.env.USDC_TOKEN_ID = '0.0.456858';
}

async function main() {
  console.log('=== Folio MainNet setup (Thrive M2) ===\n');
  // Reuse setup.ts logic via spawning would re-read env; import by re-executing file
  // Inline: require the setup module by running child
  const { spawnSync } = await import('child_process');
  const result = spawnSync(
    'npx',
    ['tsx', 'scripts/setup.ts'],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        HEDERA_NETWORK: 'mainnet',
        USE_NATIVE_USDC: 'true',
        USDC_TOKEN_ID: process.env.USDC_TOKEN_ID || '0.0.456858',
      },
    }
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log('\n=== After setup ===');
  console.log('1. npx tsx scripts/ensure-all-equity-tokens.ts --mainnet  # all TRADE_STOCKS → DB + env');
  console.log('2. Set USDC_TOKEN_ID=0.0.456858 (and USDC_TEST_TOKEN_ID same for compat)');
  console.log('3. npm run contracts:compile && npm run deploy:vault');
  console.log('4. npm run hedera:associate-vault');
  console.log('5. Associate operator with USDC if needed; fund ~10 USDC to operator');
  console.log('6. Set caps: MAX_SPEND_USDC=2 MAX_OUTSTANDING_USDC=10 ALLOW_AUTO_FUND_USDC=false ALLOW_MINT_USDC=false');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
