import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getUser } from '@/lib/user-registry';
import { createApplication, getLatestApplication } from '@/lib/card-applications';
import { getNotes } from '@/lib/spend-notes';
import { getTokenRegistry } from '@/lib/token-registry';
import { getStockPrice } from '@/lib/price';
import { isMainnet } from '@/lib/network';

const MIN_PORTFOLIO_USD = 1000;
const MIN_TX_VOLUME_90D = 50; // soft activity signal

async function computeEligibility(accountId: string) {
  let portfolioValueUsd = 0;
  try {
    const { getTokenBalances } = await import('@/lib/hedera');
    const balances = await getTokenBalances(accountId);
    const registry = getTokenRegistry();
    for (const entry of registry.filter((t) => t.type === 'stock')) {
      const raw = balances.get(entry.tokenId) ?? 0;
      const shares = raw / 10 ** entry.decimals;
      if (shares <= 0) continue;
      try {
        const p = await getStockPrice(entry.symbol);
        portfolioValueUsd += shares * p.price;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* hedera optional for checklist */
  }

  let txVolume90dUsd = 0;
  try {
    const notes = await getNotes(accountId);
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    for (const n of notes) {
      if (new Date(n.createdAt).getTime() >= cutoff) {
        txVolume90dUsd += Number(n.amount) || 0;
      }
    }
  } catch {
    /* */
  }

  return {
    portfolioValueUsd,
    txVolume90dUsd,
    checklistPortfolioOk: portfolioValueUsd >= MIN_PORTFOLIO_USD,
    checklistActivityOk: txVolume90dUsd >= MIN_TX_VOLUME_90D,
    minPortfolioUsd: MIN_PORTFOLIO_USD,
    minTxVolume90dUsd: MIN_TX_VOLUME_90D,
  };
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  const user = await getUser(auth.email);
  if (!user?.hederaAccountId) {
    return NextResponse.json({ error: 'No wallet' }, { status: 400 });
  }

  const eligibility = await computeEligibility(user.hederaAccountId);
  let application = null;
  try {
    application = await getLatestApplication(auth.email);
  } catch (e) {
    console.warn('[cards/apply GET]', e);
  }

  return NextResponse.json({
    mode: isMainnet() ? 'apply' : 'demo',
    eligibility,
    application,
  });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const user = await getUser(auth.email);
    if (!user?.hederaAccountId) {
      return NextResponse.json({ error: 'No wallet' }, { status: 400 });
    }

    const body = await req.json();
    const fullName = String(body.fullName || '').trim();
    if (!fullName || fullName.length < 2) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }

    const eligibility = await computeEligibility(user.hederaAccountId);
    if (!eligibility.checklistPortfolioOk || !eligibility.checklistActivityOk) {
      return NextResponse.json(
        {
          error: 'Eligibility checklist not met yet',
          eligibility,
        },
        { status: 400 }
      );
    }

    const existing = await getLatestApplication(auth.email);
    if (existing && ['submitted', 'under_review', 'approved'].includes(existing.status)) {
      return NextResponse.json({
        application: existing,
        message: 'You already have an application in progress.',
      });
    }

    const application = await createApplication({
      userEmail: auth.email,
      userAccountId: user.hederaAccountId,
      fullName,
      phone: body.phone,
      country: body.country,
      city: body.city,
      employmentStatus: body.employmentStatus,
      monthlyIncomeUsd: body.monthlyIncomeUsd != null ? Number(body.monthlyIncomeUsd) : undefined,
      portfolioValueUsd: eligibility.portfolioValueUsd,
      txVolume90dUsd: eligibility.txVolume90dUsd,
      checklistPortfolioOk: eligibility.checklistPortfolioOk,
      checklistActivityOk: eligibility.checklistActivityOk,
    });

    return NextResponse.json({
      success: true,
      application,
      message: 'Application submitted. We will review it and get back to you.',
    });
  } catch (error) {
    console.error('[cards/apply POST]', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to submit. Ensure card_applications table exists (run migration).',
      },
      { status: 500 }
    );
  }
}
