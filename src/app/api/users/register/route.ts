import { NextRequest, NextResponse } from 'next/server';
import { getUser, registerUser } from '@/lib/user-registry';
import { getTokenIdForSymbol } from '@/lib/token-registry';
import { verifyAuth, unauthorized } from '@/lib/auth';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

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

    // Check if user already exists
    const existing = await getUser(email);
    if (existing) {
      // For existing users, check if they need provisioning (interrupted registration)
      // Skip if they already have stock tokens on-chain
      if (hederaConfigured && existing.hederaAccountId && !existing.hederaAccountId.startsWith('0.0.1')) {
        try {
          const { prepareTokenAssociation, getTokenBalances } = await import('@/lib/hedera');

          // Check if user already has stock tokens — if so, skip re-provisioning
          const balances = await getTokenBalances(existing.hederaAccountId);
          const tslaId = getTokenIdForSymbol('TSLA');
          const hasTokens = tslaId && (balances.get(tslaId) ?? 0) > 0;

          if (!hasTokens) {
            const tokenIds = ['TSLA', 'AAPL']
              .map(getTokenIdForSymbol)
              .filter(Boolean) as string[];
            const usdcId = process.env.USDC_TEST_TOKEN_ID;
            const noteId = process.env.SPEND_NOTE_TOKEN_ID;
            if (usdcId) tokenIds.push(usdcId);
            if (noteId) tokenIds.push(noteId);

            if (tokenIds.length > 0) {
              const txBytes = await prepareTokenAssociation(existing.hederaAccountId, tokenIds);
              const tokenAssocTxBytes = Buffer.from(txBytes).toString('base64');
              return NextResponse.json({
                user: existing,
                needsTokenAssociation: true,
                tokenAssocTxBytes,
              });
            }
          }
        } catch (err) {
          console.log('[register] Could not check/prepare token assoc for existing user:', err instanceof Error ? err.message : err);
        }
      }
      return NextResponse.json({ user: existing });
    }

    let hederaAccountId = `0.0.${Date.now()}`; // Demo fallback
    let tokenAssocTxBytes: string | undefined;

    if (hederaConfigured) {
      const { createAccountWithPublicKey, prepareTokenAssociation } = await import('@/lib/hedera');
      hederaAccountId = await createAccountWithPublicKey(publicKey);

      // Prepare unsigned token association for client to sign
      const tokenIds = ['TSLA', 'AAPL']
        .map(getTokenIdForSymbol)
        .filter(Boolean) as string[];

      const usdcId = process.env.USDC_TEST_TOKEN_ID;
      const noteId = process.env.SPEND_NOTE_TOKEN_ID;
      if (usdcId) tokenIds.push(usdcId);
      if (noteId) tokenIds.push(noteId);

      if (tokenIds.length > 0) {
        const txBytes = await prepareTokenAssociation(hederaAccountId, tokenIds);
        tokenAssocTxBytes = Buffer.from(txBytes).toString('base64');
      }
    }

    const user = await registerUser(email, name || '', hederaAccountId, publicKey);

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
