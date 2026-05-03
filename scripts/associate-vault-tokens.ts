/**
 * Associate the Folio vault contract with MOCK stock tokens and grant KYC + unfreeze
 * (stock tokens use KYC + freeze in scripts/setup.ts).
 *
 * Run: npm run hedera:associate-vault
 */
import dotenv from 'dotenv';
import path from 'path';
import { TokenAssociateTransaction } from '@hashgraph/sdk';
import { getClient, getOperatorKey, grantKyc, unfreezeAccount } from '../src/lib/hedera';
import { getTokenIdForSymbol } from '../src/lib/token-registry';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

async function main() {
  const vaultId = process.env.FOLIO_VAULT_CONTRACT_ID?.trim();
  if (!vaultId) {
    throw new Error('FOLIO_VAULT_CONTRACT_ID is required (deploy the vault first)');
  }

  const tokenIds = ['TSLA', 'AAPL']
    .map((sym) => getTokenIdForSymbol(sym))
    .filter((id): id is string => Boolean(id));

  if (tokenIds.length === 0) {
    throw new Error('MOCK_TSLA_TOKEN_ID / MOCK_AAPL_TOKEN_ID must be set');
  }

  const client = getClient();
  const operatorKey = getOperatorKey();

  for (const tid of tokenIds) {
    try {
      await grantKyc(tid, vaultId);
      console.log(`Granted KYC on ${tid} for vault ${vaultId}`);
    } catch (e) {
      console.log(`grantKyc ${tid}: ${e instanceof Error ? e.message : e} (may already be granted)`);
    }
    try {
      await unfreezeAccount(tid, vaultId);
      console.log(`Unfroze ${tid} for vault`);
    } catch (e) {
      console.log(`unfreeze ${tid}: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(vaultId)
      .setTokenIds(tokenIds)
      .freezeWith(client);
    await tx.sign(operatorKey);
    const resp = await tx.execute(client);
    await resp.getReceipt(client);
    console.log(`\nVault ${vaultId} associated with tokens: ${tokenIds.join(', ')}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('TOKEN_ALREADY_ASSOCIATED') || msg.includes('already associated')) {
      console.log('Tokens already associated to vault — continuing.');
    } else {
      throw e;
    }
  }

  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
