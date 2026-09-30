import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultTaxes } from '../model/defaults';
import type { SimAccount, SimExpense, SimIncome, SimLoan, SimPerson, SimScenario, SimulationSettings } from '../model/types';
import { expectedDeathAge, sampleDeathAge, solveModalAge } from './mortality';
import { simulateScenario } from './simulate';

const flatMarket = {
  stockReturn: 0, stockStdev: 0, bondReturn: 0, bondStdev: 0,
  correlation: 0, cashReturn: 0, inflation: 0, inflationStdev: 0,
};

function settings(overrides: Partial<SimulationSettings> = {}): SimulationSettings {
  return { ...defaultSettings(), startDate: '2026-01', runs: 200, horizonYears: 10, ...overrides };
}

let nextId = 0;
const account = (type: SimAccount['type'], balance: number, stockPct = 0): SimAccount => ({
  id: `acct${nextId++}`, name: type, type, balance, stockPct, withdrawalPriority: 1,
});
const expense = (amount: number, partial: Partial<SimExpense> = {}): SimExpense => ({
  amount, frequency: 'monthly', startDate: '', endDate: '', inflationAdjusted: true, owner: -1, ...partial,
});
const person = (partial: Partial<SimPerson>): SimPerson => ({
  name: 'P', birthDate: '1960-01', lifeExpectancy: 99, ssClaimAge: 67, ssMonthlyBenefit: 0,
  // Unless given, treat the benefit as the full-retirement-age amount.
  ssPia: partial.ssPia ?? partial.ssMonthlyBenefit ?? 0,
  ...partial,
});
const income = (amount: number, partial: Partial<SimIncome> = {}): SimIncome => ({
  name: 'Income', kind: 'monthly', amount, startDate: '2026-01', endDate: '', owner: -1, survivorPct: 0,
  inflationAdjusted: false, taxable: false, depositTo: -1, ...partial,
});
const loan = (partial: Partial<SimLoan> = {}): SimLoan => ({
  name: 'Loan', balance: 12_000, annualRate: 0, monthlyPayment: 1_000, payoffDate: '', ...partial,
});

function scenario(partial: Partial<SimScenario>): SimScenario {
  return {
    id: 's', name: 'S', colorSlot: 0, people: [], accounts: [], loans: [], expenses: [], incomes: [],
    taxes: { ordinaryRate: 0, taxableWithdrawalRate: 0, ssTaxablePct: 0, ssTaxRule: 'flat' }, survivorExpensePct: 70,
    surplusAccount: -1, married: true, market: flatMarket, ...partial,
  };
}

describe('simulateScenario', () => {
  it('spends down cash linearly with no returns or inflation', () => {
    const s = scenario({ accounts: [account('cash', 120_000)], expenses: [expense(1_000)] });
    // Starting in January: 2026 plus 9 full years = 120 months.
    const r = simulateScenario(settings({ horizonYears: 9 }), s);
    expect(r.snapshotYears.slice(0, 3)).toEqual([null, 2026, 2027]);
    expect(r.liquidNominal[50][1]).toBeCloseTo(108_000, 6);
    expect(r.liquidNominal[50][10]).toBeCloseTo(0, 6);
    expect(r.successRate).toBe(100);
  });

  it('reports depletion when money runs out', () => {
    const s = scenario({ accounts: [account('cash', 24_000)], expenses: [expense(1_000)] });
    const r = simulateScenario(settings(), s);
    expect(r.successRate).toBe(0);
    expect(r.runwayP50Years).toBe(2);
    expect(r.fundedPct[2]).toBe(100);
    expect(r.fundedPct[3]).toBe(0);
  });

  it('grosses up traditional withdrawals for tax', () => {
    const s = scenario({
      accounts: [account('traditional', 100_000)],
      expenses: [expense(800)],
      taxes: { ...defaultTaxes(), ordinaryRate: 20 },
    });
    const r = simulateScenario(settings(), s);
    expect(r.liquidNominal[50][1]).toBeCloseTo(100_000 - 12 * 1_000, 6);
  });

  it('amortizes loans and pays off early from savings', () => {
    const s = scenario({ accounts: [account('cash', 50_000)], loans: [loan()] });
    const r = simulateScenario(settings(), s);
    expect(r.liquidNominal[50][1]).toBeCloseTo(38_000, 6);
    expect(r.liquidNominal[50][2]).toBeCloseTo(38_000, 6);
    expect(r.ledger[0].events).toContain('Loan paid off');

    const early = simulateScenario(settings(), { ...s, loans: [loan({ payoffDate: '2026-03' })] });
    expect(early.liquidNominal[50][1]).toBeCloseTo(38_000, 6);
    expect(early.ledger[0].events).toContain('Loan paid off early');
  });

  it('applies income survivorship after the owner dies', () => {
    // Owner (age 70) dies after 2 years; income continues at 50% to the survivor.
    const s = scenario({
      people: [person({ birthDate: '1956-01', lifeExpectancy: 72 }), person({ birthDate: '1960-01' })],
      accounts: [account('cash', 0)],
      incomes: [income(1_000, { owner: 0, survivorPct: 50 })],
    });
    const r = simulateScenario(settings(), s);
    expect(r.liquidNominal[50][2]).toBeCloseTo(24_000, 6);
    expect(r.liquidNominal[50][3]).toBeCloseTo(24_000 + 6_000, 6);
  });

  it('stops personal expenses at the owner\'s death and scales household spending', () => {
    const s = scenario({
      people: [person({ birthDate: '1956-01', lifeExpectancy: 71 }), person({ birthDate: '1960-01' })],
      accounts: [account('cash', 100_000)],
      expenses: [expense(500, { owner: 0 }), expense(1_000)],
      survivorExpensePct: 50,
    });
    const r = simulateScenario(settings(), s);
    expect(r.liquidNominal[50][1]).toBeCloseTo(100_000 - 18_000, 6);
    expect(r.liquidNominal[50][2]).toBeCloseTo(100_000 - 18_000 - 6_000, 6);
  });

  it('pays a spousal top-up while both are alive, then the larger survivor benefit', () => {
    // Both past full retirement age and claiming now. The lower earner's own $1,000 is below half
    // of the higher earner's $3,000 PIA, so they get a $500 top-up; after the death, the survivor
    // benefit is the deceased's $3,000.
    const s = scenario({
      people: [
        person({ birthDate: '1956-01', lifeExpectancy: 71, ssClaimAge: 62, ssMonthlyBenefit: 3_000 }),
        person({ birthDate: '1958-01', ssClaimAge: 62, ssMonthlyBenefit: 1_000 }),
      ],
      accounts: [account('cash', 0)],
    });
    const r = simulateScenario(settings(), s);
    expect(r.liquidNominal[50][1]).toBeCloseTo((3_000 + 1_500) * 12, 6);
    expect(r.liquidNominal[50][2]).toBeCloseTo((3_000 + 1_500) * 12 + 3_000 * 12, 6);

    // Unmarried partners get neither spousal nor survivor benefits.
    const single = simulateScenario(settings(), { ...s, married: false });
    expect(single.liquidNominal[50][2]).toBeCloseTo(4_000 * 12 + 1_000 * 12, 6);
  });

  it('reduces the spousal top-up when it starts before full retirement age', () => {
    // Born 1964 (FRA 67). Spouse B claims at 62 (60 months early): own $1,000 PIA × 70% = $700,
    // top-up ($1,500 − $1,000) × (1 − 25% − 10%) = $325. A (older) has already filed.
    const s = scenario({
      people: [
        person({ birthDate: '1958-01', ssClaimAge: 62, ssMonthlyBenefit: 3_000 }),
        person({ birthDate: '1964-01', ssClaimAge: 62, ssMonthlyBenefit: 700, ssPia: 1_000 }),
      ],
      accounts: [account('cash', 0)],
    });
    const r = simulateScenario(settings(), s);
    expect(r.liquidNominal[50][1]).toBeCloseTo((3_000 + 700 + 325) * 12, 6);
    expect(r.ledger[0].events).toContain('P spousal top-up starts');
  });

  it('waits for the higher earner to file before paying the spousal top-up', () => {
    // B (born 1964, FRA 67) files at 62 in Jan 2026; A only files at 70 in Jan 2028 (B is 64,
    // 36 months early → top-up × 75%).
    const s = scenario({
      people: [
        person({ birthDate: '1958-01', ssClaimAge: 70, ssMonthlyBenefit: 3_720, ssPia: 3_000 }),
        person({ birthDate: '1964-01', ssClaimAge: 62, ssMonthlyBenefit: 700, ssPia: 1_000 }),
      ],
      accounts: [account('cash', 0)],
    });
    const r = simulateScenario(settings(), s);
    expect(r.liquidNominal[50][2]).toBeCloseTo(700 * 24, 6);
    expect(r.liquidNominal[50][3] - r.liquidNominal[50][2]).toBeCloseTo((3_720 + 700 + 500 * 0.75) * 12, 6);
  });

  it('snapshots today, then each calendar year end', () => {
    const s = scenario({ accounts: [account('cash', 10_000)], expenses: [expense(1_000)] });
    const r = simulateScenario(settings({ startDate: '2026-09', horizonYears: 2 }), s);
    expect(r.snapshotYears).toEqual([null, 2026, 2027, 2028]);
    expect(r.snapshotMonths).toEqual([0, 4, 16, 28]);
    expect(r.liquidNominal[50][1]).toBeCloseTo(6_000, 6); // Sep–Dec 2026
    expect(r.runwayP50Years).toBeCloseTo(10 / 12, 6); // runs out in July 2027
  });

  it('assumes the configured share for the rest of this year and next year, then applies the IRS rule', () => {
    // $2,000/mo benefit and no other income: provisional income $12K is under the threshold.
    const s = scenario({
      people: [person({ birthDate: '1956-01', ssClaimAge: 62, ssMonthlyBenefit: 2_000 })],
      accounts: [account('cash', 0)],
      taxes: { ordinaryRate: 10, taxableWithdrawalRate: 0, ssTaxablePct: 85, ssTaxRule: 'irs' },
    });
    const r = simulateScenario(settings({ startDate: '2026-09' }), s);
    expect(r.ledger[0]).toEqual(expect.objectContaining({ year: 2026, firstMonth: '2026-09', lastMonth: '2026-12' }));
    expect(r.ledger.slice(0, 3).map((row) => row.ssDetail?.basis)).toEqual(['assumed', 'assumed', 'irs']);
    expect(r.ledger[1].ssTaxablePct).toBeCloseTo(85, 6);
    expect(r.ledger[1].taxes).toBeCloseTo(24_000 * 0.85 * 0.1, 6);
    expect(r.ledger[2].ssDetail).toEqual(expect.objectContaining({ tier: 0, taxable: 0, settlement: 0 }));
    expect(r.ledger[2].taxes).toBe(0);

    const flat = simulateScenario(settings({ startDate: '2026-09' }), { ...s, taxes: { ...s.taxes, ssTaxRule: 'flat' } });
    expect(flat.ledger[2].ssTaxablePct).toBeCloseTo(85, 6);
  });

  it('trues up the estimate the following April', () => {
    // 2028: a one-time $90K expense paid from the pre-tax account pushes provisional income over
    // the thresholds, but the monthly estimate (from 2027's zero other income) was 0%.
    const s = scenario({
      people: [person({ birthDate: '1956-01', ssClaimAge: 62, ssMonthlyBenefit: 2_000 })],
      accounts: [account('traditional', 1_000_000)],
      expenses: [expense(90_000, { frequency: 'once', startDate: '2028-06' })],
      taxes: { ordinaryRate: 10, taxableWithdrawalRate: 0, ssTaxablePct: 85, ssTaxRule: 'irs' },
    });
    const r = simulateScenario(settings({ startDate: '2026-01' }), s);
    const owed = 24_000 * 0.85 * 0.1;
    expect(r.ledger[2].ssDetail).toEqual(expect.objectContaining({ basis: 'irs', tier: 85, estimatedTaxable: 0 }));
    expect(r.ledger[2].ssDetail!.settlement).toBeCloseTo(owed, 6);
    expect(r.ledger[3].settlementPaid).toBeCloseTo(owed, 6);
  });

  it('counts pre-tax withdrawals toward provisional income', () => {
    const s = scenario({
      people: [person({ birthDate: '1956-01', ssClaimAge: 62, ssMonthlyBenefit: 2_000 })],
      accounts: [account('traditional', 2_000_000)],
      expenses: [expense(6_000)],
      taxes: { ordinaryRate: 10, taxableWithdrawalRate: 0, ssTaxablePct: 85, ssTaxRule: 'irs' },
    });
    const r = simulateScenario(settings(), s);
    expect(r.ledger[2].ssTaxablePct).toBeCloseTo(85, 6);
  });

  it('is reproducible for a fixed seed', () => {
    const s = scenario({
      accounts: [account('taxable', 500_000, 60)],
      expenses: [expense(2_500)],
      market: defaultSettings().market,
    });
    const a1 = simulateScenario(settings({ horizonYears: 30 }), s);
    const a2 = simulateScenario(settings({ horizonYears: 30 }), s);
    expect(a1.liquidReal[50]).toEqual(a2.liquidReal[50]);
    expect(a1.successRate).toBeGreaterThan(0);
    expect(a1.successRate).toBeLessThan(100);
  });

  it('matches the expected mean return in a deterministic ledger', () => {
    const s = scenario({ accounts: [account('taxable', 100_000, 100)], market: { ...flatMarket, stockReturn: 7 } });
    const r = simulateScenario(settings(), s);
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
