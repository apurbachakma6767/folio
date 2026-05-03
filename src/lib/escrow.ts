// Escrow executor — orchestrates Hedera transfers, Supabase state, and HCS audit

import { getNote, settleNote } from './spend-notes';
import { calculateSettlement, calculateRepayment, type SettlementResult } from './settlement';
import { getStockPrice } from './price';
import { getTokenIdForSymbol } from './token-registry';

const hederaConfigured = !!(
  process.env.HEDERA_OPERATOR_ID &&
  process.env.HEDERA_OPERATOR_KEY
);

/**
 * Execute early repayment: user pays back USDC, gets all collateral returned.
 */
export async function executeRepayment(
  noteId: number,
  userAccountId: string,
  signedRepayTxBytes?: string
): Promise<SettlementResult> {
  const note = await getNote(noteId);
  if (!note) throw new Error(`Note ${noteId} not found`);
  if (note.status !== 'active') throw new Error(`Note ${noteId} is already ${note.status}`);
  if (note.userAccountId !== userAccountId) throw new Error('Unauthorized: account mismatch');

  const result = calculateRepayment(note);

  if (hederaConfigured) {
    const {
      transferToken,
      getOperatorId,
      submitSignedTransaction,
      submitAuditMessage,
      isFolioVaultConfigured,
      getFolioVaultContractId,
      executeVaultRelease,
    } = await import('./hedera');
    const operatorId = getOperatorId().toString();
    const stockTokenId = getTokenIdForSymbol(note.symbol.replace('MOCK-', ''));

    // Return collateral shares FIRST, before taking USDC payment
    // This ordering protects the user: if share return fails, USDC is not taken
    if (stockTokenId) {
      if (isFolioVaultConfigured()) {
        await executeVaultRelease(getFolioVaultContractId(), stockTokenId, userAccountId, note.sharesHts);
      } else {
        await transferToken(stockTokenId, operatorId, userAccountId, note.sharesHts);
      }
    }

    // Submit user-signed USDC repayment (user → operator)
    if (signedRepayTxBytes) {
      const bytes = Uint8Array.from(Buffer.from(signedRepayTxBytes, 'base64'));
      await submitSignedTransaction(bytes);
    }

    // Update Supabase
    const priceData = await getStockPrice(note.symbol.replace('MOCK-', ''));
    await settleNote(noteId, {
      status: 'repaid',
      settlementTxId: `repay-${Date.now()}`,
      settlementPrice: priceData.price,
      settlementSharesReturned: note.sharesHts,
    });

    // HCS audit (non-blocking)
    const auditTopicId = process.env.AUDIT_TOPIC_ID;
    if (auditTopicId) {
      submitAuditMessage(auditTopicId, {
        type: 'COLLAR_REPAID',
        noteId,
        symbol: note.symbol,
        amount: note.amount,
        sharesReturned: note.shares,
        userAccountId,
        timestamp: new Date().toISOString(),
      }).catch((e: unknown) => console.error('HCS audit log failed:', e));
    }
  } else {
    // Demo mode — just update status
    await settleNote(noteId, {
      status: 'repaid',
      settlementTxId: `demo-repay-${Date.now()}`,
      settlementPrice: note.stockPrice,
      settlementSharesReturned: note.sharesHts,
    });
  }

  return result;
}

/**
 * Execute settlement for an expired collar.
 * Called by the cron job for each expired active note.
 */
export async function executeExpiredSettlement(
  noteId: number
): Promise<SettlementResult> {
  const note = await getNote(noteId);
  if (!note) throw new Error(`Note ${noteId} not found`);
  if (note.status !== 'active') throw new Error(`Note ${noteId} is already ${note.status}`);

  const now = new Date();
  if (new Date(note.expiryDate) > now) {
    throw new Error(`Note ${noteId} has not expired yet (expires ${note.expiryDate})`);
  }

  // Get current stock price for settlement math
  const symbol = note.symbol.replace('MOCK-', '');
  const priceData = await getStockPrice(symbol);
  const result = calculateSettlement({ note, currentPrice: priceData.price });

  if (hederaConfigured) {
    const {
      transferToken,
      getOperatorId,
      submitAuditMessage,
      isFolioVaultConfigured,
      getFolioVaultContractId,
      executeVaultRelease,
    } = await import('./hedera');
    const stockTokenId = getTokenIdForSymbol(symbol);

    // Return remaining shares to user (if any)
    if (result.sharesToReturnHts > 0 && stockTokenId) {
      if (isFolioVaultConfigured()) {
        await executeVaultRelease(
          getFolioVaultContractId(),
          stockTokenId,
          note.userAccountId,
          result.sharesToReturnHts
        );
      } else {
        const operatorId = getOperatorId().toString();
        await transferToken(stockTokenId, operatorId, note.userAccountId, result.sharesToReturnHts);
      }
    }

    // Update Supabase
    await settleNote(noteId, {
      status: result.outcome,
      settlementTxId: `settle-${Date.now()}`,
      settlementPrice: priceData.price,
      settlementSharesReturned: result.sharesToReturnHts,
    });

    // HCS audit (non-blocking)
    const auditTopicId = process.env.AUDIT_TOPIC_ID;
    if (auditTopicId) {
      const auditType = result.outcome === 'liquidated' ? 'COLLAR_LIQUIDATED' : 'COLLAR_SETTLED';
      submitAuditMessage(auditTopicId, {
        type: auditType,
        noteId,
        symbol: note.symbol,
        amount: note.amount,
        settlementPrice: priceData.price,
        floor: note.floor,
        cap: note.cap,
        sharesReturned: result.sharesToReturnHts / 1e6,
        outcome: result.outcome,
        reason: result.reason,
        userAccountId: note.userAccountId,
        timestamp: new Date().toISOString(),
      }).catch((e: unknown) => console.error('HCS audit log failed:', e));
    }
  } else {
    // Demo mode
    await settleNote(noteId, {
      status: result.outcome,
      settlementTxId: `demo-settle-${Date.now()}`,
      settlementPrice: priceData.price,
      settlementSharesReturned: result.sharesToReturnHts,
    });
  }

  return result;
}
