'use client';

import { useState, useEffect, useRef } from 'react';
import type { PriceData, SpendResult } from '@/app/page';
import type { Holding } from '@/lib/types';
import type { ActiveNote } from '@/components/AiBubble';
import { calculateCollar, formatShares, formatUsd, formatDate } from '@/lib/collar';
import { authFetch } from '@/lib/use-auth-fetch';
import CollarGraph from '@/components/CollarGraph';
import { useHederaKey } from '@/lib/use-hedera-key';
import Spinner from '@/components/Spinner';

export type SpendMode = 'send' | 'card';

interface SpendFlowProps {
  mode: SpendMode;
  selectedHolding?: Holding | null;
  holdings: Holding[];
  prices: Record<string, PriceData>;
  currentUserAccountId?: string;
  activeNotes?: ActiveNote[];
  onBack: () => void;
  onComplete: (result: SpendResult) => void;
}

export default function SpendFlow({ mode, selectedHolding, holdings, prices, currentUserAccountId, activeNotes = [], onBack, onComplete }: SpendFlowProps) {
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<'idle' | 'preparing' | 'signing' | 'submitting'>('idle');
  const [sendError, setSendError] = useState('');
  const { signTransaction } = useHederaKey();
  const [showDetails, setShowDetails] = useState(false);
  const [currentHolding, setCurrentHolding] = useState<Holding | null>(
    selectedHolding ?? holdings.find((h) => h.shares > 0) ?? holdings[0] ?? null
  );
  const [showPicker, setShowPicker] = useState(false);

  // Keep selection in sync when parent holdings load after mount (empty → first stock)
  useEffect(() => {
    if (currentHolding) return;
    const next =
      selectedHolding ?? holdings.find((h) => h.shares > 0) ?? holdings[0] ?? null;
    if (next) setCurrentHolding(next);
  }, [selectedHolding, holdings, currentHolding]);
  const [recipientInput, setRecipientInput] = useState('');
  const [recipientAccountId, setRecipientAccountId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'checking' | 'found' | 'not-found' | 'self'>('idle');
  const verifyTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [durationMonths, setDurationMonths] = useState(1);

  // AI collar optimizer state — stores all 3 duration results for instant switching
  const [aiResults, setAiResults] = useState<Record<number, {
    recommendation: { floorPct: number; capPct: number; durationMonths: number; confidence: number; reasoning: string; riskLevel: string; warnings: string[]; oneLiner?: string };
    collar: { shares: number; floor: number; cap: number; advance: number; fee: number; expiryDate: string };
  }> | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  // Track AI-recommended duration
  const [aiRecommendedDuration, setAiRecommendedDuration] = useState<number>(1);

  const hasRecipient = mode === 'card' || !!recipientAccountId;
  const resolvedRecipientId = recipientAccountId;

  // Verify recipient email as they type
  useEffect(() => {
    if (mode !== 'send' || recipientAccountId) return;
    clearTimeout(verifyTimeout.current);
    const input = recipientInput.trim();

    if (!input || !input.includes('@')) {
      setVerifyStatus('idle');
      return;
    }

    setVerifyStatus('checking');
    verifyTimeout.current = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/users/search?q=${encodeURIComponent(input)}`);
        const data = await res.json();
        const users: { email: string; name: string; hederaAccountId: string }[] = data.users || [];

        // Filter out self and find exact email match
        const match = users.find(
          (u) => u.email.toLowerCase() === input.toLowerCase() && u.hederaAccountId !== currentUserAccountId
        );

        if (match) {
          setRecipientAccountId(match.hederaAccountId);
          setRecipientName(match.name || match.email);
          setVerifyStatus('found');
        } else {
          // Check if they tried their own email
          const self = users.find(
            (u) => u.email.toLowerCase() === input.toLowerCase() && u.hederaAccountId === currentUserAccountId
          );
          setVerifyStatus(self ? 'self' : 'not-found');
        }
      } catch {
        setVerifyStatus('not-found');
      }
    }, 500);
    return () => clearTimeout(verifyTimeout.current);
  }, [recipientInput, mode, recipientAccountId, currentUserAccountId]);

  // Debounced AI collar optimization — fetches all 3 durations in one call
  useEffect(() => {
    const val = parseFloat(amount) || 0;
    const symbol = currentHolding?.symbol;
    if (!val || !symbol) {
      setAiResults(null);
      return;
    }

    setAiLoading(true);
    setAiResults(null);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await authFetch('/api/ai/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, amount: val }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.durations) {
            setAiResults(data.durations);
            // Set AI-recommended duration from the response
            if (data.recommendation?.durationMonths) {
              setAiRecommendedDuration(data.recommendation.durationMonths);
            }
          }
        }
      } catch {
        // Silent degradation — AI optimization is non-blocking
      } finally {
        setAiLoading(false);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
      setAiLoading(false);
    };
  }, [amount, currentHolding?.symbol]);

  // Calculate locked shares per symbol from active notes (already in escrow)
  const lockedBySymbol = activeNotes.reduce<Record<string, number>>((acc, note) => {
    acc[note.symbol] = (acc[note.symbol] || 0) + note.shares;
    return acc;
  }, {});

  const spendableHoldings = holdings.filter((h) => {
    const available = h.shares - (lockedBySymbol[h.symbol] || 0);
    return available > 0;
  });

  // Empty portfolio (mainnet: no free stock) — guide user to Trade
  if (!currentHolding) {
    return (
      <div className="space-y-6">
        <button onClick={onBack} className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          ← Back
        </button>
        <div className="card p-8 text-center space-y-3">
          <div className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>
            No stock to spend against
          </div>
          <div className="text-[13px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            Buy equity on Trade first, then come back to borrow against your shares.
          </div>
        </div>
      </div>
    );
  }

  const { symbol, name: stockName, shares: totalShares, icon: stockIcon, gradient: stockGradient } = currentHolding;
  const lockedShares = lockedBySymbol[symbol] || 0;
  const availableShares = Math.max(0, totalShares - lockedShares);

  const priceLoaded = prices[symbol] !== undefined;
  const stockPrice = prices[symbol]?.price ?? 0;
  const val = parseFloat(amount) || 0;
  const maxSpend = availableShares * stockPrice;
  const collar = calculateCollar(val, stockPrice || 225, durationMonths);

  // Pick current duration's AI data — switching duration is instant from cached results
  const currentAi = aiResults?.[durationMonths]?.recommendation;
  const effectiveFloor = currentAi ? (stockPrice || 225) * (1 - currentAi.floorPct) : collar.floor;
  const effectiveCap = currentAi ? (stockPrice || 225) * (1 + currentAi.capPct) : collar.cap;

  const handleSend = async () => {
    if (val <= 0 || val > maxSpend || !currentUserAccountId) return;
    setSending(true);
    setSendError('');

    try {
      // Step 1: Prepare — server builds unsigned collateral lock transaction
      setSendStatus('preparing');
      const prepRes = await authFetch('/api/spend/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: val,
          symbol,
          durationMonths,
          userAccountId: currentUserAccountId || '',
        }),
      });

      if (!prepRes.ok) {
        const err = await prepRes.json().catch(() => ({}));
        throw new Error(err.details || err.error || 'Failed to prepare transaction');
      }

      const prepData = await prepRes.json();
      let signedCollateralTxBytes: string | undefined;
      let signedAllowanceTxBytes: string | undefined;
      let signedVaultDepositTxBytes: string | undefined;

      // Step 2: Sign — HTS allowance (if needed) then vault deposit, or legacy collateral lock
      if (prepData.needsAllowanceSignature && prepData.allowanceTxBytes) {
        setSendStatus('signing');
        signedAllowanceTxBytes = await signTransaction(prepData.allowanceTxBytes);
      }
      if (prepData.needsVaultDepositSignature && prepData.vaultDepositTxBytes) {
        setSendStatus('signing');
        signedVaultDepositTxBytes = await signTransaction(prepData.vaultDepositTxBytes);
      } else if (prepData.needsSignature && prepData.collateralLockTxBytes) {
        setSendStatus('signing');
        signedCollateralTxBytes = await signTransaction(prepData.collateralLockTxBytes);
      }

      // Step 3: Execute — server submits signed tx(s) and completes advance / note
      setSendStatus('submitting');
      const execRes = await authFetch('/api/spend/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedCollateralTxBytes,
          signedAllowanceTxBytes,
          signedVaultDepositTxBytes,
          amount: val,
          symbol,
          durationMonths,
          issueCard: mode === 'card',
          recipientAccountId: mode === 'send' ? resolvedRecipientId : undefined,
          recipientName: mode === 'send' ? (recipientName || undefined) : undefined,
          recipientEmail: mode === 'send' ? (recipientInput.trim() || undefined) : undefined,
          userAccountId: currentUserAccountId || '',
        }),
      });

      if (!execRes.ok) {
        const err = await execRes.json().catch(() => ({}));
        throw new Error(err.details || err.error || 'Transaction failed');
      }

      const data = await execRes.json();

      onComplete({
        symbol,
        amount: val,
        shares: collar.shares,
        durationMonths,
        expiryDate: collar.expiryDate.toISOString(),
        noteId: data.note.id,
        txId: data.txId,
        card: data.card,
        recipientName: mode === 'send' ? (recipientName || resolvedRecipientId) : undefined,
        recipientAccountId: mode === 'send' ? resolvedRecipientId : undefined,
        floor: data.collar?.floor,
        cap: data.collar?.cap,
        floorPct: data.collar?.floorPct,
        capPct: data.collar?.capPct,
        ai: data.ai,
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSending(false);
      setSendStatus('idle');
    }
  };

  // Transaction step display for contextual progress
  const txSteps = [
    { label: `Locking ${formatShares(collar.shares)} ${symbol} as collateral`, key: 'preparing' },
    { label: 'Confirming your signature', key: 'signing' },
    { label: mode === 'send' ? `Sending ${formatUsd(val)} to ${recipientName || 'recipient'}` : `Loading ${formatUsd(val)} onto your card`, key: 'submitting' },
  ];
  const activeStepIndex = sendStatus === 'preparing' ? 0 : sendStatus === 'signing' ? 1 : sendStatus === 'submitting' ? 2 : -1;

  return (
    <div className="space-y-8">
      {/* Shimmer animation uses global @keyframes shimmer from globals.css */}
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg cursor-pointer transition-colors"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-lg font-semibold">{mode === 'send' ? 'Send Payment' : 'Load Card'}</div>
      </div>

      {/* Recipient (send mode only) */}
      {mode === 'send' && (
        <div className="relative">
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Send to
          </div>

          {recipientAccountId ? (
            /* Verified recipient */
            <div className="card flex items-center gap-4 p-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,0.1)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--positive)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold truncate">{recipientName || recipientInput}</div>
                <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
                  Verified recipient
                </div>
              </div>
              <button onClick={() => {
                setRecipientAccountId('');
                setRecipientName('');
                setRecipientInput('');
                setVerifyStatus('idle');
              }} className="p-2 rounded-lg cursor-pointer transition-colors flex-shrink-0"
                style={{ color: 'var(--text-tertiary)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ) : (
            /* Input with inline verification */
            <div className="card p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--bg-elevated)' }}>
                  {verifyStatus === 'checking' ? (
                    <div className="w-4 h-4 border-2 rounded-full animate-spin"
                      style={{ borderColor: 'var(--text-tertiary)', borderTopColor: 'transparent' }} />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    value={recipientInput}
                    onChange={(e) => {
                      setRecipientInput(e.target.value);
                      setRecipientAccountId('');
                      setRecipientName('');
                      setVerifyStatus('idle');
                    }}
                    placeholder="name@example.com"
                    className="w-full bg-transparent border-none outline-none text-[15px] font-semibold"
                    style={{ color: 'var(--text-primary)', caretColor: 'var(--accent)' }}
                  />
                  <div className="text-[11px] mt-0.5" style={{
                    color: verifyStatus === 'self' ? 'var(--negative)'
                      : verifyStatus === 'not-found' ? 'var(--negative)'
                      : 'var(--text-tertiary)'
                  }}>
                    {verifyStatus === 'checking' && 'Verifying...'}
                    {verifyStatus === 'self' && "You can't send to yourself"}
                    {verifyStatus === 'not-found' && 'No user found with that email'}
                    {verifyStatus === 'idle' && 'Enter their email address'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Amount Input */}
      <div>
        <div className="flex items-center justify-center gap-0.5 mb-2">
          <span className="text-5xl font-bold" style={{ color: 'var(--text-tertiary)' }}>$</span>
          <input
            type="text"
            value={amount}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9.]/g, '');
              // Prevent multiple decimal points
              const parts = val.split('.');
              setAmount(parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : val);
            }}
            placeholder="0"
            className="text-5xl font-bold text-center bg-transparent border-none outline-none placeholder:text-[var(--text-tertiary)]"
            style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', caretColor: 'var(--accent)', width: `${Math.max(2, (amount || '0').length + 0.5)}ch` }}
            inputMode="decimal"
          />
        </div>
        <div className="text-center text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          Available: up to <strong style={{ color: 'var(--text-secondary)' }}>
            ${maxSpend.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </strong> from {stockName}
        </div>
      </div>

      {/* Paying From — tappable asset picker */}
      <div className="relative">
        <button
          onClick={() => spendableHoldings.length > 1 && setShowPicker(!showPicker)}
          className="card flex items-center gap-4 p-4 w-full text-left cursor-pointer transition-colors"
          style={{ border: showPicker ? '1px solid var(--accent)' : undefined }}
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white"
            style={{ background: stockGradient }}>{stockIcon}</div>
          <div className="flex-1">
            <div className="text-[14px] font-semibold">{stockName}</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {lockedShares > 0 ? `${formatShares(availableShares)} available · ${formatShares(lockedShares)} locked` : 'Paying from'}
            </div>
          </div>
          <div className="text-[15px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: priceLoaded ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
            {priceLoaded ? `$${maxSpend.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '···'}
          </div>
          {spendableHoldings.length > 1 && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round"
              style={{ transform: showPicker ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          )}
        </button>

        {showPicker && (
          <div className="card mt-1 overflow-hidden" style={{ position: 'absolute', left: 0, right: 0, zIndex: 10 }}>
            {spendableHoldings
              .filter((h) => h.symbol !== currentHolding.symbol)
              .map((h) => {
                const hp = prices[h.symbol];
                return (
                  <button
                    key={h.symbol}
                    onClick={() => { setCurrentHolding(h); setShowPicker(false); }}
                    className="flex items-center gap-4 p-4 w-full text-left cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: h.gradient }}>{h.icon}</div>
                    <div className="flex-1">
                      <div className="text-[14px] font-semibold">{h.name}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                        {formatShares(h.shares - (lockedBySymbol[h.symbol] || 0))} available{(lockedBySymbol[h.symbol] || 0) > 0 ? ` · ${formatShares(lockedBySymbol[h.symbol])} locked` : ''}
                      </div>
                    </div>
                    <div className="text-[15px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: hp ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                      {hp ? `$${((h.shares - (lockedBySymbol[h.symbol] || 0)) * hp.price).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '···'}
                    </div>
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* Deal Card — clean receipt-style summary */}
      <div className="card p-5 space-y-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
          0% interest loan
        </div>

        {/* Deal rows */}
        <div className="flex flex-col">
          {[
            { label: mode === 'send' ? 'They get' : 'You get', value: formatUsd(val) },
            { label: 'Collateral', value: `${formatShares(collar.shares)} ${symbol}` },
            { label: 'Your cost', value: '$0', accent: true },
            { label: 'Repay by', value: formatDate(collar.expiryDate) },
          ].map((row) => (
            <div key={row.label} className="flex justify-between text-[14px] py-2.5"
              style={{ borderTop: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>{row.label}</span>
              <span className="font-semibold" style={{
                color: row.accent ? 'var(--accent)' : 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* Duration Picker with AI recommendation */}
        <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-[11px] mb-3 uppercase tracking-wider font-medium" style={{ color: 'var(--text-tertiary)' }}>
            Repay within
          </div>
          <div className="flex gap-2.5">
            {[1, 2, 3].map((m) => {
              const active = durationMonths === m;
              const isRecommended = m === aiRecommendedDuration && aiResults !== null;
              return (
                <button
                  key={m}
                  onClick={() => setDurationMonths(m)}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all cursor-pointer"
                  style={{
                    background: active ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                    border: `1.5px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {m} mo{m > 1 ? 's' : ''}{isRecommended ? ' ★' : ''}
                </button>
              );
            })}
          </div>
        </div>

        {/* AI One-Liner */}
        {val > 0 && (
          <div>
            {aiLoading ? (
              <div className="flex items-center gap-2 py-3 px-4 rounded-xl"
                style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.08)' }}>
                <span style={{ color: 'var(--accent)', animation: 'pulse 2s infinite' }}>★</span>
                <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
                  Checking {symbol} market conditions...
                </span>
              </div>
            ) : currentAi?.oneLiner ? (
              <div className="flex items-start gap-2 py-3 px-4 rounded-xl"
                style={{
                  background: currentAi.warnings.length > 0 ? 'rgba(245,158,11,0.04)' : 'rgba(16,185,129,0.04)',
                  border: `1px solid ${currentAi.warnings.length > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)'}`,
                }}>
                <span className="mt-0.5 flex-shrink-0" style={{ color: currentAi.warnings.length > 0 ? 'var(--warning)' : 'var(--accent)' }}>★</span>
                <span className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {currentAi.oneLiner}
                </span>
              </div>
            ) : currentAi ? (
              <div className="flex items-start gap-2 py-3 px-4 rounded-xl"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>★</span>
                <span className="text-[13px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                  Market-based pricing applied.
                </span>
              </div>
            ) : null}
          </div>
        )}

        {/* Consequence text */}
        <div className="text-[12px] leading-relaxed pt-2" style={{ color: 'var(--text-tertiary)', borderTop: '1px solid var(--border)' }}>
          Repay {formatUsd(val)} anytime to unlock your shares. If not repaid by <strong style={{ color: 'var(--text-secondary)' }}>{formatDate(collar.expiryDate)}</strong>,
          you can extend for a fee or shares are sold to settle.
        </div>

        {/* Learn more — collar details for judges/power users */}
        <div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 text-[12px] cursor-pointer transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Learn more about how this works
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              style={{ transform: showDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {showDetails && (
            <div className="mt-4 pt-4 space-y-4" style={{ borderTop: '1px solid var(--border)' }}>
              {/* Collar visualization */}
              <CollarGraph price={stockPrice || 225} floor={effectiveFloor} cap={effectiveCap} stockName={stockName} durationMonths={durationMonths} />

              {/* Protection details */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="text-[15px] font-bold" style={{ color: '#EF4444', fontVariantNumeric: 'tabular-nums' }}>
                    ${effectiveFloor.toFixed(2)}
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>Protected floor</div>
                </div>
                <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="text-[15px] font-bold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                    ${effectiveCap.toFixed(2)}
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>Upside cap</div>
                </div>
              </div>

              {/* AI reasoning (detailed, for power users) */}
              {currentAi && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{
                      background: currentAi.riskLevel === 'conservative' ? 'rgba(16,185,129,0.1)' : currentAi.riskLevel === 'aggressive' ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)',
                      color: currentAi.riskLevel === 'conservative' ? 'var(--accent)' : currentAi.riskLevel === 'aggressive' ? 'var(--negative)' : '#3B82F6',
                    }}>
                      {currentAi.riskLevel === 'conservative' ? 'Conservative' : currentAi.riskLevel === 'aggressive' ? 'Aggressive' : 'Balanced'}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {Math.round(currentAi.confidence * 100)}% confidence
                    </span>
                  </div>
                  <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                    {currentAi.reasoning}
                  </div>
                  {currentAi.warnings.length > 0 && currentAi.warnings.map((w, i) => (
                    <div key={i} className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--text-tertiary)' }}>
                      <span style={{ color: '#F59E0B' }}>!</span> {w}
                    </div>
                  ))}
                </div>
              )}

              {/* How it works explanation */}
              <div className="text-[13px] leading-relaxed space-y-3" style={{ color: 'var(--text-tertiary)' }}>
                <p>
                  <strong style={{ color: 'var(--text-secondary)' }}>Why is this free?</strong>{' '}
                  Instead of charging interest, you temporarily cap your upside on {formatShares(collar.shares)} {stockName} shares
                  at <strong style={{ color: 'var(--accent)' }}>+{((effectiveCap / (stockPrice || 225) - 1) * 100).toFixed(1)}%</strong> for {durationMonths} month{durationMonths > 1 ? 's' : ''}.
                  That cap is how we fund the loan.
                </p>
                <p>
                  <strong style={{ color: 'var(--text-secondary)' }}>Downside protection.</strong>{' '}
                  If {stockName} drops more than {((1 - effectiveFloor / (stockPrice || 225)) * 100).toFixed(1)}% (below ${effectiveFloor.toFixed(0)}), we absorb the loss.
                </p>
                <p>
                  <strong style={{ color: 'var(--text-secondary)' }}>Repay anytime</strong> before {formatDate(collar.expiryDate)} and
                  your shares are fully unlocked. If not, you can extend for a fee or shares are sold to cover the balance.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {sendError && (
        <div className="text-center text-[13px] px-4 py-2 rounded-lg" style={{ color: 'var(--negative)', background: 'var(--bg-elevated)' }}>
          {sendError}
        </div>
      )}

      {/* Action Button — contextual transaction steps when sending */}
      {sending ? (
        <div className="card p-5">
          <div className="flex flex-col gap-3.5">
            {txSteps.map((step, i) => {
              const isDone = i < activeStepIndex;
              const isActive = i === activeStepIndex;
              return (
                <div key={step.key} className="flex items-center gap-3 text-[14px]">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isDone ? 'var(--accent-muted)' : isActive ? 'var(--accent)' : 'var(--bg-elevated)',
                      border: !isDone && !isActive ? '1.5px solid var(--border)' : 'none',
                      ...(isActive ? { boxShadow: '0 0 0 0 rgba(16,185,129,0.3)', animation: 'pulse 1.5s infinite' } : {}),
                    }}>
                    {isDone ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                    ) : isActive ? (
                      <Spinner size={12} color="#000" />
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
                    )}
                  </div>
                  <span style={{
                    color: isDone ? 'var(--text-secondary)' : isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: isActive ? 500 : 400,
                  }}>{step.label}</span>
                </div>
              );
            })}
          </div>
          {activeStepIndex === 2 && (
            <div className="text-center text-[11px] mt-3" style={{ color: 'var(--text-tertiary)' }}>
              Usually takes a few seconds
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={handleSend}
          disabled={!priceLoaded || val <= 0 || val > maxSpend || sending || !hasRecipient || !currentUserAccountId}
          className="btn-primary w-full py-4 text-[15px]"
        >
          {mode === 'send' ? `Send ${formatUsd(val)}` : `Get Card · ${formatUsd(val)} at 0%`}
        </button>
      )}
    </div>
  );
}
