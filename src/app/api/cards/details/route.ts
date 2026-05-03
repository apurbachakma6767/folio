import { NextRequest, NextResponse } from 'next/server';
import { getCardDetails } from '@/lib/lithic';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getNotes } from '@/lib/spend-notes';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  const cardToken = req.nextUrl.searchParams.get('cardToken');
  const userAccountId = req.nextUrl.searchParams.get('userAccountId');

  if (!cardToken) {
    return NextResponse.json({ error: 'cardToken required' }, { status: 400 });
  }

  // Verify the card belongs to the requesting user
  if (userAccountId) {
    const notes = await getNotes(userAccountId);
    const ownsCard = notes.some((n) => n.cardToken === cardToken);
    if (!ownsCard) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }
  }

  const result = await getCardDetails(cardToken);
  if (!result.success || !result.card) {
    return NextResponse.json(
      { error: result.error || 'Failed to fetch card details' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    card: {
      pan: result.card.pan,
      cvv: result.card.cvv,
      expMonth: result.card.expMonth,
      expYear: result.card.expYear,
      lastFour: result.card.lastFour,
      state: result.card.state,
      spendLimit: result.card.spendLimit,
    },
  });
}
