import { describe, expect, it } from 'vitest';
import { solveClaiming } from '../engine/solver';
import {
  allCombinations,
  expenseChoice,
  incomeChoice,
  newExpense,
  newIncome,
  newOption,
  newPerson,
  newPhase,
  newScenario,
  samplePlan,
} from './defaults';
import { normalizePlan } from './normalize';
import { resolveScenario } from './resolve';
import { benefitAtClaimAge, claimFactor, fullRetirementAge } from './socialSecurity';

describe('Social Security', () => {
  it('follows the SSA full retirement age schedule', () => {
    expect(fullRetirementAge(1950)).toBe(66);
    expect(fullRetirementAge(1957)).toBe(66.5);
    expect(fullRetirementAge(1966)).toBe(67);
  });

  it('reduces early and credits delayed claims', () => {
    expect(claimFactor(1966, 62)).toBeCloseTo(0.7, 6);
    expect(claimFactor(1966, 67)).toBe(1);
    expect(claimFactor(1966, 70)).toBeCloseTo(1.24, 6);
    expect(claimFactor(1966, 67.5)).toBeCloseTo(1.04, 6);
  });

  it('scales a known benefit at any age to another claim age', () => {
    // $2,100 at 62 is 70% of a $3,000 PIA; at 70 that is $3,720.
    expect(benefitAtClaimAge(2100, 62, 1966, 70)).toBe(3720);
    expect(benefitAtClaimAge(2900, 67, 1966, 67)).toBe(2900);
  });
});

describe('resolveScenario', () => {
  it('turns expense phases tied to ages into date ranges', () => {
    const plan = samplePlan();
    plan.settings.startDate = '2026-01';
    const a = plan.household.people[0]; // born 1966-04
    plan.household.expenses = [
      newExpense('Insurance', expenseChoice('monthly', [newPhase(800), newPhase(400, { type: 'age', personId: a.id, age: 65 })]), {
        ownerId: a.id,
      }),
    ];
    const sim = resolveScenario(plan, plan.scenarios[0]);
    expect(sim.expenses).toEqual([
      expect.objectContaining({ amount: 800, startDate: '', endDate: '2031-03', owner: 0 }),
      expect.objectContaining({ amount: 400, startDate: '2031-04', endDate: '', owner: 0 }),
    ]);
  });

  it('converts a payment count into an end month and skips "off" options', () => {
    const plan = samplePlan();
    const on = newOption('Monthly × 12', incomeChoice('monthly', { amount: 5000, start: { type: 'date', date: '2027-01' }, payments: 12 }));
    const off = newOption('None', incomeChoice('monthly'), true);
    plan.household.incomes = [newIncome('Severance', [on, off])];
    const id = plan.household.incomes[0].id;
    const withIt = resolveScenario(plan, newScenario({ choices: { [id]: on.id } }));
    expect(withIt.incomes[0]).toEqual(expect.objectContaining({ startDate: '2027-01', endDate: '2027-12' }));
    expect(resolveScenario(plan, newScenario({ choices: { [id]: off.id } })).incomes).toHaveLength(0);
  });

  it('derives Social Security from the known benefit for the chosen claim age', () => {
    const plan = samplePlan();
    const sim = resolveScenario(plan, plan.scenarios[2]); // Person A at 70
    expect(sim.people[0].ssClaimAge).toBe(70);
    expect(sim.people[0].ssMonthlyBenefit).toBe(Math.round(2900 * 1.24));
  });
});

describe('scenarios', () => {
  it('builds every combination of decisions', () => {
    const plan = samplePlan();
    // SS A (3) × SS B (2) × mortgage (2) × severance (3) × consulting (2)
    expect(allCombinations(plan.household)).toHaveLength(72);
  });
});

describe('normalizePlan', () => {
  it('round-trips an exported plan', () => {
    const plan = samplePlan();
    expect(normalizePlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it('rejects garbage', () => {
    expect(() => normalizePlan('nope')).toThrow();
    expect(() => normalizePlan({ format: 'other' })).toThrow();
  });

  it('fills missing fields', () => {
    const plan = normalizePlan({ household: { people: [{ name: 'Solo' }] }, scenarios: [] });
    expect(plan.household.people[0].ssOptions[0].value.claimAge).toBe(67);
    expect(plan.scenarios).toHaveLength(1);
  });

  it('migrates version 1 files, merging per-scenario copies into options', () => {
    const person = { id: 'p1', name: 'Person A', birthDate: '1966-04', lifeExpectancy: 88, ssClaimAge: 67, ssMonthlyBenefit: 2900 };
    const v1 = {
      format: 'retirement-planner',
      version: 1,
      settings: { startDate: '2026-09' },
      scenarios: [
        {
          name: 'A',
          people: [person],
          accounts: [{ id: 'c', name: 'Cash', type: 'cash', balance: 1000 }],
          loans: [{ name: 'Mortgage', balance: 100, annualRate: 6, monthlyPayment: 10, payoffDate: '' }],
          expenses: [{ name: 'Food', amount: 900, frequency: 'monthly' }],
          incomes: [{ name: 'Severance', kind: 'lump', amount: 90000, startDate: '2026-10', ownerId: 'p1', depositToId: 'c' }],
        },
        {
          name: 'B',
          people: [{ ...person, id: 'p2', ssClaimAge: 70, ssMonthlyBenefit: 3600 }],
          accounts: [{ id: 'c2', name: 'Cash', type: 'cash', balance: 1000 }],
          loans: [{ name: 'Mortgage', balance: 100, annualRate: 6, monthlyPayment: 10, payoffDate: '2026-11' }],
          expenses: [{ name: 'Food', amount: 900, frequency: 'monthly' }],
          incomes: [],
        },
      ],
    };
    const plan = normalizePlan(v1);
    const h = plan.household;
    expect(h.people).toHaveLength(1);
    expect(h.people[0].ssOptions.map((o) => o.value.claimAge)).toEqual([67, 70]);
    expect(h.accounts[0].options).toHaveLength(1);
    expect(h.loans[0].options.map((o) => o.label)).toEqual(['Keep paying', 'Pay off 2026-11']);
    expect(h.expenses[0].options).toHaveLength(1);
    expect(h.incomes[0].options.map((o) => o.off)).toEqual([false, true]);
    expect(h.incomes[0].ownerId).toBe(h.people[0].id);
    expect(h.incomes[0].options[0].value.depositToId).toBe(h.accounts[0].id);

    const b = resolveScenario(plan, plan.scenarios[1]);
    expect(b.people[0]).toEqual(expect.objectContaining({ ssClaimAge: 70, ssMonthlyBenefit: 3600 }));
    expect(b.loans[0].payoffDate).toBe('2026-11');
    expect(b.incomes).toHaveLength(0);
  });
});

describe('solveClaiming', () => {
  it('prefers delaying when the claimant lives long and savings are ample', () => {
    const plan = samplePlan();
    plan.settings = { ...plan.settings, startDate: '2026-01', horizonYears: 40 };
    const p = newPerson({ name: 'Solo', birthDate: '1964-01', lifeExpectancy: 97, ssKnownBenefit: 3000, ssKnownAge: 67 });
    plan.household = { ...plan.household, people: [p], incomes: [], loans: [], expenses: [newExpense('Living', expenseChoice('monthly', [newPhase(4000)]))] };
    plan.scenarios = [newScenario()];
    const r = solveClaiming(plan, plan.scenarios[0].id, 'median', 150);
    expect(r.people.map((x) => x.name)).toEqual(['Solo']);
    expect(r.grid.length).toBe(9); // 62..70
    expect(r.best.ages[0]).toBeGreaterThanOrEqual(68);
    expect(r.best.score).toBeGreaterThanOrEqual(r.current.score);
  });
});

describe('explore', () => {
  it('enumerates every combination, including every claim age when asked', async () => {
    const { buildAxes, comboAt, comboCount, exploreRange, summarizeEffects } = await import('../engine/explore');
    const plan = samplePlan();
    const axes = buildAxes(plan, false);
    expect(comboCount(axes)).toBe(72);
    // Mixed radix: the last index decodes to the last value of every axis.
    expect(comboAt(axes, 71)).toEqual(axes.map((a) => a.values.length - 1));

    const withAges = buildAxes(plan, true);
    expect(withAges.filter((a) => a.kind === 'ss-age')).toHaveLength(2);
    expect(withAges[0].values.map((v) => v.claimAge)).toEqual([62, 63, 64, 65, 66, 67, 68, 69, 70]);

    const rows = exploreRange(plan, false, 60, 0, comboCount(axes));
    expect(rows).toHaveLength(72);
    const effects = summarizeEffects(axes, rows, 'success');
    expect(effects).toHaveLength(axes.length);
    for (const e of effects) expect(e.values.reduce((s, v) => s + v.bestShare, 0)).toBeCloseTo(100, 6);
  });
});

describe('Social Security taxation (IRS rule)', () => {
  it('taxes 0%, up to 50%, or up to 85% of benefits by provisional income', async () => {
    const { taxableSocialSecurity } = await import('./ssTax');
    // Joint, $40K benefits: provisional = other + 20K.
    expect(taxableSocialSecurity(40000, 10000, true)).toBe(0); // PI 30K ≤ 32K
    expect(taxableSocialSecurity(40000, 20000, true)).toBe(4000); // PI 40K: ½ × (40K − 32K)
    expect(taxableSocialSecurity(40000, 60000, true)).toBe(0.85 * 40000); // capped at 85%
    // PI 50K: 0.85 × (50K − 44K) + min(20K, 6K) = 5.1K + 6K
    expect(taxableSocialSecurity(40000, 30000, true)).toBeCloseTo(11100, 6);
    // Single thresholds are lower: PI 30K → ½ × (30K − 25K)
    expect(taxableSocialSecurity(20000, 20000, false)).toBe(2500);
  });
});
