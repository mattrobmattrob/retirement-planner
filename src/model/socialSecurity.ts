/** Full retirement age in years for a birth year (SSA schedule). */
export function fullRetirementAge(birthYear: number): number {
  if (birthYear <= 1937) return 65;
  if (birthYear <= 1942) return 65 + ((birthYear - 1937) * 2) / 12;
  if (birthYear <= 1954) return 66;
  if (birthYear <= 1959) return 66 + ((birthYear - 1954) * 2) / 12;
  return 67;
}

export const MIN_CLAIM_AGE = 62;
export const MAX_CLAIM_AGE = 70;

/**
 * Benefit at `claimAge` as a multiple of the full-retirement-age benefit (PIA).
 * Early: −5/9% per month for the first 36 months, −5/12% per month beyond.
 * Delayed: +2/3% per month (8%/yr) up to age 70.
 */
export function claimFactor(birthYear: number, claimAge: number): number {
  const fra = fullRetirementAge(birthYear);
  const age = Math.min(MAX_CLAIM_AGE, Math.max(MIN_CLAIM_AGE, claimAge));
  const months = Math.round((age - fra) * 12);
  if (months >= 0) return 1 + (months * 2) / 300;
  const early = -months;
  return 1 - (Math.min(early, 36) * 5) / 900 - (Math.max(0, early - 36) * 5) / 1200;
}

/**
 * Scale a known benefit (e.g. "$2,900/mo at 67" from an SSA statement) to another claim age.
 */
export function benefitAtClaimAge(knownBenefit: number, knownAge: number, birthYear: number, claimAge: number): number {
  return Math.round((knownBenefit * claimFactor(birthYear, claimAge)) / claimFactor(birthYear, knownAge));
}

/** 67.5 → "67y 6m", 67 → "67". */
export function formatAge(age: number): string {
  const years = Math.floor(age + 1e-9);
  const months = Math.round((age - years) * 12);
  return months ? `${years}y ${months}m` : `${years}`;
}
