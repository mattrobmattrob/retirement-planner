/** Calendar month in `YYYY-MM` form. An empty string means "not set". */
export type YearMonth = string;

/** All percentages in the model are stored as human numbers (7 = 7%). */
export interface MarketAssumptions {
  /** Expected annual (arithmetic) nominal stock return, %. */
  stockReturn: number;
  /** Annual standard deviation of stock returns, %. */
  stockStdev: number;
  bondReturn: number;
  bondStdev: number;
  /** Correlation between stock and bond returns, -1..1. */
  correlation: number;
  /** Annual nominal yield on cash accounts, %. Deterministic. */
  cashReturn: number;
  /** Expected annual inflation, %. */
  inflation: number;
  inflationStdev: number;
}

export interface TaxAssumptions {
  /** Effective rate on ordinary income, including traditional (pre-tax) withdrawals, %. */
  ordinaryRate: number;
  /** Effective rate on withdrawals from taxable brokerage accounts, %. */
  taxableWithdrawalRate: number;
  /**
   * Share of Social Security that is taxable, %. With the IRS rule this is the assumed share for
   * the first two plan years, before the simulation has a prior year of income to go on.
   */
  ssTaxablePct: number;
  /** `irs`: 0/50/85% provisional-income rule on the prior year's simulated income. `flat`: always `ssTaxablePct`. */
  ssTaxRule: SsTaxRule;
}

export type SsTaxRule = 'irs' | 'flat';

export type MortalityMode = 'fixed' | 'stochastic';

export interface SimulationSettings {
  startDate: YearMonth;
  horizonYears: number;
  runs: number;
  seed: number;
  mortality: MortalityMode;
  market: MarketAssumptions;
}

export type AccountType = 'cash' | 'taxable' | 'traditional' | 'roth' | 'hsa';
export type ExpenseFrequency = 'monthly' | 'annual' | 'once';
export type IncomeKind = 'monthly' | 'lump' | 'death-benefit';

// ---------------------------------------------------------------------------
// Plan (what the user edits and what the JSON file stores)
//
// The household is described once. Anything that differs between scenarios is an
// `Option` on the item it belongs to; a scenario is just one option picked per item.
// ---------------------------------------------------------------------------

/** A point in time, either fixed or tied to someone's age. */
export type When =
  | { type: 'start' }
  | { type: 'date'; date: YearMonth }
  | { type: 'age'; personId: string; age: number }
  | { type: 'never' };

export interface Option<T> {
  id: string;
  label: string;
  /** "Not included" — the item is left out of scenarios that pick this option. */
  off: boolean;
  value: T;
}

export interface SocialSecurityChoice {
  /** Age (years, month precision as decimals: 67.5 = 67y 6m) at which benefits start. */
  claimAge: number;
  /** Monthly benefit in today's dollars. Ignored when `auto`. */
  monthlyBenefit: number;
  /** Scale the person's known benefit to this claim age using SSA reduction/credit rules. */
  auto: boolean;
}

export interface Person {
  id: string;
  name: string;
  birthDate: YearMonth;
  /**
   * Fixed mortality: the age this person is assumed to die.
   * Stochastic mortality: the expected (mean) age at death given their current age.
   */
  lifeExpectancy: number;
  /** A known benefit from the SSA statement: `ssKnownBenefit` per month (today's $) if claiming at `ssKnownAge`. */
  ssKnownBenefit: number;
  ssKnownAge: number;
  ssOptions: Option<SocialSecurityChoice>[];
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Share invested in stocks (rest in bonds), 0–100. Ignored for cash. */
  stockPct: number;
  /** Lower numbers are drawn down first when spending exceeds income. */
  withdrawalPriority: number;
  options: Option<{ balance: number }>[];
}

export interface Loan {
  id: string;
  name: string;
  balance: number;
  /** Annual interest rate, %. */
  annualRate: number;
  monthlyPayment: number;
  /** `payoffDate` empty = keep paying on schedule; otherwise pay the balance from savings that month. */
  options: Option<{ payoffDate: YearMonth }>[];
}

export interface ExpensePhase {
  id: string;
  amount: number;
  /** When this phase begins. The first phase always begins at the plan start. */
  from: When;
}

export interface ExpenseChoice {
  frequency: ExpenseFrequency;
  /** Amount changes over time: `$X until Y, then $Z onward`. */
  phases: ExpensePhase[];
  until: When;
}

export interface Expense {
  id: string;
  name: string;
  /** Amounts are in today's dollars and grow with inflation. */
  inflationAdjusted: boolean;
  /** If set, the expense stops when this person dies (e.g. their health insurance). */
  ownerId: string;
  options: Option<ExpenseChoice>[];
}

export interface IncomeChoice {
  kind: IncomeKind;
  /** Monthly amount for `monthly`; total for `lump` and `death-benefit`. */
  amount: number;
  start: When;
  /** Monthly only: number of payments. 0 = until `end` (or for life). */
  payments: number;
  end: When;
  /** Share of the payment that continues to the survivor after the owner dies, 0–100. */
  survivorPct: number;
  inflationAdjusted: boolean;
  taxable: boolean;
  /** Account that receives the (after-tax) payment. Empty = general cash flow. */
  depositToId: string;
}

export interface Income {
  id: string;
  name: string;
  /** Person whose life the payment depends on. Empty = household. */
  ownerId: string;
  options: Option<IncomeChoice>[];
}

export interface Household {
  people: Person[];
  accounts: Account[];
  loans: Loan[];
  expenses: Expense[];
  incomes: Income[];
  taxes: TaxAssumptions;
  /** Household spending as a % of normal after the first death in a multi-person household. */
  survivorExpensePct: number;
  /** Where monthly surpluses are deposited. Empty = highest-priority cash account. */
  surplusAccountId: string;
}

export interface Scenario {
  id: string;
  name: string;
  notes: string;
  /** Fixed categorical color slot (0–7) so a scenario keeps its color as others come and go. */
  colorSlot: number;
  /** Item or person id → chosen option id. Missing = the item's first option. */
  choices: Record<string, string>;
  /** When set, replaces the plan-wide market assumptions for this scenario. */
  marketOverride: MarketAssumptions | null;
}

export interface PlanFile {
  format: 'retirement-planner';
  version: 2;
  settings: SimulationSettings;
  household: Household;
  scenarios: Scenario[];
}

// ---------------------------------------------------------------------------
// Resolved scenario (what the simulation engine consumes): every option picked,
// every `When` turned into a concrete month.
// ---------------------------------------------------------------------------

export interface SimPerson {
  name: string;
  birthDate: YearMonth;
  lifeExpectancy: number;
  ssClaimAge: number;
  ssMonthlyBenefit: number;
}

export interface SimAccount {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  stockPct: number;
  withdrawalPriority: number;
}

export interface SimLoan {
  name: string;
  balance: number;
  annualRate: number;
  monthlyPayment: number;
  payoffDate: YearMonth;
}

export interface SimExpense {
  amount: number;
  frequency: ExpenseFrequency;
  /** Empty = plan start. */
  startDate: YearMonth;
  /** Empty = forever. */
  endDate: YearMonth;
  inflationAdjusted: boolean;
  /** Index into `people`, or -1 for the household. */
  owner: number;
}

export interface SimIncome {
  name: string;
  kind: IncomeKind;
  amount: number;
  startDate: YearMonth;
  endDate: YearMonth;
  /** Index into `people`, or -1 for the household. */
  owner: number;
  survivorPct: number;
  inflationAdjusted: boolean;
  taxable: boolean;
  /** Index into `accounts`, or -1 for general cash flow. */
  depositTo: number;
}

export interface SimScenario {
  id: string;
  name: string;
  colorSlot: number;
  people: SimPerson[];
  accounts: SimAccount[];
  loans: SimLoan[];
  expenses: SimExpense[];
  incomes: SimIncome[];
  taxes: TaxAssumptions;
  survivorExpensePct: number;
  /** Index into `accounts`, or -1 for the highest-priority cash account. */
  surplusAccount: number;
  market: MarketAssumptions;
}
