'use client';

import { useState, useEffect } from 'react';
import { formatUsd, formatDate } from '@/lib/collar';
import { authFetch } from '@/lib/use-auth-fetch';
import { useHederaKey } from '@/lib/use-hedera-key';
import Spinner from '@/components/Spinner';

interface SpendNote {
  id: number;
  amount: number;
  shares: number;
  symbol: string;
  recipientName: string;
  recipientEmail?: string;
  status: 'active' | 'repaid' | 'settled' | 'liquidated' | 'expired';
  expiryDate: string;
  createdAt: string;
  direction?: 'sent' | 'received';
  userAccountId?: string;
}

interface NotesListProps {
  onSelectNote: (noteId: number) => void;
}

export default function NotesList({ onSelectNote }: NotesListProps) {
  const [notes, setNotes] = useState<SpendNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');
  const [settlingId, setSettlingId] = useState<number | null>(null);
  const [settleStatus, setSettleStatus] = useState<string>('');
  const [settleError, setSettleError] = useState<string | null>(null);
  const { signTransaction } = useHederaKey();

  const fetchNotes = async () => {
    try {
      const res = await authFetch('/api/notes?scope=main');
      const data = await res.json();
      setNotes(data.notes ?? []);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, []);

  const handleSettle = async (e: React.MouseEvent, noteId: number) => {
    e.stopPropagation();
    setSettlingId(noteId);
    setSettleError(null);
    try {
      setSettleStatus('Preparing...');
      const prepRes = await authFetch('/api/spend/repay/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      });

      if (!prepRes.ok) {
        const err = await prepRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to prepare repayment');
      }

      const prepData = await prepRes.json();
      let signedRepayTxBytes: string | undefined;

      if (prepData.needsSignature && prepData.repayTxBytes) {
        setSettleStatus('Signing...');
        signedRepayTxBytes = await signTransaction(prepData.repayTxBytes);
      }

      setSettleStatus('Settling...');
      const res = await authFetch('/api/spend/repay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, signedRepayTxBytes }),
      });

      if (res.ok) {
        setNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, status: 'repaid' as const } : n))
        );
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Settlement failed');
      }
    } catch (err) {
      setSettleError(err instanceof Error ? err.message : 'Settlement failed');
      setTimeout(() => setSettleError(null), 5000);
    } finally {
      setSettlingId(null);
      setSettleStatus('');
    }
  };

  const statusColors: Record<string, { bg: string; color: string }> = {
    active: { bg: 'rgba(16,185,129,0.12)', color: '#10B981' },
    repaid: { bg: 'rgba(99,102,241,0.12)', color: '#818CF8' },
    settled: { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B' },
    liquidated: { bg: 'rgba(239,68,68,0.12)', color: '#EF4444' },
    expired: { bg: 'rgba(239,68,68,0.12)', color: '#EF4444' },
  };

  const filtered = notes.filter((n) => {
    if (filter === 'all') return true;
    return (n.direction || 'sent') === filter;
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="page-eyebrow">Activity</div>
        <div className="page-title">Transactions</div>
        <div className="page-sub">Payments you sent and received</div>
      </div>

      <div className="segmented max-w-sm">
        {([
          ['all', 'All'],
          ['sent', 'Sent'],
          ['received', 'Received'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className="segmented-btn"
            style={{ fontSize: 12, paddingTop: 8, paddingBottom: 8 }}
            data-active={filter === id}
            data-tone={filter === id ? 'buy' : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card flex items-center gap-4 p-5">
              <div className="skeleton w-11 h-11 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-24 rounded" />
                <div className="skeleton h-3 w-16 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16 px-6">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-tertiary)"
              strokeWidth="1.5"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="text-[15px] font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
            No transactions yet
          </div>
          <div className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            Send a payment or receive one to see activity here
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((note) => {
            const expiry = new Date(note.expiryDate);
            const daysLeft = Math.max(
              0,
              Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            );
            const isUrgent = daysLeft <= 7 && note.status === 'active';
            const colors = statusColors[note.status] ?? statusColors.active;
            const isReceived = note.direction === 'received';
            const title = isReceived
              ? `From ${note.recipientName === 'Unknown' ? 'someone' : 'payer'}`
              : note.recipientName;
            // For received, recipientName is the original recipient (you); show counterparty better
            const displayName = isReceived
              ? 'Received payment'
              : note.recipientName || 'Sent payment';
            const sub = isReceived
              ? note.symbol
                ? `Against ${note.symbol} · ${formatDate(new Date(note.createdAt))}`
                : formatDate(new Date(note.createdAt))
              : note.recipientEmail || `Due ${formatDate(expiry)}`;

            return (
              <div
                key={note.id}
                className="card overflow-hidden"
                style={isUrgent ? { border: '1px solid rgba(245,158,11,0.2)' } : undefined}
              >
                <button
                  onClick={() => onSelectNote(note.id)}
                  className="flex items-center gap-4 p-5 text-left cursor-pointer w-full"
                >
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-[15px] font-bold"
                    style={{
                      background: isReceived
                        ? 'rgba(16,185,129,0.15)'
                        : 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                      color: isReceived ? 'var(--accent)' : '#fff',
                    }}
                  >
                    {isReceived ? '↓' : note.recipientName.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-[15px] font-semibold truncate">{displayName}</div>
                      <span
                        className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                        style={{
                          background: isReceived
                            ? 'rgba(16,185,129,0.12)'
                            : 'rgba(99,102,241,0.12)',
                          color: isReceived ? '#10B981' : '#818CF8',
                        }}
                      >
                        {isReceived ? 'In' : 'Out'}
                      </span>
                    </div>
                    <div className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {sub}
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                    <div
                      className="text-[15px] font-semibold"
                      style={{
                        fontVariantNumeric: 'tabular-nums',
                        color: isReceived ? 'var(--accent)' : 'var(--text-primary)',
                      }}
                    >
                      {isReceived ? '+' : '−'}
                      {formatUsd(note.amount)}
                    </div>
                    <span className="pill" style={{ background: colors.bg, color: colors.color }}>
                      {note.status}
                    </span>
                  </div>
                </button>

                {note.status === 'active' && !isReceived && (
                  <div
                    className="flex flex-col gap-2 px-5 py-3"
                    style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
                  >
                    {settleError && settlingId === null && (
                      <div className="text-[12px] text-center" style={{ color: 'var(--negative)' }}>
                        {settleError}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div
                        className="text-[12px]"
                        style={{ color: isUrgent ? '#F59E0B' : 'var(--text-tertiary)' }}
                      >
                        {daysLeft === 0
                          ? 'Expires today!'
                          : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} to repay`}
                      </div>
                      <button
                        onClick={(e) => handleSettle(e, note.id)}
                        disabled={settlingId === note.id}
                        className="text-[13px] font-semibold px-4 py-1.5 rounded-lg cursor-pointer transition-colors"
                        style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                      >
                        {settlingId === note.id ? (
                          <span className="flex items-center gap-1.5">
                            <Spinner size={14} />
                            {settleStatus || 'Settling...'}
                          </span>
                        ) : (
                          'Settle'
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
