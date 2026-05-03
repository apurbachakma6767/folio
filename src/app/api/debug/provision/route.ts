import { NextRequest, NextResponse } from 'next/server';
import { getTokenRegistry } from '@/lib/token-registry';
import { DEMO_HOLDINGS } from '@/lib/types';

// GET /api/debug/provision?accountId=0.0.XXX
// Diagnoses and fixes token provisioning for a specific account.
// Returns detailed step-by-step results showing exactly what fails.
// No auth required — testnet diagnostic only. Remove before production.

export async function GET(req: NextRequest) {

  const accountId = req.nextUrl.searchParams.get('accountId');
  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  }

  const steps: { step: string; status: string; detail?: string }[] = [];

  try {
    const { getTokenBalances, mintFungibleToken, transferToken, grantKyc, unfreezeAccount, getOperatorId } = await import('@/lib/hedera');
    const registry = getTokenRegistry();
    const operatorId = getOperatorId().toString();
    const HTS_DECIMALS = 6;

    // Step 1: Check current balances
    let userBalances: Map<string, number>;
    try {
      userBalances = await getTokenBalances(accountId);
      steps.push({
        step: 'getTokenBalances',
        status: 'ok',
        detail: JSON.stringify(Object.fromEntries(userBalances)),
      });
    } catch (err) {
      steps.push({ step: 'getTokenBalances', status: 'error', detail: String(err) });
      return NextResponse.json({ accountId, steps });
    }

    // Step 2: Check registry
    steps.push({
      step: 'tokenRegistry',
      status: 'ok',
      detail: registry.map((t) => `${t.symbol}=${t.tokenId}(${t.type})`).join(', '),
    });

    // Step 3: Try to provision each demo holding
    for (const holding of DEMO_HOLDINGS) {
      const entry = registry.find((t) => t.symbol === holding.symbol && t.type === 'stock');
      if (!entry) {
        steps.push({ step: `${holding.symbol}:lookup`, status: 'error', detail: 'no_token_in_registry' });
        continue;
      }

      const tokenId = entry.tokenId;
      const targetAmount = Math.floor(holding.shares * 10 ** HTS_DECIMALS);
      const currentBalance = userBalances.get(tokenId) ?? 0;
      steps.push({
        step: `${holding.symbol}:balance`,
        status: 'ok',
        detail: `current=${currentBalance}, target=${targetAmount}, deficit=${targetAmount - currentBalance}`,
      });

      if (currentBalance >= targetAmount) {
        steps.push({ step: `${holding.symbol}:provision`, status: 'skip', detail: 'already provisioned' });
        continue;
      }

      // Try KYC
      try {
        await grantKyc(tokenId, accountId);
        steps.push({ step: `${holding.symbol}:kyc`, status: 'ok' });
      } catch (err) {
        steps.push({ step: `${holding.symbol}:kyc`, status: 'warn', detail: String(err) });
      }

      // Try unfreeze
      try {
        await unfreezeAccount(tokenId, accountId);
        steps.push({ step: `${holding.symbol}:unfreeze`, status: 'ok' });
      } catch (err) {
        steps.push({ step: `${holding.symbol}:unfreeze`, status: 'warn', detail: String(err) });
      }

      // Try mint
      const deficit = targetAmount - currentBalance;
      try {
        const txId = await mintFungibleToken(tokenId, deficit);
        steps.push({ step: `${holding.symbol}:mint`, status: 'ok', detail: `minted ${deficit}, txId=${txId}` });
      } catch (err) {
        steps.push({ step: `${holding.symbol}:mint`, status: 'error', detail: String(err) });
        continue; // Skip transfer if mint failed
      }

      // Try transfer
      try {
        const txId = await transferToken(tokenId, operatorId, accountId, deficit);
        steps.push({ step: `${holding.symbol}:transfer`, status: 'ok', detail: `transferred ${deficit}, txId=${txId}` });
      } catch (err) {
        steps.push({ step: `${holding.symbol}:transfer`, status: 'error', detail: String(err) });
      }
    }

    // Step 4: USDC check
    const usdcId = process.env.USDC_TEST_TOKEN_ID;
    if (usdcId) {
      const usdcBalance = userBalances.get(usdcId) ?? 0;
      steps.push({ step: 'usdc:balance', status: 'ok', detail: `${usdcBalance}` });
    }

    // Step 5: Re-check balances after provisioning
    try {
      const afterBalances = await getTokenBalances(accountId);
      steps.push({
        step: 'finalBalances',
        status: 'ok',
        detail: JSON.stringify(Object.fromEntries(afterBalances)),
      });
    } catch (err) {
      steps.push({ step: 'finalBalances', status: 'error', detail: String(err) });
    }

    return NextResponse.json({ accountId, steps });
  } catch (error) {
    steps.push({ step: 'fatal', status: 'error', detail: String(error) });
    return NextResponse.json({ accountId, steps }, { status: 500 });
  }
}
