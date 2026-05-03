'use client';

import { useEffect, useState } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { ConnectButton } from './connect-button';
import FolioLogo from '../FolioLogo';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const { user } = useDynamicContext();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Render children during SSR so static generation works
  if (!mounted) return <>{children}</>;

  const isAuthenticated = user !== undefined && user !== null;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <div
          className="flex flex-col items-center gap-6 rounded-2xl p-10"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-elevated)',
          }}
        >
          <div className="text-center">
            <FolioLogo size={48} className="mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              Folio
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Sign in with your email to continue
            </p>
          </div>
          <ConnectButton />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
