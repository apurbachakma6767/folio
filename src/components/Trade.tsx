'use client';

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import { authFetch } from '@/lib/use-auth-fetch';
import type { PriceData } from '@/app/page';
import { TRADE_STOCKS, holdingGradient } from '@/lib/types';
import { useHederaKey } from '@/lib/use-hedera-key';
import Spinner from '@/components/Spinner';

interface Order {
  id: number;
  side: 'buy' | 'sell';
  symbol: string;
  shares: number;
  notionalUsd?: number;
  limitPrice?: number;
  status: string;
  createdAt: string;
}

interface TradeProps {
  prices: Record<string, PriceData>;
  stockHoldings: { symbol: string; shares: number }[];
  /** Available USDC for buy sizing */
  usdcBalance?: number;
  onHoldingsChanged?: () => void;
}

const PCT_PRESETS = [25, 50, 75, 100] as const;

function formatAmount(value: number, decimals: number) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const fixed = value.toFixed(decimals);
  // Trim trailing zeros: "10.50" → "10.5", "10.00" → "10"
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export default function Trade({
  prices,
  stockHoldings,
  usdcBalance = 0,
  onHoldingsChanged,
}: TradeProps) {
  const { signTransaction } = useHederaKey();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [symbol, setSymbol] = useState('TSLA');
  const [mode, setMode] = useState<'shares' | 'usd'>('usd');
  const [amount, setAmount] = useState('10');
  const [pct, setPct] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  const stockMeta = TRADE_STOCKS.find((s) => s.symbol === symbol) ?? TRADE_STOCKS[0];
  const price = prices[symbol]?.price ?? 0;
  const priceLoaded = !!prices[symbol];
  const gradient = holdingGradient(symbol);
  const icon = symbol.charAt(0);
  const accent = side === 'buy' ? 'var(--accent)' : '#EF4444';
  const accentMuted = side === 'buy' ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)';
  const accentBorder = side === 'buy' ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)';

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setLoadingOrders(true);
    try {
      const res = await authFetch('/api/trade/orders');
      const data = await res.json();
      setOrders(data.orders || []);
    } catch {
      if (!silent) setOrders([]);
    } finally {
      if (!silent) setLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    // Poll while any order is pending/processing so UI advances to filled
    const id = setInterval(() => {
      setOrders((prev) => {
        const busy = prev.some((o) => o.status === 'pending' || o.status === 'processing');
        if (busy) loadOrders(true);
        return prev;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [loadOrders]);

  const holdingShares =
    stockHoldings.find((h) => h.symbol === symbol)?.shares ?? 0;

  /** Max spendable base units for current side + mode */
  const maxAvailable = useMemo(() => {
    if (side === 'buy') {
      // Buy with USDC
      if (mode === 'usd') return Math.max(0, usdcBalance);
      // shares mode: how many shares USDC can buy
      return price > 0 ? Math.max(0, usdcBalance / price) : 0;
    }
    // Sell holdings
    if (mode === 'shares') return Math.max(0, holdingShares);
    // usd mode: dollar value of holdings
    return price > 0 ? Math.max(0, holdingShares * price) : 0;
  }, [side, mode, usdcBalance, holdingShares, price]);

  const maxLabel =
    side === 'buy'
      ? `$${usdcBalance.toFixed(2)} USDC`
      : `${holdingShares.toFixed(4)} ${symbol}`;

  const applyPercent = useCallback(
    (nextPct: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(nextPct)));
      setPct(clamped);
      if (maxAvailable <= 0 || clamped === 0) {
        setAmount('');
        return;
      }
      const raw = (maxAvailable * clamped) / 100;
      const decimals = mode === 'usd' ? 2 : 4;
      setAmount(formatAmount(raw, decimals) || raw.toFixed(decimals));
    },
    [maxAvailable, mode]
  );

  // Recompute amount when available balance / unit mode changes while a % is selected
  useEffect(() => {
    if (pct <= 0) return;
    if (maxAvailable <= 0) {
      setAmount('');
      return;
    }
    const raw = (maxAvailable * pct) / 100;
    const decimals = mode === 'usd' ? 2 : 4;
    setAmount(formatAmount(raw, decimals) || raw.toFixed(decimals));
  }, [maxAvailable, mode, side, symbol]); // eslint-disable-line react-hooks/exhaustive-deps -- pct intentionally omitted

  // Derive pct from manual amount edits
  const syncPctFromAmount = (value: string) => {
    setAmount(value);
    const n = Number(value);
    if (!value || !Number.isFinite(n) || n <= 0 || maxAvailable <= 0) {
      setPct(0);
      return;
    }
    const derived = Math.round((n / maxAvailable) * 100);
    setPct(Math.max(0, Math.min(100, derived)));
  };

  const parsed = Number(amount);
  const shares =
    mode === 'shares'
      ? parsed
      : price > 0 && parsed > 0
        ? parsed / price
        : 0;
  const notional = mode === 'usd' ? parsed : shares * price;

  const submit = async () => {
    setError(null);
    setSuccess(null);
    if (!parsed || parsed <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (side === 'buy' && notional > usdcBalance + 0.01) {
      setError(`You only have $${usdcBalance.toFixed(2)} USDC`);
      return;
    }
    if (side === 'sell' && shares > holdingShares + 1e-9) {
      setError(`You only have ${holdingShares.toFixed(4)} ${symbol} tokens`);
      return;
    }
    setSubmitting(true);
    try {
      const prepBody: Record<string, unknown> = { side, symbol };
      if (mode === 'shares') prepBody.shares = parsed;
      else prepBody.notionalUsd = parsed;

      // 1) Prepare gasless settlement (buy: USDC→treasury, sell: stock→treasury)
      const prepRes = await authFetch('/api/trade/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepBody),
      });
      const prep = await prepRes.json();
      if (!prepRes.ok) throw new Error(prep.error || 'Prepare failed');

      // Associate new equity HTS if needed (gasless). Non-fatal: auto-assoc accounts
      // receive tokens on fill without explicit association.
      if (prep.needsAssociate && prep.associateTxBytes) {
        try {
          const signedAssoc = await signTransaction(prep.associateTxBytes);
          const assocRes = await authFetch('/api/trade/associate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signedAssociateTxBytes: signedAssoc }),
          });
          if (!assocRes.ok) {
            const err = await assocRes.json().catch(() => ({}));
            const em = String(err.error || '');
            if (
              !em.includes('TOKEN_ALREADY_ASSOCIATED') &&
              !em.includes('already-associated') &&
              !em.includes('INVALID_SIGNATURE')
            ) {
              console.warn('[trade] associate:', em);
            }
            // INVALID_SIGNATURE often means key mismatch or already associated — continue
          }
        } catch (assocErr) {
          console.warn(
            '[trade] associate skipped:',
            assocErr instanceof Error ? assocErr.message : assocErr
          );
        }
      }

      let signedSettlementTxBytes: string | undefined;
      if (prep.needsSignature && prep.settlementTxBytes) {
        signedSettlementTxBytes = await signTransaction(prep.settlementTxBytes);
      }

      // Create order with signed settlement; server auto-fills in ~10s
      const res = await authFetch('/api/trade/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...prepBody,
          signedSettlementTxBytes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Order failed');
      setSuccess(data.message || 'Order placed');
      setAmount('');
      setPct(0);
      await loadOrders();
      // Refresh portfolio after auto-fill window
      setTimeout(() => {
        loadOrders(true);
        onHoldingsChanged?.();
      }, 11_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-7">
      <div>
        <div className="page-eyebrow">Trade</div>
        <div className="page-title">Buy & sell</div>
        <div className="page-sub">Equity tokens settled on Hedera</div>
      </div>

      <div
        className="card p-4 text-[13px] leading-relaxed"
        style={{
          background:
            'linear-gradient(145deg, rgba(59,130,246,0.12) 0%, rgba(22,22,24,0.45) 100%)',
          borderColor: 'rgba(59,130,246,0.22)',
          color: 'var(--text-secondary)',
        }}
      >
        <div className="font-semibold mb-1" style={{ color: '#93C5FD' }}>
          More brokerages coming soon
        </div>
        Robinhood, Groww, Zerodha and others will connect later. For now, place orders here.
      </div>

      <div className="card p-6 space-y-5">
        <div className="segmented">
          {(['buy', 'sell'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSide(s);
                setPct(0);
                setAmount('');
                setError(null);
                // Default mode: buy in USD, sell in shares
                setMode(s === 'buy' ? 'usd' : 'shares');
              }}
              className="segmented-btn capitalize"
              data-active={side === s}
              data-tone={s}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Stock picker — Spend-style card + list */}
        <div className="relative">
          <div className="section-label mb-2">Stock</div>
          <button
            type="button"
            onClick={() => setShowPicker(!showPicker)}
            className="glass-inset flex items-center gap-4 p-4 w-full text-left cursor-pointer transition-colors"
            style={{
              borderColor: showPicker ? 'rgba(16,185,129,0.45)' : undefined,
              boxShadow: showPicker ? '0 0 0 3px rgba(16,185,129,0.1)' : undefined,
            }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: gradient }}
            >
              {icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold">{stockMeta.name}</div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {symbol}
                {holdingShares > 0 ? ` · you hold ${holdingShares.toFixed(3)}` : ''}
              </div>
            </div>
            <div
              className="text-[15px] font-semibold tabular-nums"
              style={{ color: priceLoaded ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
            >
              {priceLoaded ? `$${price.toFixed(2)}` : '···'}
            </div>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
              style={{
                transform: showPicker ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
                flexShrink: 0,
              }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {showPicker && (
            <div
              className="card mt-1 overflow-hidden max-h-[280px] overflow-y-auto"
              style={{ position: 'absolute', left: 0, right: 0, zIndex: 20 }}
            >
              {TRADE_STOCKS.map((s) => {
                const p = prices[s.symbol];
                const held = stockHoldings.find((h) => h.symbol === s.symbol)?.shares ?? 0;
                const selected = s.symbol === symbol;
                return (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => {
                      setSymbol(s.symbol);
                      setShowPicker(false);
                    }}
                    className="flex items-center gap-4 p-4 w-full text-left cursor-pointer transition-colors"
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: selected ? 'var(--accent-muted)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!selected) e.currentTarget.style.background = 'var(--bg-elevated)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = selected ? 'var(--accent-muted)' : 'transparent';
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: holdingGradient(s.symbol) }}
                    >
                      {s.symbol.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold">{s.name}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                        {s.symbol}
                        {held > 0 ? ` · ${held.toFixed(3)} held` : ''}
                      </div>
                    </div>
                    <div
                      className="text-[15px] font-semibold tabular-nums"
                      style={{ color: p ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
                    >
                      {p ? `$${p.price.toFixed(2)}` : '···'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="flex justify-between mb-2">
            <div className="section-label">Amount</div>
            <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.25)' }}>
              {(['usd', 'shares'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    // Re-apply pct in new units
                    if (pct > 0) {
                      // apply after mode state updates via effect
                    } else {
                      setAmount('');
                    }
                  }}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-md capitalize"
                  style={{
                    color: mode === m ? accent : 'var(--text-tertiary)',
                    background: mode === m ? accentMuted : 'transparent',
                  }}
                >
                  {m === 'usd' ? 'USD' : 'Shares'}
                </button>
              ))}
            </div>
          </div>
          <div className="glass-inset py-5 px-4 mb-3">
            <div className="flex items-center justify-center gap-0.5">
              {mode === 'usd' && (
                <span className="text-4xl font-bold" style={{ color: 'var(--text-tertiary)' }}>
                  $
                </span>
              )}
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '' || /^\d*\.?\d*$/.test(v)) syncPctFromAmount(v);
                }}
                className="text-4xl font-bold text-center bg-transparent border-none outline-none"
                style={{
                  color: 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                  caretColor: accent,
                  width: `${Math.max(2, (amount || '0').length + 0.5)}ch`,
                }}
                placeholder="0"
              />
            </div>
            <div className="text-center text-[12px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
              ≈ {shares > 0 ? shares.toFixed(4) : '—'} shares · $
              {notional > 0 ? notional.toFixed(2) : '—'}
            </div>
          </div>

          {/* Percentage slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="section-label">
                {side === 'buy' ? '% of USDC' : '% of holdings'}
              </div>
              <div
                className="text-[13px] font-bold tabular-nums px-2 py-0.5 rounded-lg"
                style={{
                  color: accent,
                  background: accentMuted,
                  border: `1px solid ${accentBorder}`,
                }}
              >
                {pct}%
              </div>
            </div>

            <div
              className="relative flex items-center"
              style={{ height: 32 }}
            >
              <div
                className="absolute left-0 right-0 h-2 rounded-full overflow-hidden pointer-events-none"
                style={{ background: 'rgba(255,255,255,0.08)' }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-75"
                  style={{
                    width: `${pct}%`,
                    background:
                      side === 'buy'
                        ? 'linear-gradient(90deg, rgba(16,185,129,0.55), #10B981)'
                        : 'linear-gradient(90deg, rgba(239,68,68,0.55), #EF4444)',
                    boxShadow:
                      side === 'buy'
                        ? '0 0 12px rgba(16,185,129,0.45)'
                        : '0 0 12px rgba(239,68,68,0.4)',
                  }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={pct}
                disabled={maxAvailable <= 0}
                onChange={(e) => applyPercent(Number(e.target.value))}
                onPointerDown={() => setDragging(true)}
                onPointerUp={() => setDragging(false)}
                onPointerCancel={() => setDragging(false)}
                className="trade-pct-slider"
                aria-label={side === 'buy' ? 'Percent of USDC' : 'Percent of holdings'}
                style={
                  {
                    '--slider-accent': side === 'buy' ? '#10B981' : '#EF4444',
                    '--slider-thumb-scale': dragging ? '1.15' : '1',
                  } as CSSProperties
                }
              />
            </div>

            <div className="flex gap-2">
              {PCT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={maxAvailable <= 0}
                  onClick={() => applyPercent(p)}
                  className="flex-1 py-2 rounded-xl text-[12px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: pct === p ? accentMuted : 'rgba(255,255,255,0.04)',
                    color: pct === p ? accent : 'var(--text-secondary)',
                    border:
                      pct === p
                        ? `1px solid ${accentBorder}`
                        : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {p}%
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              <span>
                Available: <strong style={{ color: 'var(--text-secondary)' }}>{maxLabel}</strong>
              </span>
              {maxAvailable <= 0 && (
                <span style={{ color: '#F59E0B' }}>
                  {side === 'buy' ? 'Deposit USDC to buy' : `No ${symbol} to sell`}
                </span>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div
            className="text-[13px] p-3 rounded-xl"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#F87171' }}
          >
            {error}
          </div>
        )}
        {success && (
          <div
            className="text-[13px] p-3 rounded-xl"
            style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--accent)' }}
          >
            {success}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="btn-primary w-full py-4 text-[15px]"
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <Spinner size={16} /> Submitting…
            </span>
          ) : (
            `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`
          )}
        </button>
      </div>

      <div className="card p-6">
        <div className="flex justify-between items-center mb-4">
          <div className="section-label">Your orders</div>
          <button
            type="button"
            onClick={() => loadOrders()}
            className="text-[12px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            Refresh
          </button>
        </div>
        {loadingOrders ? (
          <div className="flex justify-center py-6">
            <Spinner size={22} />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            No orders yet.
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <div
                key={o.id}
                className="glass-inset flex justify-between gap-3 px-3.5 py-3 mb-2 last:mb-0"
              >
                <div>
                  <div className="text-[14px] font-semibold capitalize">
                    {o.side} {o.symbol}
                  </div>
                  <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                    {o.shares.toFixed(4)} sh · ${o.notionalUsd?.toFixed(2) ?? '—'} ·{' '}
                    {new Date(o.createdAt).toLocaleString()}
                  </div>
                </div>
                <div
                  className="text-[11px] font-semibold uppercase h-fit px-2 py-1 rounded-full"
                  style={{
                    background:
                      o.status === 'filled'
                        ? 'rgba(16,185,129,0.12)'
                        : o.status === 'processing'
                          ? 'rgba(59,130,246,0.12)'
                          : o.status === 'pending'
                            ? 'rgba(245,158,11,0.12)'
                            : 'rgba(239,68,68,0.12)',
                    color:
                      o.status === 'filled'
                        ? '#10B981'
                        : o.status === 'processing'
                          ? '#60A5FA'
                          : o.status === 'pending'
                            ? '#F59E0B'
                            : '#EF4444',
                  }}
                >
                  {o.status === 'processing' ? 'processing…' : o.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
