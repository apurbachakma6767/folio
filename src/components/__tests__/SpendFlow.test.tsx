/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SpendFlow from '../SpendFlow';
import type { Holding } from '@/lib/types';

const appleHolding: Holding = {
  symbol: 'AAPL',
  name: 'Apple',
  shares: 10,
  icon: 'A',
  gradient: 'linear-gradient(135deg, #555, #333)',
};

const mockPrices = {
  AAPL: { symbol: 'AAPL', price: 180, change: 2, changePercent: 1.1, lastUpdated: '', source: 'live' as const },
};

const teslaHolding: Holding = {
  symbol: 'TSLA',
  name: 'Tesla',
  shares: 44,
  icon: 'T',
  gradient: 'linear-gradient(135deg, #E31937, #B91C3A)',
};

const defaultProps = {
  mode: 'send' as const,
  selectedHolding: appleHolding,
  holdings: [appleHolding, teslaHolding],
  prices: mockPrices,
  onBack: jest.fn(),
  onComplete: jest.fn(),
};

describe('SpendFlow', () => {
  it('displays selected stock name', () => {
    render(<SpendFlow {...defaultProps} />);
    expect(screen.getByText('Apple')).toBeInTheDocument();
  });

  it('displays total holding value and max spend', () => {
    // 10 shares * $180 = $1,800 (shown on card and in available text)
    render(<SpendFlow {...defaultProps} />);
    expect(screen.getAllByText(/\$1,800/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows stock symbol in collateral line', () => {
    render(<SpendFlow {...defaultProps} />);
    // Collar for $50 at $180 = 0.278 shares AAPL
    expect(screen.getByText(/AAPL/)).toBeInTheDocument();
  });

  it('does not show hardcoded Tesla references', () => {
    const { container } = render(<SpendFlow {...defaultProps} />);
    // No literal "Tesla" text (only "Apple" from selected holding)
    const textContent = container.textContent || '';
    expect(textContent).not.toContain('Tesla');
  });
});
