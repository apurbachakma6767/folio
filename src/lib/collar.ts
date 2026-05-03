// Deterministic collar engine — no real options trading
// Floor protects the platform. Cap is cost to the user.

export interface CollarResult {
  shares: number;
  sharesHts: number; // integer, decimal 6
  floor: number;
  cap: number;
  collateralValue: number;
  advance: number;
  advanceHts: number; // integer, decimal 6
  fee: number;
  expiryDate: Date;
  durationMonths: number;
}

const FLOOR_PCT = 0.05; // 5% downside protection
const CAP_PCT = 0.15; // 15% upside cap
const HTS_DECIMALS = 6;

function getThirdFriday(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const day = first.getDay();
  const firstFriday = day <= 5 ? 5 - day + 1 : 5 + 7 - day + 1;
  return new Date(year, month, firstFriday + 14);
}

export function getExpiryDate(months: number): Date {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + months, 1);
  return getThirdFriday(target.getFullYear(), target.getMonth());
}

export function calculateCollar(
  spendAmount: number,
  stockPrice: number,
  durationMonths: number = 1
): CollarResult {
  const shares = spendAmount / stockPrice;
  const sharesHts = Math.floor(shares * 10 ** HTS_DECIMALS);
  // Scale floor/cap by sqrt(duration) — longer collars need wider ranges
  const durationScale = Math.sqrt(durationMonths);
  const floor = stockPrice * (1 - FLOOR_PCT * durationScale);
  const cap = stockPrice * (1 + CAP_PCT * durationScale);
  const collateralValue = shares * stockPrice;
  const advance = spendAmount;
  const advanceHts = Math.floor(advance * 10 ** HTS_DECIMALS);
  const expiryDate = getExpiryDate(durationMonths);

  return {
    shares,
    sharesHts,
    floor,
    cap,
    collateralValue,
    advance,
    advanceHts,
    fee: 0, // zero-cost collar
    expiryDate,
    durationMonths,
  };
}

export function formatShares(shares: number): string {
  return shares.toFixed(3);
}

export function formatUsd(amount: number): string {
  return '$' + amount.toFixed(2);
}

export function formatDate(d: Date): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
