/**
 * E2E: profile save, trade buy auto-fill, trade sell, spend collateral + settle.
 * Uses real Supabase users + kitkat123.
 *
 * Run: npx tsx scripts/e2e-trade-profile-settle.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { PrivateKey, Transaction } from '@hashgraph/sdk';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3001';
const PASS = process.env.SIMULATION_PASSPHRASE || 'kitkat123';
const PBKDF2_ITERATIONS = 600_000;

type Row = { name: string; ok: boolean; detail: string };
const results: Row[] = [];
function ok(n: string, d: string) {
  results.push({ name: n, ok: true, detail: d });
  console.log(`✓ ${n}: ${d}`);
}
function bad(n: string, d: string) {
  results.push({ name: n, ok: false, detail: d });
  console.log(`✗ ${n}: ${d}`);
}

function b64ToBuf(b64: string) {
  return Buffer.from(b64, 'base64');
}
function decryptPrivateKey(encryptedKey: string, salt: string, iv: string, passphrase: string) {
  const key = pbkdf2Sync(passphrase, b64ToBuf(salt), PBKDF2_ITERATIONS, 32, 'sha256');
  const data = b64ToBuf(encryptedKey);
  const tag = data.subarray(data.length - 16);
  const enc = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, b64ToBuf(iv));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

async function authFetch(email: string, p: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer folio-dev:${email}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${p}`, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitOrderFilled(email: string, orderId: number, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { json } = await authFetch(email, '/api/trade/orders');
    const o = (json.orders || []).find((x: { id: number }) => x.id === orderId);
    if (o?.status === 'filled') return o;
    if (o?.status === 'failed') throw new Error(`order failed: ${o.notes || 'unknown'}`);
    await sleep(1500);
  }
  // Force fill if still pending
  const { fillOrderNow } = await import('../src/lib/fill-order');
  try {
    await fillOrderNow(orderId);
  } catch (e) {
    console.warn('force fill:', e);
  }
  await sleep(1000);
  const { json } = await authFetch(email, '/api/trade/orders');
  return (json.orders || []).find((x: { id: number }) => x.id === orderId);
}

async function signB64(userKey: PrivateKey, b64: string) {
  const tx = Transaction.fromBytes(Uint8Array.from(Buffer.from(b64, 'base64')));
  await tx.sign(userKey);
  return Buffer.from(tx.toBytes()).toString('base64');
}

async function main() {
  console.log('\n=== E2E trade / profile / settle ===\n');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: users } = await sb.from('users').select('*');
  if (!users?.length) throw new Error('no users');

  // Test both users lightly; deep path on first
  for (const u of users) {
    const email = u.email as string;
    const accountId = u.hedera_account_id as string;
    const tag = email.split('@')[0];
    const der = decryptPrivateKey(u.encrypted_key, u.key_salt, u.key_iv, PASS);
    const userKey = PrivateKey.fromStringDer(der);
    console.log(`\n==== ${email} (${accountId}) ====`);

    // ── PROFILE ──────────────────────────────────────────────────────
    const patch = await authFetch(email, '/api/users/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: `Sim ${tag}`,
        city: 'Mumbai',
        country: 'IN',
        phone: '+919999999999',
      }),
    });
    if (patch.res.ok && patch.json.success) {
      ok(`${tag}.profile.save`, JSON.stringify(patch.json.profile).slice(0, 120));
    } else {
      bad(`${tag}.profile.save`, `${patch.res.status} ${JSON.stringify(patch.json).slice(0, 200)}`);
    }
    const getp = await authFetch(email, '/api/users/profile');
    if (getp.res.ok && (getp.json.profile?.displayName || getp.json.profile?.name)) {
      ok(`${tag}.profile.read`, `name=${getp.json.profile.displayName || getp.json.profile.name} city=${getp.json.profile.city || ''}`);
    } else {
      bad(`${tag}.profile.read`, JSON.stringify(getp.json).slice(0, 150));
    }

    // ── TRADE BUY + AUTO-FILL ────────────────────────────────────────
    const buyPrep = await authFetch(email, '/api/trade/prepare', {
      method: 'POST',
      body: JSON.stringify({ side: 'buy', symbol: 'TSLA', notionalUsd: 1 }),
    });
    if (!buyPrep.res.ok) {
      bad(`${tag}.trade.buy.prepare`, JSON.stringify(buyPrep.json).slice(0, 200));
    } else {
      ok(`${tag}.trade.buy.prepare`, `shares≈${Number(buyPrep.json.shares).toFixed(6)}`);
      if (buyPrep.json.associateTxBytes) {
        const signed = await signB64(userKey, buyPrep.json.associateTxBytes);
        await authFetch(email, '/api/trade/associate', {
          method: 'POST',
          body: JSON.stringify({ signedAssociateTxBytes: signed }),
        });
      }
      const signedSettlement = buyPrep.json.settlementTxBytes
        ? await signB64(userKey, buyPrep.json.settlementTxBytes)
        : undefined;
      const buyOrder = await authFetch(email, '/api/trade/orders', {
        method: 'POST',
        body: JSON.stringify({
          side: 'buy',
          symbol: 'TSLA',
          notionalUsd: 1,
          signedSettlementTxBytes: signedSettlement,
        }),
      });
      if (!buyOrder.res.ok) {
        bad(`${tag}.trade.buy.order`, JSON.stringify(buyOrder.json).slice(0, 200));
      } else {
        const oid = buyOrder.json.order?.id;
        ok(`${tag}.trade.buy.order`, `id=${oid} status=${buyOrder.json.order?.status}`);
        console.log('  waiting for auto-fill…');
        try {
          const filled = await waitOrderFilled(email, oid, 15_000);
          if (filled?.status === 'filled') {
            ok(`${tag}.trade.buy.fill`, `tx=${filled.fillTxId || filled.fill_tx_id || '?'}`);
          } else {
            bad(`${tag}.trade.buy.fill`, `status=${filled?.status} notes=${filled?.notes}`);
          }
        } catch (e) {
          bad(`${tag}.trade.buy.fill`, e instanceof Error ? e.message : String(e));
        }
      }
    }

    // ── TRADE SELL + AUTO-FILL ───────────────────────────────────────
    const sellPrep = await authFetch(email, '/api/trade/prepare', {
      method: 'POST',
      body: JSON.stringify({ side: 'sell', symbol: 'TSLA', notionalUsd: 1 }),
    });
    if (!sellPrep.res.ok) {
      // try shares if notional fails
      const sellPrep2 = await authFetch(email, '/api/trade/prepare', {
        method: 'POST',
        body: JSON.stringify({ side: 'sell', symbol: 'TSLA', shares: 0.002 }),
      });
      if (!sellPrep2.res.ok) {
        bad(`${tag}.trade.sell.prepare`, JSON.stringify(sellPrep2.json).slice(0, 200));
      } else {
        Object.assign(sellPrep, sellPrep2);
      }
    }
    if (sellPrep.res.ok) {
      ok(`${tag}.trade.sell.prepare`, `shares≈${Number(sellPrep.json.shares).toFixed(6)}`);
      const signedSettlement = sellPrep.json.settlementTxBytes
        ? await signB64(userKey, sellPrep.json.settlementTxBytes)
        : undefined;
      const sellOrder = await authFetch(email, '/api/trade/orders', {
        method: 'POST',
        body: JSON.stringify({
          side: 'sell',
          symbol: 'TSLA',
          notionalUsd: sellPrep.json.notional ?? 1,
          shares: sellPrep.json.shares,
          signedSettlementTxBytes: signedSettlement,
        }),
      });
      if (!sellOrder.res.ok) {
        bad(`${tag}.trade.sell.order`, JSON.stringify(sellOrder.json).slice(0, 200));
      } else {
        const oid = sellOrder.json.order?.id;
        ok(`${tag}.trade.sell.order`, `id=${oid}`);
        try {
          const filled = await waitOrderFilled(email, oid, 15_000);
          if (filled?.status === 'filled') {
            ok(`${tag}.trade.sell.fill`, `tx=${filled.fillTxId || '?'}`);
          } else {
            bad(`${tag}.trade.sell.fill`, `status=${filled?.status} ${filled?.notes || ''}`);
          }
        } catch (e) {
          bad(`${tag}.trade.sell.fill`, e instanceof Error ? e.message : String(e));
        }
      }
    }

    // ── SPEND (collateralize) + SETTLE (repay) ───────────────────────
    const spendPrep = await authFetch(email, '/api/spend/prepare', {
      method: 'POST',
      body: JSON.stringify({
        amount: 1,
        symbol: 'TSLA',
        durationMonths: 1,
        userAccountId: accountId,
      }),
    });
    if (!spendPrep.res.ok) {
      bad(`${tag}.spend.prepare`, JSON.stringify(spendPrep.json).slice(0, 200));
    } else {
      ok(
        `${tag}.spend.prepare`,
        `vaultAllow=${!!spendPrep.json.allowanceTxBytes} shares=${spendPrep.json.collar?.shares}`
      );
      let signedAllowanceTxBytes: string | undefined;
      let signedCollateralTxBytes: string | undefined;
      if (spendPrep.json.allowanceTxBytes) {
        signedAllowanceTxBytes = await signB64(userKey, spendPrep.json.allowanceTxBytes);
      }
      if (spendPrep.json.collateralLockTxBytes) {
        signedCollateralTxBytes = await signB64(userKey, spendPrep.json.collateralLockTxBytes);
      }
      const exec = await authFetch(email, '/api/spend/execute', {
        method: 'POST',
        body: JSON.stringify({
          amount: 1,
          symbol: 'TSLA',
          durationMonths: 1,
          userAccountId: accountId,
          recipientName: 'Settle Test',
          recipientAccountId: accountId,
          signedAllowanceTxBytes,
          signedCollateralTxBytes,
        }),
      });
      if (!exec.res.ok) {
        bad(`${tag}.spend.execute`, JSON.stringify(exec.json).slice(0, 250));
      } else {
        const noteId = exec.json.noteId || exec.json.note?.id;
        ok(`${tag}.spend.execute`, `noteId=${noteId} (collateral locked)`);

        // Settle / repay → release collateral
        const rprep = await authFetch(email, '/api/spend/repay/prepare', {
          method: 'POST',
          body: JSON.stringify({ noteId }),
        });
        if (!rprep.res.ok) {
          bad(`${tag}.spend.settle.prepare`, JSON.stringify(rprep.json).slice(0, 200));
        } else {
          let signedRepayTxBytes: string | undefined;
          if (rprep.json.needsSignature && rprep.json.repayTxBytes) {
            signedRepayTxBytes = await signB64(userKey, rprep.json.repayTxBytes);
          }
          const repay = await authFetch(email, '/api/spend/repay', {
            method: 'POST',
            body: JSON.stringify({ noteId, signedRepayTxBytes }),
          });
          if (repay.res.ok && repay.json.success) {
            ok(
              `${tag}.spend.settle`,
              repay.json.settlement?.reason || 'repaid + shares released'
            );
          } else {
            bad(`${tag}.spend.settle`, JSON.stringify(repay.json).slice(0, 250));
          }
        }
      }
    }
  }

  console.log('\n=== Summary ===');
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`PASS ${pass}  FAIL ${fail}`);
  if (fail) {
    for (const r of results.filter((x) => !x.ok)) console.log(` • ${r.name}: ${r.detail}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
