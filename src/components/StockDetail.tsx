'use client';

import type { PriceData } from '@/app/page';
import type { Holding } from '@/lib/types';

interface StockDetailProps {
  holding: Holding;
  price?: PriceData;
  totalPortfolioValue: number;
  onBack: () => void;
  onSpend: () => void;
}

export default function StockDetail({ holding, price, totalPortfolioValue, onBack, onSpend }: StockDetailProps) {
  const isUsdc = holding.symbol === 'USDC';
  const isCrypto = holding.type === 'crypto' || isUsdc;

  // For crypto stablecoins, price is $1. For stocks, use price API.
  const unitPrice = isCrypto ? (isUsdc ? 1 : 0) : (price?.price ?? 0);
  const change = isCrypto ? 0 : (price?.change ?? 0);
  const changePercent = isCrypto ? 0 : (price?.changePercent ?? 0);
  const isUp = change >= 0;
  const totalValue = holding.shares * unitPrice;
  const priceLoaded = isCrypto || price !== undefined;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg cursor-pointer transition-colors"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Identity */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white"
          style={{ background: holding.gradient }}>
          {holding.icon}
        </div>
        <div>
          <div className="text-2xl font-bold">{holding.name}</div>
          <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{holding.symbol}</div>
        </div>
      </div>

      {/* Price / Balance */}
      <div>
        {isCrypto ? (
          <>
            <div className="text-[40px] font-bold tracking-tight leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>
              ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm mt-3" style={{ color: 'var(--text-tertiary)' }}>
              {holding.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {holding.symbol}
            </div>
          </>
        ) : (
          <>
            <div className="text-[40px] font-bold tracking-tight leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {priceLoaded ? `$${unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '···'}
            </div>
            {priceLoaded && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-sm font-semibold px-2.5 py-1 rounded-lg"
                  style={{
                    color: isUp ? 'var(--positive)' : 'var(--negative)',
                    background: isUp ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  }}>
                  {isUp ? '+' : ''}{change.toFixed(2)} ({isUp ? '+' : ''}{changePercent.toFixed(2)}%)
                </span>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>today</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Position Details */}
      <div className="card p-6 space-y-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
          {isCrypto ? 'Balance' : 'Your Position'}
        </div>
        {(isCrypto ? [
          { label: 'Balance', value: `${holding.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${holding.symbol}` },
          { label: 'Value', value: `$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { label: 'Network', value: 'Hedera Testnet' },
        ] : [
          { label: 'Shares', value: holding.shares.toLocaleString() },
          { label: 'Market Price', value: priceLoaded ? `$${unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '···' },
          { label: 'Market Value', value: priceLoaded ? `$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '···' },
          { label: 'Portfolio Weight', value: totalPortfolioValue > 0 ? `${((totalValue / totalPortfolioValue) * 100).toFixed(1)}%` : '—' },
        ]).map((row, i, arr) => (
          <div key={row.label} className="flex justify-between py-3.5 text-[14px]"
            style={i < arr.length - 1 ? { borderBottom: '1px solid var(--border)' } : undefined}>
            <span style={{ color: 'var(--text-tertiary)' }}>{row.label}</span>
            <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.value}</span>
          </div>
        ))}
      </div>

      {/* Action Button */}
      <button onClick={onSpend} className="btn-primary w-full py-4 text-[15px]">
        {isCrypto ? `Send ${holding.symbol}` : `Spend from ${holding.name}`}
      </button>
    </div>
  );
}
