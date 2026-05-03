'use client';

import { useDynamicContext } from '@dynamic-labs/sdk-react-core';

export function ConnectButton() {
  const { user, setShowAuthFlow } = useDynamicContext();

  if (!user) {
    return (
      <button
        onClick={() => setShowAuthFlow(true)}
        className="btn-primary px-8 py-3 text-[15px]"
      >
        Sign in
      </button>
    );
  }

  const label = user.email ?? user.firstName ?? 'Connected';

  return (
    <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
    </div>
  );
}
