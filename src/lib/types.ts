// Unified holding type — single source of truth for all components

export interface Holding {
  symbol: string;
  name: string;
  shares: number;
  icon: string;
  gradient: string;
  type?: 'stock' | 'crypto'; // defaults to 'stock'
}

export const SYMBOL_GRADIENTS: Record<string, string> = {
  TSLA: 'linear-gradient(135deg, #E31937, #B91C3A)',
  AAPL: 'linear-gradient(135deg, #555, #333)',
  NFLX: 'linear-gradient(135deg, #E50914, #B20710)',
  MSFT: 'linear-gradient(135deg, #00A4EF, #0078D4)',
  AMZN: 'linear-gradient(135deg, #FF9900, #E88B00)',
  GOOGL: 'linear-gradient(135deg, #4285F4, #3367D6)',
  META: 'linear-gradient(135deg, #0668E1, #0553B8)',
  NVDA: 'linear-gradient(135deg, #76B900, #5E9400)',
};

export const DEFAULT_GRADIENT = 'linear-gradient(135deg, #6366F1, #4F46E5)';

export function holdingGradient(symbol: string): string {
  return SYMBOL_GRADIENTS[symbol] ?? DEFAULT_GRADIENT;
}

export const DEMO_HOLDINGS: Holding[] = [
  { symbol: 'TSLA', name: 'Tesla', shares: 44, icon: 'T', gradient: SYMBOL_GRADIENTS.TSLA },
  { symbol: 'AAPL', name: 'Apple', shares: 10, icon: 'A', gradient: SYMBOL_GRADIENTS.AAPL },
];
