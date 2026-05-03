// Lithic API client — prepaid virtual card issuing & management
// Docs: https://docs.lithic.com

const LITHIC_SANDBOX_URL = 'https://sandbox.lithic.com/v1';
const LITHIC_PROD_URL = 'https://api.lithic.com/v1';

export type CardState = 'OPEN' | 'PAUSED' | 'CLOSED';

export interface VirtualCard {
  token: string;
  pan: string;
  cvv: string;
  expMonth: string;
  expYear: string;
  lastFour: string;
  state: CardState;
  spendLimit: number;
  spendLimitDuration: 'TRANSACTION' | 'MONTHLY' | 'ANNUALLY' | 'FOREVER';
  totalSpent: number;
  created: string;
  memo: string;
}

export interface CardResult {
  success: boolean;
  card?: VirtualCard;
  error?: string;
}

const isMockMode = process.env.LITHIC_MOCK === 'true';
const apiKey = process.env.LITHIC_API_KEY || '';
const baseUrl = process.env.LITHIC_ENV === 'production' ? LITHIC_PROD_URL : LITHIC_SANDBOX_URL;

function headers(): Record<string, string> {
  return {
    'Authorization': apiKey,
    'Content-Type': 'application/json',
  };
}

// In-memory mock card store for freeze/unfreeze and top-up in mock mode
const mockCards = new Map<string, VirtualCard>();

function mockCard(amountCents: number, memo?: string): CardResult {
  const ts = Date.now().toString();
  const mockPan = `4000 0012 ${ts.slice(-4)} ${ts.slice(-8, -4)}`;
  const card: VirtualCard = {
    token: `mock-card-${ts}`,
    pan: mockPan.replace(/ /g, ''),
    cvv: '123',
    expMonth: '12',
    expYear: '2030',
    lastFour: ts.slice(-4),
    state: 'OPEN',
    spendLimit: amountCents,
    spendLimitDuration: 'FOREVER',
    totalSpent: 0,
    created: new Date().toISOString(),
    memo: memo || `Folio Card · $${(amountCents / 100).toFixed(2)}`,
  };
  mockCards.set(card.token, card);
  return { success: true, card };
}

function parseCard(data: Record<string, unknown>): VirtualCard {
  return {
    token: data.token as string,
    pan: data.pan as string,
    cvv: data.cvv as string,
    expMonth: data.exp_month as string,
    expYear: data.exp_year as string,
    lastFour: data.last_four as string,
    state: data.state as CardState,
    spendLimit: data.spend_limit as number,
    spendLimitDuration: (data.spend_limit_duration as VirtualCard['spendLimitDuration']) || 'FOREVER',
    totalSpent: (data.total_spend as number) || 0,
    created: data.created as string,
    memo: (data.memo as string) || '',
  };
}

// Issue a reusable prepaid virtual card
export async function issueVirtualCard(amountCents: number): Promise<CardResult> {
  if (isMockMode) {
    return mockCard(amountCents);
  }

  try {
    const memo = `Folio Card · $${(amountCents / 100).toFixed(2)}`;
    const res = await fetch(`${baseUrl}/cards`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        type: 'UNLOCKED',
        spend_limit: amountCents,
        spend_limit_duration: 'FOREVER',
        memo,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Lithic card creation failed: ${res.status} ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    return { success: true, card: parseCard(data) };
  } catch (error) {
    console.error('Lithic card creation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Lithic error',
    };
  }
}

// Retrieve card details (PAN, CVV) by token
export async function getCardDetails(cardToken: string): Promise<CardResult> {
  if (isMockMode) {
    const existing = mockCards.get(cardToken);
    if (existing) return { success: true, card: existing };
    return mockCard(0);
  }

  try {
    const res = await fetch(`${baseUrl}/cards/${cardToken}`, {
      headers: headers(),
    });

    if (!res.ok) {
      throw new Error(`Lithic card fetch failed: ${res.status}`);
    }

    const data = await res.json();
    return { success: true, card: parseCard(data) };
  } catch (error) {
    console.error('Lithic card fetch failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Lithic error',
    };
  }
}

// Freeze a card (PAUSED state — can be unfrozen)
export async function freezeCard(cardToken: string): Promise<CardResult> {
  if (isMockMode) {
    const existing = mockCards.get(cardToken);
    if (existing) {
      existing.state = 'PAUSED';
      return { success: true, card: existing };
    }
    return { success: false, error: 'Card not found' };
  }

  try {
    const res = await fetch(`${baseUrl}/cards/${cardToken}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ state: 'PAUSED' }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Lithic freeze failed: ${res.status} ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    return { success: true, card: parseCard(data) };
  } catch (error) {
    console.error('Lithic freeze failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Lithic error',
    };
  }
}

// Unfreeze a card (back to OPEN state)
export async function unfreezeCard(cardToken: string): Promise<CardResult> {
  if (isMockMode) {
    const existing = mockCards.get(cardToken);
    if (existing) {
      existing.state = 'OPEN';
      return { success: true, card: existing };
    }
    return { success: false, error: 'Card not found' };
  }

  try {
    const res = await fetch(`${baseUrl}/cards/${cardToken}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ state: 'OPEN' }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Lithic unfreeze failed: ${res.status} ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    return { success: true, card: parseCard(data) };
  } catch (error) {
    console.error('Lithic unfreeze failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Lithic error',
    };
  }
}

// Update spending limit (top-up or reduce)
export async function updateSpendLimit(cardToken: string, newLimitCents: number): Promise<CardResult> {
  if (isMockMode) {
    const existing = mockCards.get(cardToken);
    if (existing) {
      existing.spendLimit = newLimitCents;
      return { success: true, card: existing };
    }
    return { success: false, error: 'Card not found' };
  }

  try {
    const res = await fetch(`${baseUrl}/cards/${cardToken}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({
        spend_limit: newLimitCents,
        spend_limit_duration: 'FOREVER',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Lithic limit update failed: ${res.status} ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    return { success: true, card: parseCard(data) };
  } catch (error) {
    console.error('Lithic limit update failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Lithic error',
    };
  }
}
