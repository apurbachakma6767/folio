import { NextRequest, NextResponse } from 'next/server';
import { getStockPrice } from '@/lib/price';
import { getVolatilityData } from '@/lib/volatility';
import { optimizeCollar, calculateOptimizedCollar } from '@/lib/ai-collar-optimizer';
import { verifyAuth, unauthorized } from '@/lib/auth';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

// ── Direct SDK treasury balance check (~200ms vs 5-10s agent loop) ──────

async function checkTreasuryBalance(
  requiredAmount: number
): Promise<{ feasible: boolean; treasuryBalance?: string }> {
  const { Client, PrivateKey, AccountId, AccountBalanceQuery } = await import('@hashgraph/sdk');

  const operatorId = process.env.HEDERA_OPERATOR_ID!;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY!;
  const usdcTokenId = process.env.USDC_TEST_TOKEN_ID;

  if (!usdcTokenId) {
    return { feasible: true }; // Can't check without token ID — assume OK
  }

  const client = Client.forTestnet();
  client.setOperator(
    AccountId.fromString(operatorId),
    PrivateKey.fromStringDer(operatorKey)
  );

  const balance = await new AccountBalanceQuery()
    .setAccountId(AccountId.fromString(operatorId))
    .execute(client);

  const tokenBalance = balance.tokens?._map?.get(usdcTokenId.toString());
  const usdcBalance = tokenBalance ? Number(tokenBalance) / 1e6 : 0;

  return {
    feasible: usdcBalance >= requiredAmount,
    treasuryBalance: `${usdcBalance.toFixed(2)} USDC`,
  };
}

// ── Batch collar calculation for all durations ──────────────────────────

const DURATIONS = [1, 2, 3] as const;

// Generate a plain-English one-liner for the spending flow UI.
// DESIGN.md: "One sentence, human language, actionable."
function generateOneLiner(
  symbol: string,
  changePercent: number,
  riskLevel: string,
  warnings: string[],
  volData?: Awaited<ReturnType<typeof getVolatilityData>>,
): string {
  // Check for earnings/event warnings first
  const earningsWarning = warnings.find(w => /earning/i.test(w));
  if (earningsWarning) {
    return `Heads up: ${symbol} has earnings coming up. You're covered either way.`;
  }

  // Bearish sentiment
  const putCallRatio = volData?.optionsChain?.putCallRatio;
  if (putCallRatio && putCallRatio > 1.5) {
    return `${symbol} is seeing some bearish sentiment. Your terms account for that.`;
  }

  // Volatile day
  if (Math.abs(changePercent) > 3) {
    return changePercent > 0
      ? `${symbol} is up ${changePercent.toFixed(1)}% today. Good time to lock in value.`
      : `${symbol} is down ${Math.abs(changePercent).toFixed(1)}% today. Your terms are adjusted for that.`;
  }

  // Default: steady conditions
  if (riskLevel === 'conservative') {
    return `Good time — ${symbol} has been steady. Conservative terms.`;
  }
  if (riskLevel === 'aggressive') {
    return `${symbol} is calm right now. You're getting tight terms.`;
  }
  return `Good time — ${symbol} has been steady this month.`;
}

// AI collar optimization endpoint — fetches price, volatility, and treasury
// balance in parallel, then computes collar params for all 3 durations at once.
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const { amount, symbol = 'TSLA', portfolioShares, riskPreference, previousCollars } = await req.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // ── Parallel fetch: price + volatility + treasury balance ──────────
    const [priceResult, volResult, balanceResult] = await Promise.allSettled([
      getStockPrice(symbol),
      getVolatilityData(symbol),
      hederaConfigured
        ? checkTreasuryBalance(amount)
        : Promise.resolve({ feasible: true } as { feasible: boolean; treasuryBalance?: string }),
    ]);

    if (priceResult.status === 'rejected') {
      throw new Error(`Failed to fetch stock price: ${priceResult.reason}`);
    }
    const priceData = priceResult.value;

    // Vol data is best-effort — optimizer has its own fallback
    const volData = volResult.status === 'fulfilled' ? volResult.value : undefined;

    // Balance check is non-blocking
    const agentInsight: { feasible: boolean; treasuryBalance?: string } =
      balanceResult.status === 'fulfilled'
        ? balanceResult.value
        : { feasible: true };

    if (balanceResult.status === 'rejected') {
      console.warn('[treasury] Balance check failed, continuing:', balanceResult.reason);
    }

    // ── Single AI/quantitative call (duration-agnostic) ─────────────
    const recommendation = await optimizeCollar(
      {
        symbol,
        stockPrice: priceData.price,
        changePercent: priceData.changePercent,
        spendAmount: amount,
        portfolioShares,
        userRiskPreference: riskPreference,
        previousCollars,
      },
      volData,
    );

    // Add treasury warning if needed
    if (!agentInsight.feasible) {
      recommendation.warnings = [
        ...(recommendation.warnings || []),
        'Treasury may have insufficient USDC for this advance',
      ];
    }

    // ── Generate plain-English AI one-liner for the UI ────────────────
    // DESIGN.md: "AI speaks like a financially savvy friend, not a Bloomberg terminal"
    const oneLiner = generateOneLiner(
      symbol,
      priceData.changePercent,
      recommendation.riskLevel,
      recommendation.warnings,
      volData,
    );

    // ── Compute collar for all 3 durations cheaply ──────────────────
    const durations: Record<number, {
      recommendation: { floorPct: number; capPct: number; durationMonths: number; confidence: number; riskLevel: string; reasoning: string; warnings: string[]; oneLiner: string };
      collar: { shares: number; floor: number; cap: number; advance: number; fee: number; expiryDate: string };
    }> = {};

    // The AI/quant optimizer returns floor/cap for ~1 month of risk.
    // Scale by sqrt(duration) so longer collars have proportionally wider ranges.
    const baseDuration = recommendation.durationMonths || 1;

    for (const months of DURATIONS) {
      const durationScale = Math.sqrt(months / baseDuration);
      const durationRec = {
        ...recommendation,
        durationMonths: months,
        floorPct: Math.min(0.30, recommendation.floorPct * durationScale),
        capPct: Math.min(0.50, recommendation.capPct * durationScale),
      };
      const collar = calculateOptimizedCollar(amount, priceData.price, durationRec);

      durations[months] = {
        recommendation: {
          floorPct: durationRec.floorPct,
          capPct: durationRec.capPct,
          durationMonths: months,
          confidence: durationRec.confidence,
          riskLevel: durationRec.riskLevel,
          reasoning: durationRec.reasoning,
          warnings: durationRec.warnings,
          oneLiner: months === (recommendation.durationMonths || 1)
            ? oneLiner
            : months > (recommendation.durationMonths || 1)
              ? `Longer loan, more flexibility. ${oneLiner}`
              : `Shorter loan, tighter terms. ${oneLiner}`,
        },
        collar: {
          shares: collar.shares,
          floor: collar.floor,
          cap: collar.cap,
          advance: collar.advance,
          fee: collar.fee,
          expiryDate: collar.expiryDate.toISOString(),
        },
      };
    }

    return NextResponse.json({
      durations,
      price: {
        symbol: priceData.symbol,
        price: priceData.price,
        change: priceData.change,
        changePercent: priceData.changePercent,
      },
      agent: agentInsight.treasuryBalance ? {
        feasible: agentInsight.feasible,
        treasuryBalance: agentInsight.treasuryBalance,
      } : undefined,
      // Backward compat: also include the default duration at top level
      recommendation: durations[recommendation.durationMonths]?.recommendation ?? durations[1].recommendation,
      collar: durations[recommendation.durationMonths]?.collar ?? durations[1].collar,
    });
  } catch (error) {
    console.error('AI optimization error:', error);
    return NextResponse.json(
      { error: 'Optimization failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
