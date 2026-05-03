import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getUser } from '@/lib/user-registry';
import { executeRepayment } from '@/lib/escrow';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const { noteId, signedRepayTxBytes } = await req.json();

    if (!noteId) {
      return NextResponse.json({ error: 'noteId required' }, { status: 400 });
    }

    const user = await getUser(auth.email);
    if (!user?.hederaAccountId) {
      return NextResponse.json({ error: 'User has no Hedera account' }, { status: 400 });
    }

    const result = await executeRepayment(noteId, user.hederaAccountId, signedRepayTxBytes);

    return NextResponse.json({
      success: true,
      settlement: result,
    });
  } catch (error) {
    console.error('Repayment error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Repayment failed' },
      { status: 500 }
    );
  }
}
