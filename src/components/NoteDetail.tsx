'use client';

import { useState, useEffect } from 'react';
import { formatUsd, formatShares, formatDate } from '@/lib/collar';
import { authFetch } from '@/lib/use-auth-fetch';
import { useHederaKey } from '@/lib/use-hedera-key';
import Spinner from '@/components/Spinner';

interface SpendNote {
  id: number;
  symbol: string;
  amount: number;
  shares: number;
  floor: number;
  cap: number;
  recipientName: string;
  recipientEmail?: string;
  status: 'active' | 'repaid' | 'settled' | 'liquidated' | 'expired';
  settlementPrice?: number;
  settlementSharesReturned?: number;
  settledAt?: string;
  durationMonths: number;
  expiryDate: string;
  createdAt: string;
  txId: string;
}

interface NoteDetailProps {
  noteId: number;
  onBack: () => void;
}

export default function NoteDetail({ noteId, onBack }: NoteDetailProps) {
  const [note, setNote] = useState<SpendNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [repaying, setRepaying] = useState(false);
  const [repayStatus, setRepayStatus] = useState('');
  const [repayError, setRepayError] = useState('');
  const { signTransaction } = useHederaKey();

  useEffect(() => {
    const fetchNote = async () => {
      try {
        const res = await authFetch('/api/notes');
        const data = await res.json();
        const found = (data.notes ?? []).find((n: SpendNote) => n.id === noteId);
        setNote(found ?? null);
      } catch {
        setNote(null);
      } finally {
        setLoading(false);
      }
    };
    fetchNote();
  }, [noteId]);

  const handleRepay = async () => {
    if (!note) return;
    setRepaying(true);
    setRepayError('');
    try {
      // Step 1: Prepare
      setRepayStatus('Preparing...');
      const prepRes = await authFetch('/api/spend/repay/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: note.id }),
      });
      if (!prepRes.ok) {
        const err = await prepRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to prepare repayment');
      }

      const prepData = await prepRes.json();
      let signedRepayTxBytes: string | undefined;

      // Step 2: Sign
      if (prepData.needsSignature && prepData.repayTxBytes) {
        setRepayStatus('Signing...');
        signedRepayTxBytes = await signTransaction(prepData.repayTxBytes);
      }

      // Step 3: Execute
      setRepayStatus('Settling...');
      const res = await authFetch('/api/spend/repay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: note.id, signedRepayTxBytes }),
      });
      if (res.ok) {
        setNote({ ...note, status: 'repaid' });
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Settlement failed');
      }
    } catch (err) {
      setRepayError(err instanceof Error ? err.message : 'Settlement failed');
    } finally {
      setRepaying(false);
      setRepayStatus('');
    }
  };

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading">
        {/* Top: avatar + name bars */}
        <div className="flex items-center gap-4 mb-3">
          <div className="skeleton w-11 h-11 rounded-full" />
          <div className="space-y-2">
            <div className="skeleton h-5 w-32 rounded" />
            <div className="skeleton h-3 w-20 rounded" />
          </div>
        </div>
        {/* Amount */}
        <div className="skeleton h-10 w-40 rounded mx-auto mt-6" />
        {/* Detail card */}
        <div className="card p-6 mt-6">
          <div className="flex flex-col gap-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex justify-between">
                <div className="skeleton h-3 w-20 rounded" />
                <div className="skeleton h-3 w-24 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <div>
        <button onClick={onBack} className="p-2 rounded-lg mb-6 cursor-pointer"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-center py-20 text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
          Note not found
        </div>
      </div>
    );
  }

  const expiry = new Date(note.expiryDate);
  const now = new Date();
  const daysLeft = Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  const isUrgent = daysLeft <= 7 && note.status === 'active';

  const statusColors: Record<string, string> = {
    active: 'var(--accent)',
    repaid: '#818CF8',
    settled: '#F59E0B',
    liquidated: '#EF4444',
    expired: '#EF4444',
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button onClick={onBack} className="p-2 rounded-lg cursor-pointer transition-colors"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-lg font-semibold">Transaction</div>
      </div>

      {/* Recipient + Amount */}
      <div className="flex items-center gap-4 mb-3">
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white"
          style={{ background: 'linear-gradient(135deg, #6366F1, #8B5CF6)' }}>
          {note.recipientName.charAt(0)}
        </div>
        <div>
          <div className="text-[16px] font-semibold">{note.recipientName}</div>
          <div className="text-[13px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {note.recipientEmail || new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
      </div>

      <div className="text-[40px] font-bold mb-8" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatUsd(note.amount)}
      </div>

      {/* Urgency Banner */}
      {isUrgent && (
        <div className="flex items-center gap-3 p-4 rounded-xl mb-6"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-[13px] font-semibold" style={{ color: '#F59E0B' }}>
            {daysLeft === 0 ? 'Expires today!' : `${daysLeft} day${daysLeft > 1 ? 's' : ''} until expiry`}
          </span>
        </div>
      )}

      {/* Advance Details */}
      <div className="card p-6 mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-5" style={{ color: 'var(--text-tertiary)' }}>
          Advance Details
        </div>

        <div className="flex flex-col gap-4">
          {[
            { label: 'Status', value: note.status.charAt(0).toUpperCase() + note.status.slice(1), color: statusColors[note.status] },
            { label: 'Collateral', value: `${formatShares(note.shares)} ${note.symbol || 'TSLA'}` },
            { label: 'Interest', value: '0%', color: 'var(--accent)' },
            { label: 'Protection', value: `${formatUsd(note.floor)} floor / ${formatUsd(note.cap)} cap` },
            { label: 'Protected until', value: formatDate(expiry) },
          ].map((row) => (
            <div key={row.label} className="flex justify-between text-[14px]">
              <span style={{ color: 'var(--text-tertiary)' }}>{row.label}</span>
              <span className="font-semibold" style={{
                color: row.color ?? 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}>{row.value}</span>
            </div>
          ))}
        </div>

        {(note.status === 'settled' || note.status === 'liquidated') && note.settlementPrice && (
          <div className="flex flex-col gap-3 mt-5 pt-5" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Settlement
            </div>
            <div className="flex justify-between text-[14px]">
              <span style={{ color: 'var(--text-tertiary)' }}>Settlement price</span>
              <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatUsd(note.settlementPrice)}</span>
            </div>
            {note.settlementSharesReturned != null && note.settlementSharesReturned > 0 && (
              <div className="flex justify-between text-[14px]">
                <span style={{ color: 'var(--text-tertiary)' }}>Shares returned</span>
                <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatShares(note.settlementSharesReturned / 1e6)}</span>
              </div>
            )}
          </div>
        )}

        <div className="text-[12px] mt-5 pt-5 leading-relaxed" style={{ color: 'var(--text-tertiary)', borderTop: '1px solid var(--border)' }}>
          {note.status === 'repaid'
            ? 'Advance settled. Your shares have been unlocked and returned.'
            : note.status === 'settled'
            ? 'Loan expired and settled. Remaining shares have been returned to your account.'
            : note.status === 'liquidated'
            ? 'Loan expired below the protection floor. All collateral was used to cover the advance.'
            : note.status === 'expired'
            ? 'Advance expired. Collateral shares were sold to cover the balance.'
            : `Settle ${formatUsd(note.amount)} before ${formatDate(expiry)} to unlock your shares.`}
        </div>
      </div>

      {/* TX verification link */}
      <div className="text-[11px] mb-8 px-1">
        <a
          href={`https://hashscan.io/testnet/transaction/${note.txId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Verify on Hedera Testnet
        </a>
      </div>

      {/* Repay Button */}
      {note.status === 'active' && (
        <>
          {repayError && (
            <div className="text-center text-[13px] px-4 py-2 rounded-lg mb-2" style={{ color: 'var(--negative)', background: 'var(--bg-elevated)' }}>
              {repayError}
            </div>
          )}
          <button
            onClick={handleRepay}
            disabled={repaying}
            className="btn-primary w-full py-4.5 text-[15px]"
          >
            {repaying ? <span className="flex items-center justify-center gap-2"><Spinner size={16} />{repayStatus || 'Processing...'}</span> : `Settle ${formatUsd(note.amount)} & Unlock Shares`}
          </button>
        </>
      )}
    </div>
  );
}
