import { ageAt, isYearMonth } from '../model/dates';
import { decisions, resolveScenario } from '../model/resolve';
import { benefitAtClaimAge, formatAge, MAX_CLAIM_AGE, MIN_CLAIM_AGE } from '../model/socialSecurity';
import type { PlanFile, Scenario } from '../model/types';
import { simulateSummary, type SummaryResult } from './simulate';

/**
 * One dimension of the search: an item's options, or (optionally) every whole-year Social
 * Security claim age for a person.
 */
export interface Axis {
  key: string;
  name: string;
  group: string;
  kind: 'option' | 'ss-age';
  values: { id: string; label: string; claimAge?: number }[];
}

export interface ExploreRow extends SummaryResult {
  /** Combination index — decodes to one value index per axis via `comboAt`. */
  index: number;
}

export const MAX_EXPLORE_COMBINATIONS = 20000;

/** Earliest claim age still possible (62, or the person's current age rounded up to a month). */
export function earliestClaimAge(birthDate: string, startDate: string): number {
  const age0 = isYearMonth(birthDate) ? ageAt(birthDate, startDate) : 0;
  return Math.round(Math.max(MIN_CLAIM_AGE, Math.ceil(age0 * 12 - 1e-9) / 12) * 12) / 12;
}

export function buildAxes(plan: PlanFile, allClaimAges: boolean): Axis[] {
  const h = plan.household;
  const swept = new Set<string>();
  const ageAxes: Axis[] = [];
  if (allClaimAges) {
    for (const p of h.people) {
      const min = earliestClaimAge(p.birthDate, plan.settings.startDate);
      if (p.ssKnownBenefit <= 0 || min >= MAX_CLAIM_AGE) continue;
      const ages = [min];
      for (let a = Math.ceil(min); a <= MAX_CLAIM_AGE; a++) if (a > min + 1e-9) ages.push(a);
      swept.add(p.id);
      ageAxes.push({
        key: p.id,
        name: `${p.name} — Social Security`,
        group: 'Social Security',
        kind: 'ss-age',
        values: ages.map((a) => ({ id: `age:${a}`, label: `Claim at ${formatAge(a)}`, claimAge: a })),
      });
    }
  }
  const optionAxes: Axis[] = decisions(h)
    .filter((d) => !swept.has(d.key))
    .map((d) => ({
      key: d.key,
      name: d.name,
      group: d.group,
      kind: 'option',
      values: d.options.map((o) => ({ id: o.id, label: o.off ? `${o.label} (not included)` : o.label })),
    }));
  // Keep Social Security first, as in the decisions list.
  return [...ageAxes, ...optionAxes].sort((a, b) => Number(b.group === 'Social Security') - Number(a.group === 'Social Security'));
}

export function comboCount(axes: Axis[]): number {
  return axes.reduce((n, a) => n * a.values.length, 1);
}

/** Mixed-radix decode: combination index → value index per axis (last axis varies fastest). */
export function comboAt(axes: Axis[], index: number): number[] {
  const picks = new Array<number>(axes.length);
  for (let i = axes.length - 1; i >= 0; i--) {
    const n = axes[i].values.length;
    picks[i] = index % n;
    index = Math.floor(index / n);
  }
  return picks;
}

/** Scenario choices + claim-age overrides for one combination. */
export function picksToChoices(axes: Axis[], picks: number[]) {
  const choices: Record<string, string> = {};
  const claimAges: Record<string, number> = {};
  axes.forEach((axis, i) => {
    const v = axis.values[picks[i]];
    if (axis.kind === 'option') choices[axis.key] = v.id;
    else claimAges[axis.key] = v.claimAge!;
  });
  return { choices, claimAges };
}

/** Simulate combinations [from, to). Called inside a worker, one slice per worker. */
export function exploreRange(
  plan: PlanFile,
  allClaimAges: boolean,
  runs: number,
  from: number,
  to: number,
  onProgress?: (fraction: number) => void,
): ExploreRow[] {
  const axes = buildAxes(plan, allClaimAges);
  const settings = { ...plan.settings, runs };
  const personIndex = new Map(plan.household.people.map((p, i) => [p.id, i]));
  const rows: ExploreRow[] = [];
  for (let index = from; index < to; index++) {
    const { choices, claimAges } = picksToChoices(axes, comboAt(axes, index));
    const scenario: Scenario = { id: 'explore', name: 'Explore', notes: '', colorSlot: 0, choices, marketOverride: null };
    const sim = resolveScenario(plan, scenario);
    for (const [personId, age] of Object.entries(claimAges)) {
      const i = personIndex.get(personId)!;
      const p = plan.household.people[i];
      const birthYear = isYearMonth(p.birthDate) ? +p.birthDate.slice(0, 4) : 1960;
      sim.people[i] = { ...sim.people[i], ssClaimAge: age, ssMonthlyBenefit: benefitAtClaimAge(p.ssKnownBenefit, p.ssKnownAge, birthYear, age) };
    }
    rows.push({ index, ...simulateSummary(settings, sim) });
    if (onProgress && (index - from) % 5 === 0) onProgress((index - from + 1) / (to - from));
  }
  onProgress?.(1);
  return rows;
}

export type ExploreSort = 'success' | 'runway' | 'median' | 'p10';

export const EXPLORE_SORTS: Record<ExploreSort, string> = {
  success: 'Success rate',
  runway: 'Runway (90%)',
  p10: 'Poor-market ending',
  median: 'Median ending',
};

/** Higher is better; small tie-breakers keep flat regions in a sensible order. */
export function rowScore(sort: ExploreSort, r: SummaryResult): number {
  const runway = r.runwayP10Years ?? 1000;
  switch (sort) {
    case 'success':
      return r.successRate * 1e12 + runway * 1e8 + r.p10EndingReal / 10 + r.medianEndingReal / 1e7;
    case 'runway':
      return runway * 1e12 + r.successRate * 1e8 + r.p10EndingReal / 10;
    case 'p10':
      return r.p10EndingReal * 1e3 + r.successRate + r.medianEndingReal / 1e7;
    case 'median':
      return r.medianEndingReal * 1e3 + r.successRate;
  }
}

export interface ValueEffect {
  label: string;
  /** Averages across every combination that uses this value. */
  meanSuccess: number;
  meanMedianEnding: number;
  meanP10Ending: number;
  /** Share of like-for-like comparisons (all other choices equal) in which this value was best. */
  bestShare: number;
}

export interface AxisEffect {
  axis: Axis;
  values: ValueEffect[];
  /** Spread of mean success across values — how much this decision matters. */
  successSpread: number;
}

/** How much each decision matters, and which option wins when everything else is held equal. */
export function summarizeEffects(axes: Axis[], rows: ExploreRow[], sort: ExploreSort): AxisEffect[] {
  const decoded = rows.map((r) => ({ r, picks: comboAt(axes, r.index), score: rowScore(sort, r) }));
  return axes
    .map((axis, a) => {
      const n = axis.values.length;
      const sum = Array.from({ length: n }, () => ({ count: 0, success: 0, median: 0, p10: 0 }));
      const groups = new Map<string, { value: number; score: number }[]>();
      for (const d of decoded) {
        const v = d.picks[a];
        const s = sum[v];
        s.count++;
        s.success += d.r.successRate;
        s.median += d.r.medianEndingReal;
        s.p10 += d.r.p10EndingReal;
        const key = d.picks.filter((_, i) => i !== a).join(',');
        const list = groups.get(key) ?? [];
        list.push({ value: v, score: d.score });
        groups.set(key, list);
      }
      const wins = new Array<number>(n).fill(0);
      let comparisons = 0;
      for (const list of groups.values()) {
        if (list.length < 2) continue;
        const top = Math.max(...list.map((x) => x.score));
        const winners = list.filter((x) => x.score === top);
        for (const w of winners) wins[w.value] += 1 / winners.length;
        comparisons++;
      }
      const values = axis.values.map((v, i) => ({
        label: v.label,
        meanSuccess: sum[i].count ? sum[i].success / sum[i].count : 0,
        meanMedianEnding: sum[i].count ? sum[i].median / sum[i].count : 0,
        meanP10Ending: sum[i].count ? sum[i].p10 / sum[i].count : 0,
        bestShare: comparisons ? (wins[i] / comparisons) * 100 : 0,
      }));
      const successes = values.map((v) => v.meanSuccess);
      return { axis, values, successSpread: Math.max(...successes) - Math.min(...successes) };
    })
    .sort((x, y) => y.successSpread - x.successSpread);
}
