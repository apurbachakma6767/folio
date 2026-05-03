'use client';

import { useState } from 'react';
import type { PriceData } from '@/app/page';
import type { ActiveNote } from '@/components/AiBubble';
import type { Holding } from '@/lib/types';
import type { PlaidStatus } from '@/lib/use-plaid-holdings';
import { formatUsd, formatShares } from '@/lib/collar';
import { authFetch } from '@/lib/use-auth-fetch';
import { useHederaKey } from '@/lib/use-hedera-key';
import { useAnimatedNumber } from '@/lib/use-animated-number';
import Spinner from '@/components/Spinner';

function AnimatedValue({ value, prefix = '' }: { value: number; prefix?: string }) {
  const animated = useAnimatedNumber(value);
  return <>{prefix}{animated.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>;
}

interface PortfolioProps {
  holdings: Holding[];
  cryptoHoldings: Holding[];
  prices: Record<string, PriceData>;
  plaidStatus: PlaidStatus;
  isPlaidAvailable: boolean;
  isDemo: boolean;
  activeNotes: ActiveNote[];
  onConnectBrokerage: () => void;
  onSpendFromHolding: (holding: Holding) => void;
  onSpend: () => void;
  onViewNotes: () => void;
  onViewCards: () => void;
  onSettleNote: () => void;
}

export default function Portfolio({
  holdings,
  cryptoHoldings,
  prices,
  plaidStatus,
  isPlaidAvailable,
  isDemo,
  activeNotes,
  onConnectBrokerage,
  onSpendFromHolding,
  onSpend,
  onViewNotes,
  onViewCards,
  onSettleNote,
}: PortfolioProps) {
  const [settling, setSettling] = useState(false);
  const [settleStatus, setSettleStatus] = useState('');
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settleSuccess, setSettleSuccess] = useState(false);
  const [advanceDismissedUntil, setAdvanceDismissedUntil] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    try {
      return Number(sessionStorage.getItem('folio:advance-dismissed-until') || '0');
    } catch {
      return 0;
    }
  });
  const { signTransaction } = useHederaKey();

  // Calculate locked shares per symbol from active notes
  const lockedBySymbol = activeNotes.reduce<Record<string, number>>((acc, note) => {
    acc[note.symbol] = (acc[note.symbol] || 0) + note.shares;
    return acc;
  }, {});

  const visibleHoldings = holdings.filter((h) => h.shares > 0);

  // Most urgent active note (closest expiry, then largest amount)
  const urgentNote = activeNotes.length > 0
    ? [...activeNotes].sort((a, b) => {
        const dateCompare = new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
        if (dateCompare !== 0) return dateCompare;
        return b.amount - a.amount;
      })[0]
    : null;

  // Crypto holdings value (USDC and CARDS = $1 each)
  const cryptoValue = cryptoHoldings.reduce((sum, h) => {
    if (h.symbol === 'USDC' || h.symbol === 'CARDS') return sum + h.shares;
    return sum;
  }, 0);

  // Outstanding advances are liabilities — subtract so portfolio nets to zero
  const outstandingAdvances = activeNotes.reduce((sum, n) => sum + n.amount, 0);

  const totalValue = holdings.reduce((sum, h) => {
    const price = prices[h.symbol]?.price ?? 0;
    return sum + h.shares * price;
  }, 0) + cryptoValue - outstandingAdvances;

  // Value of locked collateral (can't be spent)
  const lockedValue = Object.entries(lockedBySymbol).reduce((sum, [sym, shares]) => {
    const price = prices[sym]?.price ?? 0;
    return sum + shares * price;
  }, 0);

  const spendableValue = totalValue - lockedValue;

  const totalChange = holdings.reduce((sum, h) => {
    const change = prices[h.symbol]?.change ?? 0;
    return sum + h.shares * change;
  }, 0);

  const animatedTotal = useAnimatedNumber(totalValue);
  const animatedSpendable = useAnimatedNumber(spendableValue);

  const isPositive = totalChange >= 0;
  const hasHoldings = visibleHoldings.length > 0;

  // Check if any price is from fallback (not live)
  const sources = Object.values(prices).map((p) => p.source);
  const pricesLoaded = sources.length > 0;
  const isLive = pricesLoaded && sources.every((s) => s === 'live' || s === 'cached');

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-medium mb-3 uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
          <span>Total Portfolio</span>
          {pricesLoaded && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                color: isLive ? 'var(--positive)' : 'var(--negative)',
                background: isLive ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: isLive ? 'var(--positive)' : 'var(--negative)' }} />
              {isLive ? 'LIVE' : 'OFFLINE'}
            </span>
          )}
        </div>
        <div className="text-[44px] font-bold tracking-tight leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>
          ${animatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <span className="text-sm font-semibold px-2.5 py-1 rounded-lg"
            style={{
              color: isPositive ? 'var(--positive)' : 'var(--negative)',
              background: isPositive ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            }}>
            {isPositive ? '+' : ''}{totalChange.toFixed(2)}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>today</span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <button onClick={onSpend} disabled={!hasHoldings} className="btn-primary flex-1 py-4 text-[15px]">
          Send Payment
        </button>
        <button onClick={onViewNotes} className="btn-secondary flex-1 py-4 text-[15px]">
          Transactions
        </button>
      </div>

      {/* Outstanding Advance */}
      {urgentNote && !settleSuccess && Date.now() >= advanceDismissedUntil && (
        <div className="card p-6 relative overflow-hidden"
          style={{ border: '1px solid rgba(245,158,11,0.2)' }}>
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-[0.04]"
            style={{ background: '#F59E0B', filter: 'blur(40px)', transform: 'translate(30%, -30%)' }} />
          {/* Close button — dismisses until next note expiry or 24h */}
          <button
            onClick={() => {
              // Find the next note expiry, or default to 24h from now
              const sortedExpiries = activeNotes
                .map((n) => new Date(n.expiryDate).getTime())
                .sort((a, b) => a - b);
              const now = Date.now();
              const nextExpiry = sortedExpiries.find((t) => t > now);
              const dismissUntil = nextExpiry ?? now + 24 * 60 * 60 * 1000;
              setAdvanceDismissedUntil(dismissUntil);
              try { sessionStorage.setItem('folio:advance-dismissed-until', String(dismissUntil)); } catch { /* */ }
            }}
            className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full z-10 cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            aria-label="Dismiss"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
          <div className="flex items-center justify-between mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#F59E0B' }}>
              Outstanding Advance
            </div>
            {(() => {
              const daysLeft = Math.max(0, Math.ceil((new Date(urgentNote.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
              return daysLeft <= 7 ? (
                <div className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(245,158,11,0.1)', color: '#F59E0B' }}>
                  {daysLeft === 0 ? 'Expires today' : `${daysLeft}d left`}
                </div>
              ) : null;
            })()}
          </div>
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-[28px] font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatUsd(urgentNote.amount)}
            </div>
          </div>
          <div className="text-[13px] mb-5" style={{ color: 'var(--text-tertiary)' }}>
            {formatShares(urgentNote.shares)} {urgentNote.symbol} shares locked as collateral
            {activeNotes.length > 1 && (
              <span style={{ color: 'var(--text-tertiary)' }}> · and {activeNotes.length - 1} more</span>
            )}
          </div>
          {settleError && (
            <div className="text-[13px] mb-3 text-center" style={{ color: 'var(--negative)' }}>{settleError}</div>
          )}
          <button
            onClick={async () => {
              setSettling(true);
              setSettleError(null);
              try {
                // Step 1: Prepare
                setSettleStatus('Preparing...');
                const prepRes = await authFetch('/api/spend/repay/prepare', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ noteId: urgentNote.id }),
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
                  body: JSON.stringify({ noteId: urgentNote.id, signedRepayTxBytes }),
                });
                if (res.ok) {
                  setSettleSuccess(true);
                  setTimeout(() => {
                    setSettleSuccess(false);
                    onSettleNote();
                  }, 3000);
                } else {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err.error || 'Settlement failed');
                }
              } catch (err) {
                setSettleError(err instanceof Error ? err.message : 'Settlement failed. Try again.');
                setTimeout(() => setSettleError(null), 5000);
              } finally {
                setSettling(false);
                setSettleStatus('');
              }
            }}
            disabled={settling}
            className="btn-primary w-full py-3.5 text-[14px]"
          >
            {settling ? <span className="flex items-center justify-center gap-2"><Spinner size={16} />{settleStatus || 'Settling...'}</span> : `Settle & Unlock ${urgentNote.symbol}`}
          </button>
        </div>
      )}

      {/* Settle Success */}
      {settleSuccess && (
        <div className="card p-6 text-center"
          style={{ border: '1px solid rgba(16,185,129,0.2)' }}>
          <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(16,185,129,0.12)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div className="text-[16px] font-bold" style={{ color: '#10B981' }}>Advance Settled</div>
          <div className="text-[13px] mt-1" style={{ color: 'var(--text-tertiary)' }}>Shares unlocked and returned</div>
        </div>
      )}

      {/* Connect Brokerage or Holdings */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Holdings
          </div>
          {isDemo && (
            <div className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--accent)' }}>
              HTS Tokenized
            </div>
          )}
        </div>

        {plaidStatus === 'loading' ? (
          <div role="status" aria-busy="true" aria-label="Loading" className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card flex items-center gap-4 p-5">
                <div className="skeleton w-11 h-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-24 rounded" />
                  <div className="skeleton h-3 w-16 rounded" />
                </div>
                <div className="flex flex-col items-end space-y-2">
                  <div className="skeleton h-4 w-20 rounded" />
                  <div className="skeleton h-3 w-14 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Holdings List */
          <div className="space-y-3">
            {visibleHoldings.map((h) => {
              const price = prices[h.symbol]?.price ?? 0;
              const change = prices[h.symbol]?.changePercent ?? 0;
              const locked = lockedBySymbol[h.symbol] || 0;
              const available = Math.max(0, h.shares - locked);
              const value = h.shares * price;
              const isUp = change >= 0;

              return (
                <button
                  key={h.symbol}
                  onClick={() => onSpendFromHolding(h)}
                  className="w-full card flex items-center gap-4 p-5 text-left transition-all"
                  style={{ cursor: 'pointer' }}
                >
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: h.gradient }}>
                    {h.icon}
                  </div>
                  <div className="flex-1">
                    <div className="text-[15px] font-semibold">{h.name}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      {locked > 0 ? (
                        <>{formatShares(available)} available · <span style={{ color: '#F59E0B' }}>{formatShares(locked)} locked</span>{isDemo && ' · HTS'}</>
                      ) : (
                        <>{h.shares} share{h.shares !== 1 ? 's' : ''}{isDemo && ' · HTS'}</>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[15px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs font-medium mt-1" style={{ color: isUp ? 'var(--positive)' : 'var(--negative)' }}>
                      {isUp ? '+' : ''}{change.toFixed(2)}%
                    </div>
                  </div>
                </button>
              );
            })}

            {/* Connect Brokerage */}
            {plaidStatus === 'idle' && isPlaidAvailable && isDemo && (
              <button
                onClick={onConnectBrokerage}
                className="w-full card p-5 text-left cursor-pointer transition-all"
                style={{ border: '1.5px dashed rgba(255,255,255,0.12)' }}
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center"
                    style={{ background: 'var(--accent-muted)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[15px] font-semibold">Connect Brokerage</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      Link your account to see real positions
                    </div>
                  </div>
                </div>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Crypto Holdings (exclude CARDS — shown in own section) */}
      {cryptoHoldings.filter((h) => h.symbol !== 'CARDS').length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Crypto
            </div>
            <div className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(39,117,202,0.1)', color: '#2775CA' }}>
              Hedera
            </div>
          </div>
          <div className="space-y-3">
            {cryptoHoldings.filter((h) => h.symbol !== 'CARDS').map((h) => {
              const isUsdc = h.symbol === 'USDC';
              const value = isUsdc ? h.shares : 0;

              return (
                <button
                  key={h.symbol}
                  onClick={() => onSpendFromHolding(h)}
                  className="w-full card flex items-center gap-4 p-5 text-left transition-all"
                  style={{ cursor: 'pointer' }}
                >
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: h.gradient }}>
                    {h.icon}
                  </div>
                  <div className="flex-1">
                    <div className="text-[15px] font-semibold">{h.name}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      {isUsdc
                        ? <><AnimatedValue value={h.shares} /> USDC</>
                        : `${h.shares} ${h.symbol}`
                      }
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[15px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <AnimatedValue value={value} prefix="$" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Virtual Cards */}
      {cryptoHoldings.filter((h) => h.symbol === 'CARDS').length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Cards
            </div>
            <div className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(139,92,246,0.1)', color: '#8B5CF6' }}>
              Virtual
            </div>
          </div>
          <div className="space-y-3">
            {cryptoHoldings.filter((h) => h.symbol === 'CARDS').map((h) => (
              <button
                key={h.symbol}
                onClick={() => onViewCards()}
                className="w-full card flex items-center gap-4 p-5 text-left transition-all"
                style={{ cursor: 'pointer' }}
              >
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: h.gradient, color: 'white' }}>
                  {h.icon}
                </div>
                <div className="flex-1">
                  <div className="text-[15px] font-semibold">{h.name}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    ${h.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} loaded
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    ${h.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    View cards
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Available to Spend */}
      {hasHoldings && (
        urgentNote ? (
          <div className="card px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Available to Spend
              </div>
              <div className="text-[18px] font-bold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                ${animatedSpendable.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            {Object.keys(lockedBySymbol).length > 0 && (
              <div className="text-[11px] mt-2" style={{ color: '#F59E0B' }}>
                {Object.entries(lockedBySymbol).map(([sym, shares]) => (
                  <span key={sym}>{formatShares(shares)} {sym} locked as collateral{' '}</span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="card p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-[0.04]"
              style={{ background: 'var(--accent)', filter: 'blur(40px)', transform: 'translate(30%, -30%)' }} />
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Available to Spend
            </div>
            <div className="text-[30px] font-bold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
              ${animatedSpendable.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[13px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
              Spend directly from your portfolio
            </div>
          </div>
        )
      )}
    </div>
  );
}
