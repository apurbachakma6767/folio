'use client';

import { useState, useEffect } from 'react';
import { formatUsd } from '@/lib/collar';
import { authFetch } from '@/lib/use-auth-fetch';

interface CardNote {
  id: number;
  amount: number;
  symbol: string;
  status: 'active' | 'repaid' | 'expired';
  cardLastFour?: string;
  cardState?: 'OPEN' | 'PAUSED' | 'CLOSED';
  createdAt: string;
  expiryDate: string;
}

interface CardsListProps {
  onGetCard: () => void;
  onSelectCard: (noteId: number) => void;
}

export default function CardsList({ onGetCard, onSelectCard }: CardsListProps) {
  const [cards, setCards] = useState<CardNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCards = async () => {
      try {
        const res = await authFetch('/api/notes');
        const data = await res.json();
        // Filter to notes that have a card associated
        const cardNotes = (data.notes ?? []).filter((n: CardNote) => n.cardLastFour);
        setCards(cardNotes);
      } catch {
        setCards([]);
      } finally {
        setLoading(false);
      }
    };
    fetchCards();
  }, []);

  const statusConfig: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: 'rgba(16,185,129,0.12)', color: '#10B981', label: 'Active' },
    repaid: { bg: 'rgba(99,102,241,0.12)', color: '#818CF8', label: 'Settled' },
    expired: { bg: 'rgba(239,68,68,0.12)', color: '#EF4444', label: 'Expired' },
  };

  // Separate active and past cards
  const activeCards = cards.filter((c) => c.status === 'active');
  const pastCards = cards.filter((c) => c.status !== 'active');

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="text-xl font-semibold">Cards</div>
          <div className="text-[13px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {cards.length === 0 ? 'No cards issued yet' : `${activeCards.length} active`}
          </div>
        </div>
        <button onClick={onGetCard} className="text-[13px] font-semibold px-4 py-2.5 rounded-xl cursor-pointer transition-all"
          style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid transparent' }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
        >
          + New Card
        </button>
      </div>

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="card p-5">
              <div className="skeleton h-48 w-full rounded-xl mb-4" />
              <div className="flex justify-between">
                <div className="space-y-2">
                  <div className="skeleton h-4 w-32 rounded" />
                  <div className="skeleton h-3 w-20 rounded" />
                </div>
                <div className="skeleton h-6 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: 'var(--bg-elevated)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
          </div>
          <div className="text-[17px] font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>No cards yet</div>
          <div className="text-[13px] mb-8 max-w-[280px] mx-auto leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            Get a prepaid Visa card backed by your portfolio. Spend anywhere, repay anytime.
          </div>
          <button onClick={onGetCard} className="btn-primary px-8 py-3.5 text-[14px]">
            Get Your First Card
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Cards */}
          {activeCards.length > 0 && (
            <div className="flex flex-col gap-3">
              {activeCards.map((card) => {
                const config = statusConfig[card.status];
                const created = new Date(card.createdAt);
                const expiry = new Date(card.expiryDate);
                const isFrozen = card.cardState === 'PAUSED';

                return (
                  <button
                    key={card.id}
                    onClick={() => onSelectCard(card.id)}
                    className="card p-5 text-left cursor-pointer transition-all w-full"
                    style={{ border: '1px solid var(--border)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                  >
                    {/* Mini card visual */}
                    <div
                      className="rounded-xl p-4 mb-4 relative overflow-hidden"
                      style={{
                        background: isFrozen
                          ? 'linear-gradient(135deg, #1E1E21 0%, #2A2A2E 100%)'
                          : 'linear-gradient(135deg, #0C0C0E 0%, #161618 40%, #1E1E21 100%)',
                        border: '1px solid var(--border)',
                        opacity: isFrozen ? 0.7 : 1,
                      }}
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div className="text-[12px] font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>Folio</div>
                        <div className="text-[10px] font-bold italic tracking-wider" style={{ color: 'rgba(245,245,247,0.3)' }}>VISA</div>
                      </div>
                      <div className="flex justify-between items-end">
                        <div className="text-[15px] font-mono tracking-[0.12em]" style={{ color: 'var(--text-primary)' }}>
                          •••• {card.cardLastFour}
                        </div>
                        <div className="text-[16px] font-bold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                          {formatUsd(card.amount)}
                        </div>
                      </div>
                      {isFrozen && (
                        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full"
                          style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          <span className="text-[9px] font-semibold" style={{ color: '#A1A1AA' }}>Frozen</span>
                        </div>
                      )}
                    </div>

                    {/* Card info row */}
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                          Folio Card •••• {card.cardLastFour}
                        </div>
                        <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                          {card.symbol} · {created.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · Settle by {expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                      <span className="pill" style={{ background: config.bg, color: config.color }}>
                        {isFrozen ? 'Frozen' : config.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Past Cards */}
          {pastCards.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Past Cards
              </div>
              <div className="flex flex-col gap-2">
                {pastCards.map((card) => {
                  const config = statusConfig[card.status] ?? statusConfig.active;
                  const created = new Date(card.createdAt);

                  return (
                    <button
                      key={card.id}
                      onClick={() => onSelectCard(card.id)}
                      className="card flex items-center gap-4 p-4 text-left cursor-pointer transition-colors w-full"
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)')}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                      <div
                        className="w-12 h-8 rounded-lg flex items-center justify-end pr-2 text-[9px] font-mono flex-shrink-0"
                        style={{
                          background: 'linear-gradient(135deg, #1E1E21, #2A2A2E)',
                          color: 'var(--text-tertiary)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {card.cardLastFour}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                          •••• {card.cardLastFour}
                        </div>
                        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                          {card.symbol} · {created.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1.5">
                        <div className="text-[14px] font-semibold" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                          {formatUsd(card.amount)}
                        </div>
                        <span className="pill" style={{ background: config.bg, color: config.color }}>
                          {config.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
