import { NextRequest, NextResponse } from 'next/server';
import {
  getUser,
  storeEncryptedKey,
  storeServerWalletKey,
  storeWalletPassphrase,
} from '@/lib/user-registry';
import { verifyAuth, unauthorized } from '@/lib/auth';
import {
  decryptServerWalletKey,
  encryptServerWalletKey,
} from '@/lib/server-wallet-crypto';

// GET — passphrase backup and/or server wallet restore for the authenticated user
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  const email = req.nextUrl.searchParams.get('email') || auth.email;
  if (email.toLowerCase() !== auth.email.toLowerCase()) {
    return unauthorized('Cannot access another user\'s keys');
  }

  const user = await getUser(email);
  if (!user) {
    return NextResponse.json({
      exists: false,
      hasEncryptedKey: false,
      hasServerWalletKey: false,
    });
  }

  const mode = req.nextUrl.searchParams.get('mode'); // 'server' | null

  // Restore server-held private key (silent multi-device recovery)
  if (mode === 'server' && user.serverWalletKey) {
    try {
      const privateKeyDer = decryptServerWalletKey(user.serverWalletKey);
      return NextResponse.json({
        exists: true,
        hasServerWalletKey: true,
        privateKeyDer,
        publicKey: user.publicKey,
        hederaAccountId: user.hederaAccountId,
      });
    } catch (e) {
      console.error('[users/key] server decrypt failed', e);
      return NextResponse.json({
        exists: true,
        hasServerWalletKey: true,
        error: 'decrypt_failed',
      });
    }
  }

  if (!user.encryptedKey || !user.keySalt || !user.keyIv) {
    return NextResponse.json({
      exists: true,
      hasEncryptedKey: false,
      hasServerWalletKey: !!user.serverWalletKey,
      hederaAccountId: user.hederaAccountId,
    });
  }

  return NextResponse.json({
    exists: true,
    hasEncryptedKey: true,
    hasServerWalletKey: !!user.serverWalletKey,
    encryptedKey: user.encryptedKey,
    keySalt: user.keySalt,
    keyIv: user.keyIv,
    hederaAccountId: user.hederaAccountId,
  });
}

// POST — store passphrase backup and/or server wallet key
export async function POST(req: NextRequest) {
  const postAuth = await verifyAuth(req);
  if (!postAuth.authenticated) return unauthorized(postAuth.error);

  try {
    const body = await req.json();
    const email = (body.email || postAuth.email) as string;

    if (email.toLowerCase() !== postAuth.email.toLowerCase()) {
      return unauthorized('Cannot modify another user\'s keys');
    }

    const user = await getUser(email);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Passphrase-encrypted backup (optional fields)
    if (body.encryptedKey && body.keySalt && body.keyIv) {
      await storeEncryptedKey(email, body.encryptedKey, body.keySalt, body.keyIv);
    }

    // Persist passphrase on all networks (including mainnet) for recovery / unlock
    if (typeof body.passphrase === 'string' && body.passphrase.length >= 6) {
      await storeWalletPassphrase(email, body.passphrase);
    }

    // Server-side private key backup (privateKeyDer from client once over HTTPS)
    // Only store if key matches the account's public key — never overwrite with a wrong key
    if (typeof body.privateKeyDer === 'string' && body.privateKeyDer.length > 20) {
      try {
        const { PrivateKey } = await import('@hashgraph/sdk');
        const pk = PrivateKey.fromStringDer(body.privateKeyDer);
        const pub = pk.publicKey.toStringDer();
        if (user.publicKey && pub !== user.publicKey) {
          console.warn(
            `[users/key] refuse server_wallet_key for ${email}: key does not match account public key`
          );
        } else {
          const blob = encryptServerWalletKey(body.privateKeyDer);
          await storeServerWalletKey(email, blob);
          // Backfill public_key if missing
          if (!user.publicKey) {
            const { supabase } = await import('@/lib/supabase');
            await supabase
              .from('users')
              .update({ public_key: pub })
              .eq('email', email.toLowerCase());
          }
        }
      } catch (e) {
        console.warn(
          '[users/key] server key store skipped:',
          e instanceof Error ? e.message : e
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Store encrypted key error:', error);
    return NextResponse.json(
      { error: 'Failed to store key', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
