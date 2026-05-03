import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

// POST /api/admin/mint-treasury — mint USDC to the operator treasury
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  if (!hederaConfigured) {
    return NextResponse.json({ error: 'Hedera not configured' }, { status: 503 });
  }

  const usdcTokenId = process.env.USDC_TEST_TOKEN_ID;
  if (!usdcTokenId) {
    return NextResponse.json({ error: 'USDC_TEST_TOKEN_ID not set' }, { status: 503 });
  }

  try {
    const { amount } = await req.json();
    // Default: mint 10,000 USDC (6 decimals)
    const mintAmount = amount ?? 10_000_000_000;

    if (mintAmount <= 0 || mintAmount > 100_000_000_000) {
      return NextResponse.json(
        { error: 'Amount must be between 1 and 100,000 USDC (in smallest units)' },
        { status: 400 }
      );
    }

    const { mintFungibleToken, getTokenBalances, getOperatorId } = await import('@/lib/hedera');
    const operatorId = getOperatorId().toString();

    // Check balance before
    const beforeBalances = await getTokenBalances(operatorId);
    const beforeUsdc = beforeBalances.get(usdcTokenId) ?? 0;

    const txId = await mintFungibleToken(usdcTokenId, mintAmount);

    // Check balance after
    const afterBalances = await getTokenBalances(operatorId);
    const afterUsdc = afterBalances.get(usdcTokenId) ?? 0;

    return NextResponse.json({
      success: true,
      txId,
      minted: mintAmount,
      mintedFormatted: `${(mintAmount / 1_000_000).toLocaleString()} USDC`,
      treasury: {
        before: beforeUsdc,
        after: afterUsdc,
        beforeFormatted: `${(beforeUsdc / 1_000_000).toLocaleString()} USDC`,
        afterFormatted: `${(afterUsdc / 1_000_000).toLocaleString()} USDC`,
      },
    });
  } catch (error) {
    console.error('Treasury mint error:', error);
    return NextResponse.json(
      { error: 'Mint failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// GET /api/admin/mint-treasury — check current treasury USDC balance
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  if (!hederaConfigured) {
    return NextResponse.json({ error: 'Hedera not configured' }, { status: 503 });
  }

  const usdcTokenId = process.env.USDC_TEST_TOKEN_ID;
  if (!usdcTokenId) {
    return NextResponse.json({ error: 'USDC_TEST_TOKEN_ID not set' }, { status: 503 });
  }

  try {
    const { getTokenBalances, getOperatorId } = await import('@/lib/hedera');
    const operatorId = getOperatorId().toString();
    const balances = await getTokenBalances(operatorId);
    const usdcBalance = balances.get(usdcTokenId) ?? 0;

    return NextResponse.json({
      operatorId,
      usdcTokenId,
      balance: usdcBalance,
      balanceFormatted: `${(usdcBalance / 1_000_000).toLocaleString()} USDC`,
    });
  } catch (error) {
    console.error('Treasury balance check error:', error);
    return NextResponse.json(
      { error: 'Balance check failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
