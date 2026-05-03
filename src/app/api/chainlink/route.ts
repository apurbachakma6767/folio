import { NextRequest, NextResponse } from 'next/server';
import { getChainlinkCollars } from '@/lib/chainlink';
import { verifyAuth, unauthorized } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const symbolsParam = req.nextUrl.searchParams.get('symbols');
    const symbols = symbolsParam
      ? symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : ['ETH', 'BTC'];

    const collars = await getChainlinkCollars(symbols);
    return NextResponse.json(collars);
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch Chainlink collars' },
      { status: 500 }
    );
  }
}
