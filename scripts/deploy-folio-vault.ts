/**
 * Deploy FolioCollateralVault to Hedera (testnet or mainnet) via ContractCreateFlow.
 * Prerequisites: npm run contracts:compile, HEDERA_OPERATOR_* in .env.local
 * Set HEDERA_NETWORK=mainnet for Thrive MainNet deploy.
 *
 * Run: npm run deploy:vault
 *
 * Sets adminKey = operator so TokenAssociateTransaction on the vault succeeds later.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import {
  AccountId,
  ContractCreateFlow,
  ContractFunctionParameters,
  Hbar,
} from '@hashgraph/sdk';
import { getClient, getOperatorKey, hexWith0x, resetHederaClientForTests } from '../src/lib/hedera';

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
  if (!process.env.HEDERA_OPERATOR_ID || !process.env.HEDERA_OPERATOR_KEY) {
    throw new Error('HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY are required');
  }

  resetHederaClientForTests();
  console.log(`HEDERA_NETWORK=${process.env.HEDERA_NETWORK || 'testnet'}`);

  const artifactPath = path.join(
    process.cwd(),
    'contracts/folio-vault/artifacts/solidity/FolioCollateralVault.sol/FolioCollateralVault.json'
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Bytecode not found at ${artifactPath}. Run: npm run contracts:compile`);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as { bytecode: string };
  let hex = artifact.bytecode.replace(/^0x/, '');

  const operatorAccount = AccountId.fromString(process.env.HEDERA_OPERATOR_ID);
  const operatorSolidity = operatorAccount.toSolidityAddress();
  const operatorKey = getOperatorKey();
  const client = getClient();
  client.setDefaultMaxTransactionFee(new Hbar(100));

  const flow = new ContractCreateFlow()
    .setGas(2_500_000)
    .setBytecode(hex)
    .setAdminKey(operatorKey.publicKey)
    .setConstructorParameters(
      new ContractFunctionParameters().addAddress(operatorSolidity)
    );

  const response = await flow.execute(client);
  const receipt = await response.getReceipt(client);
  const cid = receipt.contractId;
  if (!cid) {
    throw new Error('Contract creation receipt missing contractId');
  }

  const vaultId = cid.toString();
  const vaultEvm = hexWith0x(cid.toSolidityAddress());
  console.log('\n--- Vault deployed ---');
  console.log(`FOLIO_VAULT_CONTRACT_ID=${vaultId}`);
  console.log(`FOLIO_VAULT_EVM_ADDRESS=${vaultEvm}`);

  // Persist into active env file
  const envPath = useMainnet && fs.existsSync(mainnetEnv) ? mainnetEnv : localEnv;
  if (fs.existsSync(envPath)) {
    let text = fs.readFileSync(envPath, 'utf8');
    for (const [k, v] of [
      ['FOLIO_VAULT_CONTRACT_ID', vaultId],
      ['FOLIO_VAULT_EVM_ADDRESS', vaultEvm],
    ] as const) {
      if (new RegExp(`^${k}=`, 'm').test(text)) {
        text = text.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
      } else {
        text += (text.endsWith('\n') ? '' : '\n') + `${k}=${v}\n`;
      }
    }
    fs.writeFileSync(envPath, text);
    console.log(`\nUpdated ${path.basename(envPath)}`);
  }

  console.log(
    useMainnet
      ? '\nNext: npx tsx scripts/associate-vault-tokens.ts --mainnet\n'
      : '\nNext: npm run hedera:associate-vault\n'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
