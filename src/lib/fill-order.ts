// Shared order fill + auto-confirm pipeline
//
// Strict atomic order (never reverse these):
//   BUY:  1) take USDC user→treasury (submit + balance proof)
//         2) only then mint/transfer stock → user
//   SELL: 1) take stock user→treasury (submit + balance proof)
//         2) only then pay USDC treasury→user
//
// Never mark filled if the first leg fails. Never deliver the second leg
// without on-chain proof of the first. Admin fill uses this same path.

import { getOrder, markOrderFilled, markOrderStatus } from './broker-orders';
import { ensureEquityToken, getTokenIdForSymbol } from './token-registry';
import { getUsdcTokenId } from './network';
import { getUser } from './user-registry';
import { decryptServerWalletKey } from './server-wallet-crypto';

const HTS_DECIMALS = 6;
const BALANCE_POLL_ATTEMPTS = 6;
const BALANCE_POLL_BASE_MS = 350;

async function getUserPrivateKeyDer(userEmail: string): Promise<string | null> {
  try {
    const user = await getUser(userEmail);
    if (!user?.serverWalletKey || !user.publicKey) return null;
    const der = decryptServerWalletKey(user.serverWalletKey);
    // Refuse wrong key (was causing INVALID_SIGNATURE + free stock mint)
    const { PrivateKey } = await import('@hashgraph/sdk');
    const pk = PrivateKey.fromStringDer(der);
    if (pk.publicKey.toStringDer() !== user.publicKey) {
      console.warn(
        `[fill] server_wallet_key for ${userEmail} does not match public_key — ignore`
      );
      return null;
    }
    return der;
  } catch (e) {
    console.warn(
      '[fill] cannot decrypt server wallet key:',
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

export function encodeSettlementNote(signedTxBase64: string): string {
  return `SETTLEMENT_TX:${signedTxBase64}`;
}

export function decodeSettlementNote(notes?: string): string | null {
  if (!notes?.startsWith('SETTLEMENT_TX:')) return null;
  const rest = notes.slice('SETTLEMENT_TX:'.length);
  // Notes may have trailing status text after a newline
  const cut = rest.indexOf('\n');
  return cut >= 0 ? rest.slice(0, cut) : rest;
}

/** True only for duplicate/replay — not generic prose containing “already”. */
function isBenignReplayError(msg: string): boolean {
  return (
    /DUPLICATE_TRANSACTION/i.test(msg) ||
    /\bDUPLICATE\b/i.test(msg) ||
    /already.?executed/i.test(msg)
  );
}

/**
 * Validate the signed settlement transfer before submit:
 * - correct token id
 * - user debited, treasury credited, same absolute amount
 * - amount must be >= order expected (no underpay)
 * Returns the absolute amount locked in the signed tx (for balance proofs).
 */
async function assertSettlementTransfer(
  settlementB64: string,
  opts: {
    tokenId: string;
    userAccountId: string;
    operatorId: string;
    expectedAmount: number;
    label: string;
  }
): Promise<number> {
  const { Transaction } = await import('@hashgraph/sdk');
  const bytes = Uint8Array.from(Buffer.from(settlementB64, 'base64'));
  const tx = Transaction.fromBytes(bytes) as {
    _tokenTransfers?: Array<{
      tokenId: { toString(): string };
      accountId: { toString(): string };
      amount: { toString(): string } | number;
    }>;
    tokenTransfers?: {
      _map?: Map<string, Map<string, { toString(): string } | number>>;
    };
  };

  const amounts: Record<string, number> = {};

  // Prefer internal list (stable across SDK versions)
  if (tx._tokenTransfers?.length) {
    for (const row of tx._tokenTransfers) {
      if (row.tokenId.toString() !== opts.tokenId) continue;
      const acct = row.accountId.toString();
      const amt =
        typeof row.amount === 'number'
          ? row.amount
          : Number(row.amount.toString());
      amounts[acct] = (amounts[acct] ?? 0) + amt;
    }
  } else if (tx.tokenTransfers?._map) {
    const tokenMap = tx.tokenTransfers._map.get(opts.tokenId);
    if (tokenMap) {
      for (const [acct, raw] of tokenMap.entries()) {
        const amt =
          typeof raw === 'number' ? raw : Number(String(raw));
        amounts[String(acct)] = amt;
      }
    }
  }

  if (Object.keys(amounts).length === 0) {
    throw new Error(
      `${opts.label}: signed settlement is not a token transfer of ${opts.tokenId}`
    );
  }

  const userAmt = amounts[opts.userAccountId] ?? 0;
  const opAmt = amounts[opts.operatorId] ?? 0;

  if (userAmt >= 0) {
    throw new Error(
      `${opts.label}: settlement must debit user ${opts.userAccountId}, got ${userAmt}`
    );
  }
  if (opAmt <= 0) {
    throw new Error(
      `${opts.label}: settlement must credit treasury ${opts.operatorId}, got ${opAmt}`
    );
  }
  if (userAmt + opAmt !== 0) {
    throw new Error(
      `${opts.label}: settlement transfer not balanced (user ${userAmt}, treasury ${opAmt})`
    );
  }

  const signedAmount = opAmt;
  // Allow exact match or +1 unit rounding; never underpay vs order
  if (signedAmount + 1 < opts.expectedAmount) {
    throw new Error(
      `${opts.label}: settlement amount ${signedAmount} < order ${opts.expectedAmount}`
    );
  }
  // Cap runaway overpay (>1% and >100 units) — likely wrong tx
  if (
    signedAmount > opts.expectedAmount * 1.01 + 100 &&
    signedAmount > opts.expectedAmount + 100
  ) {
    throw new Error(
      `${opts.label}: settlement amount ${signedAmount} far exceeds order ${opts.expectedAmount}`
    );
  }

  return signedAmount;
}

async function submitSettlementOrThrow(
  settlementB64: string,
  label: string
): Promise<string> {
  const { submitSignedTransaction } = await import('./hedera');
  const bytes = Uint8Array.from(Buffer.from(settlementB64, 'base64'));
  try {
    return await submitSignedTransaction(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isBenignReplayError(msg)) {
      // Caller MUST still prove balances moved — do not treat as success alone
      console.warn(`[fill] ${label} settlement may already be done:`, msg);
      return 'settlement-replay';
    }
    // Never continue to mint/pay if settlement failed
    throw new Error(
      `${label} settlement failed (second leg not run): ${msg}`
    );
  }
}

type BalanceFn = (accountId: string) => Promise<Map<string, number>>;

/**
 * Poll until `user` loses ~expected and/or `counterparty` gains ~expected.
 * Returns true only with on-chain evidence of the first leg.
 */
async function waitForTokenMove(
  getTokenBalances: BalanceFn,
  opts: {
    tokenId: string;
    userAccountId: string;
    counterpartyId: string;
    expectedAmount: number;
    userBefore: number;
    counterpartyBefore: number;
  }
): Promise<boolean> {
  const need = opts.expectedAmount;
  for (let i = 0; i < BALANCE_POLL_ATTEMPTS; i++) {
    const userAfter =
      (await getTokenBalances(opts.userAccountId)).get(opts.tokenId) ?? 0;
    const cpAfter =
      (await getTokenBalances(opts.counterpartyId)).get(opts.tokenId) ?? 0;
    const userDrop = opts.userBefore - userAfter;
    const cpGain = cpAfter - opts.counterpartyBefore;
    // Tolerance 1 unit for rounding; either side is enough proof
    if (userDrop + 1 >= need || cpGain + 1 >= need) {
      return true;
    }
    await new Promise((r) => setTimeout(r, BALANCE_POLL_BASE_MS * (i + 1)));
  }
  return false;
}

async function prepareUserForStockReceive(
  accountId: string,
  stockTokenId: string,
  userEmail: string,
  helpers: {
    clearTokenKycAndFreeze: (tokenId: string) => Promise<unknown>;
    ensureUserTokenReady: (
      accountId: string,
      tokenId: string,
      userPrivateKeyDer: string
    ) => Promise<void>;
    grantKyc: (tokenId: string, accountId: string) => Promise<unknown>;
    unfreezeAccount: (tokenId: string, accountId: string) => Promise<unknown>;
  }
): Promise<void> {
  try {
    await helpers.clearTokenKycAndFreeze(stockTokenId);
  } catch (e) {
    console.warn('[fill] clearTokenKycAndFreeze:', e instanceof Error ? e.message : e);
  }

  const userKeyDer = await getUserPrivateKeyDer(userEmail);
  if (userKeyDer) {
    try {
      await helpers.ensureUserTokenReady(accountId, stockTokenId, userKeyDer);
    } catch (e) {
      console.warn(
        '[fill] ensureUserTokenReady:',
        e instanceof Error ? e.message : e
      );
    }
  } else {
    try {
      await helpers.grantKyc(stockTokenId, accountId);
    } catch {
      /* */
    }
    try {
      await helpers.unfreezeAccount(stockTokenId, accountId);
    } catch {
      /* */
    }
  }
}

export async function fillOrderOnChain(orderId: number): Promise<{ fillTxId: string }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error('Order not found');
  if (order.status === 'filled') return { fillTxId: order.fillTxId || 'already-filled' };
  if (order.status !== 'pending' && order.status !== 'processing') {
    throw new Error(`Order is ${order.status}`);
  }

  await markOrderStatus(orderId, 'processing').catch(() => undefined);

  const hederaConfigured = !!(
    process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY
  );

  // Never mark filled off-chain when Hedera is expected
  if (!hederaConfigured) {
    throw new Error(
      'Hedera operator not configured — cannot settle trade on-chain'
    );
  }

  const {
    mintFungibleToken,
    burnFungibleToken,
    transferToken,
    getOperatorId,
    grantKyc,
    unfreezeAccount,
    getTokenBalances,
    clearTokenKycAndFreeze,
    ensureUserTokenReady,
  } = await import('./hedera');

  const operatorId = getOperatorId().toString();
  const amountHts = Math.max(1, Math.floor(order.shares * 10 ** HTS_DECIMALS));
  const usdcId = getUsdcTokenId();
  const proceeds = order.notionalUsd ?? order.shares * (order.limitPrice ?? 0);
  const usdcHts = Math.max(1, Math.round(proceeds * 10 ** HTS_DECIMALS));
  const settlementB64 = decodeSettlementNote(order.notes);

  if (!settlementB64) {
    throw new Error(
      order.side === 'buy'
        ? 'Missing signed USDC payment for buy order'
        : 'Missing signed stock transfer for sell order'
    );
  }

  let fillTxId: string;

  if (order.side === 'buy') {
    // ═══════════════════════════════════════════════════════════
    // BUY: USDC first → stock second. Never reverse.
    // ═══════════════════════════════════════════════════════════
    if (!usdcId) throw new Error('USDC not configured');

    // Validate signed tx before broadcast; use signed amount for balance proof
    const usdcSettleAmt = await assertSettlementTransfer(settlementB64, {
      tokenId: usdcId,
      userAccountId: order.userAccountId,
      operatorId,
      expectedAmount: usdcHts,
      label: 'Buy USDC',
    });

    const usdcBeforeUser =
      (await getTokenBalances(order.userAccountId)).get(usdcId) ?? 0;
    const usdcBeforeOp = (await getTokenBalances(operatorId)).get(usdcId) ?? 0;

    if (usdcBeforeUser + 1 < usdcSettleAmt) {
      throw new Error(
        `Buy aborted: user has ${usdcBeforeUser} USDC units, need ${usdcSettleAmt}. Stock not minted.`
      );
    }

    // --- LEG 1: take USDC ---
    const settleTxId = await submitSettlementOrThrow(settlementB64, 'Buy USDC');

    const paid = await waitForTokenMove(getTokenBalances, {
      tokenId: usdcId,
      userAccountId: order.userAccountId,
      counterpartyId: operatorId,
      expectedAmount: usdcSettleAmt,
      userBefore: usdcBeforeUser,
      counterpartyBefore: usdcBeforeOp,
    });
    if (!paid) {
      throw new Error(
        `Buy aborted: USDC payment not confirmed on-chain (need ${usdcSettleAmt} units, settle=${settleTxId}). Stock not minted.`
      );
    }

    // --- LEG 2: deliver stock only after USDC proven ---
    const equity = await ensureEquityToken(order.symbol);
    const stockTokenId = equity.tokenId;

    await prepareUserForStockReceive(order.userAccountId, stockTokenId, order.userEmail, {
      clearTokenKycAndFreeze,
      ensureUserTokenReady,
      grantKyc,
      unfreezeAccount,
    });

    await mintFungibleToken(stockTokenId, amountHts);
    fillTxId = await transferToken(
      stockTokenId,
      operatorId,
      order.userAccountId,
      amountHts
    );

    // Soft verify stock landed (do not un-fill USDC; log if lag)
    const stockAfter =
      (await getTokenBalances(order.userAccountId)).get(stockTokenId) ?? 0;
    if (stockAfter + 1 < amountHts) {
      console.warn(
        `[fill] buy ${orderId}: stock transfer ${fillTxId} may lag mirror; user bal=${stockAfter} need=${amountHts}`
      );
    }
  } else {
    // ═══════════════════════════════════════════════════════════
    // SELL: stock first → USDC second. Never reverse.
    // ═══════════════════════════════════════════════════════════
    if (!usdcId) throw new Error('USDC not configured');
    if (!proceeds || proceeds <= 0) throw new Error('Cannot compute sell proceeds');

    const stockTokenId =
      getTokenIdForSymbol(order.symbol) ||
      (await ensureEquityToken(order.symbol)).tokenId;

    const stockSettleAmt = await assertSettlementTransfer(settlementB64, {
      tokenId: stockTokenId,
      userAccountId: order.userAccountId,
      operatorId,
      expectedAmount: amountHts,
      label: 'Sell stock',
    });

    const stockBeforeUser =
      (await getTokenBalances(order.userAccountId)).get(stockTokenId) ?? 0;
    const stockBeforeOp =
      (await getTokenBalances(operatorId)).get(stockTokenId) ?? 0;

    if (stockBeforeUser + 1 < stockSettleAmt) {
      throw new Error(
        `Sell aborted: user has ${stockBeforeUser} ${order.symbol} units, need ${stockSettleAmt}. USDC not paid.`
      );
    }

    // --- LEG 1: take stock ---
    const settleTxId = await submitSettlementOrThrow(settlementB64, 'Sell stock');

    const stockReceived = await waitForTokenMove(getTokenBalances, {
      tokenId: stockTokenId,
      userAccountId: order.userAccountId,
      counterpartyId: operatorId,
      expectedAmount: stockSettleAmt,
      userBefore: stockBeforeUser,
      counterpartyBefore: stockBeforeOp,
    });
    if (!stockReceived) {
      throw new Error(
        `Sell aborted: stock not received by treasury (need ${stockSettleAmt} units, settle=${settleTxId}). USDC not paid.`
      );
    }

    // Burn treasury inventory after receipt (operator is not a stock desk)
    try {
      const treasuryBal =
        (await getTokenBalances(operatorId)).get(stockTokenId) ?? 0;
      const burnAmt = Math.min(stockSettleAmt, treasuryBal);
      if (burnAmt > 0) await burnFungibleToken(stockTokenId, burnAmt);
    } catch (e) {
      console.warn('[fill] sell burn:', e instanceof Error ? e.message : e);
    }

    // --- LEG 2: pay USDC only after stock proven ---
    const opUsdc = (await getTokenBalances(operatorId)).get(usdcId) ?? 0;
    if (opUsdc + 1 < usdcHts) {
      throw new Error(
        `Sell aborted after stock received: treasury USDC ${opUsdc} < ${usdcHts}. Manual payout required.`
      );
    }

    const usdcBeforeUser =
      (await getTokenBalances(order.userAccountId)).get(usdcId) ?? 0;
    fillTxId = await transferToken(usdcId, operatorId, order.userAccountId, usdcHts);

    const usdcPaid = await waitForTokenMove(getTokenBalances, {
      tokenId: usdcId,
      userAccountId: operatorId, // operator loses USDC
      counterpartyId: order.userAccountId,
      expectedAmount: usdcHts,
      userBefore: opUsdc,
      counterpartyBefore: usdcBeforeUser,
    });
    if (!usdcPaid) {
      // Stock already taken — surface hard error so order fails (not filled)
      throw new Error(
        `Sell USDC payout not confirmed after stock settlement (expected +${usdcHts}, tx=${fillTxId}). Manual reconcile required.`
      );
    }
  }

  const keepNote = order.notes?.startsWith('SETTLEMENT_TX:')
    ? order.notes
    : order.notes;
  await markOrderFilled(orderId, fillTxId, keepNote || 'auto-confirmed');
  console.log(
    `[fill] order ${orderId} ${order.side} ${order.symbol} → filled ${fillTxId} (leg1 then leg2)`
  );
  return { fillTxId };
}

export function scheduleAutoConfirm(orderId: number): void {
  setTimeout(() => {
    markOrderStatus(orderId, 'processing', undefined).catch((e) =>
      console.error('[auto-confirm] processing', orderId, e)
    );
  }, 1_000);

  setTimeout(() => {
    fillOrderOnChain(orderId).catch(async (e) => {
      console.error('[auto-confirm] fill', orderId, e);
      try {
        await markOrderStatus(
          orderId,
          'failed',
          e instanceof Error ? e.message : String(e)
        );
      } catch {
        /* */
      }
    });
  }, 4_000);
}

export async function fillOrderNow(orderId: number): Promise<{ fillTxId: string }> {
  return fillOrderOnChain(orderId);
}
