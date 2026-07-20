import { NextRequest, NextResponse } from 'next/server';
import { holdingGradient } from '@/lib/types';
import { getTokenRegistry } from '@/lib/token-registry';
import { verifyAuth, unauthorized } from '@/lib/auth';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  if (!hederaConfigured) {
    return NextResponse.json({ holdings: [], source: 'not_configured' });
  }

  const accountId = req.nextUrl.searchParams.get('accountId');
  if (!accountId) {
    return NextResponse.json({ holdings: [], source: 'no_account' });
  }

  try {
    const { getTokenBalances } = await import('@/lib/hedera');
    const balances = await getTokenBalances(accountId);
    const registry = getTokenRegistry();

    // Build lookup: tokenId -> registry entry
    const tokenMap = new Map(registry.map((t) => [t.tokenId, t]));

    const holdings = Array.from(balances.entries())
      .filter(([tokenId]) => {
        const entry = tokenMap.get(tokenId);
        // Portfolio equities only (not USDC / crypto)
        return entry && entry.type === 'stock';
      })
      .map(([tokenId, rawBalance]) => {
        const entry = tokenMap.get(tokenId)!;
        // Preserve fractional HTS balances (6 decimals)
        const shares = rawBalance / 10 ** entry.decimals;
        return {
          symbol: entry.symbol,
          name: entry.name,
          shares,
          icon: entry.symbol[0],
          gradient: holdingGradient(entry.symbol),
          provider: entry.provider,
          type: 'stock' as const,
        };
      })
      .filter((h) => h.shares > 1e-9);

    return NextResponse.json({ holdings, source: 'hedera' });
  } catch (error) {
    console.error('Hedera holdings error:', error);
    return NextResponse.json({ holdings: [], source: 'error' }, { status: 500 });
  }
}
