import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getOrder, markOrderFilled, markOrderStatus } from '@/lib/broker-orders';
import { getTokenIdForSymbol } from '@/lib/token-registry';
import { getUsdcTokenId } from '@/lib/network';

function isAdmin(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // If unset, allow any authenticated user in non-production for local desk testing
  if (list.length === 0) {
    return process.env.FOLIO_ENV !== 'production' && process.env.NODE_ENV !== 'production';
  }
  return list.includes(email.toLowerCase());
}

/**
 * POST /api/admin/orders/fill
 * Body: { orderId, skipChain?: boolean }
 * Buy fill → mint HTS stock to user
 * Sell fill → transfer USDC notional to user (stock already expected at operator or burned ops-side)
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);
  if (!isAdmin(auth.email)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  let orderIdForFail: number | undefined;
  try {
    const { orderId, skipChain = false } = await req.json();
    orderIdForFail = orderId != null ? Number(orderId) : undefined;
    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }

    const order = await getOrder(Number(orderId));
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (order.status !== 'pending' && order.status !== 'processing') {
      return NextResponse.json({ error: `Order is already ${order.status}` }, { status: 400 });
    }

    const hederaConfigured = !!(
      process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY
    );
    let fillTxId = `desk-fill-${Date.now()}`;

    if (hederaConfigured && !skipChain) {
      const {
        mintFungibleToken,
        burnFungibleToken,
        transferToken,
        getOperatorId,
        grantKyc,
        unfreezeAccount,
        getTokenBalances,
      } = await import('@/lib/hedera');
      const operatorId = getOperatorId().toString();
      const HTS_DECIMALS = 6;
      const amountHts = Math.floor(order.shares * 10 ** HTS_DECIMALS);

      if (order.side === 'buy') {
        const stockTokenId = getTokenIdForSymbol(order.symbol);
        if (!stockTokenId) {
          return NextResponse.json({ error: `No HTS token for ${order.symbol}` }, { status: 503 });
        }
        try {
          await grantKyc(stockTokenId, order.userAccountId);
        } catch { /* ok */ }
        try {
          await unfreezeAccount(stockTokenId, order.userAccountId);
        } catch { /* ok */ }
        // Mint → user immediately; operator does not retain stock inventory
        await mintFungibleToken(stockTokenId, amountHts);
        fillTxId = await transferToken(
          stockTokenId,
          operatorId,
          order.userAccountId,
          amountHts
        );
      } else {
        // Sell: burn any treasury stock, pay USDC (operator is USDC liquidity only)
        const stockTokenId = getTokenIdForSymbol(order.symbol);
        if (stockTokenId) {
          try {
            const bal = (await getTokenBalances(operatorId)).get(stockTokenId) ?? 0;
            const burnAmt = Math.min(amountHts, bal);
            if (burnAmt > 0) await burnFungibleToken(stockTokenId, burnAmt);
          } catch (e) {
            console.warn('[admin/fill] burn stock:', e instanceof Error ? e.message : e);
          }
        }
        const usdcId = getUsdcTokenId();
        if (!usdcId) {
          return NextResponse.json({ error: 'USDC not configured' }, { status: 503 });
        }
        const proceeds =
          order.notionalUsd ??
          order.shares * (order.limitPrice ?? 0);
        if (!proceeds || proceeds <= 0) {
          return NextResponse.json({ error: 'Cannot compute sell proceeds' }, { status: 400 });
        }
        const usdcHts = Math.round(proceeds * 1e6);
        fillTxId = await transferToken(usdcId, operatorId, order.userAccountId, usdcHts);
      }
    }

    const filled = await markOrderFilled(order.id, fillTxId, `Filled by ${auth.email}`);
    return NextResponse.json({ success: true, order: filled, fillTxId });
  } catch (error) {
    console.error('[admin/orders/fill]', error);
    if (orderIdForFail) {
      try {
        await markOrderStatus(orderIdForFail, 'failed', error instanceof Error ? error.message : String(error));
      } catch { /* ignore */ }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Fill failed' },
      { status: 500 }
    );
  }
}
