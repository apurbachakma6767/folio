/**
 * Associate the Folio vault contract with equity HTS tokens.
 *
 * Association only — the vault starts with **zero** balance. Equity is deposited
 * when a user collars via the app. Operator never pre-funds the vault with stock.
 * Tokens without KYC/freeze keys skip those steps.
 *
 * Run: npm run hedera:associate-vault
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import {
  AccountId,
  TokenAssociateTransaction,
  TokenId,
  TokenInfoQuery,
} from '@hashgraph/sdk';
import {
  getClient,
  getOperatorKey,
  grantKyc,
  unfreezeAccount,
  resetHederaClientForTests,
} from '../src/lib/hedera';
import { getTokenIdForSymbol } from '../src/lib/token-registry';
import { TRADE_STOCKS } from '../src/lib/types';

const mainnetEnv = path.resolve(process.cwd(), '.env.mainnet.local');
const localEnv = path.resolve(process.cwd(), '.env.local');
const useMainnet =
  process.argv.includes('--mainnet') ||
  process.env.HEDERA_NETWORK === 'mainnet';

if (useMainnet && fs.existsSync(mainnetEnv)) {
  dotenv.config({ path: mainnetEnv });
  process.env.HEDERA_NETWORK = 'mainnet';
} else {
  dotenv.config({ path: localEnv });
  dotenv.config();
}

async function main() {
  resetHederaClientForTests();
  const vaultId = process.env.FOLIO_VAULT_CONTRACT_ID?.trim();
  if (!vaultId) {
    throw new Error('FOLIO_VAULT_CONTRACT_ID is required (deploy the vault first)');
  }
  console.log(`Network: ${process.env.HEDERA_NETWORK || 'testnet'}`);
  console.log(`Vault: ${vaultId}`);

  // Hydrate DB so all TRADE_STOCKS resolve (primary store; env is seed only)
  const { hydrateTokenRegistryFromDb, getTokenRegistry } = await import(
    '../src/lib/token-registry'
  );
  await hydrateTokenRegistryFromDb();
  // Force env seeds into registry via getTokenRegistry
  getTokenRegistry();

  const symbols = [...new Set(TRADE_STOCKS.map((s) => s.symbol))];

  const tokenIds = symbols
    .map((sym) => getTokenIdForSymbol(sym))
    .filter((id): id is string => Boolean(id));

  if (tokenIds.length === 0) {
    throw new Error('No equity token IDs found — run npm run ensure:equities first');
  }

  const client = getClient();
  const operatorKey = getOperatorKey();
  const vaultAccount = AccountId.fromString(vaultId);
  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  const mirrorBase =
    process.env.HEDERA_MIRROR_NODE_URL?.trim() ||
    (network === 'mainnet'
      ? 'https://mainnet-public.mirrornode.hedera.com'
      : 'https://testnet.mirrornode.hedera.com');

  // Already associated?
  let already = new Set<string>();
  try {
    const res = await fetch(`${mirrorBase}/api/v1/accounts/${vaultId}/tokens?limit=100`);
    const data = (await res.json()) as { tokens?: { token_id: string }[] };
    already = new Set((data.tokens || []).map((t) => t.token_id));
  } catch {
    /* ignore */
  }

  const needAssociate: string[] = [];

  for (const tid of tokenIds) {
    if (already.has(tid)) {
      console.log(`Already associated: ${tid}`);
    } else {
      needAssociate.push(tid);
    }
  }

  if (needAssociate.length === 0) {
    console.log(`\nVault ${vaultId} already associated with all ${tokenIds.length} tokens.`);
    return;
  }

  // Associate one-by-one so a single failure does not block the rest
  const associatedOk: string[] = [...already];
  for (const tid of needAssociate) {
    try {
      const tx = await new TokenAssociateTransaction()
        .setAccountId(vaultAccount)
        .setTokenIds([TokenId.fromString(tid)])
        .freezeWith(client);
      await tx.sign(operatorKey);
      // Contract accounts: admin key must sign (set at ContractCreate via setAdminKey).
      const resp = await tx.execute(client);
      await resp.getReceipt(client);
      console.log(`Associated vault with ${tid}`);
      associatedOk.push(tid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('TOKEN_ALREADY_ASSOCIATED') || msg.includes('already associated')) {
        console.log(`Already associated: ${tid}`);
        associatedOk.push(tid);
      } else if (msg.includes('INVALID_SIGNATURE')) {
        console.error(
          `INVALID_SIGNATURE associating ${tid} — vault admin key may not match HEDERA_OPERATOR_KEY.\n` +
            `  Redeploy with: npm run deploy:vault (now sets admin key), update FOLIO_VAULT_* in .env.local, re-run this script.`
        );
      } else {
        console.error(`Associate ${tid} failed: ${msg}`);
      }
    }
  }

  // KYC / unfreeze only after association, and only if token has those keys
  for (const tid of associatedOk) {
    try {
      const info = await new TokenInfoQuery().setTokenId(TokenId.fromString(tid)).execute(client);
      if (info.kycKey) {
        try {
          await grantKyc(tid, vaultId);
          console.log(`Granted KYC on ${tid}`);
        } catch (e) {
          console.log(`grantKyc ${tid}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (info.freezeKey) {
        try {
          await unfreezeAccount(tid, vaultId);
          console.log(`Unfroze ${tid}`);
        } catch (e) {
          console.log(`unfreeze ${tid}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      console.log(`tokenInfo ${tid}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\nDone. Vault ${vaultId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
