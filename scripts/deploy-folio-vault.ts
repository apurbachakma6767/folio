/**
 * Deploy FolioCollateralVault to Hedera testnet via ContractCreateTransaction.
 * Prerequisites: npm run contracts:compile, HEDERA_OPERATOR_* in .env.local
 *
 * Run: npm run deploy:vault
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import {
  AccountId,
  ContractCreateTransaction,
  ContractFunctionParameters,
} from '@hashgraph/sdk';
import { getClient, getOperatorKey, hexWith0x } from '../src/lib/hedera';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

async function main() {
  if (!process.env.HEDERA_OPERATOR_ID || !process.env.HEDERA_OPERATOR_KEY) {
    throw new Error('HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY are required');
  }

  const artifactPath = path.join(
    process.cwd(),
    'contracts/folio-vault/artifacts/solidity/FolioCollateralVault.sol/FolioCollateralVault.json'
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Bytecode not found at ${artifactPath}. Run: npm run contracts:compile`);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as { bytecode: string };
  const hex = artifact.bytecode.replace(/^0x/, '');
  const bytecode = Uint8Array.from(Buffer.from(hex, 'hex'));

  const operatorAccount = AccountId.fromString(process.env.HEDERA_OPERATOR_ID);
  const operatorEvm = hexWith0x(operatorAccount.toSolidityAddress());
  const operatorKey = getOperatorKey();
  const client = getClient();

  const tx = new ContractCreateTransaction()
    .setGas(3_000_000)
    .setBytecode(bytecode)
    .setConstructorParameters(new ContractFunctionParameters().addAddress(operatorEvm));

  const frozen = await tx.freezeWith(client);
  await frozen.sign(operatorKey);
  const response = await frozen.execute(client);
  const receipt = await response.getReceipt(client);
  const cid = receipt.contractId;
  if (!cid) {
    throw new Error('Contract creation receipt missing contractId');
  }

  console.log('\n--- Add to .env.local ---');
  console.log(`FOLIO_VAULT_CONTRACT_ID=${cid.toString()}`);
  console.log(`FOLIO_VAULT_EVM_ADDRESS=${hexWith0x(cid.toSolidityAddress())}`);
  console.log('\nNext: npm run hedera:associate-vault (KYC, unfreeze, token associate for vault)\n');

  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
