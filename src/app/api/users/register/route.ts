import { NextRequest, NextResponse } from 'next/server';
import { getUser, registerUser } from '@/lib/user-registry';
import { verifyAuth, unauthorized } from '@/lib/auth';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

/**
 * Tokens to associate at registration.
 * Keep this small: USDC + Spend Note only.
 * Equity HTS associate on-demand at Trade/Spend (prepare routes) so signup
 * does not build a 14-token association that fails/hangs on mainnet.
 */
async function bootstrapTokenIdsForAssociation(): Promise<string[]> {
  const tokenIds: string[] = [];
  const { getUsdcTokenId } = await import('@/lib/network');
  const usdcId = getUsdcTokenId();
  const noteId = process.env.SPEND_NOTE_TOKEN_ID?.trim();
  if (usdcId) tokenIds.push(usdcId);
  if (noteId) tokenIds.push(noteId);
  return tokenIds;
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const { email, name, publicKey } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }
    if (!publicKey) {
      return NextResponse.json({ error: 'publicKey required' }, { status: 400 });
    }

    // Check if user already exists — NEVER create a second Hedera account for same email
    const existing = await getUser(email);
    if (existing) {
      // Optionally refresh public_key if client still has matching wallet (do not change account id)
      if (
        publicKey &&
        existing.publicKey &&
        publicKey !== existing.publicKey
      ) {
        console.warn(
          `[register] existing user ${email} presented a different publicKey — ignoring (keep hedera ${existing.hederaAccountId})`
        );
      }
      return NextResponse.json({
        user: existing,
        created: false,
        needsTokenAssociation: false,
      });
    }

    let hederaAccountId = `0.0.${Date.now()}`; // Demo fallback
    let tokenAssocTxBytes: string | undefined;

    if (hederaConfigured) {
      const { createAccountWithPublicKey, prepareTokenAssociation } = await import('@/lib/hedera');
      // 1) Create Hedera account
      hederaAccountId = await createAccountWithPublicKey(publicKey);
    }

    // 2) Persist user immediately so DB has a row even if association fails later
    const user = await registerUser(email, name || '', hederaAccountId, publicKey);

    // 3) Optional bootstrap assoc: USDC + Spend Note only (equities on Trade/Spend)
    if (hederaConfigured) {
      try {
        const { prepareTokenAssociation } = await import('@/lib/hedera');
        const tokenIds = await bootstrapTokenIdsForAssociation();
        if (tokenIds.length > 0) {
          const txBytes = await prepareTokenAssociation(hederaAccountId, tokenIds);
          tokenAssocTxBytes = Buffer.from(txBytes).toString('base64');
        }
      } catch (assocPrepErr) {
        console.warn(
          '[register] token assoc prep failed (user already in DB):',
          assocPrepErr instanceof Error ? assocPrepErr.message : assocPrepErr
        );
      }
    }

    return NextResponse.json({
      user,
      created: true,
      tokenAssocTxBytes,
      needsTokenAssociation: !!tokenAssocTxBytes,
    });
  } catch (error) {
    console.error('User registration error:', error);
    return NextResponse.json(
      { error: 'Registration failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
