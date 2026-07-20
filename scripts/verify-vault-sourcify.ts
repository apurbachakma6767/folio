/**
 * Verify FolioCollateralVault on Sourcify (Hedera testnet chainId 296 / mainnet 295).
 * HashScan picks up Sourcify verification automatically.
 *
 * Docs: https://docs.hedera.com/hedera/tutorials/smart-contracts/how-to-verify-a-smart-contract-on-hashscan
 * API:  https://docs.sourcify.dev/docs/api/
 *
 * Run: npx tsx scripts/verify-vault-sourcify.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

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

const SOURCIFY = 'https://sourcify.dev/server';

async function main() {
  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  const chainId = network === 'mainnet' ? 295 : 296;
  const contractId = process.env.FOLIO_VAULT_CONTRACT_ID?.trim();
  let evm =
    process.env.FOLIO_VAULT_EVM_ADDRESS?.trim() ||
    '';

  if (!contractId && !evm) {
    throw new Error('Set FOLIO_VAULT_CONTRACT_ID or FOLIO_VAULT_EVM_ADDRESS');
  }

  const mirror =
    network === 'mainnet'
      ? 'https://mainnet-public.mirrornode.hedera.com'
      : 'https://testnet.mirrornode.hedera.com';

  if (contractId) {
    const res = await fetch(`${mirror}/api/v1/contracts/${contractId}`);
    if (!res.ok) throw new Error(`Mirror contract lookup failed: ${res.status}`);
    const data = (await res.json()) as { evm_address?: string; created_timestamp?: string };
    if (!evm && data.evm_address) {
      evm = data.evm_address.startsWith('0x') ? data.evm_address : `0x${data.evm_address}`;
    }
  }

  if (!evm) throw new Error('Could not resolve EVM address');
  if (!evm.startsWith('0x')) evm = `0x${evm}`;

  // Lookup creation hash for better match quality
  let creationTransactionHash: string | undefined;
  if (contractId) {
    const res = await fetch(
      `${mirror}/api/v1/contracts/${contractId}/results?limit=5&order=asc`
    );
    if (res.ok) {
      const data = (await res.json()) as { results?: { hash?: string }[] };
      creationTransactionHash = data.results?.[0]?.hash;
    }
  }

  const buildInfoDir = path.join(process.cwd(), 'contracts/folio-vault/artifacts/build-info');
  let buildInfoPath = path.join(
    buildInfoDir,
    '492854197a7293bc0631cc8d4363024a.json'
  );
  if (!fs.existsSync(buildInfoPath) && fs.existsSync(buildInfoDir)) {
    const files = fs.readdirSync(buildInfoDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      throw new Error('Missing Hardhat build-info. Run: npm run contracts:compile');
    }
    buildInfoPath = path.join(buildInfoDir, files[0]);
  }
  if (!fs.existsSync(buildInfoPath)) {
    throw new Error('Missing Hardhat build-info. Run: npm run contracts:compile');
  }
  const bi = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8')) as {
    solcLongVersion: string;
    input: unknown;
  };

  // Already verified?
  const check = await fetch(
    `${SOURCIFY}/v2/contract/${chainId}/${evm}?fields=runtimeMatch,creationMatch,match,verifiedAt,compilation`
  );
  if (check.ok) {
    const existing = await check.json();
    if (existing.match || existing.runtimeMatch) {
      console.log('Already verified on Sourcify:');
      console.log(JSON.stringify(existing, null, 2));
      printLinks(network, chainId, contractId, evm);
      return;
    }
  }

  const payload: Record<string, unknown> = {
    stdJsonInput: bi.input,
    compilerVersion: bi.solcLongVersion,
    contractIdentifier: 'solidity/FolioCollateralVault.sol:FolioCollateralVault',
  };
  if (creationTransactionHash) {
    payload.creationTransactionHash = creationTransactionHash;
  }

  console.log(`Verifying ${evm} on chain ${chainId} (${network})…`);
  const submit = await fetch(`${SOURCIFY}/v2/verify/${chainId}/${evm}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const submitBody = await submit.json();
  if (!submit.ok && !submitBody.verificationId) {
    console.error('Submit failed:', submit.status, submitBody);
    process.exit(1);
  }

  const verificationId = submitBody.verificationId as string;
  console.log('verificationId', verificationId);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const jobRes = await fetch(`${SOURCIFY}/v2/verify/${verificationId}`);
    const job = await jobRes.json();
    if (job.isJobCompleted) {
      console.log(JSON.stringify(job, null, 2));
      if (job.contract?.match || job.contract?.runtimeMatch) {
        console.log('\n✓ Verified');
        printLinks(network, chainId, contractId, evm);
        return;
      }
      // Re-submit when already exact_match is a no-op success
      if (job.error?.customCode === 'already_verified') {
        console.log('\n✓ Already verified on Sourcify (exact match on file)');
        printLinks(network, chainId, contractId, evm);
        return;
      }
      console.error('Verification completed without match');
      process.exit(1);
    }
  }
  console.error('Timed out waiting for Sourcify job');
  process.exit(1);
}

function printLinks(
  network: string,
  chainId: number,
  contractId: string | undefined,
  evm: string
) {
  const net = network === 'mainnet' ? 'mainnet' : 'testnet';
  console.log('\nLinks:');
  console.log(`  Sourcify: https://repo.sourcify.dev/${chainId}/${evm}`);
  if (contractId) {
    console.log(`  HashScan: https://hashscan.io/${net}/contract/${contractId}`);
  }
  console.log(`  HashScan (EVM): https://hashscan.io/${net}/contract/${evm}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
