import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getUser } from '@/lib/user-registry';
import { getStockPrice } from '@/lib/price';
import { TRADE_STOCKS } from '@/lib/types';
import { ensureEquityToken, getTokenIdForSymbol } from '@/lib/token-registry';
import { getUsdcTokenId } from '@/lib/network';

const ALLOWED = new Set(TRADE_STOCKS.map((s) => s.symbol));
const HTS_DECIMALS = 6;

/**
 * Prepare gasless settlement tx for trade:
 * - buy:  user USDC → operator treasury
 * - sell: user stock HTS → operator treasury
 */
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

    const user = await getUser(auth.email);
    if (!user?.hederaAccountId) {
      return NextResponse.json({ error: 'Complete wallet setup first' }, { status: 400 });
    }

    const priceData = await getStockPrice(symbol);
    const price = priceData.price;
    if ((!shares || shares <= 0) && notionalUsd && notionalUsd > 0) {
      shares = notionalUsd / price;
    }
    if (!shares || shares <= 0 || !Number.isFinite(shares)) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    const notional = notionalUsd ?? shares * price;
    const sharesHts = Math.floor(shares * 10 ** HTS_DECIMALS);
    const usdcHts = Math.round(notional * 10 ** HTS_DECIMALS);

    const hederaConfigured = !!(
      process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY
    );
    if (!hederaConfigured) {
      return NextResponse.json({
        needsSignature: false,
        shares,
        notional,
        price,
        message: 'Hedera not configured — demo order only',
      });
    }

    const { getTokenBalances, prepareRepayment, prepareCollateralLock } = await import(
      '@/lib/hedera'
    );
    const balances = await getTokenBalances(user.hederaAccountId);

    // Ensure shared HTS equity token exists for this symbol (auto-create if needed)
    // One token ID per stock for ALL users (e.g. all NVDA holders share the same NVDA HTS)
    const { hydrateTokenRegistryFromDb } = await import('@/lib/token-registry');
    await hydrateTokenRegistryFromDb();
    const equity = await ensureEquityToken(symbol);
    const stockTokenId = equity.tokenId;

    // Associate user with this HTS if needed (older accounts without auto-assoc)
    const { isTokenAssociated, prepareTokenAssociation } = await import('@/lib/hedera');
    let associateTxBytes: string | undefined;
    const associated = await isTokenAssociated(user.hederaAccountId, stockTokenId);
    if (!associated) {
      const assocBytes = await prepareTokenAssociation(user.hederaAccountId, [stockTokenId]);
      associateTxBytes = Buffer.from(assocBytes).toString('base64');
    }

    if (side === 'buy') {
      const usdcId = getUsdcTokenId();
      if (!usdcId) {
        return NextResponse.json({ error: 'USDC not configured' }, { status: 503 });
      }
      const usdcBal = (balances.get(usdcId) ?? 0) / 10 ** HTS_DECIMALS;
      if (usdcBal + 1e-9 < notional) {
        return NextResponse.json(
          {
            error: `Insufficient USDC. Need $${notional.toFixed(2)}, have $${usdcBal.toFixed(2)}. Add USDC in Wallet.`,
          },
          { status: 400 }
        );
      }
      // Reuse gasless repay builder: user USDC → operator
      const txBytes = await prepareRepayment(usdcId, user.hederaAccountId, usdcHts);
      return NextResponse.json({
        needsSignature: true,
        settlementTxBytes: Buffer.from(txBytes).toString('base64'),
        associateTxBytes,
        needsAssociate: !!associateTxBytes,
        side: 'buy',
        symbol,
        shares,
        sharesHts,
        notional,
        usdcHts,
        price,
        tokenId: stockTokenId,
      });
    }

    // sell
    const stockBal = (balances.get(stockTokenId) ?? 0) / 10 ** HTS_DECIMALS;
    if (stockBal + 1e-9 < shares) {
      return NextResponse.json(
        {
          error: `Insufficient ${symbol}. Need ${shares.toFixed(4)}, have ${stockBal.toFixed(4)}.`,
        },
        { status: 400 }
      );
    }
    // Gasless: user stock → operator (same shape as collateral lock)
    const txBytes = await prepareCollateralLock(
      stockTokenId,
      user.hederaAccountId,
      sharesHts
    );
    return NextResponse.json({
      needsSignature: true,
      settlementTxBytes: Buffer.from(txBytes).toString('base64'),
      associateTxBytes,
      needsAssociate: !!associateTxBytes,
      side: 'sell',
      symbol,
      shares,
      sharesHts,
      notional,
      usdcHts,
      price,
      tokenId: stockTokenId,
    });
  } catch (error) {
    console.error('[trade/prepare]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Prepare failed' },
      { status: 500 }
    );
  }
}
