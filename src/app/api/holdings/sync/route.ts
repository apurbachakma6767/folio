import { NextRequest, NextResponse } from 'next/server';
import { getTokenRegistry } from '@/lib/token-registry';
import { verifyAuth, unauthorized } from '@/lib/auth';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

// POST /api/holdings/sync — reconcile brokerage holdings to on-chain HTS tokens
//
// When a user connects Plaid or has demo holdings, this endpoint ensures their
// Hedera account holds the corresponding HTS stock tokens. Mints any deficit
// from treasury so on-chain balance matches what the user sees.
//
// Testnet only — in production, tokenized securities come from Swarm.

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  if (!hederaConfigured) {
    return NextResponse.json({ synced: false, reason: 'hedera_not_configured' });
  }

  try {
    const { accountId, holdings } = await req.json() as {
      accountId: string;
      holdings: { symbol: string; shares: number }[];
    };

    if (!accountId || !holdings?.length) {
      return NextResponse.json({ error: 'accountId and holdings required' }, { status: 400 });
    }

    const { getTokenBalances, mintFungibleToken, transferToken, getOperatorId, grantKyc, unfreezeAccount } = await import('@/lib/hedera');
    const operatorId = getOperatorId().toString();
    const userBalances = await getTokenBalances(accountId);
    const registry = getTokenRegistry();
    const HTS_DECIMALS = 6;

    const results: { symbol: string; minted: number; transferred: number; error?: string }[] = [];

    for (const holding of holdings) {
      const entry = registry.find(
        (t) => t.symbol === holding.symbol && t.type === 'stock'
      );
      if (!entry) {
        results.push({ symbol: holding.symbol, minted: 0, transferred: 0, error: 'no_token_in_registry' });
        console.warn(`[sync] No token registry entry for ${holding.symbol} — check MOCK_${holding.symbol}_TOKEN_ID env var`);
        continue;
      }

      const tokenId = entry.tokenId;

      // Ensure KYC + unfreeze (idempotent — safe for already-provisioned users)
      try { await grantKyc(tokenId, accountId); } catch { /* already granted */ }
      try { await unfreezeAccount(tokenId, accountId); } catch { /* already unfrozen */ }

      const targetAmount = Math.floor(holding.shares * 10 ** HTS_DECIMALS);
      const currentBalance = userBalances.get(tokenId) ?? 0;

      if (currentBalance >= targetAmount) continue; // already has enough

      const deficit = targetAmount - currentBalance;
      try {
        await mintFungibleToken(tokenId, deficit);
        await transferToken(tokenId, operatorId, accountId, deficit);
        results.push({ symbol: holding.symbol, minted: deficit, transferred: deficit });
        console.log(`[sync] Minted ${deficit} ${holding.symbol} (${holding.shares} shares) to ${accountId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        results.push({ symbol: holding.symbol, minted: 0, transferred: 0, error: msg });
        console.error(`[sync] Failed to mint ${holding.symbol}:`, err);
      }
    }

    // Fund USDC from treasury if user has none
    const usdcId = process.env.USDC_TEST_TOKEN_ID;
    if (usdcId) {
      const usdcBalance = userBalances.get(usdcId) ?? 0;
      if (usdcBalance === 0) {
        try {
          const fundAmount = 500_000_000; // 500 USDC (6 decimals)
          await transferToken(usdcId, operatorId, accountId, fundAmount);
          console.log(`[sync] Funded 500 USDC to ${accountId}`);
        } catch (err) {
          console.error(`[sync] Failed to fund USDC:`, err);
        }
      }
    }

    return NextResponse.json({
      synced: true,
      results,
      registryTokens: registry.map((t) => `${t.symbol}=${t.tokenId}`),
    });
  } catch (error) {
    console.error('Holdings sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
