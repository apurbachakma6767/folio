'use client';

import { useEffect, useState } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import FolioLogo from './FolioLogo';

interface SidebarProps {
  activeTab: string;
  onNavigate: (screen: string) => void;
}

const navItems = [
  {
    id: 'portfolio', label: 'Portfolio',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'trade', label: 'Trade',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
  {
    id: 'spend', label: 'Spend',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    ),
  },
  {
    id: 'wallet', label: 'Wallet',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12V7H5a2 2 0 010-4h14v4" /><path d="M3 5v14a2 2 0 002 2h16v-5" /><path d="M18 12a2 2 0 000 4h4v-4z" />
      </svg>
    ),
  },
  {
    id: 'cards', label: 'Cards',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
  },
  {
    id: 'notes', label: 'Transactions',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: 'settings', label: 'Settings',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
];

export default function Sidebar({ activeTab, onNavigate }: SidebarProps) {
  const [mounted, setMounted] = useState(false);
  const { user } = useDynamicContext();

  useEffect(() => {
    setMounted(true);
  }, []);

  const label = mounted ? (user?.email ?? user?.firstName ?? 'Account') : 'Account';
  const initial = label.charAt(0).toUpperCase();

  const networkLabel =
    process.env.NEXT_PUBLIC_HEDERA_NETWORK === 'mainnet' ? 'Mainnet' : 'Testnet';

  return (
    <aside className="sidebar-glass hidden md:flex flex-col w-[248px] shrink-0 px-4 py-7 gap-1 h-full self-stretch overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-8 px-3">
        <FolioLogo size={36} />
        <span className="text-[17px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Folio
        </span>
      </div>

      {/* Nav */}
      <div className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all cursor-pointer ${
              activeTab === item.id ? 'nav-active' : ''
            }`}
            style={{
              background: activeTab === item.id ? undefined : 'transparent',
              color: activeTab === item.id ? undefined : 'var(--text-secondary)',
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {/* User */}
      <div className="mt-4 px-1">
        <div className="glass-inset flex items-center gap-3 p-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-semibold shrink-0"
            style={{
              background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
              color: '#fff',
              boxShadow: '0 4px 12px rgba(99,102,241,0.4), inset 0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            {initial}
          </div>
          <div className="min-w-0">
            <div
              className="text-[13px] font-medium truncate max-w-[140px]"
              style={{ color: 'var(--text-primary)' }}
            >
              {label}
            </div>
            <div className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-tertiary)' }}>
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: 'var(--accent)',
                  boxShadow: '0 0 6px rgba(16,185,129,0.8)',
                }}
              />
              {networkLabel}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
