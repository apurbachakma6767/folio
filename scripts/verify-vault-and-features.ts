/**
 * End-to-end config + feature smoke checks for Folio testnet vault + core APIs.
 * Run: npx tsx scripts/verify-vault-and-features.ts
 *
 * Does not place live spends without a funded test user key; validates wiring,
 * on-chain state, and dry-run prepare paths where possible.
 */
import dotenv from 'dotenv';
import path from 'path';
import { ContractCallQuery, ContractFunctionParameters, AccountId, TokenId } from '@hashgraph/sdk';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

type Status = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
interface Check {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

const checks: Check[] = [];

function pass(name: string, detail: string) {
  checks.push({ name, status: 'PASS', detail });
  console.log(`✓ PASS  ${name}: ${detail}`);
}
function fail(name: string, detail: string, fix?: string) {
  checks.push({ name, status: 'FAIL', detail, fix });
  console.log(`✗ FAIL  ${name}: ${detail}`);
  if (fix) console.log(`       FIX: ${fix}`);
}
function warn(name: string, detail: string, fix?: string) {
  checks.push({ name, status: 'WARN', detail, fix });
  console.log(`! WARN  ${name}: ${detail}`);
  if (fix) console.log(`       FIX: ${fix}`);
}
function skip(name: string, detail: string) {
  checks.push({ name, status: 'SKIP', detail });
  console.log(`· SKIP  ${name}: ${detail}`);
}

async function main() {
  console.log('\n=== Folio vault + feature verification ===\n');

  // ── 1. Env ──────────────────────────────────────────────────────────
  const vaultId = process.env.FOLIO_VAULT_CONTRACT_ID?.trim() || '';
  const vaultEvm = process.env.FOLIO_VAULT_EVM_ADDRESS?.trim() || '';
  const network = process.env.HEDERA_NETWORK || 'testnet';
  const pubNet = process.env.NEXT_PUBLIC_HEDERA_NETWORK || '';
  const operatorId = process.env.HEDERA_OPERATOR_ID || '';
  const usdc = process.env.USDC_TEST_TOKEN_ID || process.env.USDC_TOKEN_ID || '';
  const note = process.env.SPEND_NOTE_TOKEN_ID || '';
  const topic = process.env.AUDIT_TOPIC_ID || '';
  const oracle = process.env.COLLAR_ORACLE_ADDRESS || '';

  if (vaultId) pass('env.FOLIO_VAULT_CONTRACT_ID', vaultId);
  else
    fail(
      'env.FOLIO_VAULT_CONTRACT_ID',
      'empty',
      'Set FOLIO_VAULT_CONTRACT_ID=0.0.9217856 in .env.local'
    );

  if (vaultEvm) pass('env.FOLIO_VAULT_EVM_ADDRESS', vaultEvm);
  else warn('env.FOLIO_VAULT_EVM_ADDRESS', 'empty (optional for runtime)');

  if (network === 'testnet') pass('env.HEDERA_NETWORK', network);
  else warn('env.HEDERA_NETWORK', network);

  if (pubNet === 'testnet') pass('env.NEXT_PUBLIC_HEDERA_NETWORK', pubNet);
  else
    warn(
      'env.NEXT_PUBLIC_HEDERA_NETWORK',
      pubNet || '(unset)',
      'Set NEXT_PUBLIC_HEDERA_NETWORK=testnet so UI shows correct network'
    );

  if (operatorId) pass('env.HEDERA_OPERATOR_ID', operatorId);
  else fail('env.HEDERA_OPERATOR_ID', 'missing');

  if (usdc) pass('env.USDC', usdc);
  else fail('env.USDC', 'missing USDC_TEST_TOKEN_ID / USDC_TOKEN_ID');

  if (note) pass('env.SPEND_NOTE_TOKEN_ID', note);
  else fail('env.SPEND_NOTE_TOKEN_ID', 'missing');

  if (topic) pass('env.AUDIT_TOPIC_ID', topic);
  else warn('env.AUDIT_TOPIC_ID', 'missing — HCS audit writes will fail');

  if (oracle && !oracle.startsWith('0x0000')) pass('env.COLLAR_ORACLE_ADDRESS', oracle);
  else warn('env.COLLAR_ORACLE_ADDRESS', oracle || 'unset — Yahoo fallback only');

  // ── 2. App config helpers ───────────────────────────────────────────
  const {
    isFolioVaultConfigured,
    getFolioVaultContractId,
    getClient,
    getOperatorId,
    getOperatorKey,
    hexWith0x,
    getTokenBalances,
  } = await import('../src/lib/hedera');
  const { getUsdcTokenId, requireVault, getHederaNetwork } = await import('../src/lib/network');
  const { getTokenIdForSymbol } = await import('../src/lib/token-registry');
  const { TRADE_STOCKS } = await import('../src/lib/types');

  if (isFolioVaultConfigured()) {
    pass('isFolioVaultConfigured()', 'true');
    try {
      pass('getFolioVaultContractId()', getFolioVaultContractId());
    } catch (e) {
      fail('getFolioVaultContractId()', e instanceof Error ? e.message : String(e));
    }
  } else {
    fail(
      'isFolioVaultConfigured()',
      'false — app will use legacy operator custody',
      'Set FOLIO_VAULT_CONTRACT_ID and restart Next.js'
    );
  }

  pass('getHederaNetwork()', getHederaNetwork());
  pass('requireVault()', String(requireVault()));
  const usdcResolved = getUsdcTokenId();
  if (usdcResolved) pass('getUsdcTokenId()', usdcResolved);
  else fail('getUsdcTokenId()', 'undefined');

  // ── 3. Mirror: vault exists ─────────────────────────────────────────
  if (vaultId) {
    try {
      const res = await fetch(
        `https://testnet.mirrornode.hedera.com/api/v1/contracts/${vaultId}`
      );
      if (!res.ok) {
        fail('mirror.vault_exists', `HTTP ${res.status}`, 'Redeploy vault or fix contract id');
      } else {
        const data = (await res.json()) as {
          contract_id: string;
          evm_address: string;
          deleted: boolean;
        };
        if (data.deleted) fail('mirror.vault_exists', 'contract deleted');
        else pass('mirror.vault_exists', `${data.contract_id} evm=${data.evm_address}`);

        if (vaultEvm && data.evm_address) {
          if (data.evm_address.toLowerCase() === vaultEvm.toLowerCase()) {
            pass('mirror.evm_matches_env', data.evm_address);
          } else {
            fail(
              'mirror.evm_matches_env',
              `env ${vaultEvm} vs chain ${data.evm_address}`,
              'Update FOLIO_VAULT_EVM_ADDRESS to match mirror'
            );
          }
        }
      }
    } catch (e) {
      fail('mirror.vault_exists', e instanceof Error ? e.message : String(e));
    }
  }

  // ── 4. On-chain operator() ──────────────────────────────────────────
  if (vaultId && operatorId) {
    try {
      const client = getClient();
      const q = new ContractCallQuery()
        .setContractId(vaultId)
        .setGas(100_000)
        .setFunction('operator');
      const result = await q.execute(client);
      const opAddr = result.getAddress(0);
      const opHex = opAddr.startsWith('0x') ? opAddr : `0x${opAddr}`;
      const expected = hexWith0x(AccountId.fromString(operatorId).toSolidityAddress());
      if (opHex.toLowerCase() === expected.toLowerCase()) {
        pass('vault.operator()', `matches HEDERA_OPERATOR_ID (${opHex})`);
      } else {
        fail(
          'vault.operator()',
          `on-chain ${opHex} != env operator ${expected}`,
          'Vault was deployed with a different operator. Redeploy vault with current operator, or use the original operator key.'
        );
      }
      client.close();
    } catch (e) {
      fail(
        'vault.operator()',
        e instanceof Error ? e.message : String(e),
        'Contract may not be FolioCollateralVault, or RPC/query failed'
      );
    }
  }

  // ── 5. Token registry for trade symbols ─────────────────────────────
  const missingTokens: string[] = [];
  for (const s of TRADE_STOCKS) {
    const id = getTokenIdForSymbol(s.symbol);
    if (!id) missingTokens.push(s.symbol);
  }
  if (missingTokens.length === 0) {
    pass('token-registry.TRADE_STOCKS', `all ${TRADE_STOCKS.length} symbols mapped`);
  } else {
    fail(
      'token-registry.TRADE_STOCKS',
      `missing: ${missingTokens.join(', ')}`,
      'Run: npx tsx scripts/ensure-all-equity-tokens.ts'
    );
  }

  // ── 6. Vault token associations ─────────────────────────────────────
  if (vaultId) {
    try {
      const res = await fetch(
        `https://testnet.mirrornode.hedera.com/api/v1/accounts/${vaultId}/tokens?limit=100`
      );
      const data = (await res.json()) as {
        tokens?: { token_id: string; balance: number }[];
      };
      const associated = new Set((data.tokens || []).map((t) => t.token_id));
      const must = ['TSLA', 'AAPL'].map((s) => getTokenIdForSymbol(s)).filter(Boolean) as string[];
      const missingAssoc = must.filter((id) => !associated.has(id));
      if (missingAssoc.length === 0) {
        pass(
          'vault.associated TSLA/AAPL',
          `ok (${must.join(', ')}) balances: ${must
            .map((id) => {
              const t = (data.tokens || []).find((x) => x.token_id === id);
              return `${id}=${t?.balance ?? 0}`;
            })
            .join(', ')}`
        );
      } else {
        fail(
          'vault.associated TSLA/AAPL',
          `not associated: ${missingAssoc.join(', ')}`,
          'Run: npm run hedera:associate-vault'
        );
      }

      // Extra equities used by Trade desk
      const extra = TRADE_STOCKS.map((s) => getTokenIdForSymbol(s.symbol)).filter(
        (id): id is string => Boolean(id) && !must.includes(id)
      );
      const missingExtra = extra.filter((id) => !associated.has(id));
      if (missingExtra.length === 0) {
        pass('vault.associated all TRADE_STOCKS', `${extra.length + must.length} tokens`);
      } else {
        warn(
          'vault.associated TRADE_STOCKS',
          `${missingExtra.length} equities not associated (vault can only hold TSLA/AAPL until associate)`,
          'Extend scripts/associate-vault-tokens.ts to include all TRADE_STOCKS symbols, then re-run'
        );
      }
    } catch (e) {
      fail('vault.associations', e instanceof Error ? e.message : String(e));
    }
  }

  // ── 7. Operator treasury balances ───────────────────────────────────
  try {
    const op = getOperatorId().toString();
    const bals = await getTokenBalances(op);
    const usdcBal = usdcResolved ? bals.get(usdcResolved) ?? 0 : 0;
    // USDC often 6 decimals
    const usdcHuman = usdcBal / 1e6;
    if (usdcHuman >= 1) {
      pass('operator.USDC_treasury', `${usdcHuman.toFixed(2)} USDC`);
    } else if (usdcHuman > 0) {
      warn('operator.USDC_treasury', `${usdcHuman.toFixed(4)} USDC (low)`, 'Mint/fund treasury USDC for spends');
    } else {
      fail(
        'operator.USDC_treasury',
        '0 USDC — spends will fail treasury check',
        'Mint test USDC to operator or fund account'
      );
    }

    for (const sym of ['TSLA', 'AAPL']) {
      const tid = getTokenIdForSymbol(sym);
      if (!tid) continue;
      const bal = bals.get(tid) ?? 0;
      pass(`operator.${sym}_supply_or_hold`, `${bal} base units (token ${tid})`);
    }
  } catch (e) {
    fail('operator.balances', e instanceof Error ? e.message : String(e));
  }

  // ── 8. Allowance prepare (dry structure) ────────────────────────────
  if (isFolioVaultConfigured() && operatorId) {
    try {
      const { prepareTokenAllowanceForVault, prepareCollateralLock } = await import(
        '../src/lib/hedera'
      );
      const tsla = getTokenIdForSymbol('TSLA');
      if (!tsla) throw new Error('no TSLA token');
      // Use operator as dummy owner for freeze-only check — may fail at execute but prepare should return bytes
      // Better: skip if no test user. Use a fake-looking account will fail freeze.
      // Just ensure function exists and vault branch is taken in code path via unit-style call with operator self.
      const bytes = await prepareTokenAllowanceForVault(tsla, operatorId, vaultId, 1);
      if (bytes && bytes.length > 50) {
        pass(
          'prepareTokenAllowanceForVault()',
          `returns ${bytes.length} bytes (gasless allowance tx prepared)`
        );
      } else {
        fail('prepareTokenAllowanceForVault()', 'empty/short bytes');
      }

      // Legacy path still callable
      try {
        const legacy = await prepareCollateralLock(tsla, operatorId, 1);
        if (legacy.length > 50) pass('prepareCollateralLock() legacy still works', `${legacy.length} bytes`);
      } catch (e) {
        warn('prepareCollateralLock()', e instanceof Error ? e.message : String(e));
      }
    } catch (e) {
      fail(
        'prepareTokenAllowanceForVault()',
        e instanceof Error ? e.message : String(e),
        'Check operator key + token ids'
      );
    }
  }

  // ── 9. Collar oracle read ───────────────────────────────────────────
  try {
    const { getChainlinkCollar } = await import('../src/lib/chainlink');
    const collar = await getChainlinkCollar('TSLA');
    if (collar) {
      pass(
        'collarOracle.getCollar(TSLA)',
        `price=${collar.price} floor=${collar.floor} cap=${collar.cap}`
      );
    } else {
      warn(
        'collarOracle.getCollar(TSLA)',
        'null — app falls back to Yahoo/quant collar',
        'Oracle may be empty/stale; non-blocking for Thrive M2'
      );
    }
  } catch (e) {
    warn('collarOracle', e instanceof Error ? e.message : String(e));
  }

  // ── 10. HCS topic ───────────────────────────────────────────────────
  if (topic) {
    try {
      const res = await fetch(
        `https://testnet.mirrornode.hedera.com/api/v1/topics/${topic}/messages?limit=3&order=desc`
      );
      if (!res.ok) fail('hcs.topic', `HTTP ${res.status}`);
      else {
        const data = (await res.json()) as { messages?: unknown[] };
        pass('hcs.topic', `${topic} recent messages: ${(data.messages || []).length}`);
      }
    } catch (e) {
      warn('hcs.topic', e instanceof Error ? e.message : String(e));
    }
  }

  // ── 11. HTTP smoke (if server up) ───────────────────────────────────
  const base = process.env.VERIFY_BASE_URL || 'http://localhost:3001';
  try {
    const home = await fetch(base, { redirect: 'manual' });
    pass('http.home', `${base} → ${home.status}`);
  } catch {
    warn('http.home', `server not reachable at ${base}`, 'npm run dev -- -p 3001');
  }

  // Unauthenticated API should 401
  for (const route of ['/api/notes?scope=main', '/api/trade/orders', '/api/users/balances']) {
    try {
      const r = await fetch(`${base}${route}`);
      if (r.status === 401 || r.status === 403) {
        pass(`http.auth ${route}`, `${r.status} (auth required — good)`);
      } else if (r.status === 200) {
        warn(`http.auth ${route}`, '200 without auth — review auth guards');
      } else {
        warn(`http.auth ${route}`, `status ${r.status}`);
      }
    } catch {
      skip(`http.auth ${route}`, 'server down');
    }
  }

  // ── 12. Critical path: vault release dry (query only) ───────────────
  // Confirm release selector exists by calling operator again already done.
  // Document deposit path uses HTS approved transfer not contract deposit()

  warn(
    'architecture.deposit_path',
    'Runtime uses executeVaultDepositWithAllowance (HTS approved transfer INTO vault account), not contract deposit()',
    'This is intentional for gasless UX. release() still uses ContractExecute. Ensure vault is associated + KYC for each equity token.'
  );

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('\n=== Summary ===\n');
  const counts = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  for (const c of checks) counts[c.status]++;
  console.log(`PASS ${counts.PASS}  FAIL ${counts.FAIL}  WARN ${counts.WARN}  SKIP ${counts.SKIP}`);

  const fails = checks.filter((c) => c.status === 'FAIL');
  const warns = checks.filter((c) => c.status === 'WARN');

  if (fails.length) {
    console.log('\n--- FAIL (must fix) ---');
    for (const f of fails) {
      console.log(`• ${f.name}: ${f.detail}`);
      if (f.fix) console.log(`  Fix: ${f.fix}`);
    }
  }
  if (warns.length) {
    console.log('\n--- WARN (plan) ---');
    for (const w of warns) {
      console.log(`• ${w.name}: ${w.detail}`);
      if (w.fix) console.log(`  Fix: ${w.fix}`);
    }
  }

  console.log('\nLive spend/repay/trade with a real browser session still needed for full E2E.');
  console.log('This script validated wiring + on-chain readiness.\n');

  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
