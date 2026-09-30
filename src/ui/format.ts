const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const money = (v: number) => usd.format(Math.round(v));
export const moneyCompact = (v: number) => (Math.abs(v) < 1000 ? usd.format(Math.round(v)) : usdCompact.format(v));
export const pct = (v: number, digits = 0) => `${v.toFixed(digits)}%`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2032-09` → `Sep 2032` */
export const monthLabel = (ym: string) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * How long savings last, as the calendar year they run out plus the duration from the plan start:
 * "2039 · 13.2 yrs".
 */
export function runway(years: number | null, startDate?: string): string {
  if (years === null) return 'Never runs out';
  if (!startDate) return `${years.toFixed(1)} yrs`;
  const start = +startDate.slice(0, 4) * 12 + (+startDate.slice(5, 7) - 1);
  const year = Math.floor((start + Math.round(years * 12)) / 12);
  return `${year} · ${years.toFixed(1)} yrs`;
}

/** "2026-09" → "Sep 2026" */
export function monthName(ym: string): string {
  return `${MONTH_NAMES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
}
