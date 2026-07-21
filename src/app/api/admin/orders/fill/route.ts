import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getOrder, markOrderStatus } from '@/lib/broker-orders';
import { fillOrderNow } from '@/lib/fill-order';

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
 * Body: { orderId }
 *
 * Uses the same strict settlement as auto-fill:
 *   BUY  → USDC user→treasury first, then mint/transfer stock
 *   SELL → stock user→treasury first, then USDC treasury→user
 *
 * Does NOT mint stock or pay USDC without the signed settlement note.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);
  if (!isAdmin(auth.email)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  let orderIdForFail: number | undefined;
  try {
    const body = await req.json();
    const orderId = body.orderId != null ? Number(body.orderId) : undefined;
    orderIdForFail = orderId;
    if (!orderId || !Number.isFinite(orderId)) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }

    // skipChain is intentionally ignored — off-chain free fills are not allowed
    if (body.skipChain) {
      return NextResponse.json(
        {
          error:
            'skipChain is disabled. Settlement must take USDC (buy) or stock (sell) on-chain first.',
        },
        { status: 400 }
      );
    }

    const order = await getOrder(orderId);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (order.status !== 'pending' && order.status !== 'processing') {
      return NextResponse.json(
        { error: `Order is already ${order.status}` },
        { status: 400 }
      );
    }

    const { fillTxId } = await fillOrderNow(orderId);
    const filled = await getOrder(orderId);
    return NextResponse.json({
      success: true,
      order: filled,
      fillTxId,
      message:
        order.side === 'buy'
          ? 'Filled: USDC taken first, then stock delivered'
          : 'Filled: stock taken first, then USDC paid',
    });
  } catch (error) {
    console.error('[admin/orders/fill]', error);
    if (orderIdForFail) {
      try {
        await markOrderStatus(
          orderIdForFail,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
      } catch {
        /* ignore */
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Fill failed' },
      { status: 500 }
    );
  }
}
