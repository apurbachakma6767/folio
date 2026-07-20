'use client';

import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '@/lib/use-auth-fetch';
import { useHederaKey } from '@/lib/use-hedera-key';
import Spinner from '@/components/Spinner';

interface HoldingRow {
  symbol: string;
  name: string;
  shares: number;
  type?: string;
}

interface WalletProps {
  hederaAccountId?: string;
  onRefreshPortfolio?: () => void;
}

export default function Wallet({ hederaAccountId, onRefreshPortfolio }: WalletProps) {
  const { hasKey, exportKey } = useHederaKey();
  const [hbar, setHbar] = useState(0);
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<'account' | 'key' | null>(null);
  const [showKey, setShowKey] = useState(false);
  const hashscan =
    process.env.NEXT_PUBLIC_HASHSCAN_BASE || 'https://hashscan.io/testnet';
  const networkLabel =
    process.env.NEXT_PUBLIC_HEDERA_NETWORK === 'mainnet' ? 'Mainnet' : 'Testnet';

  const load = useCallback(async () => {
    if (!hederaAccountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/users/balances?accountId=${encodeURIComponent(hederaAccountId)}`
      );
      const data = await res.json();
      setHbar(Number(data.hbar) || 0);
      setHoldings(data.holdings || []);
    } catch {
      setHoldings([]);
    } finally {
      setLoading(false);
    }
  }, [hederaAccountId]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (text: string, kind: 'account' | 'key') => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!hederaAccountId) {
    return (
      <div className="space-y-6">
        <div>
          <div className="text-xs font-medium mb-3 uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Wallet
          </div>
          <div className="text-[28px] font-bold tracking-tight">Hedera wallet</div>
        </div>
        <div className="card p-6 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
          Finish account setup to create your Hedera wallet.
        </div>
      </div>
    );
  }

  const usdc = holdings.find((h) => h.symbol === 'USDC')?.shares ?? 0;

  return (
    <div className="space-y-7">
      <div>
        <div className="page-eyebrow">Wallet</div>
        <div className="page-title">Your funds</div>
        <div className="page-sub">
          Hedera {networkLabel} · deposit HBAR or USDC only
        </div>
      </div>

      {/* Balance hero */}
      <div className="glass-hero p-6 md:p-7">
        <div className="section-label mb-3">Cash & network</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="glass-inset px-3.5 py-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
              USDC
            </div>
            <div className="text-[22px] font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
              {loading ? '—' : usdc.toFixed(2)}
            </div>
          </div>
          <div className="glass-inset px-3.5 py-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
              HBAR
            </div>
            <div className="text-[22px] font-bold tabular-nums">
              {loading ? '—' : hbar.toFixed(4)}
            </div>
          </div>
        </div>
      </div>

      {/* Account */}
      <div className="card p-6 space-y-4">
        <div className="section-label">Account</div>
        <div className="glass-inset flex items-center justify-between gap-3 p-3.5">
          <div className="font-mono text-[13px] break-all" style={{ color: 'var(--text-primary)' }}>
            {hederaAccountId}
          </div>
          <button
            type="button"
            onClick={() => copy(hederaAccountId, 'account')}
            className="shrink-0 text-[12px] font-semibold px-3 py-2 rounded-lg"
            style={{
              background: 'var(--accent-muted)',
              color: 'var(--accent)',
              border: '1px solid rgba(16,185,129,0.2)',
            }}
          >
            {copied === 'account' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <a
          href={`${hashscan}/account/${hederaAccountId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-medium inline-flex items-center gap-1"
          style={{ color: 'var(--accent)' }}
        >
          View on explorer ↗
        </a>
      </div>

      {/* Balances */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="section-label">All balances</div>
          <button
            type="button"
            onClick={() => {
              load();
              onRefreshPortfolio?.();
            }}
            className="text-[12px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="glass-inset flex justify-between items-center px-3.5 py-3">
              <div>
                <div className="text-[15px] font-semibold">HBAR</div>
                <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  Network fees
                </div>
              </div>
              <div className="text-[16px] font-semibold tabular-nums">{hbar.toFixed(4)}</div>
            </div>
            {holdings.length === 0 ? (
              <div className="text-[13px] py-3 px-1" style={{ color: 'var(--text-tertiary)' }}>
                No tokens yet. Buy stocks in Trade or deposit USDC here.
              </div>
            ) : (
              holdings.map((h) => (
                <div
                  key={h.symbol}
                  className="glass-inset flex justify-between items-center px-3.5 py-3"
                >
                  <div>
                    <div className="text-[15px] font-semibold">{h.symbol}</div>
                    <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {h.name}
                    </div>
                  </div>
                  <div className="text-[16px] font-semibold tabular-nums">
                    {h.symbol === 'USDC' || h.symbol === 'CARDS'
                      ? h.shares.toFixed(2)
                      : h.shares.toFixed(4)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Deposit */}
      <div className="card p-6 space-y-3">
        <div className="section-label">Add funds</div>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Send only these on <strong style={{ color: 'var(--text-primary)' }}>Hedera</strong> to
          your account ID above:
        </p>
        <ul className="text-[13px] space-y-2 pl-0 list-none" style={{ color: 'var(--text-secondary)' }}>
          <li className="flex gap-2">
            <span style={{ color: 'var(--accent)' }}>●</span>
            <span>
              <strong style={{ color: 'var(--text-primary)' }}>USDC</strong> — to buy stocks and
              repay advances (Circle USDC on Hedera)
            </span>
          </li>
          <li className="flex gap-2">
            <span style={{ color: 'var(--accent)' }}>●</span>
            <span>
              <strong style={{ color: 'var(--text-primary)' }}>HBAR</strong> — optional spare for
              edge-case fees (most Folio actions are gasless)
            </span>
          </li>
        </ul>
        <ul className="text-[12px] space-y-1.5 pl-4 list-disc" style={{ color: 'var(--text-tertiary)' }}>
          <li>Use HashPack, Blade, or an exchange that supports Hedera.</li>
          <li>Do not send from Ethereum, Solana, or other chains.</li>
          <li>Stocks are bought on the Trade tab (not deposited here).</li>
        </ul>
      </div>

      {/* Export key */}
      <div className="card p-6 space-y-4">
        <div className="section-label">Export private key</div>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Export your Hedera key to import into HashPack/Blade or move funds yourself. Anyone with
          this key controls your account.
        </p>
        {!hasKey ? (
          <div className="text-[13px]" style={{ color: 'var(--warning)' }}>
            No local key found. Unlock your wallet from the home setup flow first.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="btn-secondary w-full py-3 text-[14px]"
            >
              {showKey ? 'Hide key' : 'Show private key'}
            </button>
            {showKey && (
              <div className="space-y-2">
                <div
                  className="p-3 rounded-lg break-all text-[11px] font-mono leading-relaxed"
                  style={{
                    background: 'var(--bg-surface)',
                    color: 'var(--text-tertiary)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {exportKey()}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const k = exportKey();
                    if (k) copy(k, 'key');
                  }}
                  className="w-full py-2.5 text-[13px] font-semibold rounded-xl"
                  style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                >
                  {copied === 'key' ? 'Copied!' : 'Copy to clipboard'}
                </button>
                <div className="text-[11px]" style={{ color: 'var(--negative)' }}>
                  Never share this key. Folio cannot recover it if you lose both browser storage and
                  this backup.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
