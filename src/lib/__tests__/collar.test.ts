import { calculateCollar, getExpiryDate, formatShares, formatUsd, formatDate } from '../collar';

describe('calculateCollar', () => {
  describe('basic $50 spend at $225 TSLA', () => {
    const result = calculateCollar(50, 225, 1);

    it('calculates correct shares', () => {
      expect(result.shares).toBeCloseTo(50 / 225, 6);
    });

    it('calculates correct HTS shares (decimal 6)', () => {
      // floor(0.2222... * 1e6)
      expect(result.sharesHts).toBe(Math.floor((50 / 225) * 1e6));
    });

    it('calculates correct floor (5% below)', () => {
      expect(result.floor).toBeCloseTo(225 * 0.95, 8);
    });

    it('calculates correct cap (15% above)', () => {
      expect(result.cap).toBeCloseTo(225 * 1.15, 8);
    });

    it('advance equals spend amount', () => {
      expect(result.advance).toBe(50);
    });

    it('calculates correct HTS advance (decimal 6)', () => {
      expect(result.advanceHts).toBe(Math.floor(50 * 1e6));
    });

    it('fee is zero (zero-cost collar)', () => {
      expect(result.fee).toBe(0);
    });

    it('collateral value equals spend amount', () => {
      expect(result.collateralValue).toBeCloseTo(50, 8);
    });

    it('duration is 1 month', () => {
      expect(result.durationMonths).toBe(1);
    });

    it('expiry is a valid date in the future', () => {
      expect(result.expiryDate).toBeInstanceOf(Date);
      expect(result.expiryDate.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('edge case: very small $1 spend at $225', () => {
    const result = calculateCollar(1, 225, 1);

    it('computes positive shares', () => {
      expect(result.shares).toBeGreaterThan(0);
    });

    it('HTS shares is floored integer', () => {
      expect(Number.isInteger(result.sharesHts)).toBe(true);
      expect(result.sharesHts).toBe(Math.floor((1 / 225) * 1e6));
    });

    it('advance is $1', () => {
      expect(result.advance).toBe(1);
    });

    it('fee is zero', () => {
      expect(result.fee).toBe(0);
    });
  });

  describe('edge case: large $5000 spend at $225', () => {
    const result = calculateCollar(5000, 225, 3);

    it('shares is 5000/225', () => {
      expect(result.shares).toBeCloseTo(5000 / 225, 6);
    });

    it('HTS advance is 5000 * 1e6', () => {
      expect(result.advanceHts).toBe(Math.floor(5000 * 1e6));
    });

    it('floor and cap scale with price and duration', () => {
      // Floor/cap scale by sqrt(duration): 5% * sqrt(3) ≈ 8.66%, 15% * sqrt(3) ≈ 25.98%
      const scale = Math.sqrt(3);
      expect(result.floor).toBeCloseTo(225 * (1 - 0.05 * scale), 8);
      expect(result.cap).toBeCloseTo(225 * (1 + 0.15 * scale), 8);
    });

    it('duration is 3 months', () => {
      expect(result.durationMonths).toBe(3);
    });
  });

  describe('HTS integer conversion correctness', () => {
    it('sharesHts is always a non-negative integer', () => {
      for (const spend of [1, 10, 50, 100, 999.99, 5000]) {
        const r = calculateCollar(spend, 225, 1);
        expect(Number.isInteger(r.sharesHts)).toBe(true);
        expect(r.sharesHts).toBeGreaterThanOrEqual(0);
      }
    });

    it('advanceHts is always a non-negative integer', () => {
      for (const spend of [1, 10, 50, 100, 999.99, 5000]) {
        const r = calculateCollar(spend, 225, 1);
        expect(Number.isInteger(r.advanceHts)).toBe(true);
        expect(r.advanceHts).toBeGreaterThanOrEqual(0);
      }
    });

    it('sharesHts equals floor(shares * 1e6)', () => {
      const r = calculateCollar(75.50, 214.37, 2);
      expect(r.sharesHts).toBe(Math.floor(r.shares * 1e6));
    });

    it('advanceHts equals floor(advance * 1e6)', () => {
      const r = calculateCollar(75.50, 214.37, 2);
      expect(r.advanceHts).toBe(Math.floor(r.advance * 1e6));
    });
  });

  describe('expiry date calculation', () => {
    it('1-month expiry is a Friday', () => {
      const r = calculateCollar(50, 225, 1);
      expect(r.expiryDate.getDay()).toBe(5); // 5 = Friday
    });

    it('2-month expiry is a Friday', () => {
      const r = calculateCollar(50, 225, 2);
      expect(r.expiryDate.getDay()).toBe(5);
    });

    it('3-month expiry is a Friday', () => {
      const r = calculateCollar(50, 225, 3);
      expect(r.expiryDate.getDay()).toBe(5);
    });

    it('expiry is the 3rd Friday (date between 15 and 21)', () => {
      for (const months of [1, 2, 3]) {
        const r = calculateCollar(50, 225, months);
        const d = r.expiryDate.getDate();
        expect(d).toBeGreaterThanOrEqual(15);
        expect(d).toBeLessThanOrEqual(21);
      }
    });

    it('longer duration means later expiry', () => {
      const r1 = calculateCollar(50, 225, 1);
      const r2 = calculateCollar(50, 225, 2);
      const r3 = calculateCollar(50, 225, 3);
      expect(r2.expiryDate.getTime()).toBeGreaterThan(r1.expiryDate.getTime());
      expect(r3.expiryDate.getTime()).toBeGreaterThan(r2.expiryDate.getTime());
    });
  });
});

describe('getExpiryDate', () => {
  it('returns a Date instance', () => {
    expect(getExpiryDate(1)).toBeInstanceOf(Date);
  });

  it('returns a Friday', () => {
    expect(getExpiryDate(1).getDay()).toBe(5);
    expect(getExpiryDate(2).getDay()).toBe(5);
    expect(getExpiryDate(3).getDay()).toBe(5);
  });
});

describe('formatShares', () => {
  it('formats to 3 decimal places', () => {
    expect(formatShares(0.222)).toBe('0.222');
    expect(formatShares(0.2222)).toBe('0.222');
    expect(formatShares(1)).toBe('1.000');
  });
});

describe('formatUsd', () => {
  it('formats with dollar sign and 2 decimals', () => {
    expect(formatUsd(50)).toBe('$50.00');
    expect(formatUsd(213.75)).toBe('$213.75');
    expect(formatUsd(0)).toBe('$0.00');
  });
});

describe('formatDate', () => {
  it('returns a non-empty string', () => {
    const d = new Date(2026, 5, 19);
    expect(typeof formatDate(d)).toBe('string');
    expect(formatDate(d).length).toBeGreaterThan(0);
  });

  it('includes year', () => {
    const d = new Date(2026, 5, 19);
    expect(formatDate(d)).toContain('2026');
  });
});
