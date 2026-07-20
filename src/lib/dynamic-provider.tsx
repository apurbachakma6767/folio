'use client';

import { useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';

/**
 * Dynamic Labs touches `window` during provider init.
 * - `ssr: false` so the SDK never runs on the server
 * - Wait for mount before rendering app children that call `useDynamicContext`
 */
const DynamicProviderInner = dynamic(() => import('./dynamic-provider-inner'), {
  ssr: false,
});

export function DynamicProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Until the real provider is available on the client, do not render children
  // that depend on DynamicContext (page, AuthGuard, etc.).
  if (!mounted) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg-base)', color: 'var(--text-tertiary)' }}
        aria-busy="true"
        aria-label="Loading"
      >
        <div className="text-[13px] font-medium tracking-wide">Loading Folio…</div>
      </div>
    );
  }

  return <DynamicProviderInner>{children}</DynamicProviderInner>;
}
