'use client';

/**
 * Portfolio holdings from Hedera HTS only.
 * Plaid is disabled — no link-token / holdings / exchange API calls.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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
  const inflight = useRef(false);

  const fetchHederaHoldings = useCallback(
    async (opts?: { retries?: number }): Promise<Holding[]> => {
      if (!userAccountId) return [];
      const retries = opts?.retries ?? 1; // only retry network failures, not empty portfolios
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await authFetch(
            `/api/hedera/holdings?accountId=${encodeURIComponent(userAccountId)}`
          );
          if (!res.ok) {
            lastErr = new Error(`holdings ${res.status}`);
            if (attempt < retries) {
              await new Promise((r) => setTimeout(r, 800));
              continue;
            }
            return [];
          }
          const data = await res.json();
          // Empty array is a valid result — do NOT retry/wait
          const list: Holding[] = Array.isArray(data.holdings) ? data.holdings : [];
          setHoldings(list);
          return list;
        } catch (e) {
          lastErr = e;
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 800));
          }
        }
      }
      if (lastErr) console.warn('[holdings]', lastErr);
      setHoldings([]);
      return [];
    },
    [userAccountId]
  );

  useEffect(() => {
    const onRefresh = () => {
      if (inflight.current) return;
      inflight.current = true;
      fetchHederaHoldings({ retries: 0 }).finally(() => {
        inflight.current = false;
      });
    };
    window.addEventListener('folio:holdings-refresh', onRefresh);
    return () => window.removeEventListener('folio:holdings-refresh', onRefresh);
  }, [fetchHederaHoldings]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!getAuthToken() || !userAccountId) {
        if (!cancelled) {
          setStatus('idle');
          setHoldings([]);
        }
        return;
      }

      setStatus('loading');
      await fetchHederaHoldings({ retries: 1 });
      if (!cancelled) setStatus('idle');
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [fetchHederaHoldings, userAccountId]);

  const openLink = useCallback(() => {
    /* Plaid disabled */
  }, []);

  return {
    status,
    holdings,
    openLink,
    isPlaidAvailable: false,
    isDemo: true,
  };
}
