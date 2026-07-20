/**
 * Burn all Folio equity HTS balances from the operator treasury.
 *
 * Operator is USDC liquidity + gas only — never equity inventory.
 * Vault should only hold stock after a user collars (deposit), not at bootstrap.
 *
 * Usage:
 *   npx tsx scripts/purge-operator-equity.ts
 *   npx tsx scripts/purge-operator-equity.ts --mainnet
 *   npx tsx scripts/purge-operator-equity.ts --mainnet --vault   # also burn if vault has equity (needs admin)
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const mainnetEnv = path.resolve(process.cwd(), '.env.mainnet.local');
const localEnv = path.resolve(process.cwd(), '.env.local');
const useMainnet = process.argv.includes('--mainnet');
const alsoVault = process.argv.includes('--vault');

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
    hydrateTokenRegistryFromDb,
    getTokenIdForSymbol,
    envTokenId,
    registerStockToken,
  } = await import('../src/lib/token-registry');
  const {
    resetHederaClientForTests,
    getOperatorId,
    getTokenBalances,
    burnFungibleToken,
  } = await import('../src/lib/hedera');

  resetHederaClientForTests();
  await hydrateTokenRegistryFromDb();
  for (const s of TRADE_STOCKS) {
    const id = envTokenId(s.symbol);
    if (id) registerStockToken(s.symbol, id, s.name);
  }

  const operatorId = getOperatorId().toString();
  console.log(`Network: ${process.env.HEDERA_NETWORK || 'testnet'}`);
  console.log(`Operator (treasury): ${operatorId}`);
  console.log('Burning equity balances so operator holds USDC/gas only…\n');

  const balances = await getTokenBalances(operatorId);
  let burned = 0;

  for (const s of TRADE_STOCKS) {
    const tokenId = getTokenIdForSymbol(s.symbol);
    if (!tokenId) {
      console.log(`  ${s.symbol.padEnd(6)} (no token id — skip)`);
      continue;
    }
    const bal = balances.get(tokenId) ?? 0;
    if (bal <= 0) {
      console.log(`  ${s.symbol.padEnd(6)} ${tokenId}  balance=0`);
      continue;
    }
    try {
      const tx = await burnFungibleToken(tokenId, bal);
      console.log(`  ${s.symbol.padEnd(6)} ${tokenId}  burned ${bal}  (${tx})`);
      burned += bal;
    } catch (e) {
      console.error(
        `  ${s.symbol.padEnd(6)} FAILED burn ${bal}:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  // USDC must remain — report only
  const usdcId =
    process.env.USDC_TOKEN_ID?.trim() || process.env.USDC_TEST_TOKEN_ID?.trim();
  if (usdcId) {
    const usdcBal = balances.get(usdcId) ?? 0;
    console.log(`\n  USDC   ${usdcId}  balance=${usdcBal} (kept — liquidity)`);
  }

  if (alsoVault) {
    const vaultId = process.env.FOLIO_VAULT_CONTRACT_ID?.trim();
    if (!vaultId) {
      console.warn('\n--vault set but FOLIO_VAULT_CONTRACT_ID missing');
    } else {
      console.log(
        `\nVault ${vaultId}: equity should only arrive via user deposit.`
      );
      console.log(
        'Association is OK (empty wallet ready to receive). Non-zero vault equity'
      );
      console.log(
        'must be released by the app / operator release path — not burned from here'
      );
      try {
        const vaultBal = await getTokenBalances(vaultId);
        for (const s of TRADE_STOCKS) {
          const tokenId = getTokenIdForSymbol(s.symbol);
          if (!tokenId) continue;
          const bal = vaultBal.get(tokenId) ?? 0;
          if (bal > 0) {
            console.warn(`  VAULT holds ${s.symbol} ${tokenId} amount=${bal} — release via app`);
          }
        }
        const any = TRADE_STOCKS.some((s) => {
          const id = getTokenIdForSymbol(s.symbol);
          return id ? (vaultBal.get(id) ?? 0) > 0 : false;
        });
        if (!any) console.log('  Vault equity balances: all zero ✓');
      } catch (e) {
        console.warn('  Could not read vault balances:', e instanceof Error ? e.message : e);
      }
    }
  }

  console.log(`\nDone. Burned ${burned} raw units of equity from operator treasury.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
