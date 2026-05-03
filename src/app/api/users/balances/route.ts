import { NextRequest, NextResponse } from 'next/server';
import { getTokenRegistry } from '@/lib/token-registry';
import { SYMBOL_GRADIENTS, DEFAULT_GRADIENT } from '@/lib/types';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getNotes } from '@/lib/spend-notes';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  const accountId = req.nextUrl.searchParams.get('accountId');

  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  }

  if (!hederaConfigured) {
    return NextResponse.json({ holdings: [] });
  }

  try {
    const { getTokenBalances, transferToken } = await import('@/lib/hedera');
    const balances = await getTokenBalances(accountId);
    const registry = getTokenRegistry();

    // Auto-fund: if user has < 100 USDC, top up from treasury (demo mode)
    const usdcId = process.env.USDC_TEST_TOKEN_ID;
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    if (usdcId && operatorId && accountId !== operatorId) {
      const usdcEntry = registry.find((t) => t.tokenId === usdcId);
      const rawUsdcBalance = balances.get(usdcId) ?? 0;
      const usdcBalance = usdcEntry ? rawUsdcBalance / 10 ** usdcEntry.decimals : 0;
      if (usdcBalance < 100) {
        try {
          const fundAmount = 500_000_000; // 500 USDC (6 decimals)
          // Check treasury has enough before auto-funding
          const treasuryBalances = await getTokenBalances(operatorId);
          const treasuryUsdc = treasuryBalances.get(usdcId) ?? 0;
          if (treasuryUsdc < fundAmount) {
            console.warn(`Auto-fund skipped: treasury USDC balance (${treasuryUsdc}) < fund amount (${fundAmount})`);
          } else {
            await transferToken(usdcId, operatorId, accountId, fundAmount);
            // Re-fetch balances after funding
            const updated = await getTokenBalances(accountId);
            balances.clear();
            updated.forEach((v, k) => balances.set(k, v));
          }
        } catch (e) {
          console.error('Auto-fund USDC failed:', e);
        }
      }
    }

    const tokenMap = new Map(registry.map((t) => [t.tokenId, t]));

    // Fetch active card notes to split USDC into liquid vs cards
    let activeCardTotal = 0;
    let activeCardCount = 0;
    try {
      const notes = await getNotes(accountId);
      for (const note of notes) {
        if (note.status === 'active' && note.cardToken) {
          activeCardTotal += note.amount;
          activeCardCount++;
        }
      }
    } catch { /* spend_notes query failed, show all as USDC */ }

    const holdings = Array.from(balances.entries())
      .filter(([tokenId]) => {
        const entry = tokenMap.get(tokenId);
        return entry && entry.type === 'crypto';
      })
      .flatMap(([tokenId, rawBalance]) => {
        const entry = tokenMap.get(tokenId)!;
        const shares = rawBalance / 10 ** entry.decimals;
        const isCrypto = entry.type === 'crypto';

        // Split USDC into liquid balance and active cards
        if (entry.symbol === 'USDC' && activeCardTotal > 0) {
          const liquidUsdc = shares - activeCardTotal;
          const items = [];
          if (liquidUsdc > 0) {
            items.push({
              symbol: 'USDC',
              name: 'USD Coin',
              shares: liquidUsdc,
              icon: '$',
              gradient: 'linear-gradient(135deg, #2775CA, #1A5FB4)',
              type: entry.type,
            });
          }
          items.push({
            symbol: 'CARDS',
            name: `Virtual Cards (${activeCardCount})`,
            shares: activeCardTotal,
            icon: '💳',
            gradient: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
            type: 'crypto' as const,
          });
          return items;
        }

        return [{
          symbol: entry.symbol,
          name: entry.name,
          shares: isCrypto ? shares : Math.floor(shares),
          icon: entry.symbol === 'USDC' ? '$' : entry.symbol[0],
          gradient: SYMBOL_GRADIENTS[entry.symbol] || (isCrypto ? 'linear-gradient(135deg, #2775CA, #1A5FB4)' : DEFAULT_GRADIENT),
          type: entry.type,
        }];
      })
      .filter((h) => h.shares > 0);

    return NextResponse.json({ holdings });
  } catch (error) {
    console.error('User balances error:', error);
    return NextResponse.json({ holdings: [] }, { status: 500 });
  }
}
