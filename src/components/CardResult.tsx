'use client';

import { useState } from 'react';
import type { SpendResult } from '@/app/page';
import { formatUsd, formatShares } from '@/lib/collar';

interface CardResultProps {
  result: SpendResult;
  onViewCardDetail: () => void;
  onDone: () => void;
}

function formatPan(pan: string): string {
  const clean = pan.replace(/\s/g, '');
  return clean.replace(/(.{4})/g, '$1 ').trim();
}

export default function CardResult({ result, onViewCardDetail, onDone }: CardResultProps) {
  const [copied, setCopied] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [showPan, setShowPan] = useState(false);

  const card = result.card;
  const pan = card?.pan || '4000001234567890';
  const cvv = card?.cvv || '***';
  const expMonth = card?.expMonth || '12';
  const expYear = card?.expYear || '2030';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pan);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  const maskedPan = `•••• •••• •••• ${pan.slice(-4)}`;

  return (
    <div className="text-center pt-6">
      {/* Success Badge */}
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
        style={{ background: 'var(--accent-muted)', boxShadow: '0 0 40px rgba(16,185,129,0.15)' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>

      <div className="text-[22px] font-bold mb-1">Your card is ready</div>
      <div className="text-[14px] mb-8" style={{ color: 'var(--text-secondary)' }}>
        {formatUsd(result.amount)} prepaid from your {result.symbol} shares
      </div>

      {/* Virtual Card */}
      <div
        className="rounded-2xl p-6 text-left mx-auto mb-8 relative overflow-hidden flex flex-col justify-between"
        style={{
          background: 'linear-gradient(135deg, #0C0C0E 0%, #161618 40%, #1E1E21 100%)',
          maxWidth: 360,
          aspectRatio: '1.586',
          border: '1px solid var(--border)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(16,185,129,0.06)',
        }}
      >
        {/* Card shine */}
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none"
          style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 50%, rgba(255,255,255,0.02) 100%)' }} />

        {/* Top row: Folio + Visa */}
        <div className="relative flex justify-between items-start">
          <div>
            <div className="text-[16px] font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>Folio</div>
            <div className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Prepaid Card</div>
          </div>
          <div className="text-[14px] font-bold italic tracking-wider" style={{ color: 'rgba(245,245,247,0.4)' }}>VISA</div>
        </div>

        {/* Chip */}
        <div className="relative mt-4">
          <div className="w-10 h-7 rounded-md" style={{
            background: 'linear-gradient(135deg, #C9A84C, #F0D78C, #C9A84C)',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)',
          }} />
        </div>

        {/* Card Number — tap to reveal */}
        <button
          onClick={() => setShowPan(!showPan)}
          className="relative mt-4 text-left cursor-pointer group"
          title={showPan ? 'Tap to mask' : 'Tap to reveal'}
        >
          <div className="text-[20px] font-mono font-medium tracking-[0.15em] transition-opacity group-hover:opacity-80"
            style={{ color: 'var(--text-primary)' }}>
            {showPan ? formatPan(pan) : maskedPan}
          </div>
          <span className="text-[10px] mt-1 block" style={{ color: 'var(--text-tertiary)' }}>
            {showPan ? 'Tap to mask' : 'Tap to reveal'}
          </span>
        </button>

        {/* Bottom row: Expiry + CVV + Amount */}
        <div className="relative flex justify-between items-end mt-4">
          <div className="flex gap-6">
            <div>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Expires</div>
              <div className="text-[14px] font-mono" style={{ color: 'rgba(245,245,247,0.9)' }}>{expMonth}/{expYear.slice(-2)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>CVV</div>
              <button
                onClick={() => setShowCvv(!showCvv)}
                className="text-[14px] font-mono cursor-pointer"
                style={{ color: 'rgba(245,245,247,0.9)' }}
              >
                {showCvv ? cvv : '•••'}
              </button>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Balance</div>
            <div className="text-[18px] font-bold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {formatUsd(result.amount)}
            </div>
          </div>
        </div>
      </div>

      {/* Advance Summary */}
      <div className="card p-5 text-left mb-6">
        <div className="flex flex-col gap-3">
          {[
            { label: 'Type', value: 'Prepaid Visa' },
            { label: 'Collateral', value: `${formatShares(result.shares)} ${result.symbol}` },
            { label: 'Interest', value: '0%', accent: true },
            { label: 'Fees', value: '$0', accent: true },
          ].map((row) => (
            <div key={row.label} className="flex justify-between text-[13px]">
              <span style={{ color: 'var(--text-tertiary)' }}>{row.label}</span>
              <span className="font-semibold" style={{
                color: row.accent ? 'var(--accent)' : 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hedera TX */}
      <div className="text-[11px] mb-6 font-mono" style={{ color: 'var(--text-tertiary)' }}>
        <a
          href={`https://hashscan.io/testnet/transaction/${result.txId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
          style={{ color: 'var(--text-tertiary)' }}
        >
          View on Hedera Testnet
        </a>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button onClick={handleCopy} className="btn-primary w-full py-4 text-[15px]">
          {copied ? 'Copied!' : 'Copy Card Number'}
        </button>
        <button onClick={onViewCardDetail} className="btn-secondary w-full py-4 text-[15px]">
          View Card Details
        </button>
        <button onClick={onDone} className="text-[14px] font-medium py-3 cursor-pointer"
          style={{ color: 'var(--text-tertiary)' }}>
          Back to Portfolio
        </button>
      </div>
    </div>
  );
}
