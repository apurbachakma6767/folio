// Spend / treasury guards for Thrive mainnet (small real-USDC treasury)

import { getNotes } from './spend-notes';
import {
  getMaxOutstandingUsdc,
  getMaxSpendUsdc,
  getPerUserMaxSpendUsdc,
  isSpendPaused,
  requireVault,
} from './network';

export type SpendGuardOk = { ok: true };
export type SpendGuardErr = { ok: false; status: number; error: string };
export type SpendGuardResult = SpendGuardOk | SpendGuardErr;

/**
 * Validate amount against pause switch, per-spend, per-user, and global outstanding caps.
 */
export async function assertSpendAllowed(
  amount: number,
  userAccountId: string
): Promise<SpendGuardResult> {
  if (isSpendPaused()) {
    return {
      ok: false,
      status: 503,
      error: 'Spending is temporarily paused. Please try again later.',
    };
  }

  if (!amount || amount <= 0) {
    return { ok: false, status: 400, error: 'Invalid amount' };
  }

  const maxSpend = getMaxSpendUsdc();
  if (amount > maxSpend) {
    return {
      ok: false,
      status: 400,
      error: `Maximum spend is $${maxSpend.toFixed(2)} USDC per transaction.`,
    };
  }

  const perUserMax = getPerUserMaxSpendUsdc();
  const globalMax = getMaxOutstandingUsdc();

  let activeNotes: Awaited<ReturnType<typeof getNotes>> = [];
  try {
    activeNotes = (await getNotes()).filter((n) => n.status === 'active');
  } catch (e) {
    console.error('[spend-guards] Failed to load notes for caps:', e);
    // Fail open on DB errors only in non-capped environments; when caps are tight, fail closed
    if (globalMax < 1_000_000) {
      return {
        ok: false,
        status: 503,
        error: 'Unable to verify spend limits. Please try again.',
      };
    }
  }

  const userOutstanding = activeNotes
    .filter((n) => n.userAccountId === userAccountId)
    .reduce((sum, n) => sum + Number(n.amount), 0);

  if (userOutstanding + amount > perUserMax) {
    return {
      ok: false,
      status: 400,
      error: `Per-user outstanding limit is $${perUserMax.toFixed(2)}. You have $${userOutstanding.toFixed(2)} active.`,
    };
  }

  const globalOutstanding = activeNotes.reduce((sum, n) => sum + Number(n.amount), 0);
  if (globalOutstanding + amount > globalMax) {
    return {
      ok: false,
      status: 400,
      error: `Platform advance capacity reached (max $${globalMax.toFixed(2)} outstanding). Try a smaller amount or repay existing advances.`,
    };
  }

  return { ok: true };
}

export function assertVaultRequirement(
  vaultConfigured: boolean
): SpendGuardResult {
  if (requireVault() && !vaultConfigured) {
    return {
      ok: false,
      status: 503,
      error: 'Collateral vault is required on this network but is not configured.',
    };
  }
  return { ok: true };
}
