/**
 * IRS rule for how much Social Security is taxable (IRS Pub. 915 worksheet).
 * Provisional income = other income + ½ of benefits. The base amounts are fixed in law and
 * not indexed for inflation.
 */
export const SS_TAX_THRESHOLDS = {
  joint: { base: 32000, adjusted: 44000 },
  single: { base: 25000, adjusted: 34000 },
} as const;

/** Taxable dollars of `benefits` for a year with `otherIncome` of taxable non-SS income. */
export function taxableSocialSecurity(benefits: number, otherIncome: number, joint: boolean): number {
  if (benefits <= 0) return 0;
  const { base, adjusted } = joint ? SS_TAX_THRESHOLDS.joint : SS_TAX_THRESHOLDS.single;
  const provisional = Math.max(0, otherIncome) + benefits / 2;
  if (provisional <= base) return 0;
  if (provisional <= adjusted) return Math.min(benefits / 2, (provisional - base) / 2);
  const tier1 = Math.min(benefits / 2, (adjusted - base) / 2);
  return Math.min(0.85 * benefits, 0.85 * (provisional - adjusted) + tier1);
}

/** Taxable share (0–0.85) of benefits. */
export function taxableSocialSecurityShare(benefits: number, otherIncome: number, joint: boolean): number {
  return benefits > 0 ? taxableSocialSecurity(benefits, otherIncome, joint) / benefits : 0;
}
