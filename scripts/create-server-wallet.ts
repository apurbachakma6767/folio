// Creates a Dynamic MPC server wallet and prints the address + ID.
// Run: npx tsx scripts/create-server-wallet.ts
// Then add DYNAMIC_SERVER_WALLET_ID and DYNAMIC_SERVER_WALLET_ADDRESS to .env.local

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually (no dotenv dependency)
const envPath = resolve(process.cwd(), '.env.local');
try {
  const envFile = readFileSync(envPath, 'utf-8');
  for (const line of envFile.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
} catch {}

import { DynamicEvmWalletClient } from '@dynamic-labs-wallet/node-evm';
import { ThresholdSignatureScheme } from '@dynamic-labs-wallet/core';

async function main() {
  const envId = process.argv[2] || process.env.DYNAMIC_ENVIRONMENT_ID || process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID;
  const token = process.argv[3] || process.env.DYNAMIC_AUTH_TOKEN || process.env.DYNAMIC_API_TOKEN || process.env.DYNAMIC_API_KEY;

  if (!envId) throw new Error('Usage: npx tsx scripts/create-server-wallet.ts <ENV_ID> <API_TOKEN>');
  if (!token) throw new Error('Usage: npx tsx scripts/create-server-wallet.ts <ENV_ID> <API_TOKEN>');

  console.log(`Creating server wallet for env ${envId.substring(0, 8)}...`);

  const client = new DynamicEvmWalletClient({ environmentId: envId });
  await client.authenticateApiToken(token);

  const wallet = await client.createWalletAccount({
    thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
    backUpToClientShareService: true,
  });

  console.log('\n--- Add these to your .env.local ---');
  console.log(`DYNAMIC_ENVIRONMENT_ID=${envId}`);
  console.log(`DYNAMIC_SERVER_WALLET_ID=${wallet.id}`);
  console.log(`DYNAMIC_SERVER_WALLET_ADDRESS=${wallet.address}`);
}

main().catch((e) => {
  console.error('Failed:', e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
