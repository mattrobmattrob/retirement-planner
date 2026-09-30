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
  name: 'P', birthDate: '1960-01', lifeExpectancy: 99, ssClaimAge: 67, ssMonthlyBenefit: 0, ...partial,
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
    surplusAccount: -1, market: flatMarket, ...partial,
  };
}

describe('simulateScenario', () => {
  it('spends down cash linearly with no returns or inflation', () => {
    const s = scenario({ accounts: [account('cash', 120_000)], expenses: [expense(1_000)] });
    const r = simulateScenario(settings(), s);
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

  it('gives the survivor the larger Social Security benefit', () => {
    const s = scenario({
      people: [
        person({ birthDate: '1956-01', lifeExpectancy: 71, ssClaimAge: 62, ssMonthlyBenefit: 3_000 }),
        person({ birthDate: '1958-01', ssClaimAge: 62, ssMonthlyBenefit: 1_000 }),
      ],
      accounts: [account('cash', 0)],
    });
    const r = simulateScenario(settings(), s);
    expect(r.liquidNominal[50][1]).toBeCloseTo(48_000, 6);
    expect(r.liquidNominal[50][2]).toBeCloseTo(48_000 + 36_000, 6);
  });

  it('assumes the configured share in a partial first tax year, then applies the IRS rule', () => {
    // $2,000/mo benefit and no other income: provisional income $12K is under the threshold.
    const s = scenario({
      people: [person({ birthDate: '1956-01', ssClaimAge: 62, ssMonthlyBenefit: 2_000 })],
      accounts: [account('cash', 0)],
      taxes: { ordinaryRate: 10, taxableWithdrawalRate: 0, ssTaxablePct: 85, ssTaxRule: 'irs' },
    });
    const r = simulateScenario(settings({ startDate: '2026-09' }), s);
    expect(r.ledger[0]).toEqual(expect.objectContaining({ year: 2026, firstMonth: '2026-09', lastMonth: '2026-12' }));
    expect(r.ledger[0].ssDetail?.basis).toBe('assumed');
    expect(r.ledger[0].ssTaxablePct).toBeCloseTo(85, 6);
    expect(r.ledger[0].taxes).toBeCloseTo(8_000 * 0.85 * 0.1, 6);
    expect(r.ledger[1].ssDetail).toEqual(expect.objectContaining({ basis: 'irs', tier: 0, taxable: 0, settlement: 0 }));
    expect(r.ledger[1].taxes).toBe(0);

    const flat = simulateScenario(settings({ startDate: '2026-09' }), { ...s, taxes: { ...s.taxes, ssTaxRule: 'flat' } });
    expect(flat.ledger[1].ssTaxablePct).toBeCloseTo(85, 6);
  });

  it('trues up a full first year the following April', () => {
    const s = scenario({
      people: [person({ birthDate: '1956-01', ssClaimAge: 62, ssMonthlyBenefit: 2_000 })],
      accounts: [account('cash', 0)],
      taxes: { ordinaryRate: 10, taxableWithdrawalRate: 0, ssTaxablePct: 85, ssTaxRule: 'irs' },
    });
    // Starting in January, 2026 is a full simulated year: withheld at 85%, actually 0% taxable.
    const r = simulateScenario(settings({ startDate: '2026-01' }), s);
    const withheld = 24_000 * 0.85 * 0.1;
    expect(r.ledger[0].ssDetail).toEqual(expect.objectContaining({ basis: 'irs', taxable: 0 }));
    expect(r.ledger[0].ssDetail!.settlement).toBeCloseTo(-withheld, 6);
    expect(r.ledger[1].settlementPaid).toBeCloseTo(-withheld, 6);
    expect(r.ledger[1].taxes).toBeCloseTo(-withheld, 6);
    expect(r.liquidNominal[50][2]).toBeCloseTo(24_000 - withheld + 24_000 + withheld, 6);
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
