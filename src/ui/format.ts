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

export function runway(years: number | null): string {
  if (years === null) return 'Never runs out';
  return `${years.toFixed(1)} yrs`;
}
