import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/user-registry';
import { getTokenIdForSymbol } from '@/lib/token-registry';
import { DEMO_HOLDINGS } from '@/lib/types';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { allowAutoFundUsdc, allowDemoMintStock, getUsdcTokenId } from '@/lib/network';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const { email, signedTxBytes } = await req.json();

    if (!email || !signedTxBytes) {
      return NextResponse.json(
        { error: 'email and signedTxBytes required' },
        { status: 400 }
      );
    }

    const user = await getUser(email);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!hederaConfigured) {
      return NextResponse.json({ success: true, user });
    }

    const { submitSignedTransaction, transferToken, mintFungibleToken, grantKyc, unfreezeAccount, getOperatorId, getTokenBalances } = await import('@/lib/hedera');

    // Decode base64 → Uint8Array
    const bytes = Uint8Array.from(Buffer.from(signedTxBytes, 'base64'));

    // Submit the client-signed token association (server adds operator co-signature)
    // Idempotent: if tokens are already associated, catch and continue
    console.log(`[register/complete] Submitting token association for ${user.hederaAccountId}...`);
    try {
      await submitSignedTransaction(bytes);
      console.log(`[register/complete] Token association succeeded for ${user.hederaAccountId}`);
    } catch (assocErr) {
      const msg = assocErr instanceof Error ? assocErr.message : String(assocErr);
      if (msg.includes('TOKEN_ALREADY_ASSOCIATED') || msg.includes('ALREADY_ASSOCIATED')) {
        console.log(`[register/complete] Tokens already associated for ${user.hederaAccountId}, continuing to provision...`);
      } else {
        throw assocErr; // Re-throw unexpected errors
      }
    }

    // Registration only associates USDC + Spend Note. Equity KYC/associate happens on Trade/Spend.
    // Optional demo equity mint (OFF on mainnet/production by default).
    const operatorId = getOperatorId().toString();
    const HTS_DECIMALS = 6;
    const userBalances = await getTokenBalances(user.hederaAccountId);
    if (allowDemoMintStock()) {
      for (const holding of DEMO_HOLDINGS) {
        const tokenId = getTokenIdForSymbol(holding.symbol);
        if (tokenId) {
          try { await grantKyc(tokenId, user.hederaAccountId); } catch { /* already granted */ }
          try { await unfreezeAccount(tokenId, user.hederaAccountId); } catch { /* already unfrozen */ }
          const targetAmount = Math.floor(holding.shares * 10 ** HTS_DECIMALS);
          const currentBalance = userBalances.get(tokenId) ?? 0;
          if (currentBalance >= targetAmount) {
            console.log(`[register/complete] ${holding.symbol} already has ${currentBalance} >= ${targetAmount}, skipping`);
            continue;
          }
          const deficit = targetAmount - currentBalance;
          try {
            await mintFungibleToken(tokenId, deficit);
            await transferToken(tokenId, operatorId, user.hederaAccountId, deficit);
            console.log(`[register/complete] Minted ${deficit} ${holding.symbol} (deficit) to ${user.hederaAccountId}`);
          } catch (err) {
            console.error(`[register/complete] Failed to mint ${holding.symbol}:`, err);
          }
        }
      }
    } else {
      console.log('[register/complete] Demo stock mint disabled — user starts with 0 equity HTS');
    }

    // Free USDC airdrop — testnet only (never on mainnet with real Circle USDC)
    const usdcId = getUsdcTokenId();
    if (allowAutoFundUsdc() && usdcId) {
      const usdcBalance = userBalances.get(usdcId) ?? 0;
      if (usdcBalance === 0) {
        const fundAmount = 500_000_000; // 500 USDC (6 decimals)
        try {
          await transferToken(usdcId, operatorId, user.hederaAccountId, fundAmount);
        } catch (err) {
          console.error(`[register/complete] Failed to fund USDC:`, err);
        }
      }
    }

    console.log(`[register/complete] ✅ All done for ${user.hederaAccountId}`);
    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error('[register/complete] ❌ Error:', error);
    return NextResponse.json(
      { error: 'Token association failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
