'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatUsd, formatShares } from '@/lib/collar';
import { authFetch } from '@/lib/use-auth-fetch';
import { useHederaKey } from '@/lib/use-hedera-key';
import type { PriceData } from '@/app/page';

export interface ActiveNote {
  id: number;
  symbol: string;
  amount: number;
  shares: number;
  floor: number;
  cap: number;
  expiryDate: string;
  status: string;
}

interface AiBubbleProps {
  activeNotes: ActiveNote[];
  prices: Record<string, PriceData>;
  onRepaySuccess: () => void;
}

function getSuggestion(note: ActiveNote, prices: Record<string, PriceData>): string {
  const price = prices[note.symbol];
  const expiry = new Date(note.expiryDate);
  const daysLeft = Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  // Urgent (< 3 days)
  if (daysLeft <= 3) {
    return daysLeft === 0
      ? `Your ${formatUsd(note.amount)} ${note.symbol} loan expires today! Settle now to keep your shares, or extend for a fee.`
      : `${daysLeft} day${daysLeft > 1 ? 's' : ''} left on your ${formatUsd(note.amount)} ${note.symbol} loan. Settle now to keep your shares, or extend for a fee.`;
  }

  // Near expiry (< 14 days)
  if (daysLeft <= 14) {
    if (price && price.changePercent > 0) {
      return `${daysLeft} days to repay your ${formatUsd(note.amount)} ${note.symbol} loan. Your shares are doing well, ${note.symbol} up ${price.changePercent.toFixed(1)}% this month. Tap to settle.`;
    }
    return `${daysLeft} days to repay your ${formatUsd(note.amount)} ${note.symbol} loan. Tap to settle.`;
  }

  if (price) {
    // Stock approaching cap
    if (price.price >= note.cap * 0.95) {
      return `${note.symbol} is near your upside limit. Settle your ${formatUsd(note.amount)} loan to keep the gains.`;
    }
    // Stock is up today
    if (price.changePercent > 0) {
      return `${note.symbol} up ${price.changePercent.toFixed(1)}% today. You have ${formatUsd(note.amount)} due ${new Date(note.expiryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Settle anytime.`;
    }
  }

  // Default
  return `You have ${formatUsd(note.amount)} due ${new Date(note.expiryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Settle anytime to unlock your ${formatShares(note.shares)} ${note.symbol} shares.`;
}

function getMostUrgentNote(notes: ActiveNote[]): ActiveNote | null {
  const active = notes.filter((n) => n.status === 'active');
  if (active.length === 0) return null;
  return active.sort((a, b) => {
    const dateCompare = new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
    if (dateCompare !== 0) return dateCompare;
    return b.amount - a.amount; // bigger debt first on tie
  })[0];
}

function isUrgent(note: ActiveNote): boolean {
  const expiry = new Date(note.expiryDate);
  const daysLeft = Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  return daysLeft <= 3;
}

export default function AiBubble({ activeNotes, prices, onRepaySuccess }: AiBubbleProps) {
  const [showSpeech, setShowSpeech] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settleStatus, setSettleStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const { signTransaction } = useHederaKey();

  const note = getMostUrgentNote(activeNotes);
  const urgent = note ? isUrgent(note) : false;
  const activeCount = activeNotes.filter(n => n.status === 'active').length;

  // User-dismissable — no auto-dismiss timer
  const [dismissed, setDismissed] = useState(false);
  // Track what context triggered the last dismissal so we can re-surface on change
  const [dismissedContext, setDismissedContext] = useState<string>('');

  // Re-surface when context changes (different note, urgency level changes, price moves)
  useEffect(() => {
    if (!note) return;
    const currentContext = `${note.id}-${urgent}-${Math.floor(Date.now() / (1000 * 60 * 60 * 24))}`;
    if (dismissed && dismissedContext !== currentContext) {
      setDismissed(false);
    }
  }, [note, urgent, dismissed, dismissedContext]);

  // Entrance animation: delay 1s after notes load
  useEffect(() => {
    if (!note || dismissed) {
      setBubbleVisible(false);
      return;
    }
    const timer = setTimeout(() => setBubbleVisible(true), 1000);
    return () => clearTimeout(timer);
  }, [note, dismissed]);

  // Auto-show speech bubble 200ms after dot appears
  useEffect(() => {
    if (!bubbleVisible) return;
    const timer = setTimeout(() => setShowSpeech(true), 200);
    return () => clearTimeout(timer);
  }, [bubbleVisible]);

  const handleDismissSpeech = useCallback(() => {
    setShowSpeech(false);
    setDismissed(true);
    if (note) {
      setDismissedContext(`${note.id}-${urgent}-${Math.floor(Date.now() / (1000 * 60 * 60 * 24))}`);
    }
  }, [note, urgent]);

  const handleSettle = async () => {
    if (!note) return;
    setSettling(true);
    setError(null);
    try {
      // Step 1: Prepare
      setSettleStatus('Preparing...');
      const prepRes = await authFetch('/api/spend/repay/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: note.id }),
      });
      if (!prepRes.ok) {
        const err = await prepRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to prepare');
      }

      const prepData = await prepRes.json();
      let signedRepayTxBytes: string | undefined;

      // Step 2: Sign
      if (prepData.needsSignature && prepData.repayTxBytes) {
        setSettleStatus('Signing...');
        signedRepayTxBytes = await signTransaction(prepData.repayTxBytes);
      }

      // Step 3: Execute
      setSettleStatus('Settling...');
      const res = await authFetch('/api/spend/repay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: note.id, signedRepayTxBytes }),
      });
      if (res.ok) {
        setSuccess(true);
        // Longer celebration — 5 seconds
        setTimeout(() => {
          setShowSheet(false);
          setSuccess(false);
          onRepaySuccess();
        }, 5000);
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Settlement failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Settlement failed. Try again.');
      setTimeout(() => setError(null), 5000);
    } finally {
      setSettling(false);
      setSettleStatus('');
    }
  };

  if (!note || !bubbleVisible) return null;

  const suggestion = getSuggestion(note, prices);
  const dotColor = urgent ? '#F59E0B' : '#10B981';
  const dotShadow = urgent ? '0 2px 12px rgba(245,158,11,0.3)' : '0 2px 12px rgba(16,185,129,0.3)';

  return (
    <>
      {/* Dot + speech bubble */}
      <div className="fixed z-40 bottom-20 right-4 md:bottom-4"
        style={{ transition: 'opacity 400ms ease-out, transform 400ms ease-out' }}>
        {/* Speech bubble */}
        {showSpeech && !showSheet && (
          <div
            className="absolute bottom-14 right-0 mb-2 cursor-pointer"
            style={{ maxWidth: 280 }}
            onClick={() => { setShowSheet(true); setShowSpeech(false); }}
          >
            <div className="p-3 rounded-xl text-[13px] leading-relaxed"
              style={{
                background: urgent ? 'rgba(245,158,11,0.06)' : 'rgba(16,185,129,0.08)',
                border: `1px solid ${urgent ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.15)'}`,
                color: 'var(--text-primary)',
              }}>
              {activeCount > 1 && (
                <div className="text-[11px] font-semibold mb-1.5" style={{ color: urgent ? 'var(--warning)' : 'var(--accent)' }}>
                  {activeCount} active advances
                </div>
              )}
              {suggestion}
            </div>
            {/* Arrow */}
            <div className="absolute -bottom-1.5 right-4 w-3 h-3 rotate-45"
              style={{
                background: urgent ? 'rgba(245,158,11,0.06)' : 'rgba(16,185,129,0.08)',
                borderRight: `1px solid ${urgent ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.15)'}`,
                borderBottom: `1px solid ${urgent ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.15)'}`,
              }} />
          </div>
        )}

        {/* Dot button */}
        <button
          onClick={() => showSpeech ? handleDismissSpeech() : setShowSpeech(true)}
          aria-label="AI assistant"
          className="w-11 h-11 rounded-full flex items-center justify-center cursor-pointer"
          style={{
            background: dotColor,
            boxShadow: dotShadow,
            animation: 'pulse 2s infinite',
          }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7L12 16.4 5.7 21l2.3-7L2 9.4h7.6z" />
          </svg>
        </button>
      </div>

      {/* Bottom Sheet */}
      {showSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSheet(false); }}>
          {/* Backdrop */}
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)' }} />

          {/* Sheet */}
          <div
            className="relative w-full md:max-w-[480px] px-6 pb-8 pt-3"
            style={{
              background: '#161618',
              borderRadius: '16px 16px 0 0',
              animation: 'slideUp 250ms ease-out',
            }}
            role="dialog"
            aria-label="Settle advance"
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: 'rgba(255,255,255,0.12)' }} />

            {success ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(16,185,129,0.12)' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <div className="text-[20px] font-bold" style={{ color: '#10B981' }}>Shares Unlocked!</div>
                <div className="text-[13px] mt-2" style={{ color: 'var(--text-secondary)' }}>
                  Your {formatShares(note.shares)} {note.symbol} shares are fully yours again.
                </div>
              </div>
            ) : (
              <>
                <div className="text-[13px] leading-relaxed mb-6" style={{ color: 'var(--text-secondary)' }}>
                  {suggestion}
                </div>

                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>Settlement amount</span>
                  <span className="text-[24px] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatUsd(note.amount)}</span>
                </div>
                <div className="flex justify-between mb-6">
                  <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>Shares to unlock</span>
                  <span className="text-[15px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatShares(note.shares)} {note.symbol}
                  </span>
                </div>

                {error && (
                  <div className="text-[13px] mb-4 text-center" style={{ color: 'var(--negative)' }}>{error}</div>
                )}

                <button
                  onClick={handleSettle}
                  disabled={settling}
                  className="btn-primary w-full py-4 text-[15px]"
                >
                  {settling ? (settleStatus || 'Settling...') : 'Settle Now'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
