import { currentYearMonth, fromMonthIndex, toMonthIndex } from './dates';
import { decisions } from './resolve';
import type {
  Account,
  AccountType,
  Expense,
  ExpenseChoice,
  ExpenseFrequency,
  ExpensePhase,
  Household,
  Income,
  IncomeChoice,
  IncomeKind,
  Loan,
  MarketAssumptions,
  Option,
  Person,
  PlanFile,
  Scenario,
  SimulationSettings,
  TaxAssumptions,
  When,
} from './types';

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Cash / savings',
  taxable: 'Taxable brokerage',
  traditional: 'Pre-tax IRA / 401(k)',
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

export function newOption<T>(label: string, value: T, off = false): Option<T> {
  return { id: newId(), label, off, value };
}

/** Copy an option (fresh ids all the way down) so edits don't leak between options. */
export function cloneOption<T>(option: Option<T>, label: string): Option<T> {
  const value = structuredClone(option.value) as T & { phases?: ExpensePhase[] };
  if (Array.isArray(value.phases)) value.phases = value.phases.map((p) => ({ ...p, id: newId() }));
  return { ...option, id: newId(), label, off: false, value };
}

export const START: When = { type: 'start' };
export const NEVER: When = { type: 'never' };

export function newPerson(partial: Partial<Person> = {}): Person {
  return {
    id: newId(),
    name: 'Person',
    birthDate: '1965-01',
    lifeExpectancy: 90,
    ssKnownBenefit: 2000,
    ssKnownAge: 67,
    ssOptions: [newOption('Claim at 67', { claimAge: 67, monthlyBenefit: 0, auto: true })],
    ...partial,
  };
}

export function newAccount(type: AccountType = 'taxable', partial: Partial<Account> = {}, balance = 0): Account {
  return {
    id: newId(),
    name: ACCOUNT_TYPE_LABELS[type],
    type,
    stockPct: type === 'cash' ? 0 : 60,
    withdrawalPriority: DEFAULT_WITHDRAWAL_PRIORITY[type],
    options: [newOption('Balance', { balance })],
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
    options: [newOption('Keep paying', { payoffDate: '' })],
    ...partial,
  };
}

export function newPhase(amount: number, from: When = START): ExpensePhase {
  return { id: newId(), amount, from };
}

export function expenseChoice(frequency: ExpenseFrequency, phases: ExpensePhase[], until: When = NEVER): ExpenseChoice {
  return { frequency, phases, until };
}

export function newExpense(
  name = 'Expense',
  choice: ExpenseChoice = expenseChoice('monthly', [newPhase(500)]),
  partial: Partial<Expense> = {},
): Expense {
  return {
    id: newId(),
    name,
    inflationAdjusted: true,
    ownerId: '',
    options: [newOption('Amount', choice)],
    ...partial,
  };
}

export function incomeChoice(kind: IncomeKind, partial: Partial<IncomeChoice> = {}): IncomeChoice {
  return {
    kind,
    amount: kind === 'monthly' ? 1000 : 50000,
    start: START,
    payments: 0,
    end: NEVER,
    survivorPct: kind === 'monthly' ? 0 : 100,
    inflationAdjusted: false,
    taxable: kind !== 'death-benefit',
    depositToId: '',
    ...partial,
  };
}

export function newIncome(name: string, options: Option<IncomeChoice>[], partial: Partial<Income> = {}): Income {
  return { id: newId(), name, ownerId: '', options, ...partial };
}

export function newScenario(partial: Partial<Scenario> = {}): Scenario {
  return { id: newId(), name: 'Scenario', notes: '', colorSlot: 0, choices: {}, marketOverride: null, ...partial };
}

export function emptyHousehold(): Household {
  return {
    people: [],
    accounts: [],
    loans: [],
    expenses: [],
    incomes: [],
    taxes: defaultTaxes(),
    survivorExpensePct: 70,
    surplusAccountId: '',
  };
}

export function blankPlan(): PlanFile {
  return {
    format: 'retirement-planner',
    version: 2,
    settings: defaultSettings(),
    household: emptyHousehold(),
    scenarios: [newScenario({ name: 'Scenario A' })],
  };
}

export function duplicateScenario(source: Scenario, colorSlot: number): Scenario {
  return {
    ...structuredClone(source),
    id: newId(),
    name: `${source.name} (copy)`,
    colorSlot,
  };
}

export function nextColorSlot(scenarios: Scenario[]): number {
  const used = new Set(scenarios.map((s) => s.colorSlot));
  for (let slot = 0; slot < 8; slot++) if (!used.has(slot)) return slot;
  return scenarios.length % 8;
}

/** Every combination of every decision (cartesian product), named after the picked options. */
export function allCombinations(h: Household): Scenario[] {
  const ds = decisions(h);
  let combos: Record<string, string>[] = [{}];
  for (const d of ds) combos = combos.flatMap((c) => d.options.map((o) => ({ ...c, [d.key]: o.id })));
  return combos.map((choices, i) => {
    const label = ds.map((d) => d.options.find((o) => o.id === choices[d.key])!.label).join(' · ');
    return newScenario({ name: label || `Scenario ${i + 1}`, colorSlot: i % 8, choices });
  });
}

export function combinationCount(h: Household): number {
  return decisions(h).reduce((n, d) => n * d.options.length, 1);
}

/**
 * A worked example: how to take severance (lump sum vs. monthly), when to claim Social
 * Security, and whether to pay off the mortgage — with health insurance stepping down to
 * Medicare as each person turns 65.
 */
export function samplePlan(): PlanFile {
  const settings = defaultSettings();
  const start = toMonthIndex(settings.startDate);
  const inMonths = (n: number): When => ({ type: 'date', date: fromMonthIndex(start + n) });

  const ss = (claimAge: number) => newOption(`Claim at ${claimAge}`, { claimAge, monthlyBenefit: 0, auto: true });
  const a62 = ss(62);
  const a67 = ss(67);
  const a70 = ss(70);
  const personA = newPerson({ name: 'Person A', birthDate: '1966-04', lifeExpectancy: 88, ssKnownBenefit: 2900, ssKnownAge: 67, ssOptions: [a67, a62, a70] });
  const personB = newPerson({ name: 'Person B', birthDate: '1968-09', lifeExpectancy: 91, ssKnownBenefit: 1800, ssKnownAge: 67, ssOptions: [ss(67), ss(62)] });

  const checking = newAccount('cash', { name: 'Checking & savings' }, 45000);
  const brokerage = newAccount('taxable', { name: 'Brokerage', stockPct: 70 }, 260000);
  const k401 = newAccount('traditional', { name: '401(k) — Person A' }, 640000);
  const roth = newAccount('roth', { name: 'Roth IRA — Person B', stockPct: 80 }, 115000);

  const keepMortgage = newOption('Keep paying', { payoffDate: '' });
  const payMortgage = newOption('Pay off now', { payoffDate: fromMonthIndex(start + 2) });
  const mortgage = newLoan({ name: 'Mortgage', balance: 285000, annualRate: 6.25, monthlyPayment: 2150, options: [keepMortgage, payMortgage] });
  const hotTub = newLoan({ name: 'Hot tub', balance: 9500, annualRate: 8.99, monthlyPayment: 260 });

  const medicare = (person: Person, preMedicare: number, medicareCost: number) =>
    newExpense(
      `Health insurance — ${person.name}`,
      expenseChoice('monthly', [newPhase(preMedicare), newPhase(medicareCost, { type: 'age', personId: person.id, age: 65 })]),
      { ownerId: person.id },
    );

  const lump = newOption('Lump sum', incomeChoice('lump', { amount: 96000, start: inMonths(1), survivorPct: 100, depositToId: brokerage.id }));
  const monthly12 = newOption('Monthly × 12', incomeChoice('monthly', { amount: 8000, start: inMonths(1), payments: 12, survivorPct: 100 }));
  const monthly18 = newOption('Monthly × 18', incomeChoice('monthly', { amount: 5600, start: inMonths(1), payments: 18, survivorPct: 100 }));
  const severance = newIncome('Severance', [lump, monthly12, monthly18], { ownerId: personA.id });

  const household: Household = {
    ...emptyHousehold(),
    people: [personA, personB],
    accounts: [checking, brokerage, k401, roth],
    loans: [mortgage, hotTub],
    expenses: [
      newExpense('Housing (tax, insurance, utilities)', expenseChoice('monthly', [newPhase(1250)])),
      newExpense('Groceries & household', expenseChoice('monthly', [newPhase(1100)])),
      medicare(personA, 850, 380),
      medicare(personB, 850, 380),
      newExpense('Cars, gas, insurance', expenseChoice('monthly', [newPhase(650)])),
      newExpense('Everything else', expenseChoice('monthly', [newPhase(1100)])),
      newExpense(
        'Travel',
        expenseChoice('annual', [newPhase(9000), newPhase(4000, { type: 'age', personId: personA.id, age: 75 })]),
      ),
      newExpense('Replace car', expenseChoice('once', [newPhase(38000, inMonths(36)), newPhase(40000, inMonths(132))])),
    ],
    incomes: [
      severance,
      newIncome(
        'Part-time consulting',
        [
          newOption('3 years', incomeChoice('monthly', { amount: 2500, start: inMonths(3), payments: 36 })),
          newOption('None', incomeChoice('monthly', { amount: 0 }), true),
        ],
        { ownerId: personB.id },
      ),
    ],
    surplusAccountId: checking.id,
  };

  const scenarios = [
    newScenario({
      name: 'A · Lump-sum severance',
      notes: 'Severance as a lump sum into the brokerage account; both claim Social Security at 67.',
      colorSlot: 0,
      choices: { [severance.id]: lump.id, [mortgage.id]: keepMortgage.id, [personA.id]: a67.id },
    }),
    newScenario({
      name: 'B · Monthly severance × 18',
      notes: 'Severance paid over 18 months; continues to Person B if Person A dies.',
      colorSlot: 1,
      choices: { [severance.id]: monthly18.id, [mortgage.id]: keepMortgage.id, [personA.id]: a67.id },
    }),
    newScenario({
      name: 'C · Pay off mortgage, SS at 70',
      notes: 'Lump sum, mortgage retired now, Person A delays Social Security to 70.',
      colorSlot: 2,
      choices: { [severance.id]: lump.id, [mortgage.id]: payMortgage.id, [personA.id]: a70.id },
    }),
  ];

  return { format: 'retirement-planner', version: 2, settings, household, scenarios };
}
