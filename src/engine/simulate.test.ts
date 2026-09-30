import { describe, expect, it } from 'vitest';
import { newAccount, newExpense, newIncome, newLoan, newPerson, newScenario, samplePlan } from '../model/defaults';
import { normalizePlan } from '../model/normalize';
import type { PlanFile, Scenario } from '../model/types';
import { expectedDeathAge, sampleDeathAge, solveModalAge } from './mortality';
import { simulateScenario } from './simulate';

function planWith(scenario: Scenario, overrides: Partial<PlanFile['settings']> = {}): PlanFile {
  const plan = samplePlan();
  plan.settings = { ...plan.settings, startDate: '2026-01', runs: 200, horizonYears: 10, ...overrides };
  plan.scenarios = [scenario];
  return plan;
}

const flatMarket = {
  stockReturn: 0, stockStdev: 0, bondReturn: 0, bondStdev: 0,
  correlation: 0, cashReturn: 0, inflation: 0, inflationStdev: 0,
};

describe('simulateScenario', () => {
  it('spends down cash linearly with no returns or inflation', () => {
    const s = newScenario({
      accounts: [newAccount({ type: 'cash', balance: 120_000 })],
      expenses: [newExpense({ amount: 1_000 })],
    });
    const r = simulateScenario(planWith(s, { market: flatMarket }), s);
    expect(r.liquidNominal[50][1]).toBeCloseTo(108_000, 6);
    expect(r.liquidNominal[50][10]).toBeCloseTo(0, 6);
    expect(r.successRate).toBe(100);
  });

  it('reports depletion when money runs out', () => {
    const s = newScenario({
      accounts: [newAccount({ type: 'cash', balance: 24_000 })],
      expenses: [newExpense({ amount: 1_000 })],
    });
    const r = simulateScenario(planWith(s, { market: flatMarket }), s);
    expect(r.successRate).toBe(0);
    expect(r.runwayP50Years).toBe(2);
    expect(r.fundedPct[2]).toBe(100);
    expect(r.fundedPct[3]).toBe(0);
  });

  it('grosses up traditional withdrawals for tax', () => {
    const s = newScenario({
      accounts: [newAccount({ type: 'traditional', balance: 100_000 })],
      expenses: [newExpense({ amount: 800 })],
      taxes: { ordinaryRate: 20, taxableWithdrawalRate: 0, ssTaxablePct: 85 },
    });
    const r = simulateScenario(planWith(s, { market: flatMarket }), s);
    expect(r.liquidNominal[50][1]).toBeCloseTo(100_000 - 12 * 1_000, 6);
  });

  it('amortizes loans and pays off early from savings', () => {
    const loan = newLoan({ balance: 12_000, annualRate: 0, monthlyPayment: 1_000 });
    const s = newScenario({ accounts: [newAccount({ type: 'cash', balance: 50_000 })], loans: [loan] });
    const r = simulateScenario(planWith(s, { market: flatMarket }), s);
    expect(r.liquidNominal[50][1]).toBeCloseTo(38_000, 6);
    expect(r.liquidNominal[50][2]).toBeCloseTo(38_000, 6);
    expect(r.ledger[0].events).toContain(`${loan.name} paid off`);

    s.loans[0] = { ...loan, payoffDate: '2026-03' };
    const early = simulateScenario(planWith(s, { market: flatMarket }), s);
    expect(early.liquidNominal[50][1]).toBeCloseTo(38_000, 6);
    expect(early.ledger[0].events).toContain(`${loan.name} paid off early`);
  });

  it('applies income survivorship after the owner dies', () => {
    // Owner (age ~70) dies after 2 years; income continues at 50% to the survivor.
    const owner = newPerson({ birthDate: '1956-01', lifeExpectancy: 72, ssMonthlyBenefit: 0 });
    const spouse = newPerson({ birthDate: '1960-01', lifeExpectancy: 99, ssMonthlyBenefit: 0 });
    const s = newScenario({
      people: [owner, spouse],
      accounts: [newAccount({ type: 'cash', balance: 0 })],
      incomes: [newIncome({ amount: 1_000, startDate: '2026-01', ownerId: owner.id, survivorPct: 50, taxable: false })],
    });
    const r = simulateScenario(planWith(s, { market: flatMarket }), s);
    expect(r.liquidNominal[50][2]).toBeCloseTo(24_000, 6);
    expect(r.liquidNominal[50][3]).toBeCloseTo(24_000 + 6_000, 6);
  });

  it('gives the survivor the larger Social Security benefit', () => {
    const high = newPerson({ birthDate: '1956-01', lifeExpectancy: 71, ssClaimAge: 62, ssMonthlyBenefit: 3_000 });
    const low = newPerson({ birthDate: '1958-01', lifeExpectancy: 99, ssClaimAge: 62, ssMonthlyBenefit: 1_000 });
    const s = newScenario({
      people: [high, low],
      accounts: [newAccount({ type: 'cash', balance: 0 })],
      taxes: { ordinaryRate: 0, taxableWithdrawalRate: 0, ssTaxablePct: 0 },
    });
    const r = simulateScenario(planWith(s, { market: flatMarket }), s);
    expect(r.liquidNominal[50][1]).toBeCloseTo(48_000, 6);
    expect(r.liquidNominal[50][2]).toBeCloseTo(48_000 + 36_000, 6);
  });

  it('is reproducible for a fixed seed and uses common random numbers across scenarios', () => {
    const plan = samplePlan();
    plan.settings.runs = 300;
    const a1 = simulateScenario(plan, plan.scenarios[0]);
    const a2 = simulateScenario(plan, plan.scenarios[0]);
    expect(a1.liquidReal[50]).toEqual(a2.liquidReal[50]);
    expect(a1.successRate).toBeGreaterThan(0);
  });

  it('matches the expected mean return in a deterministic ledger', () => {
    const s = newScenario({ accounts: [newAccount({ type: 'taxable', balance: 100_000, stockPct: 100 })] });
    const r = simulateScenario(planWith(s, { market: { ...flatMarket, stockReturn: 7 } }), s);
    expect(r.ledger[0].endLiquid).toBeCloseTo(107_000, 3);
  });
});

describe('mortality', () => {
  it('solves the modal age that reproduces a life expectancy', () => {
    const m = solveModalAge(60, 86);
    expect(expectedDeathAge(60, m)).toBeCloseTo(86, 2);
  });

  it('samples death ages whose mean matches the life expectancy', () => {
    const m = solveModalAge(65, 88);
    let total = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) total += sampleDeathAge(65, m, (i + 0.5) / n);
    expect(total / n).toBeCloseTo(88, 0);
  });
});

describe('normalizePlan', () => {
  it('round-trips an exported plan', () => {
    const plan = samplePlan();
    expect(normalizePlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it('fills missing fields and rejects garbage', () => {
    const plan = normalizePlan({ scenarios: [{ name: 'X', people: [{ name: 'Solo' }] }] });
    expect(plan.scenarios[0].people[0].ssClaimAge).toBe(67);
    expect(() => normalizePlan({ scenarios: [] })).toThrow();
    expect(() => normalizePlan('nope')).toThrow();
  });
});
