import type { YearMonth } from './types';

const YM = /^(\d{4})-(\d{2})$/;

export function isYearMonth(value: unknown): value is YearMonth {
  if (typeof value !== 'string') return false;
  const m = YM.exec(value);
  return !!m && +m[2] >= 1 && +m[2] <= 12;
}

/** Months since year 0 — a flat index that makes month arithmetic trivial. */
export function toMonthIndex(ym: YearMonth): number {
  const m = YM.exec(ym);
  if (!m) throw new Error(`Invalid month "${ym}" (expected YYYY-MM)`);
  return +m[1] * 12 + (+m[2] - 1);
}

export function fromMonthIndex(index: number): YearMonth {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function currentYearMonth(date = new Date()): YearMonth {
  return fromMonthIndex(date.getFullYear() * 12 + date.getMonth());
}

/** Month offset of `ym` relative to `start`, or `fallback` when `ym` is unset. */
export function offsetFrom(start: YearMonth, ym: YearMonth, fallback: number): number {
  return isYearMonth(ym) ? toMonthIndex(ym) - toMonthIndex(start) : fallback;
}

export function ageAt(birth: YearMonth, at: YearMonth): number {
  return (toMonthIndex(at) - toMonthIndex(birth)) / 12;
}
