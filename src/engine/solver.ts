import { ageAt, isYearMonth } from '../model/dates';
import { chosenOption, resolveScenario } from '../model/resolve';
import { benefitAtClaimAge, MAX_CLAIM_AGE, MIN_CLAIM_AGE } from '../model/socialSecurity';
import type { PlanFile, SimScenario } from '../model/types';
import { simulateSummary } from './simulate';

export type SolverGoal = 'success' | 'median' | 'p10';

export const SOLVER_GOALS: Record<SolverGoal, string> = {
  success: 'Highest success rate',
  p10: 'Best poor-market (10th pct) ending savings',
  median: 'Best median ending savings',
};

export interface SolverCell {
  /** Claim age per swept person (month precision). */
  ages: number[];
  successRate: number;
  medianEndingReal: number;
  p10EndingReal: number;
  runwayP10Years: number | null;
  score: number;
}

export interface SolverResult {
  scenarioId: string;
  goal: SolverGoal;
  runs: number;
  /** People whose claim age was varied, with their allowed range. */
  people: { id: string; name: string; minAge: number; maxAge: number }[];
  /** Whole-year grid (row-major by the first person). */
  grid: SolverCell[];
  /** Best result after month-by-month refinement around the best grid cell. */
  best: SolverCell;
  /** The scenario's current choice, for comparison. */
  current: SolverCell;
}

function score(goal: SolverGoal, c: Omit<SolverCell, 'score'>): number {
  // Primary metric, with small tie-breakers so flat regions still rank sensibly.
  if (goal === 'success') return c.successRate * 1e9 + c.p10EndingReal / 1e3 + c.medianEndingReal / 1e6;
  if (goal === 'p10') return c.p10EndingReal + c.successRate * 1e3 + c.medianEndingReal / 1e6;
  return c.medianEndingReal + c.successRate * 1e3;
}

const toMonth = (age: number) => Math.round(age * 12) / 12;

/**
 * Search Social Security claim ages (62–70, month precision) for up to two people, holding
 * every other choice in `scenarioId` fixed. Every candidate replays the same market paths.
 */
export function solveClaiming(
  plan: PlanFile,
  scenarioId: string,
  goal: SolverGoal,
  runs: number,
  onProgress?: (fraction: number) => void,
): SolverResult {
  const scenario = plan.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error('Scenario not found.');
  const settings = { ...plan.settings, runs };
  const base = resolveScenario(plan, scenario);

  const swept = plan.household.people
    .map((p, index) => {
      const option = chosenOption(p.ssOptions, scenario, p.id);
      const age0 = isYearMonth(p.birthDate) ? ageAt(p.birthDate, plan.settings.startDate) : 0;
      const birthYear = isYearMonth(p.birthDate) ? +p.birthDate.slice(0, 4) : 1960;
      const minAge = toMonth(Math.max(MIN_CLAIM_AGE, Math.ceil(age0 * 12) / 12));
      return { p, index, option, birthYear, minAge, maxAge: MAX_CLAIM_AGE };
    })
    .filter((x) => x.option && !x.option.off && x.p.ssKnownBenefit > 0 && x.minAge < x.maxAge)
    .slice(0, 2);
  if (swept.length === 0) throw new Error('Nobody in this scenario has a Social Security claim age left to choose.');

  const cache = new Map<string, SolverCell>();
  const evaluate = (ages: number[]): SolverCell => {
    const key = ages.map((a) => a.toFixed(4)).join('|');
    const hit = cache.get(key);
    if (hit) return hit;
    const sim: SimScenario = { ...base, people: base.people.map((p) => ({ ...p })) };
    swept.forEach((s, i) => {
      sim.people[s.index].ssClaimAge = ages[i];
      sim.people[s.index].ssMonthlyBenefit = benefitAtClaimAge(s.p.ssKnownBenefit, s.p.ssKnownAge, s.birthYear, ages[i]);
    });
    const r = simulateSummary(settings, sim);
    const partial = {
      ages,
      successRate: r.successRate,
      medianEndingReal: r.medianEndingReal,
      p10EndingReal: r.p10EndingReal,
      runwayP10Years: r.runwayP10Years,
    };
    const cell = { ...partial, score: score(goal, partial) };
    cache.set(key, cell);
    return cell;
  };

  const yearAges = swept.map((s) => {
    const list: number[] = [s.minAge];
    for (let a = Math.ceil(s.minAge); a <= s.maxAge; a++) if (a > s.minAge + 1e-9) list.push(a);
    return list;
  });
  let combos: number[][] = [[]];
  for (const list of yearAges) combos = combos.flatMap((c) => list.map((a) => [...c, a]));
  const refineSteps = swept.length * 2 * 22;
  const total = combos.length + refineSteps + 1;
  let done = 0;
  const tick = () => onProgress?.(Math.min(1, ++done / total));

  const grid = combos.map((ages) => {
    const cell = evaluate(ages);
    tick();
    return cell;
  });

  // Coordinate search by month around the best whole-year cell, two passes.
  let best = grid.reduce((a, b) => (b.score > a.score ? b : a));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < swept.length; i++) {
      for (let dm = -11; dm <= 11; dm++) {
        if (dm === 0) continue;
        const age = toMonth(best.ages[i] + dm / 12);
        if (age < swept[i].minAge - 1e-9 || age > swept[i].maxAge + 1e-9) continue;
        const ages = [...best.ages];
        ages[i] = age;
        const cell = evaluate(ages);
        tick();
        if (cell.score > best.score) best = cell;
      }
    }
  }

  const current = evaluate(swept.map((s) => Math.max(s.minAge, Math.min(s.maxAge, s.option!.value.claimAge))));
  onProgress?.(1);

  return {
    scenarioId,
    goal,
    runs,
    people: swept.map((s) => ({ id: s.p.id, name: s.p.name, minAge: s.minAge, maxAge: s.maxAge })),
    grid,
    best,
    current,
  };
}
