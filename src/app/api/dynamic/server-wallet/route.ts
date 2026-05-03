import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { createServerWallet } from '@/lib/dynamic-server';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const { address, walletId } = await createServerWallet();
    return NextResponse.json({ address, walletId });
  } catch (error) {
    console.error('Failed to create server wallet:', error);
    return NextResponse.json(
      { error: 'Failed to create server wallet' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  return NextResponse.json({
    address: process.env.DYNAMIC_SERVER_WALLET_ADDRESS || null,
  });
}
