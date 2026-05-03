/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock authFetch before importing AiBubble
jest.mock('@/lib/use-auth-fetch', () => ({
  authFetch: jest.fn(),
}));

// Mock useHederaKey — settle flow now calls prepare → sign → execute
jest.mock('@/lib/use-hedera-key', () => ({
  useHederaKey: () => ({
    hasKey: true,
    publicKeyDer: 'mock-pubkey',
    signTransaction: jest.fn().mockResolvedValue('mock-signed-tx'),
    generateKey: jest.fn(),
    encryptAndStore: jest.fn(),
    recoverKey: jest.fn(),
    exportKey: jest.fn(),
    importKey: jest.fn(),
    clearKey: jest.fn(),
  }),
}));

import AiBubble from '../AiBubble';
import type { ActiveNote } from '../AiBubble';
import { authFetch } from '@/lib/use-auth-fetch';

const mockAuthFetch = authFetch as jest.MockedFunction<typeof authFetch>;

const baseNote: ActiveNote = {
  id: 1,
  symbol: 'TSLA',
  amount: 500,
  shares: 2,
  floor: 180,
  cap: 280,
  expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  status: 'active',
};

const basePrices = {
  TSLA: { symbol: 'TSLA', price: 250, change: 5, changePercent: 2.0, lastUpdated: '', source: 'live' as const },
};

/** Advance fake timers in two steps: entrance delay + speech delay */
function showBubbleWithSpeech() {
  act(() => { jest.advanceTimersByTime(1000); }); // entrance
  act(() => { jest.advanceTimersByTime(200); });  // speech
}

beforeEach(() => {
  jest.useFakeTimers();
  sessionStorage.clear();
  mockAuthFetch.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AiBubble', () => {
  describe('visibility', () => {
    it('does not render when no active notes', () => {
      const { container } = render(
        <AiBubble activeNotes={[]} prices={basePrices} onRepaySuccess={jest.fn()} />
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders after entrance delay when active notes exist', () => {
      render(
        <AiBubble activeNotes={[baseNote]} prices={basePrices} onRepaySuccess={jest.fn()} />
      );
      expect(screen.queryByLabelText('AI assistant')).not.toBeInTheDocument();
      act(() => { jest.advanceTimersByTime(1000); });
      expect(screen.getByLabelText('AI assistant')).toBeInTheDocument();
    });
  });

  describe('suggestion logic', () => {
    it('shows stock-up suggestion when price is positive', () => {
      render(
        <AiBubble activeNotes={[baseNote]} prices={basePrices} onRepaySuccess={jest.fn()} />
      );
      showBubbleWithSpeech();
      expect(screen.getByText(/TSLA up 2.0% today/)).toBeInTheDocument();
    });

    it('shows near-cap suggestion when stock approaches cap', () => {
      const nearCapPrices = {
        TSLA: { symbol: 'TSLA', price: 270, change: 2, changePercent: 0.7, lastUpdated: '', source: 'live' as const },
      };
      render(
        <AiBubble activeNotes={[baseNote]} prices={nearCapPrices} onRepaySuccess={jest.fn()} />
      );
      showBubbleWithSpeech();
      expect(screen.getByText(/near your upside limit/)).toBeInTheDocument();
    });

    it('shows near-expiry suggestion when days left <= 3', () => {
      const urgentNote = {
        ...baseNote,
        expiryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      };
      render(
        <AiBubble activeNotes={[urgentNote]} prices={basePrices} onRepaySuccess={jest.fn()} />
      );
      showBubbleWithSpeech();
      expect(screen.getByText(/3 days? left on your \$500\.00 TSLA loan/)).toBeInTheDocument();
    });

    it('shows default suggestion when no special condition', () => {
      const flatPrices = {
        TSLA: { symbol: 'TSLA', price: 250, change: -1, changePercent: -0.4, lastUpdated: '', source: 'live' as const },
      };
      render(
        <AiBubble activeNotes={[baseNote]} prices={flatPrices} onRepaySuccess={jest.fn()} />
      );
      showBubbleWithSpeech();
      expect(screen.getByText(/You have \$500\.00 due/)).toBeInTheDocument();
    });
  });

  describe('bottom sheet', () => {
    jest.setTimeout(20_000);

    it('opens sheet when speech bubble is clicked', () => {
      render(
        <AiBubble activeNotes={[baseNote]} prices={basePrices} onRepaySuccess={jest.fn()} />
      );
      showBubbleWithSpeech();

      fireEvent.click(screen.getByText(/TSLA up 2.0% today/));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Settle Now')).toBeInTheDocument();
    });

    it('calls prepare + repay APIs on settle click and shows success', async () => {
      jest.useRealTimers();
      // Step 1: prepare returns tx bytes to sign
      mockAuthFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ needsSignature: true, repayTxBytes: 'dHgtYnl0ZXM=' }),
      } as unknown as Response);
      // Step 2: execute repay succeeds
      mockAuthFetch.mockResolvedValueOnce({ ok: true } as Response);
      const onRepaySuccess = jest.fn();

      render(
        <AiBubble activeNotes={[baseNote]} prices={basePrices} onRepaySuccess={onRepaySuccess} />
      );

      await waitFor(() => {
        expect(screen.getByText(/TSLA up 2.0% today/)).toBeInTheDocument();
      }, { timeout: 10_000 });

      fireEvent.click(screen.getByText(/TSLA up 2.0% today/));
      fireEvent.click(screen.getByText('Settle Now'));

      await waitFor(() => {
        expect(mockAuthFetch).toHaveBeenCalledWith('/api/spend/repay/prepare', expect.objectContaining({
          method: 'POST',
        }));
        expect(mockAuthFetch).toHaveBeenCalledWith('/api/spend/repay', expect.objectContaining({
          method: 'POST',
        }));
      });

      await waitFor(() => {
        expect(screen.getByText('Shares Unlocked!')).toBeInTheDocument();
      });
    });

    it('shows error on settle failure at prepare step', async () => {
      jest.useRealTimers();
      // Prepare step fails
      mockAuthFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed to prepare' }),
      } as unknown as Response);

      render(
        <AiBubble activeNotes={[baseNote]} prices={basePrices} onRepaySuccess={jest.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText(/TSLA up 2.0% today/)).toBeInTheDocument();
      }, { timeout: 10_000 });

      fireEvent.click(screen.getByText(/TSLA up 2.0% today/));
      fireEvent.click(screen.getByText('Settle Now'));

      await waitFor(() => {
        expect(screen.getByText('Failed to prepare')).toBeInTheDocument();
      });
    });
  });

  describe('dismissal', () => {
    it('dismisses speech bubble when dot is clicked', () => {
      render(
        <AiBubble activeNotes={[baseNote]} prices={basePrices} onRepaySuccess={jest.fn()} />
      );
      showBubbleWithSpeech();

      // Speech is showing, clicking dot should dismiss
      fireEvent.click(screen.getByLabelText('AI assistant'));
      // Speech bubble should no longer be showing after dismiss
      expect(screen.queryByText(/TSLA up 2.0% today/)).not.toBeInTheDocument();
    });
  });

  describe('note prioritization', () => {
    it('picks the note closest to expiry', () => {
      const farNote = { ...baseNote, id: 2, expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() };
      const nearNote = { ...baseNote, id: 3, expiryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() };

      render(
        <AiBubble activeNotes={[farNote, nearNote]} prices={basePrices} onRepaySuccess={jest.fn()} />
      );
      showBubbleWithSpeech();
      expect(screen.getByText(/5 days to repay/)).toBeInTheDocument();
    });
  });
});
