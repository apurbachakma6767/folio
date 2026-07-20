// Shared order fill + auto-confirm pipeline
//
// BUY:  1) settle USDC user→treasury (must succeed + balance check)
//       2) mint stock → user
// SELL: 1) settle stock user→treasury (must succeed + balance check)
//       2) pay USDC treasury→user

import { getOrder, markOrderFilled, markOrderStatus } from './broker-orders';
import { ensureEquityToken, getTokenIdForSymbol } from './token-registry';
import { getUsdcTokenId } from './network';
import { getUser } from './user-registry';
import { decryptServerWalletKey } from './server-wallet-crypto';

const HTS_DECIMALS = 6;

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
      console.warn(`[fill] ${label} settlement may already be done:`, msg);
      return 'settlement-replay';
    }
    // Never continue to mint/pay if settlement failed
    throw new Error(
      `${label} settlement failed (no assets moved on fill): ${msg}`
    );
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
  let fillTxId = `auto-fill-${Date.now()}`;

  if (hederaConfigured) {
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

    if (order.side === 'buy') {
      if (!usdcId) throw new Error('USDC not configured');
      if (!settlementB64) throw new Error('Missing signed USDC payment for buy order');

      // --- 1) Take USDC first; verify treasury received it ---
      const usdcBeforeUser = (await getTokenBalances(order.userAccountId)).get(usdcId) ?? 0;
      const usdcBeforeOp = (await getTokenBalances(operatorId)).get(usdcId) ?? 0;

      await submitSettlementOrThrow(settlementB64, 'Buy USDC');

      // Mirror can lag; use consensus AccountBalanceQuery via getTokenBalances (mirror-first)
      // Allow a short settle window
      let paid = false;
      for (let i = 0; i < 4; i++) {
        const usdcAfterUser = (await getTokenBalances(order.userAccountId)).get(usdcId) ?? 0;
        const usdcAfterOp = (await getTokenBalances(operatorId)).get(usdcId) ?? 0;
        const userDrop = usdcBeforeUser - usdcAfterUser;
        const opGain = usdcAfterOp - usdcBeforeOp;
        // Accept if user lost ~usdcHts or operator gained ~usdcHts (tolerance 1 unit)
        if (userDrop + 1 >= usdcHts || opGain + 1 >= usdcHts) {
          paid = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
      if (!paid) {
        throw new Error(
          `Buy aborted: USDC payment not confirmed on-chain (need ${usdcHts} units). Stock not minted.`
        );
      }

      // --- 2) Deliver stock only after payment confirmed ---
      const equity = await ensureEquityToken(order.symbol);
      const stockTokenId = equity.tokenId;

      try {
        await clearTokenKycAndFreeze(stockTokenId);
      } catch (e) {
        console.warn('[fill] clearTokenKycAndFreeze:', e instanceof Error ? e.message : e);
      }

      const userKeyDer = await getUserPrivateKeyDer(order.userEmail);
      if (userKeyDer) {
        try {
          await ensureUserTokenReady(order.userAccountId, stockTokenId, userKeyDer);
        } catch (e) {
          console.warn(
            '[fill] ensureUserTokenReady (auto-assoc may still work):',
            e instanceof Error ? e.message : e
          );
        }
      } else {
        try {
          await grantKyc(stockTokenId, order.userAccountId);
        } catch { /* */ }
        try {
          await unfreezeAccount(stockTokenId, order.userAccountId);
        } catch { /* */ }
      }

      await mintFungibleToken(stockTokenId, amountHts);
      fillTxId = await transferToken(
        stockTokenId,
        operatorId,
        order.userAccountId,
        amountHts
      );
    } else {
      // --- SELL ---
      if (!settlementB64) throw new Error('Missing signed stock transfer for sell order');
      if (!usdcId) throw new Error('USDC not configured');
      if (!proceeds || proceeds <= 0) throw new Error('Cannot compute sell proceeds');

      const stockTokenId =
        getTokenIdForSymbol(order.symbol) ||
        (await ensureEquityToken(order.symbol)).tokenId;

      const stockBeforeUser =
        (await getTokenBalances(order.userAccountId)).get(stockTokenId) ?? 0;
      const stockBeforeOp = (await getTokenBalances(operatorId)).get(stockTokenId) ?? 0;

      await submitSettlementOrThrow(settlementB64, 'Sell stock');

      let stockReceived = false;
      for (let i = 0; i < 4; i++) {
        const stockAfterUser =
          (await getTokenBalances(order.userAccountId)).get(stockTokenId) ?? 0;
        const stockAfterOp = (await getTokenBalances(operatorId)).get(stockTokenId) ?? 0;
        const userDrop = stockBeforeUser - stockAfterUser;
        const opGain = stockAfterOp - stockBeforeOp;
        if (userDrop + 1 >= amountHts || opGain + 1 >= amountHts) {
          stockReceived = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
      if (!stockReceived) {
        throw new Error(
          `Sell aborted: stock not received by treasury (need ${amountHts} units). USDC not paid.`
        );
      }

      // Burn treasury stock inventory (operator is not a stock desk)
      try {
        const treasuryBal = (await getTokenBalances(operatorId)).get(stockTokenId) ?? 0;
        const burnAmt = Math.min(amountHts, treasuryBal);
        if (burnAmt > 0) await burnFungibleToken(stockTokenId, burnAmt);
      } catch (e) {
        console.warn('[fill] sell burn:', e instanceof Error ? e.message : e);
      }

      const usdcBeforeUser = (await getTokenBalances(order.userAccountId)).get(usdcId) ?? 0;
      fillTxId = await transferToken(usdcId, operatorId, order.userAccountId, usdcHts);

      const usdcAfterUser = (await getTokenBalances(order.userAccountId)).get(usdcId) ?? 0;
      if (usdcAfterUser + 1 < usdcBeforeUser + usdcHts) {
        throw new Error(
          `Sell USDC payout not confirmed (expected +${usdcHts}). Check treasury USDC.`
        );
      }
    }
  }

  const keepNote = order.notes?.startsWith('SETTLEMENT_TX:')
    ? order.notes
    : order.notes;
  await markOrderFilled(orderId, fillTxId, keepNote || 'auto-confirmed');
  console.log(`[fill] order ${orderId} ${order.side} ${order.symbol} → filled ${fillTxId}`);
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
      } catch { /* */ }
    });
  }, 4_000);
}

export async function fillOrderNow(orderId: number): Promise<{ fillTxId: string }> {
  return fillOrderOnChain(orderId);
}
