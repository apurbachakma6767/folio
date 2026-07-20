// Shared order fill + auto-confirm pipeline

import { getOrder, markOrderFilled, markOrderStatus } from './broker-orders';
import { ensureEquityToken, getTokenIdForSymbol } from './token-registry';
import { getUsdcTokenId } from './network';
import { getUser } from './user-registry';
import { decryptServerWalletKey } from './server-wallet-crypto';

const HTS_DECIMALS = 6;

/** Decrypt user's server wallet key for server-side associate/KYC. */
async function getUserPrivateKeyDer(userEmail: string): Promise<string | null> {
  try {
    const user = await getUser(userEmail);
    if (!user?.serverWalletKey) return null;
    return decryptServerWalletKey(user.serverWalletKey);
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
  // Notes may have extra text after fill — take first segment only
  const rest = notes.slice('SETTLEMENT_TX:'.length);
  const cut = rest.indexOf('\n');
  return cut >= 0 ? rest.slice(0, cut) : rest;
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
      submitSignedTransaction,
      getTokenBalances,
    } = await import('./hedera');
    const operatorId = getOperatorId().toString();
    const amountHts = Math.max(1, Math.floor(order.shares * 10 ** HTS_DECIMALS));
    const usdcId = getUsdcTokenId();
    const proceeds = order.notionalUsd ?? order.shares * (order.limitPrice ?? 0);
    const usdcHts = Math.max(1, Math.round(proceeds * 10 ** HTS_DECIMALS));
    const settlementB64 = decodeSettlementNote(order.notes);

    if (order.side === 'buy') {
      // 1) Collect USDC from user (pre-signed gasless transfer → treasury)
      if (settlementB64) {
        try {
          const bytes = Uint8Array.from(Buffer.from(settlementB64, 'base64'));
          await submitSignedTransaction(bytes);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // If already executed / duplicate, continue to mint stock
          if (!/DUPLICATE|already|BUSY/i.test(msg)) {
            console.warn('[fill] buy settlement submit:', msg);
            // INVALID_SIGNATURE on settlement is fatal (USDC not collected)
            if (/INVALID_SIGNATURE|INSUFFICIENT|TOKEN_NOT_ASSOCIATED/i.test(msg)) {
              throw new Error(
                `USDC payment failed: ${msg}. Re-open Trade and place the order again.`
              );
            }
          }
        }
      } else if (usdcId) {
        throw new Error('Missing signed USDC payment for buy order');
      }

      // 2) Prepare token for user receive
      const equity = await ensureEquityToken(order.symbol);
      const stockTokenId = equity.tokenId;

      // Prefer clearing KYC friction; then associate+KYC with server key if still needed
      try {
        const { clearTokenKycAndFreeze, ensureUserTokenReady } = await import('./hedera');
        await clearTokenKycAndFreeze(stockTokenId);
        const userKeyDer = await getUserPrivateKeyDer(order.userEmail);
        if (userKeyDer) {
          // Only works if server key matches account — ensureUserTokenReady validates path
          try {
            await ensureUserTokenReady(order.userAccountId, stockTokenId, userKeyDer);
          } catch (assocErr) {
            console.warn(
              '[fill] ensureUserTokenReady (will try transfer with auto-assoc):',
              assocErr instanceof Error ? assocErr.message : assocErr
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
      } catch (prepErr) {
        console.warn(
          '[fill] token prep:',
          prepErr instanceof Error ? prepErr.message : prepErr
        );
      }

      // 3) Mint → user (auto-assoc accounts receive without explicit associate once KYC gone)
      await mintFungibleToken(stockTokenId, amountHts);
      fillTxId = await transferToken(
        stockTokenId,
        operatorId,
        order.userAccountId,
        amountHts
      );
    } else {
      // sell
      // 1) Collect stock from user (pre-signed gasless transfer → treasury)
      if (settlementB64) {
        try {
          const bytes = Uint8Array.from(Buffer.from(settlementB64, 'base64'));
          fillTxId = await submitSignedTransaction(bytes);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn('[fill] sell settlement submit:', msg);
          // If stock already pulled, still pay USDC if user balance dropped
          if (/INSUFFICIENT|INVALID_ACCOUNT|TOKEN_NOT_ASSOCIATED/i.test(msg)) {
            throw e;
          }
        }
      } else {
        throw new Error('Missing signed stock transfer for sell order');
      }

      // 2) Burn stock from treasury — operator does not hold equity inventory
      const stockTokenId =
        getTokenIdForSymbol(order.symbol) ||
        (await ensureEquityToken(order.symbol)).tokenId;
      try {
        const treasuryBal = (await getTokenBalances(operatorId)).get(stockTokenId) ?? 0;
        const burnAmt = Math.min(amountHts, treasuryBal);
        if (burnAmt > 0) {
          await burnFungibleToken(stockTokenId, burnAmt);
        }
      } catch (e) {
        console.warn(
          '[fill] sell burn treasury stock:',
          e instanceof Error ? e.message : e
        );
      }

      // 3) Pay USDC from treasury → user (operator is USDC liquidity only)
      if (!usdcId) throw new Error('USDC not configured');
      if (!proceeds || proceeds <= 0) throw new Error('Cannot compute sell proceeds');

      // Ensure user associated with USDC (usually already)
      try {
        await grantKyc(usdcId, order.userAccountId);
      } catch { /* */ }

      const before = await getTokenBalances(order.userAccountId);
      const usdcBefore = before.get(usdcId) ?? 0;

      fillTxId = await transferToken(usdcId, operatorId, order.userAccountId, usdcHts);

      const after = await getTokenBalances(order.userAccountId);
      const usdcAfter = after.get(usdcId) ?? 0;
      if (usdcAfter < usdcBefore) {
        console.warn('[fill] sell USDC balance did not increase', { usdcBefore, usdcAfter });
      }
    }
  }

  // Preserve settlement note; mark filled
  const keepNote = order.notes?.startsWith('SETTLEMENT_TX:')
    ? order.notes
    : order.notes;
  await markOrderFilled(orderId, fillTxId, keepNote || 'auto-confirmed');
  console.log(`[fill] order ${orderId} ${order.side} ${order.symbol} → filled ${fillTxId}`);
  return { fillTxId };
}

/**
 * pending → processing (~1s) → filled (~4s total).
 * Fire-and-forget; safe to call multiple times (idempotent when filled).
 */
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

/** Awaitable fill for scripts / admin */
export async function fillOrderNow(orderId: number): Promise<{ fillTxId: string }> {
  return fillOrderOnChain(orderId);
}
