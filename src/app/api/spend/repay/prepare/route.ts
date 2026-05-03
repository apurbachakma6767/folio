import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getUser } from '@/lib/user-registry';
import { getNote } from '@/lib/spend-notes';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const { noteId } = await req.json();

    if (!noteId) {
      return NextResponse.json({ error: 'noteId required' }, { status: 400 });
    }

    const user = await getUser(auth.email);
    if (!user?.hederaAccountId) {
      return NextResponse.json({ error: 'User has no Hedera account' }, { status: 400 });
    }

    const note = await getNote(noteId);
    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }
    if (note.status !== 'active') {
      return NextResponse.json({ error: `Note is already ${note.status}` }, { status: 400 });
    }
    if (note.userAccountId !== user.hederaAccountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    let repayTxBytes: string | undefined;

    if (hederaConfigured) {
      const { prepareRepayment, getTokenBalances } = await import('@/lib/hedera');
      const usdcTokenId = process.env.USDC_TEST_TOKEN_ID!;

      // Check user has enough USDC to repay
      const balances = await getTokenBalances(user.hederaAccountId);
      const usdcBalance = balances.get(usdcTokenId) ?? 0;
      const amountHts = Math.floor(note.amount * 1e6);

      if (usdcBalance < amountHts) {
        return NextResponse.json(
          { error: `Insufficient USDC. Need ${note.amount} USDC, have ${(usdcBalance / 1e6).toFixed(2)}` },
          { status: 400 }
        );
      }

      const txBytes = await prepareRepayment(usdcTokenId, user.hederaAccountId, amountHts);
      repayTxBytes = Buffer.from(txBytes).toString('base64');
    }

    return NextResponse.json({
      noteId: note.id,
      amount: note.amount,
      symbol: note.symbol,
      shares: note.shares,
      repayTxBytes,
      needsSignature: !!repayTxBytes,
    });
  } catch (error) {
    console.error('Repay prepare error:', error);
    return NextResponse.json(
      { error: 'Failed to prepare repayment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
