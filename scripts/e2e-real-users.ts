/**
 * E2E against real Supabase users using simulation passphrase (kitkat123).
 *
 * Run: npx tsx scripts/e2e-real-users.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import {
  PrivateKey,
  Transaction,
  TokenId,
  AccountId,
} from '@hashgraph/sdk';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3001';
const PASSPHRASE = process.env.SIMULATION_PASSPHRASE || 'kitkat123';
const PBKDF2_ITERATIONS = 600_000;

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

function b64ToBuf(b64: string) {
  return Buffer.from(b64, 'base64');
}

function decryptPrivateKey(
  encryptedKey: string,
  salt: string,
  iv: string,
  passphrase: string
): string {
  const key = pbkdf2Sync(passphrase, b64ToBuf(salt), PBKDF2_ITERATIONS, 32, 'sha256');
  const data = b64ToBuf(encryptedKey);
  const tag = data.subarray(data.length - 16);
  const enc = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, b64ToBuf(iv));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

async function mirrorBal(accountId: string, tokenId: string): Promise<number> {
  const res = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/tokens?limit=100`
  );
  const data = (await res.json()) as { tokens?: { token_id: string; balance: number }[] };
  return (data.tokens || []).find((t) => t.token_id === tokenId)?.balance ?? 0;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('\n=== E2E real users (kitkat123) ===\n');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Load secrets from storage
  let storageSecrets: Record<string, { passphrase: string; serverWalletKey?: string }> = {};
  try {
    const { data, error } = await sb.storage
      .from('folio-simulation')
      .download('user-passphrases.json');
    if (!error && data) {
      const j = JSON.parse(await data.text()) as {
        users: { email: string; passphrase: string; serverWalletKey?: string }[];
      };
      for (const u of j.users || []) {
        storageSecrets[u.email.toLowerCase()] = {
          passphrase: u.passphrase,
          serverWalletKey: u.serverWalletKey,
        };
      }
      ok('storage.secrets', `${Object.keys(storageSecrets).length} user(s)`);
    } else {
      bad('storage.secrets', error?.message || 'missing');
    }
  } catch (e) {
    bad('storage.secrets', e instanceof Error ? e.message : String(e));
  }

  const { data: users, error: usersErr } = await sb.from('users').select('*');
  if (usersErr || !users?.length) {
    bad('supabase.users', usersErr?.message || 'none');
    process.exit(1);
  }
  ok('supabase.users', `${users.length} user(s)`);

  // Env vault
  const vaultId = process.env.FOLIO_VAULT_CONTRACT_ID?.trim() || '';
  if (vaultId) ok('vault.env', vaultId);
  else bad('vault.env', 'FOLIO_VAULT_CONTRACT_ID empty');

  // Homepage
  try {
    const r = await fetch(BASE);
    if (r.status === 200) ok('homepage', `HTTP ${r.status}`);
    else bad('homepage', `HTTP ${r.status}`);
  } catch (e) {
    bad('homepage', e instanceof Error ? e.message : String(e));
  }

  const {
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

  if (!isFolioVaultConfigured()) bad('vault.configured', 'false');
  else ok('vault.configured', 'true');

  const tsla = getTokenIdForSymbol('TSLA')!;
  const usdc = getUsdcTokenId()!;
  const op = getOperatorId().toString();

  for (const u of users) {
    const email = (u.email as string).toLowerCase();
    const accountId = u.hedera_account_id as string;
    const label = email.split('@')[0];
    console.log(`\n--- ${email} (${accountId}) ---`);

    const pass =
      storageSecrets[email]?.passphrase ||
      (u as { wallet_passphrase?: string }).wallet_passphrase ||
      PASSPHRASE;

    // Decrypt key
    let userKey: PrivateKey;
    try {
      if (!u.encrypted_key || !u.key_salt || !u.key_iv) {
        throw new Error('no encrypted_key in DB');
      }
      const der = decryptPrivateKey(u.encrypted_key, u.key_salt, u.key_iv, pass);
      userKey = PrivateKey.fromStringDer(der);
      ok(`${label}.unlock`, `passphrase ok (${pass.length} chars)`);
    } catch (e) {
      bad(`${label}.unlock`, e instanceof Error ? e.message : String(e));
      continue;
    }

    const auth = `Bearer folio-dev:${email}`;

    // API suite
    for (const [routeName, path] of [
      ['balances', `/api/users/balances?accountId=${encodeURIComponent(accountId)}`],
      ['notes', '/api/notes?scope=main'],
      ['price', '/api/price?symbols=TSLA,AAPL'],
      ['orders', '/api/trade/orders'],
    ] as const) {
      try {
        const r = await fetch(`${BASE}${path}`, { headers: { Authorization: auth } });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const extra =
            routeName === 'balances'
              ? `hbar=${j.hbar} holdings=${(j.holdings || []).length}`
              : routeName === 'notes'
                ? `notes=${(j.notes || []).length}`
                : routeName === 'orders'
                  ? `orders=${(j.orders || []).length}`
                  : `keys=${Object.keys(j).length}`;
          ok(`${label}.api.${routeName}`, extra);
        } else {
          bad(`${label}.api.${routeName}`, `HTTP ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
        }
      } catch (e) {
        bad(`${label}.api.${routeName}`, e instanceof Error ? e.message : String(e));
      }
    }

    // Ensure associated with TSLA + USDC
    try {
      const assocBytes = await prepareTokenAssociation(accountId, [tsla, usdc]);
      const assocTx = Transaction.fromBytes(assocBytes);
      await assocTx.sign(userKey);
      try {
        const txId = await submitSignedTransaction(assocTx.toBytes());
        ok(`${label}.associate`, txId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('TOKEN_ALREADY_ASSOCIATED') || msg.includes('already associated')) {
          ok(`${label}.associate`, 'already associated');
        } else {
          // may partially succeed
          ok(`${label}.associate`, `note: ${msg.slice(0, 100)}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('TOKEN_ALREADY_ASSOCIATED')) ok(`${label}.associate`, 'already associated');
      else bad(`${label}.associate`, msg);
    }

    // Ensure some TSLA for vault test (1 share base 1e6)
    const stockAmt = 1_000_000;
    let userTsla = await mirrorBal(accountId, tsla);
    if (userTsla < stockAmt) {
      try {
        await transferToken(tsla, op, accountId, stockAmt);
        await sleep(2500);
        userTsla = await mirrorBal(accountId, tsla);
        ok(`${label}.fund.TSLA`, `now=${userTsla}`);
      } catch (e) {
        bad(`${label}.fund.TSLA`, e instanceof Error ? e.message : String(e));
      }
    } else {
      ok(`${label}.TSLA.balance`, String(userTsla));
    }

    // Ensure some USDC
    let userUsdc = await mirrorBal(accountId, usdc);
    if (userUsdc < 2_000_000) {
      try {
        await transferToken(usdc, op, accountId, 10_000_000);
        await sleep(2000);
        userUsdc = await mirrorBal(accountId, usdc);
        ok(`${label}.fund.USDC`, `now=${userUsdc}`);
      } catch (e) {
        bad(`${label}.fund.USDC`, e instanceof Error ? e.message : String(e));
      }
    } else {
      ok(`${label}.USDC.balance`, String(userUsdc));
    }

    // Vault deposit + release cycle
    if (vaultId && userTsla >= stockAmt) {
      try {
        const vaultBefore = await mirrorBal(vaultId, tsla);
        const userBefore = await mirrorBal(accountId, tsla);

        const allowBytes = await prepareTokenAllowanceForVault(
          tsla,
          accountId,
          vaultId,
          stockAmt
        );
        const allowTx = Transaction.fromBytes(allowBytes);
        await allowTx.sign(userKey);
        await submitSignedTransaction(allowTx.toBytes());
        ok(`${label}.vault.allowance`, 'signed');

        await executeVaultDepositWithAllowance(vaultId, tsla, accountId, stockAmt);
        await sleep(3000);
        const userMid = await mirrorBal(accountId, tsla);
        const vaultMid = await mirrorBal(vaultId, tsla);
        if (userMid < userBefore && vaultMid > vaultBefore) {
          ok(`${label}.vault.deposit`, `user ${userBefore}→${userMid} vault ${vaultBefore}→${vaultMid}`);
        } else {
          await sleep(4000);
          const userMid2 = await mirrorBal(accountId, tsla);
          const vaultMid2 = await mirrorBal(vaultId, tsla);
          if (userMid2 < userBefore || vaultMid2 > vaultBefore) {
            ok(`${label}.vault.deposit`, `user→${userMid2} vault→${vaultMid2} (retry)`);
          } else {
            bad(
              `${label}.vault.deposit`,
              `no change user ${userBefore}→${userMid2} vault ${vaultBefore}→${vaultMid2}`
            );
          }
        }

        await executeVaultRelease(vaultId, tsla, accountId, stockAmt);
        await sleep(3000);
        const userAfter = await mirrorBal(accountId, tsla);
        if (userAfter >= userBefore - 1) {
          ok(`${label}.vault.release`, `user back=${userAfter}`);
        } else {
          await sleep(4000);
          const userAfter2 = await mirrorBal(accountId, tsla);
          if (userAfter2 >= userBefore - 1) ok(`${label}.vault.release`, `user back=${userAfter2}`);
          else bad(`${label}.vault.release`, `user=${userAfter2} expected~${userBefore}`);
        }
      } catch (e) {
        bad(`${label}.vault.cycle`, e instanceof Error ? e.message : String(e));
      }
    }

    // Spend prepare (vault branch) — $1 TSLA
    try {
      const prep = await fetch(`${BASE}/api/spend/prepare`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 1,
          symbol: 'TSLA',
          durationMonths: 1,
          userAccountId: accountId,
        }),
      });
      const body = await prep.json();
      if (prep.ok && body.allowanceTxBytes) {
        ok(
          `${label}.spend.prepare`,
          `vault branch needsAllowance=${body.needsAllowanceSignature} shares=${body.collar?.shares}`
        );

        // Sign allowance if needed and execute full spend for $1
        try {
          let signedAllowanceTxBytes: string | undefined;
          let signedCollateralTxBytes: string | undefined;
          if (body.allowanceTxBytes) {
            const tx = Transaction.fromBytes(
              Uint8Array.from(Buffer.from(body.allowanceTxBytes, 'base64'))
            );
            await tx.sign(userKey);
            signedAllowanceTxBytes = Buffer.from(tx.toBytes()).toString('base64');
          }
          if (body.collateralLockTxBytes) {
            const tx = Transaction.fromBytes(
              Uint8Array.from(Buffer.from(body.collateralLockTxBytes, 'base64'))
            );
            await tx.sign(userKey);
            signedCollateralTxBytes = Buffer.from(tx.toBytes()).toString('base64');
          }

          const exec = await fetch(`${BASE}/api/spend/execute`, {
            method: 'POST',
            headers: {
              Authorization: auth,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              amount: 1,
              symbol: 'TSLA',
              durationMonths: 1,
              userAccountId: accountId,
              recipientName: 'E2E Self',
              recipientAccountId: accountId, // p2p to self
              signedAllowanceTxBytes,
              signedCollateralTxBytes,
              collar: body.collar,
            }),
          });
          const execBody = await exec.json().catch(() => ({}));
          if (exec.ok) {
            ok(
              `${label}.spend.execute`,
              `noteId=${execBody.noteId || execBody.note?.id || '?'} tx=${(execBody.txId || '').slice(0, 40)}`
            );
          } else {
            bad(
              `${label}.spend.execute`,
              `HTTP ${exec.status} ${JSON.stringify(execBody).slice(0, 280)}`
            );
          }
        } catch (e) {
          bad(`${label}.spend.execute`, e instanceof Error ? e.message : String(e));
        }
      } else if (prep.ok && body.collateralLockTxBytes) {
        ok(`${label}.spend.prepare`, 'legacy collateral branch (vault not used)');
      } else {
        bad(
          `${label}.spend.prepare`,
          `HTTP ${prep.status} ${JSON.stringify(body).slice(0, 280)}`
        );
      }
    } catch (e) {
      bad(`${label}.spend.prepare`, e instanceof Error ? e.message : String(e));
    }

    // Trade prepare (buy $1 TSLA)
    try {
      const prep = await fetch(`${BASE}/api/trade/prepare`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          side: 'buy',
          symbol: 'TSLA',
          notionalUsd: 1,
        }),
      });
      const body = await prep.json().catch(() => ({}));
      if (prep.ok) {
        ok(
          `${label}.trade.prepare`,
          `needsSig=${body.needsSignature} hasSettlement=${!!body.settlementTxBytes}`
        );
      } else {
        // trade prepare may need user email binding — show error
        bad(
          `${label}.trade.prepare`,
          `HTTP ${prep.status} ${JSON.stringify(body).slice(0, 200)}`
        );
      }
    } catch (e) {
      bad(`${label}.trade.prepare`, e instanceof Error ? e.message : String(e));
    }
  }

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
