import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';

/** Submit user-signed (gasless) token association. */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const { signedAssociateTxBytes } = await req.json();
    if (!signedAssociateTxBytes) {
      return NextResponse.json({ error: 'signedAssociateTxBytes required' }, { status: 400 });
    }
    const { submitSignedTransaction } = await import('@/lib/hedera');
    const bytes = Uint8Array.from(Buffer.from(signedAssociateTxBytes, 'base64'));
    const txId = await submitSignedTransaction(bytes);
    return NextResponse.json({ success: true, txId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Associate failed';
    console.error('[trade/associate]', msg);
    // Already associated is success for trade flow
    if (msg.includes('TOKEN_ALREADY_ASSOCIATED') || msg.includes('already-associated')) {
      return NextResponse.json({ success: true, txId: 'already-associated' });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
