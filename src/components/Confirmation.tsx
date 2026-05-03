'use client';

import type { SpendResult } from '@/app/page';
import { formatUsd, formatShares, formatDate } from '@/lib/collar';

interface ConfirmationProps {
  result: SpendResult;
  onViewDetails: () => void;
  onDone: () => void;
}

export default function Confirmation({ result, onViewDetails, onDone }: ConfirmationProps) {
  const expiryDate = new Date(result.expiryDate);

  return (
    <div className="text-center pt-10">
      {/* Success Icon */}
      <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
        style={{ background: 'var(--accent-muted)', boxShadow: '0 0 40px rgba(16,185,129,0.15)' }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>

      {/* Hero — the value prop in one line */}
      <div className="text-[26px] font-bold mb-2">
        {formatUsd(result.amount)} sent to {result.recipientName || 'your portfolio'}
      </div>
      <div className="text-[15px] mb-10" style={{ color: 'var(--accent)', fontWeight: 500 }}>
        without selling a single share
      </div>

      {/* Minimal deal summary */}
      <div className="card p-6 text-left mb-6">
        <div className="flex flex-col gap-4">
          <div className="flex justify-between text-[14px]">
            <span style={{ color: 'var(--text-tertiary)' }}>Collateral locked</span>
            <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatShares(result.shares)} {result.symbol}
            </span>
          </div>
          <div className="flex justify-between text-[14px]" style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Repay</span>
            <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatUsd(result.amount)} by {formatDate(expiryDate)}
            </span>
          </div>
        </div>
      </div>

      {/* AI insight — visible by default, forward-looking */}
      {result.ai && (
        <div className="flex items-start gap-2 py-3 px-4 rounded-xl text-left mb-8"
          style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.08)' }}>
          <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }}>★</span>
          <span className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {result.ai.oneLiner
              || `${result.symbol} looks steady. Your shares should be fine through ${formatDate(expiryDate)}. I'll nudge you before the deadline.`}
          </span>
        </div>
      )}

      {/* If no AI result, show a default forward-looking message */}
      {!result.ai && (
        <div className="flex items-start gap-2 py-3 px-4 rounded-xl text-left mb-8"
          style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.08)' }}>
          <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }}>★</span>
          <span className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Repay {formatUsd(result.amount)} by {formatDate(expiryDate)} to unlock your shares. I&apos;ll nudge you before the deadline.
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button onClick={onDone} className="btn-primary w-full py-4 text-[15px]">
          Back to Portfolio
        </button>
        <a
          href={`https://hashscan.io/testnet/transaction/${result.txId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-[12px] py-2"
          style={{ color: 'var(--text-tertiary)' }}
        >
          View receipt ↗
        </a>
      </div>
    </div>
  );
}
