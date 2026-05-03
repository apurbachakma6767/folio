import { NextRequest, NextResponse } from 'next/server';
import { getStockPrice } from '@/lib/price';
import { addNote } from '@/lib/spend-notes';
import { issueVirtualCard } from '@/lib/lithic';
import { getTokenIdForSymbol } from '@/lib/token-registry';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { optimizeCollar, calculateOptimizedCollar } from '@/lib/ai-collar-optimizer';

// Plain-English AI one-liner for the confirmation screen
function generateExecuteOneLiner(symbol: string, changePercent: number, riskLevel: string, warnings: string[]): string {
  const hasEarnings = warnings.some(w => /earning/i.test(w));
  if (hasEarnings) return `Heads up: ${symbol} has earnings coming up. You're covered either way.`;
  if (Math.abs(changePercent) > 3) {
    return changePercent > 0
      ? `${symbol} is up ${changePercent.toFixed(1)}% today. Good time to lock in value.`
      : `${symbol} is down ${Math.abs(changePercent).toFixed(1)}% today. Your terms are adjusted for that.`;
  }
  if (riskLevel === 'conservative') return `${symbol} looks steady. Conservative terms applied.`;
  if (riskLevel === 'aggressive') return `${symbol} is calm right now. You're getting tight terms.`;
  return `${symbol} looks steady. Your shares should be fine.`;
}

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

const dynamicServerConfigured = !!(
  process.env.DYNAMIC_ENVIRONMENT_ID &&
  (process.env.DYNAMIC_AUTH_TOKEN || process.env.DYNAMIC_API_TOKEN || process.env.DYNAMIC_API_KEY) &&
  process.env.DYNAMIC_SERVER_WALLET_ID
);

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const {
      signedCollateralTxBytes,
      signedAllowanceTxBytes,
      signedVaultDepositTxBytes,
      amount,
      symbol = 'TSLA',
      durationMonths,  // optional — AI will recommend if not provided
      issueCard = false,
      recipientAccountId,
      recipientName: clientRecipientName,
      recipientEmail: clientRecipientEmail,
      userAccountId,
      portfolioShares,
      riskPreference,
      previousCollars,
    } = await req.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    if (!userAccountId) {
      return NextResponse.json({ error: 'userAccountId required' }, { status: 400 });
    }

    // Fetch stock price
    const priceData = await getStockPrice(symbol);

    // AI-optimized collar parameters
    const recommendation = await optimizeCollar({
      symbol,
      stockPrice: priceData.price,
      changePercent: priceData.changePercent,
      spendAmount: amount,
      portfolioShares,
      userRiskPreference: riskPreference,
      previousCollars,
    });

    // If user explicitly set duration, override AI recommendation
    if (durationMonths) {
      recommendation.durationMonths = durationMonths;
    }

    const collar = calculateOptimizedCollar(amount, priceData.price, recommendation);

    let txId = '';

    const stockTokenId = getTokenIdForSymbol(symbol);
    if (hederaConfigured && stockTokenId) {
      const hedera = await import('@/lib/hedera');
      const {
        submitSignedTransaction,
        submitClientSignedTransaction,
        isFolioVaultConfigured,
        transferToken,
        mintFungibleToken,
        mintSpendNoteWithIpfs,
        transferNft,
        getOperatorId,
        submitAuditMessage,
        getTokenBalances,
      } = hedera;
      const operatorId = getOperatorId().toString();
      const usdcTokenId = process.env.USDC_TEST_TOKEN_ID!;
      const noteTokenId = process.env.SPEND_NOTE_TOKEN_ID!;

      if (isFolioVaultConfigured()) {
        if (!signedVaultDepositTxBytes) {
          return NextResponse.json(
            { error: 'Vault deposit signature is required. Please try again.' },
            { status: 400 }
          );
        }
        if (signedAllowanceTxBytes) {
          const allowBytes = Uint8Array.from(Buffer.from(signedAllowanceTxBytes, 'base64'));
          await submitClientSignedTransaction(allowBytes);
        }
        const depBytes = Uint8Array.from(Buffer.from(signedVaultDepositTxBytes, 'base64'));
        txId = await submitClientSignedTransaction(depBytes);
      } else {
        if (!signedCollateralTxBytes) {
          return NextResponse.json(
            { error: 'Collateral lock signature is required. Please try again.' },
            { status: 400 }
          );
        }
        const bytes = Uint8Array.from(Buffer.from(signedCollateralTxBytes, 'base64'));
        txId = await submitSignedTransaction(bytes);
      }

      // Pre-flight: auto-mint USDC if treasury is low (testnet only)
      const treasuryBalances = await getTokenBalances(operatorId);
      const treasuryUsdc = treasuryBalances.get(usdcTokenId) ?? 0;
      if (treasuryUsdc < collar.advanceHts) {
        const deficit = collar.advanceHts - treasuryUsdc;
        // Mint deficit + 10,000 USDC buffer so we don't mint on every spend
        const mintAmount = deficit + 10_000_000_000;
        await mintFungibleToken(usdcTokenId, mintAmount);
        console.log(`[treasury] Auto-minted ${mintAmount / 1_000_000} USDC to cover advance`);
      }

      // Transfer USDC advance (operator-only, no user signature needed)
      const advanceTarget = recipientAccountId || userAccountId;
      await transferToken(usdcTokenId, operatorId, advanceTarget, collar.advanceHts);

      // Mint spend note NFT and transfer to user (operator-only)
      const now = new Date().toISOString();
      const { serial } = await mintSpendNoteWithIpfs({
        name: `Spend Note #${Date.now()}`,
        asset: `MOCK-${symbol}`,
        shares_collared: collar.sharesHts,
        stock_price_at_spend: Math.floor(priceData.price * 1e6),
        collar_floor: Math.floor(collar.floor * 1e6),
        collar_cap: Math.floor(collar.cap * 1e6),
        advance_usdc: collar.advanceHts,
        platform_spread: 0,
        created_at: now,
        expires_at: collar.expiryDate.toISOString(),
        status: 'active',
      });
      await transferNft(noteTokenId, serial, operatorId, userAccountId);

      // Log to HCS audit trail (non-blocking)
      const auditTopicId = process.env.AUDIT_TOPIC_ID;
      if (auditTopicId) {
        submitAuditMessage(auditTopicId, {
          type: 'SPEND_NOTE_CREATED',
          serial,
          txId,
          symbol,
          amount,
          collar: {
            floorPct: collar.floorPct,
            capPct: collar.capPct,
            floor: collar.floor,
            cap: collar.cap,
            durationMonths: collar.durationMonths,
          },
          ai: {
            confidence: recommendation.confidence,
            riskLevel: recommendation.riskLevel,
            reasoning: recommendation.reasoning,
          },
          userAccountId,
          recipientAccountId: advanceTarget,
          timestamp: now,
        }).catch((e: unknown) => console.error('HCS audit log failed:', e));
      }
    }

    // Oracle maintenance via Dynamic server wallet (pre-funded on Base Sepolia)
    // Sends a small USDC fee to fund Chainlink oracle gas costs.
    // If oracle data is stale, also pushes a fresh update to CollarOracle.
    let oracleFeeTxHash: string | undefined;
    let oracleUpdateTxHash: string | undefined;

    if (dynamicServerConfigured) {
      try {
        const { serverWalletSignTransaction } = await import('@/lib/dynamic-server');
        const { encodeFunctionData } = await import('viem');
        const { getChainlinkCollar } = await import('@/lib/chainlink');
        const serverWalletId = process.env.DYNAMIC_SERVER_WALLET_ID!;

        // Folio MockUSDC (fUSDC) on Base Sepolia — deployed via DeployMockUSDC.s.sol
        const USDC_BASE_SEPOLIA = (process.env.MOCK_USDC_BASE_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`;
        const COLLAR_ORACLE = (process.env.COLLAR_ORACLE_ADDRESS || '0x00A3cF51bA20eA6f1754BaFcecA6d144e3d1D00f') as `0x${string}`;
        const ORACLE_FEE_RECIPIENT = COLLAR_ORACLE; // fees accrue to the oracle contract address

        // 1. Send oracle maintenance fee (0.10 USDC per spend — covers gas for oracle updates)
        const oracleFeeUsdc = BigInt(100_000); // 0.10 USDC (6 decimals)
        const feeData = encodeFunctionData({
          abi: [{ name: 'transfer', type: 'function', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }],
          functionName: 'transfer',
          args: [ORACLE_FEE_RECIPIENT, oracleFeeUsdc],
        });
        oracleFeeTxHash = await serverWalletSignTransaction(serverWalletId, {
          to: USDC_BASE_SEPOLIA,
          value: '0',
          data: feeData,
          chainId: 84532,
        });

        // 2. If oracle data is stale (>1 hour), push a fresh update from the server wallet
        //    This is a fallback — the CRE workflow is the primary update path via DON consensus
        const existingCollar = await getChainlinkCollar(symbol);
        const isStale = !existingCollar || (Date.now() - existingCollar.updatedAt.getTime()) > 3600_000;

        if (isStale) {
          const updateData = encodeFunctionData({
            abi: [{ name: 'updateCollars', type: 'function', inputs: [{ name: 'symbols', type: 'string[]' }, { name: 'prices', type: 'uint256[]' }, { name: 'floors', type: 'uint256[]' }, { name: 'caps', type: 'uint256[]' }, { name: 'volatilities', type: 'uint256[]' }], outputs: [] }],
            functionName: 'updateCollars',
            args: [
              [symbol],
              [BigInt(Math.round(priceData.price * 1e8))],
              [BigInt(Math.round(collar.floor * 1e8))],
              [BigInt(Math.round(collar.cap * 1e8))],
              [BigInt(Math.round(recommendation.confidence * 10000))], // confidence as volatility proxy in bps
            ],
          });
          oracleUpdateTxHash = await serverWalletSignTransaction(serverWalletId, {
            to: COLLAR_ORACLE,
            value: '0',
            data: updateData,
            chainId: 84532,
          });
        }
      } catch (evmErr) {
        // Oracle maintenance is non-blocking — Hedera collateral is the primary flow
        console.error('Oracle maintenance failed (non-blocking):', evmErr);
      }
    }

    // Issue virtual card via Lithic
    let cardPan: string | undefined;
    let cardCvv: string | undefined;
    let cardExpMonth: string | undefined;
    let cardExpYear: string | undefined;
    let cardToken: string | undefined;
    let cardLastFour: string | undefined;

    let cardState: string | undefined;
    let cardSpendLimit: number | undefined;

    if (issueCard) {
      const amountCents = Math.round(amount * 100);
      const result = await issueVirtualCard(amountCents);
      if (result.success && result.card) {
        cardPan = result.card.pan;
        cardCvv = result.card.cvv;
        cardExpMonth = result.card.expMonth;
        cardExpYear = result.card.expYear;
        cardToken = result.card.token;
        cardLastFour = result.card.lastFour;
        cardState = result.card.state;
        cardSpendLimit = result.card.spendLimit;
      }
    }

    const note = await addNote({
      symbol,
      serial: hederaConfigured ? 1 : Date.now(),
      recipient: recipientAccountId || userAccountId || 'unknown',
      recipientName: clientRecipientName || (issueCard ? 'Virtual Card' : 'Unknown'),
      amount: collar.advance,
      shares: collar.shares,
      sharesHts: collar.sharesHts,
      stockPrice: priceData.price,
      floor: collar.floor,
      cap: collar.cap,
      durationMonths: collar.durationMonths,
      expiryDate: collar.expiryDate.toISOString(),
      status: 'active',
      txId,
      createdAt: new Date().toISOString(),
      userAccountId: userAccountId || '',
      recipientAccountId: recipientAccountId || undefined,
      recipientEmail: clientRecipientEmail || undefined,
      cardToken,
      cardLastFour,
      cardState: (cardState as 'OPEN' | 'PAUSED' | 'CLOSED') || undefined,
      cardSpendLimit,
    });

    return NextResponse.json({
      success: true,
      note,
      collar: {
        shares: collar.shares,
        floor: collar.floor,
        cap: collar.cap,
        advance: collar.advance,
        fee: collar.fee,
        expiryDate: collar.expiryDate.toISOString(),
        floorPct: collar.floorPct,
        capPct: collar.capPct,
      },
      ai: {
        confidence: recommendation.confidence,
        riskLevel: recommendation.riskLevel,
        reasoning: recommendation.reasoning,
        warnings: recommendation.warnings,
        oneLiner: generateExecuteOneLiner(symbol, priceData.changePercent, recommendation.riskLevel, recommendation.warnings),
      },
      txId,
      card: cardPan ? {
        pan: cardPan,
        cvv: cardCvv,
        expMonth: cardExpMonth,
        expYear: cardExpYear,
        lastFour: cardLastFour,
        token: cardToken,
      } : undefined,
      oracle: (oracleFeeTxHash || oracleUpdateTxHash) ? {
        feeTxHash: oracleFeeTxHash,
        updateTxHash: oracleUpdateTxHash,
        feeUsdc: 0.10,
        chain: 'Base Sepolia',
        chainId: 84532,
      } : undefined,
    });
  } catch (error) {
    console.error('Spend execute error:', error);
    return NextResponse.json(
      { error: 'Spend transaction failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
