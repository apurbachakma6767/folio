import { NextRequest, NextResponse } from 'next/server';
import { getAllPrices } from '@/lib/price';
import { verifyAuth, unauthorized } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const symbolsParam = req.nextUrl.searchParams.get('symbols');
    const symbols = symbolsParam
      ? symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : undefined;

    const prices = await getAllPrices(symbols);
    return NextResponse.json(prices);
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch prices' },
      { status: 500 }
    );
  }
}
