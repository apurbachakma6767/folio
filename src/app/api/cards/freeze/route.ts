import { NextRequest, NextResponse } from 'next/server';
import { freezeCard, unfreezeCard } from '@/lib/lithic';
import { getNotes } from '@/lib/spend-notes';
import { getUser } from '@/lib/user-registry';
import { supabase } from '@/lib/supabase';
import { verifyAuth, unauthorized } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const { cardToken, freeze } = await req.json();

    if (!cardToken) {
      return NextResponse.json({ error: 'cardToken required' }, { status: 400 });
    }

    // Look up the authenticated user's Hedera account and scope the query
    const user = await getUser(auth.email);
    if (!user?.hederaAccountId) {
      return NextResponse.json({ error: 'User account not found' }, { status: 404 });
    }

    const userNotes = await getNotes(user.hederaAccountId);
    const ownerNote = userNotes.find(
      (n) => n.cardToken === cardToken
    );

    if (!ownerNote) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    // Only allow freeze/unfreeze on active cards
    if (ownerNote.status !== 'active') {
      return NextResponse.json({ error: 'Card is not active' }, { status: 400 });
    }

    const result = freeze
      ? await freezeCard(cardToken)
      : await unfreezeCard(cardToken);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to update card' },
        { status: 500 }
      );
    }

    // Update card state in Supabase
    await supabase
      .from('spend_notes')
      .update({ card_state: freeze ? 'PAUSED' : 'OPEN' })
      .eq('id', ownerNote.id);

    return NextResponse.json({
      success: true,
      state: result.card?.state,
    });
  } catch (error) {
    console.error('Card freeze/unfreeze error:', error);
    return NextResponse.json(
      { error: 'Failed to update card state' },
      { status: 500 }
    );
  }
}
