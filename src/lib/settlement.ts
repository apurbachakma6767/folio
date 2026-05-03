// Settlement math — pure functions, no side effects

import type { SpendNote } from './spend-notes';

export interface SettlementInput {
  note: SpendNote;
  currentPrice: number;
}

export interface SettlementResult {
  outcome: 'repaid' | 'settled' | 'liquidated';
  sharesToReturnHts: number;
  reason: string;
}

const HTS_DECIMALS = 1e6;

/**
 * Calculate settlement for an expired collar.
 *
 * The operator already holds the collateral (transferred during spend).
 * This function determines how many shares (if any) go back to the user.
 */
export function calculateSettlement(input: SettlementInput): SettlementResult {
  const { note, currentPrice } = input;

  // Below floor — full liquidation, operator keeps all collateral
  if (currentPrice < note.floor) {
    return {
      outcome: 'liquidated',
      sharesToReturnHts: 0,
      reason: `Stock price ($${currentPrice.toFixed(2)}) fell below collar floor ($${note.floor.toFixed(2)}). All ${note.shares.toFixed(4)} shares liquidated to cover the $${note.amount.toFixed(2)} advance.`,
    };
  }

  // Above cap — settle at cap price (operator's upside)
  // Within range — settle at current price
  const settlePrice = currentPrice > note.cap ? note.cap : currentPrice;

  const sharesToCover = note.amount / settlePrice;
  const sharesToCoverHts = Math.ceil(sharesToCover * HTS_DECIMALS);

  // If the advance requires more shares than collateral, liquidate everything
  if (sharesToCoverHts >= note.sharesHts) {
    return {
      outcome: 'liquidated',
      sharesToReturnHts: 0,
      reason: `Advance of $${note.amount.toFixed(2)} requires ${sharesToCover.toFixed(4)} shares at $${settlePrice.toFixed(2)}, exceeding collateral of ${note.shares.toFixed(4)} shares.`,
    };
  }

  const sharesToReturnHts = note.sharesHts - sharesToCoverHts;
  const sharesToReturn = sharesToReturnHts / HTS_DECIMALS;

  const priceNote = currentPrice > note.cap
    ? ` (capped at $${note.cap.toFixed(2)}, market $${currentPrice.toFixed(2)})`
    : ` at $${currentPrice.toFixed(2)}`;

  return {
    outcome: 'settled',
    sharesToReturnHts,
    reason: `Settled${priceNote}. ${(sharesToCover).toFixed(4)} shares cover the $${note.amount.toFixed(2)} advance. ${sharesToReturn.toFixed(4)} shares returned to user.`,
  };
}

/**
 * Calculate settlement for early repayment.
 * User pays back the full advance, all shares returned.
 */
export function calculateRepayment(note: SpendNote): SettlementResult {
  return {
    outcome: 'repaid',
    sharesToReturnHts: note.sharesHts,
    reason: `User repaid $${note.amount.toFixed(2)} advance. All ${note.shares.toFixed(4)} collateral shares returned.`,
  };
}
