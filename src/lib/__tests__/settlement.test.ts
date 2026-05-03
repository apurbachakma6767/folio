/**
 * Tests for settlement math — pure functions that determine collar outcomes.
 * Covers all four settlement paths: repayment, in-range settle, above-cap settle, liquidation.
 */

import { calculateSettlement, calculateRepayment } from '../settlement';
import type { SpendNote } from '../spend-notes';

function makeNote(overrides: Partial<SpendNote> = {}): SpendNote {
  return {
    id: 1,
    symbol: 'MOCK-TSLA',
    serial: 1,
    recipient: '0.0.12345',
    recipientName: 'Test User',
    amount: 100,          // $100 advance
    shares: 0.5,          // 0.5 shares collateral
    sharesHts: 500_000,   // 0.5 shares in 6-decimal HTS
    stockPrice: 250,      // $250 at time of spend
    floor: 200,           // collar floor
    cap: 300,             // collar cap
    durationMonths: 1,
    expiryDate: '2026-05-01T00:00:00.000Z',
    status: 'active',
    txId: 'tx-123',
    createdAt: '2026-04-01T00:00:00.000Z',
    userAccountId: '0.0.99999',
    ...overrides,
  };
}

describe('calculateSettlement', () => {
  describe('below floor — liquidation', () => {
    it('returns zero shares when price drops below floor', () => {
      const result = calculateSettlement({
        note: makeNote(),
        currentPrice: 180, // below $200 floor
      });

      expect(result.outcome).toBe('liquidated');
      expect(result.sharesToReturnHts).toBe(0);
      expect(result.reason).toContain('fell below collar floor');
    });

    it('liquidates at exactly the floor price when advance covers all collateral', () => {
      // Price at floor ($200) is not below floor, so uses settlement math.
      // But $100 / $200 = 0.5 shares = exactly the collateral → liquidated.
      const result = calculateSettlement({
        note: makeNote(),
        currentPrice: 200, // exactly at floor
      });

      expect(result.outcome).toBe('liquidated');
      expect(result.sharesToReturnHts).toBe(0);
    });

    it('settles at floor price when advance is small relative to collateral', () => {
      // With a smaller advance, floor price still leaves shares to return
      const result = calculateSettlement({
        note: makeNote({ amount: 50 }), // only $50 advance
        currentPrice: 200,
      });

      expect(result.outcome).toBe('settled');
      expect(result.sharesToReturnHts).toBeGreaterThan(0);
    });
  });

  describe('in-range — normal settlement', () => {
    it('returns excess shares at current price', () => {
      const note = makeNote();
      const result = calculateSettlement({
        note,
        currentPrice: 250, // same as stockPrice, within range
      });

      expect(result.outcome).toBe('settled');
      // $100 advance / $250 per share = 0.4 shares to cover
      // 0.5 - 0.4 = 0.1 shares returned = 100_000 HTS
      expect(result.sharesToReturnHts).toBe(100_000);
      expect(result.reason).toContain('shares returned to user');
    });

    it('returns more shares when price is higher', () => {
      const result = calculateSettlement({
        note: makeNote(),
        currentPrice: 280, // higher price = fewer shares to cover
      });

      expect(result.outcome).toBe('settled');
      // $100 / $280 ≈ 0.357 shares → ceil at HTS = 357143
      // 500_000 - 357143 = 142857
      expect(result.sharesToReturnHts).toBe(142_857);
    });
  });

  describe('above cap — capped settlement', () => {
    it('settles at cap price, not market price', () => {
      const note = makeNote({ cap: 300 });
      const result = calculateSettlement({
        note,
        currentPrice: 400, // above $300 cap
      });

      expect(result.outcome).toBe('settled');
      // Should settle at $300 (cap), not $400 (market)
      // $100 / $300 ≈ 0.3334 shares → ceil at HTS = 333334
      // 500_000 - 333334 = 166666
      expect(result.sharesToReturnHts).toBe(166_666);
      expect(result.reason).toContain('capped at $300.00');
      expect(result.reason).toContain('market $400.00');
    });
  });

  describe('edge cases', () => {
    it('liquidates when advance exceeds collateral value', () => {
      const result = calculateSettlement({
        note: makeNote({ amount: 500 }), // $500 advance, only 0.5 shares
        currentPrice: 250,
      });

      // $500 / $250 = 2 shares needed, only 0.5 available
      expect(result.outcome).toBe('liquidated');
      expect(result.sharesToReturnHts).toBe(0);
      expect(result.reason).toContain('exceeding collateral');
    });

    it('liquidates when shares to cover exactly equals collateral', () => {
      const result = calculateSettlement({
        note: makeNote({ amount: 125, shares: 0.5, sharesHts: 500_000 }),
        currentPrice: 250,
      });

      // $125 / $250 = 0.5 shares = exactly the collateral
      expect(result.outcome).toBe('liquidated');
      expect(result.sharesToReturnHts).toBe(0);
    });
  });
});

describe('calculateRepayment', () => {
  it('returns all collateral shares on early repayment', () => {
    const note = makeNote();
    const result = calculateRepayment(note);

    expect(result.outcome).toBe('repaid');
    expect(result.sharesToReturnHts).toBe(note.sharesHts);
    expect(result.reason).toContain('All 0.5000 collateral shares returned');
  });
});
