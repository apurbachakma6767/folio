import { NextRequest, NextResponse } from 'next/server';
import { plaidClient, isPlaidConfigured, getAccessToken } from '@/lib/plaid';
import { holdingGradient } from '@/lib/types';
import { verifyAuth, unauthorized } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  if (!isPlaidConfigured) {
    return NextResponse.json(
      { error: 'plaid_not_configured' },
      { status: 501 }
    );
  }

  const userId = auth.email;
  const accessToken = await getAccessToken(userId);

  if (!accessToken) {
    return NextResponse.json(
      { error: 'not_connected' },
      { status: 401 }
    );
  }

  try {
    const response = await plaidClient.investmentsHoldingsGet({
      access_token: accessToken,
    });

    const { holdings, securities } = response.data;

    // Build security lookup by security_id
    const securityMap = new Map(
      securities.map((s) => [s.security_id, s])
    );

    // Map to our Holding shape, filtering to equities/ETFs with ticker symbols
    const ALLOWED_TYPES = new Set(['equity', 'etf']);
    const mapped = holdings
      .map((h) => {
        const security = securityMap.get(h.security_id);
        if (!security?.ticker_symbol) return null;
        if (!ALLOWED_TYPES.has(security.type ?? '')) return null;
        return {
          symbol: security.ticker_symbol,
          name: security.name || security.ticker_symbol,
          shares: h.quantity,
          icon: security.ticker_symbol[0],
          gradient: holdingGradient(security.ticker_symbol),
        };
      })
      .filter(Boolean);

    return NextResponse.json({ holdings: mapped });
  } catch (error) {
    console.error('Plaid holdings error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch holdings' },
      { status: 500 }
    );
  }
}
