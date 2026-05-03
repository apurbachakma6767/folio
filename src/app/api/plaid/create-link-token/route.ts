import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { plaidClient, isPlaidConfigured } from '@/lib/plaid';
import { Products, CountryCode } from 'plaid';
import { verifyAuth, unauthorized } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  if (!isPlaidConfigured) {
    return NextResponse.json(
      { error: 'plaid_not_configured' },
      { status: 501 }
    );
  }

  try {
    const plaidUserId = createHash('sha256').update(auth.email).digest('hex').slice(0, 32);

    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: plaidUserId },
      client_name: 'Folio',
      products: [Products.Investments],
      country_codes: [CountryCode.Us],
      language: 'en',
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error: unknown) {
    console.error('Plaid link token error:', error);
    return NextResponse.json(
      { error: 'Failed to create link token' },
      { status: 500 }
    );
  }
}
