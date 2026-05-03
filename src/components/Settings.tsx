'use client';

import { useState, useEffect } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import type { PlaidStatus } from '@/lib/use-plaid-holdings';
import { useHederaKey } from '@/lib/use-hedera-key';
import Spinner from '@/components/Spinner';


interface SettingsProps {
  plaidStatus: PlaidStatus;
  isPlaidAvailable: boolean;
  isDemo: boolean;
  onConnectBrokerage: () => void;
}

export default function Settings({
  plaidStatus,
  isPlaidAvailable,
  isDemo,
  onConnectBrokerage,
}: SettingsProps) {
  const [mounted, setMounted] = useState(false);
  const { user, handleLogOut } = useDynamicContext();
  const { hasKey, exportKey, importKey: doImportKey } = useHederaKey();
  const [showKey, setShowKey] = useState(false);
  const [importInput, setImportInput] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const label = mounted ? (user?.email ?? user?.firstName ?? 'Demo User') : 'Demo User';
  const initial = label.charAt(0).toUpperCase();

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <div className="text-xs font-medium mb-3 uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
          Settings
        </div>
        <div className="text-[28px] font-bold tracking-tight leading-none">
          Account
        </div>
      </div>

      {/* Profile Card */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
          Profile
        </div>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #6366F1, #8B5CF6)' }}>
            {initial}
          </div>
          <div>
            <div className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</div>
            <div className="text-[13px] mt-1" style={{ color: 'var(--text-tertiary)' }}>Testnet</div>
          </div>
        </div>
      </div>

      {/* Brokerage Connection */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
          Brokerage
        </div>

        {!isDemo ? (
          /* Connected state */
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(16,185,129,0.1)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--positive)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Brokerage Connected</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Showing your real positions
              </div>
            </div>
          </div>
        ) : isPlaidAvailable ? (
          /* Plaid available but not connected */
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(251,191,36,0.1)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div>
                <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Demo Mode</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Connect your brokerage to see real holdings
                </div>
              </div>
            </div>
            <button
              onClick={onConnectBrokerage}
              disabled={plaidStatus === 'loading'}
              className="btn-primary w-full py-3.5 text-[14px] font-semibold"
            >
              {plaidStatus === 'loading' ? <span className="flex items-center justify-center gap-2"><Spinner size={14} />Connecting...</span> : 'Connect Brokerage'}
            </button>
          </div>
        ) : (
          /* Plaid not available */
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.1)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--negative)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Demo Mode</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Brokerage integration unavailable — check Plaid configuration
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tokenized Assets */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
          Tokenized Assets
        </div>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(16,185,129,0.1)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>HTS Fungible Tokens</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Equities tokenized via Hedera Token Service
            </div>
          </div>
        </div>
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
            <span className="text-[13px] font-medium">MOCK-TSLA</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
              style={{ background: 'rgba(251,191,36,0.1)', color: '#FBBF24' }}>Testnet</span>
          </div>
          <div className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
            <span className="text-[13px] font-medium">MOCK-AAPL</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
              style={{ background: 'rgba(251,191,36,0.1)', color: '#FBBF24' }}>Testnet</span>
          </div>
        </div>
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[12px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
            Swarm Compatible
          </div>
          <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            Token architecture uses the same HTS standard as Swarm&apos;s regulated tokenized securities (TSLA, AAPL, NVDA, MSFT). Production migration requires swapping token IDs and adding Swarm KYC onboarding.
          </div>
        </div>
      </div>

      {/* Network */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
          Network
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Hedera Testnet</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>All transactions settle on testnet</div>
          </div>
          <div className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
            Testnet
          </div>
        </div>
      </div>

      {/* Hedera Signing Key */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
          Hedera Signing Key
        </div>
        {hasKey ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(16,185,129,0.1)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--positive)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div>
                <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Key Stored Locally</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Your private key is stored in this browser only
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setShowKey(!showKey);
                if (!showKey) setCopied(false);
              }}
              className="w-full py-3 text-[13px] font-semibold rounded-xl transition-colors"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              {showKey ? 'Hide Key' : 'Export Key for Backup'}
            </button>
            {showKey && (
              <div className="space-y-2">
                <div className="p-3 rounded-lg break-all text-[11px] font-mono leading-relaxed"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  {exportKey()}
                </div>
                <button
                  onClick={() => {
                    const key = exportKey();
                    if (key) {
                      navigator.clipboard.writeText(key);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }
                  }}
                  className="w-full py-2.5 text-[13px] font-semibold rounded-xl transition-colors"
                  style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                >
                  {copied ? 'Copied!' : 'Copy to Clipboard'}
                </button>
                <div className="text-[11px] leading-relaxed" style={{ color: 'var(--negative)' }}>
                  Save this key somewhere safe. If you clear your browser data, you will need it to access your account.
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(251,191,36,0.1)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div>
                <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>No Key Found</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Import a previously exported key to restore access
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <input
                type="text"
                value={importInput}
                onChange={(e) => { setImportInput(e.target.value); setImportStatus('idle'); }}
                placeholder="Paste your private key (DER hex)"
                className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-transparent"
                style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)' }}
              />
              <button
                onClick={async () => {
                  setImportStatus('loading');
                  try {
                    await doImportKey(importInput.trim());
                    setImportStatus('success');
                    setImportInput('');
                  } catch {
                    setImportStatus('error');
                  }
                }}
                disabled={!importInput.trim() || importStatus === 'loading'}
                className="w-full py-2.5 text-[13px] font-semibold rounded-xl transition-colors"
                style={{ background: 'var(--accent-muted)', color: 'var(--accent)', opacity: importInput.trim() ? 1 : 0.5 }}
              >
                {importStatus === 'loading' ? <span className="flex items-center justify-center gap-2"><Spinner size={14} />Importing...</span> : 'Import Key'}
              </button>
              {importStatus === 'success' && (
                <div className="text-[11px]" style={{ color: 'var(--positive)' }}>Key imported successfully</div>
              )}
              {importStatus === 'error' && (
                <div className="text-[11px]" style={{ color: 'var(--negative)' }}>Invalid key format</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Log Out */}
      <button
        onClick={handleLogOut}
        className="w-full py-4 text-[15px] font-semibold rounded-2xl transition-colors"
        style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--negative)' }}
      >
        Log Out
      </button>
    </div>
  );
}
