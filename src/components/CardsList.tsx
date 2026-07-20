'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatUsd } from '@/lib/collar';
import { authFetch } from '@/lib/use-auth-fetch';
import Spinner from '@/components/Spinner';

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

interface Eligibility {
  portfolioValueUsd: number;
  txVolume90dUsd: number;
  checklistPortfolioOk: boolean;
  checklistActivityOk: boolean;
  minPortfolioUsd: number;
  minTxVolume90dUsd: number;
}

interface Application {
  id: number;
  status: string;
  fullName: string;
  createdAt: string;
}

interface CardsListProps {
  onGetCard: () => void;
  onSelectCard: (noteId: number) => void;
}

export default function CardsList({ onGetCard, onSelectCard }: CardsListProps) {
  const [cards, setCards] = useState<CardNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'demo' | 'apply'>(
    process.env.NEXT_PUBLIC_HEDERA_NETWORK === 'mainnet' ? 'apply' : 'demo'
  );
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [application, setApplication] = useState<Application | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [employmentStatus, setEmploymentStatus] = useState('');
  const [monthlyIncomeUsd, setMonthlyIncomeUsd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cardsRes, applyRes] = await Promise.all([
        authFetch('/api/notes?scope=cards'),
        authFetch('/api/cards/apply'),
      ]);
      const cardsData = await cardsRes.json();
      setCards(
        (cardsData.notes ?? []).filter(
          (n: CardNote) => n.cardLastFour || (n as { cardToken?: string }).cardToken
        )
      );
      if (applyRes.ok) {
        const applyData = await applyRes.json();
        setMode(applyData.mode === 'apply' ? 'apply' : 'demo');
        setEligibility(applyData.eligibility ?? null);
        setApplication(applyData.application ?? null);
      }
    } catch {
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const statusConfig: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: 'rgba(16,185,129,0.12)', color: '#10B981', label: 'Active' },
    repaid: { bg: 'rgba(99,102,241,0.12)', color: '#818CF8', label: 'Settled' },
    expired: { bg: 'rgba(239,68,68,0.12)', color: '#EF4444', label: 'Expired' },
  };

  const activeCards = cards.filter((c) => c.status === 'active');
  const pastCards = cards.filter((c) => c.status !== 'active');

  const canApply =
    eligibility?.checklistPortfolioOk && eligibility?.checklistActivityOk;

  const submitApplication = async () => {
    setFormError(null);
    setFormSuccess(null);
    if (!fullName.trim()) {
      setFormError('Full name is required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch('/api/cards/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone,
          country,
          city,
          employmentStatus,
          monthlyIncomeUsd: monthlyIncomeUsd ? Number(monthlyIncomeUsd) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submit failed');
      setApplication(data.application);
      setFormSuccess(data.message || 'Submitted for review');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="page-eyebrow" style={{ marginBottom: 6 }}>Cards</div>
          <div className="page-title" style={{ fontSize: 24 }}>Your cards</div>
          <div className="page-sub">
            {mode === 'apply'
              ? 'Apply for a Folio card'
              : cards.length === 0
                ? 'No cards issued yet'
                : `${activeCards.length} active`}
          </div>
        </div>
        {mode === 'demo' && (
          <button
            onClick={onGetCard}
            className="text-[13px] font-semibold px-4 py-2.5 rounded-xl cursor-pointer transition-all"
            style={{
              background: 'var(--accent-muted)',
              color: 'var(--accent)',
              border: '1px solid rgba(16,185,129,0.25)',
              backdropFilter: 'blur(10px)',
            }}
          >
            + Card
          </button>
        )}
      </div>

      {/* Mainnet: application only (no demo cards, no testnet wallet) */}
      {mode === 'apply' ? (
        <div className="space-y-6 mb-8">
          {/* Why apply */}
          <div
            className="rounded-2xl p-4 text-[13px] leading-relaxed"
            style={{
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.2)',
              color: 'var(--text-secondary)',
            }}
          >
            <div className="font-semibold mb-1" style={{ color: 'var(--accent)' }}>
              Card applications
            </div>
            Live cards require issuer approval. Meet the checklist, submit your details, and we will
            review your application.
          </div>

          {/* Checklist */}
          {eligibility && (
            <div className="card p-5 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Eligibility checklist
              </div>
              <CheckRow
                ok={eligibility.checklistPortfolioOk}
                label={`Portfolio of at least $${eligibility.minPortfolioUsd.toLocaleString()}`}
                detail={`Yours: $${eligibility.portfolioValueUsd.toFixed(0)}`}
              />
              <CheckRow
                ok={eligibility.checklistActivityOk}
                label={`Activity in last 90 days (min $${eligibility.minTxVolume90dUsd})`}
                detail={`Yours: $${eligibility.txVolume90dUsd.toFixed(0)} in advances`}
              />
            </div>
          )}

          {application && ['submitted', 'under_review', 'approved'].includes(application.status) ? (
            <div className="card p-6 space-y-3 text-center">
              <div
                className="w-14 h-14 mx-auto rounded-full flex items-center justify-center"
                style={{ background: 'var(--accent-muted)' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div className="text-[17px] font-bold">Application received</div>
              <div className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
                Status:{' '}
                <span style={{ color: 'var(--accent)' }} className="font-semibold capitalize">
                  {application.status.replace('_', ' ')}
                </span>
              </div>
              <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                We are reviewing your application and will follow up by email.
              </div>
            </div>
          ) : (
            <div className="card p-6 space-y-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Application
              </div>
              {!canApply && (
                <div className="text-[13px] p-3 rounded-xl" style={{ background: 'rgba(245,158,11,0.1)', color: '#FBBF24' }}>
                  Complete the checklist above (grow portfolio / use Spend) before applying.
                </div>
              )}
              <Field label="Full legal name" value={fullName} onChange={setFullName} placeholder="Alex Rivera" />
              <Field label="Phone" value={phone} onChange={setPhone} placeholder="+1 555 0100" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Country" value={country} onChange={setCountry} placeholder="US" />
                <Field label="City" value={city} onChange={setCity} placeholder="Miami" />
              </div>
              <Field
                label="Employment status"
                value={employmentStatus}
                onChange={setEmploymentStatus}
                placeholder="Employed / Self-employed / Other"
              />
              <Field
                label="Monthly income (USD)"
                value={monthlyIncomeUsd}
                onChange={setMonthlyIncomeUsd}
                placeholder="5000"
              />
              {formError && (
                <div className="text-[13px]" style={{ color: '#F87171' }}>
                  {formError}
                </div>
              )}
              {formSuccess && (
                <div className="text-[13px]" style={{ color: 'var(--accent)' }}>
                  {formSuccess}
                </div>
              )}
              <button
                type="button"
                disabled={submitting || !canApply}
                onClick={submitApplication}
                className="btn-primary w-full py-3.5 text-[14px] disabled:opacity-50"
              >
                {submitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner size={16} /> Submitting…
                  </span>
                ) : (
                  'Submit application'
                )}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            className="rounded-2xl p-4 mb-8 text-[13px] leading-relaxed"
            style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.25)',
              color: 'var(--text-secondary)',
            }}
          >
            <div className="font-semibold mb-1" style={{ color: '#FBBF24' }}>
              Cards
            </div>
            Issue a card when you spend, or apply for a full card when eligible.
          </div>

          {loading ? (
            <div role="status" aria-busy="true" className="flex flex-col gap-4">
              {[0, 1].map((i) => (
                <div key={i} className="card p-5">
                  <div className="skeleton h-32 w-full rounded-xl" />
                </div>
              ))}
            </div>
          ) : cards.length === 0 ? (
            <div className="text-center py-16 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
              No cards yet.
            </div>
          ) : (
            <div className="space-y-4">
              {activeCards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectCard(c.id)}
                  className="card p-5 w-full text-left"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-[15px] font-semibold">•••• {c.cardLastFour || '····'}</div>
                      <div className="text-[12px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                        {formatUsd(c.amount)} · {c.symbol}
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-semibold px-2 py-1 rounded-full"
                      style={{
                        background: statusConfig[c.status]?.bg,
                        color: statusConfig[c.status]?.color,
                      }}
                    >
                      {statusConfig[c.status]?.label || c.status}
                    </span>
                  </div>
                </button>
              ))}
              {pastCards.length > 0 && (
                <div
                  className="text-[11px] font-semibold uppercase tracking-wider pt-2"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Past
                </div>
              )}
              {pastCards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectCard(c.id)}
                  className="card p-4 w-full text-left opacity-80"
                >
                  <div className="text-[14px]">•••• {c.cardLastFour}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold"
        style={{
          background: ok ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)',
          color: ok ? 'var(--accent)' : 'var(--text-tertiary)',
        }}
      >
        {ok ? '✓' : '·'}
      </div>
      <div>
        <div className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>
          {label}
        </div>
        <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
          {detail}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl text-[14px] outline-none bg-transparent"
        style={{ border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-primary)' }}
      />
    </div>
  );
}
