'use client';

/**
 * Portfolio holdings from Hedera HTS only.
 * Plaid is disabled for now — no link-token / holdings / exchange API calls.
 */

import { useState, useEffect, useCallback } from 'react';
import { getAuthToken } from '@dynamic-labs/sdk-react-core';
import { authFetch } from '@/lib/use-auth-fetch';
import type { Holding } from './types';

export type PlaidStatus = 'idle' | 'loading' | 'connected' | 'error';

interface PlaidHookResult {
  status: PlaidStatus;
  holdings: Holding[];
  openLink: () => void;
  isPlaidAvailable: boolean;
  isDemo: boolean;
}

export function usePlaidHoldings(userAccountId?: string): PlaidHookResult {
  const [status, setStatus] = useState<PlaidStatus>('loading');
  const [holdings, setHoldings] = useState<Holding[]>([]);

  const fetchHederaHoldings = useCallback(
    async (retries = 4): Promise<Holding[] | null> => {
      if (!userAccountId) return null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await authFetch(
            `/api/hedera/holdings?accountId=${encodeURIComponent(userAccountId)}`
          );
          if (!res.ok) return null;
          const data = await res.json();
          if (data.holdings?.length > 0) {
            setHoldings(data.holdings);
            return data.holdings;
          }
          // Empty is valid (no free stock on mainnet)
          if (attempt === retries) {
            setHoldings([]);
            return [];
          }
        } catch {
          /* retry */
        }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      return null;
    },
    [userAccountId]
  );

  useEffect(() => {
    const onRefresh = () => {
      fetchHederaHoldings(2);
    };
    window.addEventListener('folio:holdings-refresh', onRefresh);
    return () => window.removeEventListener('folio:holdings-refresh', onRefresh);
  }, [fetchHederaHoldings]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!getAuthToken()) {
        setStatus('idle');
        setHoldings([]);
        return;
      }
      if (!userAccountId) {
        setStatus('idle');
        setHoldings([]);
        return;
      }

      setStatus('loading');
      await fetchHederaHoldings();
      if (!cancelled) setStatus('idle');
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [fetchHederaHoldings, userAccountId]);

  // Plaid disabled — no-op
  const openLink = useCallback(() => {
    console.info('[holdings] Plaid connect is disabled');
  }, []);

  return {
    status,
    holdings,
    openLink,
    isPlaidAvailable: false,
    isDemo: true, // on-chain / Folio HTS only (not brokerage)
  };
}
