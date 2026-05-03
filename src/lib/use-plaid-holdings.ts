'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { getAuthToken, useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { authFetch } from '@/lib/use-auth-fetch';
import type { Holding } from './types';
import { DEMO_HOLDINGS } from './types';

export type PlaidStatus = 'idle' | 'loading' | 'connected' | 'error';


interface PlaidHookResult {
  status: PlaidStatus;
  holdings: Holding[];
  openLink: () => void;
  isPlaidAvailable: boolean;
  isDemo: boolean;
}

export function usePlaidHoldings(userAccountId?: string): PlaidHookResult {
  const { user } = useDynamicContext();
  const [status, setStatus] = useState<PlaidStatus>('loading');
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isPlaidAvailable, setIsPlaidAvailable] = useState(false);
  const [isDemo, setIsDemo] = useState(true);

  // Load tokenized holdings from Hedera (user's on-chain balances)
  // Retries with backoff to handle mirror node sync delay after registration
  const fetchHederaHoldings = useCallback(async (retries = 4): Promise<Holding[] | null> => {
    if (!userAccountId) return null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await authFetch(`/api/hedera/holdings?accountId=${encodeURIComponent(userAccountId)}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.holdings?.length > 0) {
          setHoldings(data.holdings);
          return data.holdings;
        }
      } catch { /* fall through */ }
      // Mirror node may not have synced yet — wait before retrying
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    return null;
  }, [userAccountId]);

  // Sync holdings to on-chain HTS tokens, then refresh from chain
  const syncHoldingsToChain = useCallback(async (accountId: string, holdingsToSync: { symbol: string; shares: number }[]): Promise<Holding[] | null> => {
    try {
      const res = await authFetch('/api/holdings/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          holdings: holdingsToSync.map((h) => ({ symbol: h.symbol, shares: h.shares })),
        }),
      });
      const data = await res.json();
      console.log('[holdings] sync response:', data);
      // Re-fetch HTS holdings so UI matches on-chain state
      return await fetchHederaHoldings();
    } catch (err) {
      console.error('[holdings] sync failed:', err);
      return null;
    }
  }, [fetchHederaHoldings]);

  // Initialize: load HTS tokenized equities, then set up Plaid for brokerage linking
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Skip API calls if not authenticated yet (avoids 401 console errors)
      if (!getAuthToken()) {
        setStatus('idle');
        return;
      }

      // Load user's on-chain HTS stock holdings (minted at registration).
      // Retries with backoff to handle mirror node sync delay.
      let htsHoldings = await fetchHederaHoldings();
      if (cancelled) return;

      // If still empty and we have an account, registration minting may have
      // failed — re-attempt via sync endpoint (idempotent, will mint deficit)
      if (!htsHoldings && userAccountId) {
        console.log('[holdings] No on-chain holdings found, attempting self-heal sync...');
        await syncHoldingsToChain(userAccountId, DEMO_HOLDINGS);
        if (cancelled) return;
        htsHoldings = await fetchHederaHoldings(2);
      }

      // If still nothing, show empty — never show fake holdings
      if (!htsHoldings && !cancelled) {
        console.warn('[holdings] Self-heal failed — showing empty portfolio');
        setHoldings([]);
      }

      // If user has a connected brokerage, sync those holdings to chain.
      // Don't merge with on-chain — sync endpoint is idempotent (skips if
      // on-chain balance already >= target, only mints the deficit).
      try {
        const brokerageRes = await authFetch('/api/plaid/holdings');
        if (brokerageRes.ok && !cancelled) {
          const brokerageData = await brokerageRes.json();
          if (brokerageData.holdings?.length > 0 && userAccountId) {
            await syncHoldingsToChain(userAccountId, brokerageData.holdings);
            setIsDemo(false);
          }
        }
      } catch { /* no previously connected account — that's fine */ }

      // Then check Plaid availability for new connections
      try {
        const res = await authFetch('/api/plaid/create-link-token', {
          method: 'POST',
        });

        if (!res.ok) {
          if (!cancelled) {
            setIsPlaidAvailable(false);
            setStatus('idle');
          }
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          setLinkToken(data.link_token);
          setIsPlaidAvailable(true);
          setStatus('idle');
        }
      } catch {
        if (!cancelled) {
          setIsPlaidAvailable(false);
          setStatus('idle');
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, [fetchHederaHoldings, syncHoldingsToChain, userAccountId, user]);

  // Fetch brokerage holdings, sync to chain (idempotent), read back from Hedera
  const fetchHoldings = useCallback(async () => {
    try {
      const res = await authFetch('/api/plaid/holdings');
      if (!res.ok) throw new Error('Failed to fetch holdings');
      const data = await res.json();

      const brokerageHoldings: { symbol: string; name: string; shares: number }[] = data.holdings;

      if (brokerageHoldings.length > 0 && userAccountId) {
        await syncHoldingsToChain(userAccountId, brokerageHoldings);
        setIsDemo(false);
      }
      setStatus('connected');
    } catch {
      setStatus('error');
    }
  }, [userAccountId, syncHoldingsToChain]);

  // Handle Plaid Link success
  const onSuccess = useCallback(async (publicToken: string) => {
    setStatus('loading');
    try {
      const res = await authFetch('/api/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token: publicToken }),
      });

      if (!res.ok) throw new Error('Token exchange failed');

      await fetchHoldings();
    } catch {
      setStatus('error');
    }
  }, [fetchHoldings]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  const openLink = useCallback(() => {
    if (ready) open();
  }, [ready, open]);

  return { status, holdings, openLink, isPlaidAvailable, isDemo };
}
