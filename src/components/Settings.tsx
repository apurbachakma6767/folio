'use client';

import { useState, useEffect } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { useHederaKey } from '@/lib/use-hedera-key';
import { authFetch } from '@/lib/use-auth-fetch';
import Spinner from '@/components/Spinner';

interface SettingsProps {
  onOpenCards?: () => void;
  onOpenNotes?: () => void;
}

export default function Settings({ onOpenCards, onOpenNotes }: SettingsProps) {
  const [mounted, setMounted] = useState(false);
  const { user, handleLogOut } = useDynamicContext();
  const { hasKey, exportKey, importKey: doImportKey } = useHederaKey();
  const [showKey, setShowKey] = useState(false);
  const [importInput, setImportInput] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    (async () => {
      try {
        const res = await authFetch('/api/users/profile');
        if (res.ok) {
          const data = await res.json();
          const p = data.profile || {};
          setDisplayName(p.displayName || p.name || '');
          setBirthDate(p.birthDate || '');
          setPhone(p.phone || '');
          setCountry(p.country || '');
          setCity(p.city || '');
        }
      } catch {
        /* */
      } finally {
        setProfileLoading(false);
      }
    })();
  }, [mounted]);

  const label = mounted ? (user?.email ?? user?.firstName ?? 'User') : 'User';
  const initial = (displayName || label).charAt(0).toUpperCase();

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const res = await authFetch('/api/users/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, birthDate, phone, country, city }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setProfileMsg('Profile saved');
      setTimeout(() => setProfileMsg(null), 2500);
    } catch (e) {
      setProfileMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setProfileSaving(false);
    }
  };

  const fieldClass = 'glass-field';

  return (
    <div className="space-y-7">
      <div>
        <div className="page-eyebrow">Settings</div>
        <div className="page-title">Account</div>
        <div className="page-sub">Profile, cards, and wallet recovery</div>
      </div>

      {(onOpenCards || onOpenNotes) && (
        <div className="flex gap-3 md:hidden">
          {onOpenCards && (
            <button type="button" onClick={onOpenCards} className="action-tile">
              <span
                className="action-tile-icon"
                style={{
                  background: 'rgba(139,92,246,0.14)',
                  color: '#C4B5FD',
                  borderColor: 'rgba(139,92,246,0.25)',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="4" width="22" height="16" rx="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
              </span>
              <span className="text-[13px] font-semibold">Cards</span>
            </button>
          )}
          {onOpenNotes && (
            <button type="button" onClick={onOpenNotes} className="action-tile">
              <span
                className="action-tile-icon"
                style={{
                  background: 'rgba(99,102,241,0.14)',
                  color: '#A5B4FC',
                  borderColor: 'rgba(99,102,241,0.25)',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </span>
              <span className="text-[13px] font-semibold">Activity</span>
            </button>
          )}
        </div>
      )}

      {/* Profile form */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-4 mb-2">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold text-white"
            style={{
              background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
              boxShadow: '0 6px 20px rgba(99,102,241,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            {initial}
          </div>
          <div>
            <div className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {displayName || 'Your profile'}
            </div>
            <div className="text-[13px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {label}
            </div>
          </div>
        </div>

        {profileLoading ? (
          <div className="flex justify-center py-6">
            <Spinner size={22} />
          </div>
        ) : (
          <>
            <div>
              <div className="section-label mb-2">Full name</div>
              <input
                className={fieldClass}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alex Rivera"
              />
            </div>
            <div>
              <div className="section-label mb-2">Date of birth</div>
              <input
                type="date"
                className={fieldClass}
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </div>
            <div>
              <div className="section-label mb-2">Phone</div>
              <input
                className={fieldClass}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 0100"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="section-label mb-2">Country</div>
                <input
                  className={fieldClass}
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="US"
                />
              </div>
              <div>
                <div className="section-label mb-2">City</div>
                <input
                  className={fieldClass}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="New York"
                />
              </div>
            </div>
            {profileMsg && (
              <div className="text-[13px]" style={{ color: profileMsg.includes('saved') ? 'var(--accent)' : '#F87171' }}>
                {profileMsg}
              </div>
            )}
            <button
              type="button"
              onClick={saveProfile}
              disabled={profileSaving}
              className="btn-primary w-full py-3.5 text-[14px]"
            >
              {profileSaving ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner size={16} /> Saving…
                </span>
              ) : (
                'Save profile'
              )}
            </button>
          </>
        )}
      </div>

      {/* Network */}
      <div className="card p-6">
        <div className="section-label mb-4">Network</div>
        <div className="glass-inset flex items-center justify-between px-3.5 py-3.5">
          <div>
            <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {process.env.NEXT_PUBLIC_HEDERA_NETWORK === 'mainnet' ? 'Hedera Mainnet' : 'Hedera Testnet'}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Settlement network for spend and wallet
            </div>
          </div>
          <div
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              background: 'var(--accent-muted)',
              color: 'var(--accent)',
              border: '1px solid rgba(16,185,129,0.2)',
            }}
          >
            {process.env.NEXT_PUBLIC_HEDERA_NETWORK === 'mainnet' ? 'Mainnet' : 'Testnet'}
          </div>
        </div>
      </div>

      {/* Key export / import */}
      <div className="card p-6 space-y-4">
        <div className="section-label">Wallet key</div>
        {hasKey ? (
          <>
            <button type="button" onClick={() => setShowKey(!showKey)} className="btn-secondary w-full py-3 text-[13px]">
              {showKey ? 'Hide key' : 'Export key for backup'}
            </button>
            {showKey && (
              <div className="space-y-2">
                <div
                  className="glass-inset p-3 break-all text-[11px] font-mono"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {exportKey()}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const key = exportKey();
                    if (key) {
                      navigator.clipboard.writeText(key);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }
                  }}
                  className="w-full py-2.5 text-[13px] font-semibold rounded-xl"
                  style={{
                    background: 'var(--accent-muted)',
                    color: 'var(--accent)',
                    border: '1px solid rgba(16,185,129,0.2)',
                  }}
                >
                  {copied ? 'Copied!' : 'Copy to clipboard'}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Import a private key to restore this device.
            </div>
            <textarea
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              rows={3}
              className="glass-field font-mono text-[11px]"
              placeholder="Paste DER private key"
            />
            <button
              type="button"
              disabled={importStatus === 'loading'}
              onClick={async () => {
                setImportStatus('loading');
                try {
                  await doImportKey(importInput.trim());
                  setImportStatus('success');
                } catch {
                  setImportStatus('error');
                }
              }}
              className="btn-primary w-full py-3 text-[13px]"
            >
              {importStatus === 'loading' ? 'Importing…' : 'Import key'}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => handleLogOut()}
        className="w-full py-3.5 rounded-xl text-[14px] font-semibold"
        style={{
          background: 'rgba(239,68,68,0.1)',
          color: '#F87171',
          border: '1px solid rgba(239,68,68,0.22)',
          backdropFilter: 'blur(12px)',
        }}
      >
        Sign out
      </button>
    </div>
  );
}
