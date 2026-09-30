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

export interface Person {
  id: string;
  name: string;
  birthDate: YearMonth;
  /**
   * Fixed mortality: the age this person is assumed to die.
   * Stochastic mortality: the expected (mean) age at death given their current age.
   */
  lifeExpectancy: number;
  /** Age (years, decimals allowed) at which Social Security starts. */
  ssClaimAge: number;
  /** Monthly Social Security benefit at the claim age, in today's dollars. */
  ssMonthlyBenefit: number;
}

export type AccountType = 'cash' | 'taxable' | 'traditional' | 'roth' | 'hsa';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  /** Share invested in stocks (rest in bonds), 0–100. Ignored for cash. */
  stockPct: number;
  /** Lower numbers are drawn down first when spending exceeds income. */
  withdrawalPriority: number;
}

export interface Loan {
  id: string;
  name: string;
  balance: number;
  /** Annual interest rate, %. */
  annualRate: number;
  monthlyPayment: number;
  /** If set, the remaining balance is paid off from savings in this month. */
  payoffDate: YearMonth;
}

export type ExpenseFrequency = 'monthly' | 'annual' | 'once';

export interface Expense {
  id: string;
  name: string;
  amount: number;
  frequency: ExpenseFrequency;
  /** First month the expense applies (empty = plan start). For `once`, the month it happens. */
  startDate: YearMonth;
  /** Last month the expense applies (empty = forever). */
  endDate: YearMonth;
  /** Amount is in today's dollars and grows with inflation. */
  inflationAdjusted: boolean;
}

export type IncomeKind = 'monthly' | 'lump' | 'death-benefit';

export interface Income {
  id: string;
  name: string;
  /**
   * monthly – recurring payment (salary, severance installments, pension, annuity)
   * lump – one-time payment on `startDate` (lump-sum severance, inheritance, home sale)
   * death-benefit – one-time payment when the owner dies (life insurance)
   */
  kind: IncomeKind;
  amount: number;
  startDate: YearMonth;
  /** Monthly income only. Empty = continues for life (see survivorship). */
  endDate: YearMonth;
  /** Person whose life the payment depends on. Empty = household (paid while anyone is alive). */
  ownerId: string;
  /** Share of the payment that continues to the survivor after the owner dies, 0–100. */
  survivorPct: number;
  inflationAdjusted: boolean;
  taxable: boolean;
  /** Account that receives the (after-tax) payment. Empty = general cash flow. */
  depositToId: string;
}

export interface TaxAssumptions {
  /** Effective rate on ordinary income, including traditional (pre-tax) withdrawals, %. */
  ordinaryRate: number;
  /** Effective rate on withdrawals from taxable brokerage accounts, %. */
  taxableWithdrawalRate: number;
  /** Share of Social Security that is taxable, %. */
  ssTaxablePct: number;
}

export interface Scenario {
  id: string;
  name: string;
  notes: string;
  /** Fixed categorical color slot (0–7) so a scenario keeps its color as others come and go. */
  colorSlot: number;
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
  /** When set, replaces the plan-wide market assumptions for this scenario. */
  marketOverride: MarketAssumptions | null;
}

export type MortalityMode = 'fixed' | 'stochastic';

export interface SimulationSettings {
  startDate: YearMonth;
  horizonYears: number;
  runs: number;
  seed: number;
  mortality: MortalityMode;
  market: MarketAssumptions;
}

export interface PlanFile {
  format: 'retirement-planner';
  version: 1;
  settings: SimulationSettings;
  scenarios: Scenario[];
}
