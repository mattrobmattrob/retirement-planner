import { currentYearMonth, fromMonthIndex, toMonthIndex } from './dates';
import type {
  Account,
  AccountType,
  Expense,
  Income,
  Loan,
  MarketAssumptions,
  Person,
  PlanFile,
  Scenario,
  SimulationSettings,
  TaxAssumptions,
} from './types';

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Cash / savings',
  taxable: 'Taxable brokerage',
  traditional: 'Traditional IRA / 401(k)',
  roth: 'Roth IRA / 401(k)',
  hsa: 'HSA',
};

export const DEFAULT_WITHDRAWAL_PRIORITY: Record<AccountType, number> = {
  cash: 1,
  taxable: 2,
  traditional: 3,
  hsa: 4,
  roth: 5,
};

export function defaultMarket(): MarketAssumptions {
  return {
    stockReturn: 9,
    stockStdev: 17,
    bondReturn: 4.5,
    bondStdev: 6,
    correlation: 0.1,
    cashReturn: 3.5,
    inflation: 2.8,
    inflationStdev: 1.2,
  };
}

export function defaultTaxes(): TaxAssumptions {
  return { ordinaryRate: 15, taxableWithdrawalRate: 5, ssTaxablePct: 85 };
}

export function defaultSettings(): SimulationSettings {
  return {
    startDate: currentYearMonth(),
    horizonYears: 40,
    runs: 2000,
    seed: 20260929,
    mortality: 'fixed',
    market: defaultMarket(),
  };
}

export function newPerson(partial: Partial<Person> = {}): Person {
  return {
    id: newId(),
    name: 'Person',
    birthDate: '1965-01',
    lifeExpectancy: 90,
    ssClaimAge: 67,
    ssMonthlyBenefit: 2000,
    ...partial,
  };
}

export function newAccount(partial: Partial<Account> = {}): Account {
  const type = partial.type ?? 'taxable';
  return {
    id: newId(),
    name: ACCOUNT_TYPE_LABELS[type],
    type,
    balance: 0,
    stockPct: type === 'cash' ? 0 : 60,
    withdrawalPriority: DEFAULT_WITHDRAWAL_PRIORITY[type],
    ...partial,
  };
}

export function newLoan(partial: Partial<Loan> = {}): Loan {
  return {
    id: newId(),
    name: 'Loan',
    balance: 10000,
    annualRate: 7,
    monthlyPayment: 300,
    payoffDate: '',
    ...partial,
  };
}

export function newExpense(partial: Partial<Expense> = {}): Expense {
  return {
    id: newId(),
    name: 'Expense',
    amount: 500,
    frequency: 'monthly',
    startDate: '',
    endDate: '',
    inflationAdjusted: true,
    ...partial,
  };
}

export function newIncome(partial: Partial<Income> = {}): Income {
  return {
    id: newId(),
    name: 'Income',
    kind: 'monthly',
    amount: 1000,
    startDate: currentYearMonth(),
    endDate: '',
    ownerId: '',
    survivorPct: 0,
    inflationAdjusted: false,
    taxable: true,
    depositToId: '',
    ...partial,
  };
}

export function newScenario(partial: Partial<Scenario> = {}): Scenario {
  return {
    id: newId(),
    name: 'New scenario',
    notes: '',
    colorSlot: 0,
    people: [],
    accounts: [],
    loans: [],
    expenses: [],
    incomes: [],
    taxes: defaultTaxes(),
    survivorExpensePct: 70,
    surplusAccountId: '',
    marketOverride: null,
    ...partial,
  };
}

/** Deep copy with fresh ids, remapping every cross-reference (owners, deposit accounts). */
export function duplicateScenario(source: Scenario, colorSlot: number): Scenario {
  const idMap = new Map<string, string>();
  const remap = <T extends { id: string }>(item: T): T => {
    const id = newId();
    idMap.set(item.id, id);
    return { ...item, id };
  };
  const people = source.people.map(remap);
  const accounts = source.accounts.map(remap);
  const ref = (id: string) => (id ? idMap.get(id) ?? '' : '');
  return {
    ...structuredClone(source),
    id: newId(),
    name: `${source.name} (copy)`,
    colorSlot,
    people,
    accounts,
    loans: source.loans.map((l) => ({ ...l, id: newId() })),
    expenses: source.expenses.map((e) => ({ ...e, id: newId() })),
    incomes: source.incomes.map((i) => ({
      ...i,
      id: newId(),
      ownerId: ref(i.ownerId),
      depositToId: ref(i.depositToId),
    })),
    surplusAccountId: ref(source.surplusAccountId),
    marketOverride: source.marketOverride ? { ...source.marketOverride } : null,
  };
}

export function nextColorSlot(scenarios: Scenario[]): number {
  const used = new Set(scenarios.map((s) => s.colorSlot));
  for (let slot = 0; slot < 8; slot++) if (!used.has(slot)) return slot;
  return scenarios.length % 8;
}

/**
 * A worked example comparing three ways of handling a job exit:
 * A) take severance as a lump sum, B) take it monthly with survivorship,
 * C) lump sum used to pay off the mortgage plus delaying Social Security.
 */
export function samplePlan(): PlanFile {
  const settings = defaultSettings();
  const start = toMonthIndex(settings.startDate);
  const inMonths = (n: number) => fromMonthIndex(start + n);

  const personA = newPerson({ name: 'Person A', birthDate: '1966-04', lifeExpectancy: 88, ssMonthlyBenefit: 2900 });
  const personB = newPerson({ name: 'Person B', birthDate: '1968-09', lifeExpectancy: 91, ssMonthlyBenefit: 1800 });
  const checking = newAccount({ name: 'Checking & savings', type: 'cash', balance: 45000 });
  const brokerage = newAccount({ name: 'Brokerage', type: 'taxable', balance: 260000, stockPct: 70 });
  const k401 = newAccount({ name: '401(k) — Person A', type: 'traditional', balance: 640000, stockPct: 60 });
  const roth = newAccount({ name: 'Roth IRA — Person B', type: 'roth', balance: 115000, stockPct: 80 });

  const base = newScenario({
    name: 'A · Lump-sum severance',
    notes: 'Severance paid as a single lump sum next month.',
    colorSlot: 0,
    people: [personA, personB],
    accounts: [checking, brokerage, k401, roth],
    loans: [
      newLoan({ name: 'Mortgage', balance: 285000, annualRate: 6.25, monthlyPayment: 2150 }),
      newLoan({ name: 'Hot tub', balance: 9500, annualRate: 8.99, monthlyPayment: 260 }),
    ],
    expenses: [
      newExpense({ name: 'Housing (tax, insurance, utilities)', amount: 1250 }),
      newExpense({ name: 'Groceries & household', amount: 1100 }),
      newExpense({ name: 'Health insurance (pre-Medicare)', amount: 1600, endDate: '2031-04' }),
      newExpense({ name: 'Medicare + supplements', amount: 750, startDate: '2031-04' }),
      newExpense({ name: 'Cars, gas, insurance', amount: 650 }),
      newExpense({ name: 'Everything else', amount: 1100 }),
      newExpense({ name: 'Travel', amount: 9000, frequency: 'annual' }),
      newExpense({ name: 'Replace car', amount: 38000, frequency: 'once', startDate: inMonths(36) }),
    ],
    incomes: [],
    surplusAccountId: checking.id,
  });
  base.incomes = [
    newIncome({
      name: 'Severance (lump sum)',
      kind: 'lump',
      amount: 96000,
      startDate: inMonths(1),
      ownerId: personA.id,
      survivorPct: 100,
      depositToId: brokerage.id,
    }),
    newIncome({
      name: 'Part-time consulting',
      amount: 2500,
      startDate: inMonths(3),
      endDate: inMonths(39),
      ownerId: personB.id,
    }),
  ];

  const monthly = duplicateScenario(base, 1);
  monthly.name = 'B · Monthly severance (100% survivor)';
  monthly.notes = 'Severance paid over 18 months; continues to the survivor if Person A dies.';
  monthly.incomes[0] = {
    ...monthly.incomes[0],
    name: 'Severance (monthly)',
    kind: 'monthly',
    amount: 5600,
    startDate: inMonths(1),
    endDate: inMonths(18),
    depositToId: '',
  };

  const payoff = duplicateScenario(base, 2);
  payoff.name = 'C · Pay off mortgage, delay SS to 70';
  payoff.notes = 'Lump sum used to retire the mortgage now; Person A claims Social Security at 70.';
  payoff.loans[0] = { ...payoff.loans[0], payoffDate: inMonths(2) };
  payoff.people[0] = { ...payoff.people[0], ssClaimAge: 70, ssMonthlyBenefit: 3600 };

  return { format: 'retirement-planner', version: 1, settings, scenarios: [base, monthly, payoff] };
}
