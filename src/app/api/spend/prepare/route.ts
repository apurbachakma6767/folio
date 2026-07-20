import { NextRequest, NextResponse } from 'next/server';
import Long from 'long';
import { calculateCollar } from '@/lib/collar';
import { getStockPrice } from '@/lib/price';
import { getTokenIdForSymbol, hydrateTokenRegistryFromDb } from '@/lib/token-registry';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { assertSpendAllowed, assertVaultRequirement } from '@/lib/spend-guards';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const {
      amount,
      symbol = 'TSLA',
      durationMonths = 1,
      userAccountId,
    } = await req.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    if (!userAccountId) {
      return NextResponse.json({ error: 'userAccountId required' }, { status: 400 });
    }

    const guard = await assertSpendAllowed(amount, userAccountId);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    const priceData = await getStockPrice(symbol);
    const collar = calculateCollar(amount, priceData.price, durationMonths);

    let collateralLockTxBytes: string | undefined;
    let allowanceTxBytes: string | null = null;
    let vaultDepositTxBytes: string | undefined;
    let needsAllowanceSignature = false;
    let needsVaultDepositSignature = false;

    await hydrateTokenRegistryFromDb();
    const stockTokenId = getTokenIdForSymbol(symbol);
    if (hederaConfigured && stockTokenId) {
      const {
        prepareCollateralLock,
        getTokenBalances,
        isFolioVaultConfigured,
        getFolioVaultContractId,
        getFungibleTokenAllowance,
        prepareTokenAllowanceForVault,
        prepareVaultDeposit,
      } = await import('@/lib/hedera');

      const vaultOk = assertVaultRequirement(isFolioVaultConfigured());
      if (!vaultOk.ok) {
        return NextResponse.json({ error: vaultOk.error }, { status: vaultOk.status });
      }

      // Pre-flight: check if user actually has enough stock tokens to collateralize
      const userBalances = await getTokenBalances(userAccountId);
      const userStockBalance = userBalances.get(stockTokenId) ?? 0;

      if (userStockBalance < collar.sharesHts) {
        return NextResponse.json(
          { error: `Insufficient ${symbol} balance. You have ${userStockBalance} tokens but need ${collar.sharesHts} for collateral.` },
          { status: 400 }
        );
      }

      if (isFolioVaultConfigured()) {
        const vaultId = getFolioVaultContractId();
        const { getOperatorId } = await import('@/lib/hedera');
        const need = Long.fromNumber(collar.sharesHts);
        // Allowance is to operator (spender) for gasless approved pull into vault
        const current = await getFungibleTokenAllowance(
          userAccountId,
          getOperatorId().toString(),
          stockTokenId
        );
        // Gasless: user only signs allowance; operator pulls into vault after
        if (current.compare(need) < 0) {
          const txb = await prepareTokenAllowanceForVault(stockTokenId, userAccountId, vaultId, need);
          allowanceTxBytes = Buffer.from(txb).toString('base64');
          needsAllowanceSignature = true;
        }
        needsVaultDepositSignature = false;
      } else {
        const txBytes = await prepareCollateralLock(stockTokenId, userAccountId, collar.sharesHts);
        collateralLockTxBytes = Buffer.from(txBytes).toString('base64');
      }
    }

    const needsSignature = Boolean(
      collateralLockTxBytes || needsAllowanceSignature
    );

    return NextResponse.json({
      collar: {
        shares: collar.shares,
        sharesHts: collar.sharesHts,
        floor: collar.floor,
        cap: collar.cap,
        advance: collar.advance,
        advanceHts: collar.advanceHts,
        fee: collar.fee,
        expiryDate: collar.expiryDate.toISOString(),
      },
      collateralLockTxBytes,
      allowanceTxBytes,
      vaultDepositTxBytes,
      needsAllowanceSignature,
      needsVaultDepositSignature,
      needsSignature,
    });
  } catch (error) {
    console.error('Spend prepare error:', error);
    return NextResponse.json(
      { error: 'Failed to prepare spend', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
