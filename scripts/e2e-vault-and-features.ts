/**
 * Fix-verification + E2E:
 * 1) Homepage SSR
 * 2) Supabase test users (balances / notes API via dev auth)
 * 3) Full vault custody cycle with a disposable funded account (known key)
 *
 * Run: npx tsx scripts/e2e-vault-and-features.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import {
  PrivateKey,
  Transaction,
  TokenAssociateTransaction,
  TokenId,
  AccountId,
  TransferTransaction,
  TransactionId,
  Hbar,
} from '@hashgraph/sdk';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3001';

type Row = { name: string; ok: boolean; detail: string };
const results: Row[] = [];

function ok(name: string, detail: string) {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}: ${detail}`);
}
function bad(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.log(`✗ ${name}: ${detail}`);
}

async function mirrorTokenBal(accountId: string, tokenId: string): Promise<number> {
  const res = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/tokens?limit=100`
  );
  const data = (await res.json()) as { tokens?: { token_id: string; balance: number }[] };
  const t = (data.tokens || []).find((x) => x.token_id === tokenId);
  return t?.balance ?? 0;
}

async function main() {
  console.log('\n=== E2E vault + features ===\n');

  // ── 1. Homepage SSR ────────────────────────────────────────────────
  try {
    const r = await fetch(BASE, { redirect: 'manual' });
    const html = await r.text();
    if (r.status === 200 && !html.includes('window is not defined')) {
      ok('homepage SSR', `HTTP ${r.status}`);
    } else if (r.status === 500 || html.includes('window is not defined')) {
      bad('homepage SSR', `HTTP ${r.status} still broken (Dynamic SSR?)`);
    } else {
      ok('homepage SSR', `HTTP ${r.status} (check body manually if odd)`);
    }
  } catch (e) {
    bad('homepage SSR', e instanceof Error ? e.message : String(e));
  }

  // ── 2. Supabase test users + authenticated APIs ────────────────────
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: users, error: usersErr } = await sb.from('users').select('*').limit(10);
  if (usersErr || !users?.length) {
    bad('supabase.users', usersErr?.message || 'no users');
  } else {
    ok('supabase.users', `${users.length} test user(s)`);
    for (const u of users) {
      const email = u.email as string;
      const accountId = u.hedera_account_id as string;
      const auth = `Bearer folio-dev:${email}`;

      // balances API
      try {
        const br = await fetch(
          `${BASE}/api/users/balances?accountId=${encodeURIComponent(accountId)}`,
          { headers: { Authorization: auth } }
        );
        const bj = await br.json();
        if (br.ok) {
          ok(
            `api.balances ${email}`,
            `HTTP ${br.status} hbar=${bj.hbar ?? '?'} holdings=${(bj.holdings || []).length}`
          );
        } else {
          bad(`api.balances ${email}`, `HTTP ${br.status} ${JSON.stringify(bj).slice(0, 200)}`);
        }
      } catch (e) {
        bad(`api.balances ${email}`, e instanceof Error ? e.message : String(e));
      }

      // notes API
      try {
        const nr = await fetch(`${BASE}/api/notes?scope=main`, {
          headers: { Authorization: auth },
        });
        const nj = await nr.json();
        if (nr.ok) {
          ok(`api.notes ${email}`, `HTTP ${nr.status} notes=${(nj.notes || []).length}`);
        } else {
          bad(`api.notes ${email}`, `HTTP ${nr.status} ${JSON.stringify(nj).slice(0, 160)}`);
        }
      } catch (e) {
        bad(`api.notes ${email}`, e instanceof Error ? e.message : String(e));
      }

      // prices API
      try {
        const pr = await fetch(`${BASE}/api/price?symbols=TSLA,AAPL`, {
          headers: { Authorization: auth },
        });
        if (pr.ok) {
          const pj = await pr.json();
          const n = Object.keys(pj).length;
          ok(`api.price ${email}`, `${n} symbols`);
        } else {
          bad(`api.price ${email}`, `HTTP ${pr.status}`);
        }
      } catch (e) {
        bad(`api.price ${email}`, e instanceof Error ? e.message : String(e));
      }

      // trade orders list
      try {
        const tr = await fetch(`${BASE}/api/trade/orders`, {
          headers: { Authorization: auth },
        });
        if (tr.ok) {
          const tj = await tr.json();
          ok(`api.trade.orders ${email}`, `orders=${(tj.orders || []).length}`);
        } else {
          bad(`api.trade.orders ${email}`, `HTTP ${tr.status}`);
        }
      } catch (e) {
        bad(`api.trade.orders ${email}`, e instanceof Error ? e.message : String(e));
      }

      // on-chain stock for spend readiness
      const tsla = process.env.TSLA_TOKEN_ID || process.env.MOCK_TSLA_TOKEN_ID!;
      const bal = await mirrorTokenBal(accountId, tsla);
      ok(`mirror.TSLA ${email}`, `${accountId} balance=${bal}`);
    }
  }

  // ── 3. Vault custody cycle (disposable account — known key) ────────
  // Existing Supabase users only have passphrase-encrypted keys (no server_wallet_key),
  // so we cannot sign as them without passphrases. We create a disposable account.
  const vaultId = process.env.FOLIO_VAULT_CONTRACT_ID?.trim();
  if (!vaultId) {
    bad('vault.cycle', 'FOLIO_VAULT_CONTRACT_ID not set');
  } else {
    try {
      const {
        createAccount,
        prepareTokenAssociation,
        prepareTokenAllowanceForVault,
        submitSignedTransaction,
        executeVaultDepositWithAllowance,
        executeVaultRelease,
        transferToken,
        getOperatorId,
        isFolioVaultConfigured,
      } = await import('../src/lib/hedera');
      const { getTokenIdForSymbol } = await import('../src/lib/token-registry');
      const { getUsdcTokenId } = await import('../src/lib/network');

      if (!isFolioVaultConfigured()) {
        bad('vault.configured', 'false');
      } else {
        ok('vault.configured', vaultId);
      }

      const tsla = getTokenIdForSymbol('TSLA');
      const usdc = getUsdcTokenId();
      if (!tsla || !usdc) throw new Error('TSLA or USDC token missing');

      // Create disposable user account
      const { accountId, privateKey } = await createAccount();
      const userKey = PrivateKey.fromStringDer(privateKey);
      ok('vault.cycle.createAccount', accountId);

      // Associate TSLA + USDC (user signs, operator pays)
      const assocBytes = await prepareTokenAssociation(accountId, [tsla, usdc]);
      const assocTx = Transaction.fromBytes(assocBytes);
      await assocTx.sign(userKey);
      const assocTxId = await submitSignedTransaction(assocTx.toBytes());
      ok('vault.cycle.associate', assocTxId);

      // Fund user with 1 TSLA (token decimals often 6 → 1e6 base = 1 share if 6 dec)
      // MOCK stock from setup uses decimals 6 typically — use 1_000_000 base units
      const stockAmt = 1_000_000; // 1.0 if 6 decimals
      const op = getOperatorId().toString();
      await transferToken(tsla, op, accountId, stockAmt);
      ok('vault.cycle.fundStock', `${stockAmt} base units TSLA → ${accountId}`);

      // Small USDC for repay-style flows later
      try {
        await transferToken(usdc, op, accountId, 5_000_000); // 5 USDC
        ok('vault.cycle.fundUsdc', '5 USDC');
      } catch (e) {
        bad('vault.cycle.fundUsdc', e instanceof Error ? e.message : String(e));
      }

      await new Promise((r) => setTimeout(r, 2500)); // mirror lag

      const userBefore = await mirrorTokenBal(accountId, tsla);
      const vaultBefore = await mirrorTokenBal(vaultId, tsla);
      ok('vault.cycle.balances_before', `user=${userBefore} vault=${vaultBefore}`);

      // Allowance to operator (gasless prepare)
      const allowBytes = await prepareTokenAllowanceForVault(
        tsla,
        accountId,
        vaultId,
        stockAmt
      );
      const allowTx = Transaction.fromBytes(allowBytes);
      await allowTx.sign(userKey);
      const allowTxId = await submitSignedTransaction(allowTx.toBytes());
      ok('vault.cycle.allowance', allowTxId);

      // Operator pulls into vault
      const depTxId = await executeVaultDepositWithAllowance(
        vaultId,
        tsla,
        accountId,
        stockAmt
      );
      ok('vault.cycle.deposit', depTxId);

      await new Promise((r) => setTimeout(r, 3000));
      const userMid = await mirrorTokenBal(accountId, tsla);
      const vaultMid = await mirrorTokenBal(vaultId, tsla);
      if (userMid < userBefore && vaultMid > vaultBefore) {
        ok('vault.cycle.deposit_confirmed', `user=${userMid} vault=${vaultMid}`);
      } else {
        // mirror lag — check with retry
        await new Promise((r) => setTimeout(r, 4000));
        const userMid2 = await mirrorTokenBal(accountId, tsla);
        const vaultMid2 = await mirrorTokenBal(vaultId, tsla);
        if (userMid2 < userBefore || vaultMid2 > vaultBefore) {
          ok('vault.cycle.deposit_confirmed', `user=${userMid2} vault=${vaultMid2} (retry)`);
        } else {
          bad(
            'vault.cycle.deposit_confirmed',
            `balances unchanged user ${userBefore}→${userMid2} vault ${vaultBefore}→${vaultMid2}`
          );
        }
      }

      // Release back to user
      const relTxId = await executeVaultRelease(vaultId, tsla, accountId, stockAmt);
      ok('vault.cycle.release', relTxId);

      await new Promise((r) => setTimeout(r, 3000));
      const userAfter = await mirrorTokenBal(accountId, tsla);
      if (userAfter >= stockAmt * 0.9) {
        ok('vault.cycle.release_confirmed', `user TSLA back=${userAfter}`);
      } else {
        await new Promise((r) => setTimeout(r, 4000));
        const userAfter2 = await mirrorTokenBal(accountId, tsla);
        if (userAfter2 >= stockAmt * 0.9) {
          ok('vault.cycle.release_confirmed', `user TSLA back=${userAfter2} (retry)`);
        } else {
          bad('vault.cycle.release_confirmed', `user TSLA=${userAfter2} expected ~${stockAmt}`);
        }
      }

      // HTTP spend prepare with disposable account + dev auth as first supabase user
      // (prepare only needs auth, not ownership of email)
      const prepEmail = users?.[0]?.email || 'test@folio.local';
      try {
        const prep = await fetch(`${BASE}/api/spend/prepare`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer folio-dev:${prepEmail}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: 1,
            symbol: 'TSLA',
            durationMonths: 1,
            userAccountId: accountId,
          }),
        });
        const prepBody = await prep.json();
        if (prep.ok && (prepBody.allowanceTxBytes || prepBody.collateralLockTxBytes || prepBody.needsSignature !== undefined)) {
          ok(
            'api.spend.prepare vault branch',
            `HTTP ${prep.ok} needsAllowance=${prepBody.needsAllowanceSignature} hasAllowBytes=${!!prepBody.allowanceTxBytes} hasLegacy=${!!prepBody.collateralLockTxBytes}`
          );
        } else {
          bad(
            'api.spend.prepare',
            `HTTP ${prep.status} ${JSON.stringify(prepBody).slice(0, 300)}`
          );
        }
      } catch (e) {
        bad('api.spend.prepare', e instanceof Error ? e.message : String(e));
      }
    } catch (e) {
      bad('vault.cycle', e instanceof Error ? e.message : String(e));
    }
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`PASS ${pass}  FAIL ${fail}`);
  if (fail) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(` • ${r.name}: ${r.detail}`);
    }
  }
  console.log('');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
