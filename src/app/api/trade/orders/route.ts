import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getUser } from '@/lib/user-registry';
import { createOrder, listOrders } from '@/lib/broker-orders';
import { getStockPrice } from '@/lib/price';
import { TRADE_STOCKS } from '@/lib/types';
import { ensureEquityToken, getTokenIdForSymbol } from '@/lib/token-registry';
import { getUsdcTokenId } from '@/lib/network';
import { encodeSettlementNote } from '@/lib/fill-order';

const ALLOWED = new Set(TRADE_STOCKS.map((s) => s.symbol));
const HTS_DECIMALS = 6;

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const all = req.nextUrl.searchParams.get('all') === '1';
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const isAdmin = adminEmails.includes(auth.email.toLowerCase());

    const orders = await listOrders(all && isAdmin ? undefined : auth.email);
    return NextResponse.json({ orders });
  } catch (error) {
    console.error('[trade/orders GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list orders' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const body = await req.json();
    const side = body.side === 'sell' ? 'sell' : body.side === 'buy' ? 'buy' : null;
    const symbol = String(body.symbol || '').toUpperCase();
    let shares = Number(body.shares);
    const notionalUsd = body.notionalUsd != null ? Number(body.notionalUsd) : undefined;

    if (!side) {
      return NextResponse.json({ error: 'side must be buy or sell' }, { status: 400 });
    }
    if (!ALLOWED.has(symbol)) {
      return NextResponse.json({ error: 'Unsupported symbol' }, { status: 400 });
    }

    const priceData = await getStockPrice(symbol);
    const price = priceData.price;

    if ((!shares || shares <= 0) && notionalUsd && notionalUsd > 0) {
      shares = notionalUsd / price;
    }
    if (!shares || shares <= 0 || !Number.isFinite(shares)) {
      return NextResponse.json({ error: 'Invalid shares or notionalUsd' }, { status: 400 });
    }
    if (shares > 1000) {
      return NextResponse.json({ error: 'Max 1000 shares per order during early access' }, { status: 400 });
    }

    const user = await getUser(auth.email);
    if (!user?.hederaAccountId) {
      return NextResponse.json({ error: 'Complete wallet setup first' }, { status: 400 });
    }

    const notional = notionalUsd ?? shares * price;
    const hederaConfigured = !!(
      process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY
    );

    // Balance validation
    if (hederaConfigured) {
      const { getTokenBalances } = await import('@/lib/hedera');
      const balances = await getTokenBalances(user.hederaAccountId);

      if (side === 'buy') {
        const usdcId = getUsdcTokenId();
        if (usdcId) {
          const usdcRaw = balances.get(usdcId) ?? 0;
          const usdcBal = usdcRaw / 10 ** HTS_DECIMALS;
          if (usdcBal + 1e-9 < notional) {
            return NextResponse.json(
              {
                error: `Insufficient USDC. Need $${notional.toFixed(2)}, have $${usdcBal.toFixed(2)}. Deposit USDC in Wallet first.`,
              },
              { status: 400 }
            );
          }
        }
      } else {
        const stockTokenId = getTokenIdForSymbol(symbol);
        if (stockTokenId) {
          const stockRaw = balances.get(stockTokenId) ?? 0;
          const stockBal = stockRaw / 10 ** HTS_DECIMALS;
          if (stockBal + 1e-9 < shares) {
            return NextResponse.json(
              {
                error: `Insufficient ${symbol}. Need ${shares.toFixed(4)} shares, have ${stockBal.toFixed(4)}.`,
              },
              { status: 400 }
            );
          }
        }
      }
    }

    const signedSettlementTxBytes =
      typeof body.signedSettlementTxBytes === 'string'
        ? body.signedSettlementTxBytes
        : undefined;
    if (hederaConfigured && !signedSettlementTxBytes) {
      return NextResponse.json(
        {
          error:
            'Settlement signature required. Call /api/trade/prepare, sign, then submit again.',
        },
        { status: 400 }
      );
    }

    // Ensure shared HTS equity token exists for this symbol (all users share one token ID)
    if (hederaConfigured) {
      await ensureEquityToken(symbol);
    }

    const order = await createOrder({
      userEmail: auth.email,
      userAccountId: user.hederaAccountId,
      side,
      symbol,
      shares,
      notionalUsd: notional,
      limitPrice: price,
      notes: signedSettlementTxBytes
        ? encodeSettlementNote(signedSettlementTxBytes)
        : body.notes,
    });

    // Fill immediately in-process (no setTimeout — serverless freezes after response).
    // Buy: USDC user→treasury first, then mint stock→user
    // Sell: stock user→treasury first, then USDC treasury→user
    // Prefer await so settlement runs while the request is still alive on Vercel.
    let fillTxId: string | undefined;
    let fillError: string | undefined;
    try {
      const { fillOrderNow } = await import('@/lib/fill-order');
      const result = await fillOrderNow(order.id);
      fillTxId = result.fillTxId;
    } catch (e) {
      fillError = e instanceof Error ? e.message : String(e);
      console.error('[trade/orders] inline fill failed', order.id, fillError);
      // scheduleAutoConfirm is a no-delay fallback; order already failed in fill path
      // if mark failed inside fillOrderNow — re-mark for safety
      try {
        const { markOrderStatus } = await import('@/lib/broker-orders');
        await markOrderStatus(order.id, 'failed', fillError);
      } catch {
        /* */
      }
    }

    // Refresh order status for response
    const { getOrder } = await import('@/lib/broker-orders');
    const finalOrder = (await getOrder(order.id)) || order;

    return NextResponse.json({
      order: finalOrder,
      fillTxId,
      fillError,
      message: fillError
        ? `Order could not be filled: ${fillError}`
        : side === 'buy'
          ? 'Buy filled. USDC taken; stock tokens delivered.'
          : 'Sell filled. Stock taken; USDC delivered.',
    });
  } catch (error) {
    console.error('[trade/orders POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create order' },
      { status: 500 }
    );
  }
}
