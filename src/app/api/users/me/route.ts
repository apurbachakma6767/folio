import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getUser } from '@/lib/user-registry';

/** GET /api/users/me — existing Folio profile without creating accounts */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const user = await getUser(auth.email);
    if (!user) {
      return NextResponse.json({ exists: false });
    }
    return NextResponse.json({
      exists: true,
      user: {
        email: user.email,
        name: user.name,
        displayName: user.displayName || user.name,
        hederaAccountId: user.hederaAccountId,
        publicKey: user.publicKey,
        testnetHederaAccountId: user.testnetHederaAccountId,
        createdAt: user.createdAt,
      },
      hasPassphraseBackup: !!(user.encryptedKey && user.keySalt && user.keyIv),
      hasServerWalletKey: !!user.serverWalletKey,
      hasWalletPassphrase: !!user.walletPassphrase,
      // Optional profile completeness (for debugging / settings empty state)
      profileComplete: !!(
        (user.displayName || user.name) &&
        user.encryptedKey &&
        user.keySalt &&
        user.keyIv &&
        user.walletPassphrase
      ),
    });
  } catch (error) {
    console.error('[users/me]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
