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
    console.error('[trade/associate]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Associate failed' },
      { status: 500 }
    );
  }
}
