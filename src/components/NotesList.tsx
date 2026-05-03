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
}

interface NotesListProps {
  onSelectNote: (noteId: number) => void;
}

export default function NotesList({ onSelectNote }: NotesListProps) {
  const [notes, setNotes] = useState<SpendNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [settlingId, setSettlingId] = useState<number | null>(null);
  const [settleStatus, setSettleStatus] = useState<string>('');
  const [settleError, setSettleError] = useState<string | null>(null);
  const { signTransaction } = useHederaKey();

  const fetchNotes = async () => {
    try {
      const res = await authFetch('/api/notes');
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
      // Step 1: Prepare — server builds unsigned USDC repayment tx
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

      // Step 2: Sign — client signs USDC transfer with their private key
      if (prepData.needsSignature && prepData.repayTxBytes) {
        setSettleStatus('Signing...');
        signedRepayTxBytes = await signTransaction(prepData.repayTxBytes);
      }

      // Step 3: Execute — server co-signs, submits USDC transfer, returns collateral
      setSettleStatus('Settling...');
      const res = await authFetch('/api/spend/repay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, signedRepayTxBytes }),
      });

      if (res.ok) {
        setNotes((prev) => prev.map((n) => n.id === noteId ? { ...n, status: 'repaid' as const } : n));
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

  return (
    <div>
      <div className="text-xl font-semibold mb-6">Transactions</div>

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card flex items-center gap-4 p-5">
              <div className="skeleton w-11 h-11 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-24 rounded" />
                <div className="skeleton h-3 w-16 rounded" />
              </div>
              <div className="flex flex-col items-end space-y-2">
                <div className="skeleton h-4 w-20 rounded" />
                <div className="skeleton h-5 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{ background: 'var(--bg-elevated)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <div className="text-[15px] font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>No transactions yet</div>
          <div className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            Send a payment to create your first transaction
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notes.map((note) => {
            const expiry = new Date(note.expiryDate);
            const daysLeft = Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
            const isUrgent = daysLeft <= 7 && note.status === 'active';
            const colors = statusColors[note.status] ?? statusColors.active;

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
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-[15px] font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #6366F1, #8B5CF6)' }}>
                    {note.recipientName.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold">{note.recipientName}</div>
                    <div className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {note.recipientEmail || `Due ${formatDate(expiry)}`}
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                    <div className="text-[15px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatUsd(note.amount)}
                    </div>
                    <span className="pill" style={{ background: colors.bg, color: colors.color }}>
                      {note.status}
                    </span>
                  </div>
                </button>

                {/* Repayment bar for active notes */}
                {note.status === 'active' && (
                  <div className="flex flex-col gap-2 px-5 py-3"
                    style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                    {settleError && settlingId === null && (
                      <div className="text-[12px] text-center" style={{ color: 'var(--negative)' }}>{settleError}</div>
                    )}
                    <div className="flex items-center justify-between">
                    <div className="text-[12px]" style={{ color: isUrgent ? '#F59E0B' : 'var(--text-tertiary)' }}>
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
                      {settlingId === note.id ? <span className="flex items-center gap-1.5"><Spinner size={14} />{settleStatus || 'Settling...'}</span> : 'Settle'}
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
