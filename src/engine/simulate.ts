import { ageAt, fromMonthIndex, offsetFrom, toMonthIndex } from '../model/dates';
import type { AccountType, MarketAssumptions, SimScenario, SimulationSettings } from '../model/types';
import { sampleDeathAge, solveModalAge } from './mortality';
import { Rng } from './rng';

/** Mortality draws per path are fixed so scenarios with different households stay in sync. */
const MORTALITY_DRAWS = 8;
const PERCENTILES = [10, 25, 50, 75, 90] as const;
export type Percentile = (typeof PERCENTILES)[number];
export type Bands = Record<Percentile, number[]>;

export interface LedgerRow {
  /** First month of this plan year (plan years run from the plan start month). */
  startDate: string;
  ages: number[];
  income: number;
  socialSecurity: number;
  expenses: number;
  debtPayments: number;
  taxes: number;
  withdrawals: number;
  endLiquid: number;
  endLiquidReal: number;
  endDebt: number;
  events: string[];
}

export interface ScenarioResult {
  scenarioId: string;
  name: string;
  colorSlot: number;
  /** Calendar month of each snapshot: index 0 is the start, index y is after y years. */
  snapshotDates: string[];
  /** Age of each person at each snapshot. */
  ages: { name: string; values: number[] }[];
  liquidReal: Bands;
  liquidNominal: Bands;
  /** % of simulations that have not run out of money by each snapshot. */
  fundedPct: number[];
  successRate: number;
  /** Years until money runs out in 90% / 50% of simulations (null = never within the plan). */
  runwayP10Years: number | null;
  runwayP50Years: number | null;
  medianEndingReal: number;
  p10EndingReal: number;
  /** One path with every return and inflation fixed at its expected value. */
  ledger: LedgerRow[];
  warnings: string[];
  runs: number;
}

interface Compiled {
  months: number;
  people: { name: string; age0: number; claimMonth: number; benefit: number; modalAge: number; fixedDeathMonth: number }[];
  incomes: {
    name: string;
    kind: 'monthly' | 'lump' | 'death-benefit';
    amount: number;
    start: number;
    end: number;
    owner: number;
    survivor: number;
    inflation: boolean;
    taxable: boolean;
    deposit: number;
  }[];
  expenses: { amount: number; freq: 'monthly' | 'annual' | 'once'; start: number; end: number; inflation: boolean; owner: number }[];
  loans: { name: string; balance: number; rate: number; payment: number; payoff: number }[];
  accounts: { balance: number; type: AccountType; stock: number; tax: number }[];
  order: number[];
  surplus: number;
  spendAfterDeath: number;
  ordinary: number;
  ssTaxable: number;
  warnings: string[];
}

function compile(settings: SimulationSettings, s: SimScenario): Compiled {
  const { startDate, horizonYears } = settings;
  const months = Math.max(1, Math.round(horizonYears)) * 12;
  const warnings: string[] = [];
  const at = (ym: string, fallback: number) => offsetFrom(startDate, ym, fallback);

  const people = s.people.map((p) => {
    const age0 = ageAt(p.birthDate, startDate);
    if (p.lifeExpectancy <= age0) warnings.push(`${p.name} is already past their life expectancy.`);
    return {
      name: p.name,
      age0,
      claimMonth: Math.max(0, Math.round((p.ssClaimAge - age0) * 12)),
      benefit: p.ssMonthlyBenefit,
      modalAge: solveModalAge(age0, p.lifeExpectancy),
      fixedDeathMonth: Math.max(0, Math.round((p.lifeExpectancy - age0) * 12)),
    };
  });

  const accounts = s.accounts.map((a) => ({
    balance: a.balance,
    type: a.type,
    stock: Math.min(100, Math.max(0, a.stockPct)) / 100,
    tax: Math.min(
      0.95,
      Math.max(
        0,
        a.type === 'traditional'
          ? s.taxes.ordinaryRate / 100
          : a.type === 'taxable'
            ? s.taxes.taxableWithdrawalRate / 100
            : 0,
      ),
    ),
  }));
  const priority = s.accounts.map((a) => a.withdrawalPriority);
  if (accounts.length === 0) {
    warnings.push('No accounts — surpluses go to an implicit cash account.');
    accounts.push({ balance: 0, type: 'cash', stock: 0, tax: 0 });
    priority.push(0);
  }
  const order = accounts.map((_, i) => i).sort((a, b) => priority[a] - priority[b] || a - b);
  let surplus = s.surplusAccount < accounts.length ? s.surplusAccount : -1;
  if (surplus < 0) surplus = order.find((i) => accounts[i].type === 'cash') ?? order[0];

  const incomes = s.incomes.map((inc) => {
    const owner = inc.owner;
    if (inc.kind === 'death-benefit' && owner < 0) warnings.push(`"${inc.name}" needs an owner to pay out.`);
    return {
      name: inc.name,
      kind: inc.kind,
      amount: inc.amount,
      start: at(inc.startDate, 0),
      end: at(inc.endDate, Infinity),
      owner,
      survivor: Math.min(100, Math.max(0, inc.survivorPct)) / 100,
      inflation: inc.inflationAdjusted,
      taxable: inc.taxable,
      deposit: inc.depositTo,
    };
  });

  const expenses = s.expenses.map((e) => ({
    amount: e.amount,
    freq: e.frequency,
    start: at(e.startDate, 0),
    end: at(e.endDate, Infinity),
    inflation: e.inflationAdjusted,
    owner: e.owner,
  }));

  const loans = s.loans.map((l) => {
    const rate = l.annualRate / 100 / 12;
    if (l.balance > 0 && l.monthlyPayment <= l.balance * rate && !l.payoffDate) {
      warnings.push(`"${l.name}" payment doesn't cover its interest — it will never be paid off.`);
    }
    return { name: l.name, balance: l.balance, rate, payment: l.monthlyPayment, payoff: at(l.payoffDate, Infinity) };
  });

  return {
    months,
    people,
    incomes,
    expenses,
    loans,
    accounts,
    order,
    surplus,
    spendAfterDeath: s.survivorExpensePct / 100,
    ordinary: s.taxes.ordinaryRate / 100,
    ssTaxable: s.taxes.ssTaxablePct / 100,
    warnings,
  };
}

interface MarketParams {
  stockMu: number;
  stockSigma: number;
  bondMu: number;
  bondSigma: number;
  rho: number;
  rhoC: number;
  cash: number;
  inflMu: number;
  inflSigma: number;
  /** Expected-value monthly returns for the deterministic ledger. */
  stockFixed: number;
  bondFixed: number;
}

/** Convert annual arithmetic mean/stdev into monthly log-normal parameters. */
function marketParams(m: MarketAssumptions): MarketParams {
  const logParams = (meanPct: number, sdPct: number) => {
    const mu = meanPct / 100;
    const sd = sdPct / 100;
    const s2 = Math.log(1 + (sd * sd) / ((1 + mu) * (1 + mu)));
    return { mu: (Math.log(1 + mu) - s2 / 2) / 12, sigma: Math.sqrt(s2 / 12) };
  };
  const stock = logParams(m.stockReturn, m.stockStdev);
  const bond = logParams(m.bondReturn, m.bondStdev);
  const rho = Math.min(1, Math.max(-1, m.correlation));
  const monthly = (pct: number) => Math.pow(1 + pct / 100, 1 / 12) - 1;
  return {
    stockMu: stock.mu,
    stockSigma: stock.sigma,
    bondMu: bond.mu,
    bondSigma: bond.sigma,
    rho,
    rhoC: Math.sqrt(1 - rho * rho),
    cash: monthly(m.cashReturn),
    inflMu: monthly(m.inflation),
    inflSigma: m.inflationStdev / 100 / Math.sqrt(12),
    stockFixed: monthly(m.stockReturn),
    bondFixed: monthly(m.bondReturn),
  };
}

interface PathResult {
  /** Month index at which spending could not be covered, or Infinity. */
  depletedAt: number;
}

interface YearAccumulator {
  income: number;
  socialSecurity: number;
  expenses: number;
  debtPayments: number;
  taxes: number;
  withdrawals: number;
  events: string[];
}

/**
 * Simulate one path month by month. With `rng === null` every random quantity takes its
 * expected value, which produces the deterministic ledger.
 *
 * `liquidNominal`/`liquidReal` receive one value per snapshot (years + 1 entries).
 */
function runPath(
  c: Compiled,
  mp: MarketParams,
  rng: Rng | null,
  stochasticMortality: boolean,
  liquidNominal: Float64Array,
  liquidReal: Float64Array,
  offset: number,
  ledger?: { years: YearAccumulator[]; debt: number[] },
): PathResult {
  const nPeople = c.people.length;
  const death = new Array<number>(nPeople);
  const draws: number[] = [];
  if (rng) for (let i = 0; i < MORTALITY_DRAWS; i++) draws.push(rng.open());
  for (let i = 0; i < nPeople; i++) {
    const p = c.people[i];
    if (stochasticMortality && rng && i < MORTALITY_DRAWS) {
      const age = sampleDeathAge(p.age0, p.modalAge, draws[i]);
      death[i] = Math.max(0, Math.round((age - p.age0) * 12));
    } else {
      death[i] = p.fixedDeathMonth;
    }
  }

  const bal = c.accounts.map((a) => a.balance);
  const loanBal = c.loans.map((l) => l.balance);
  let cpi = 1;
  let depletedAt = Infinity;

  const snapshot = (y: number) => {
    let liquid = 0;
    for (let i = 0; i < bal.length; i++) liquid += bal[i];
    liquidNominal[offset + y] = liquid;
    liquidReal[offset + y] = liquid / cpi;
    if (ledger) ledger.debt[y] = loanBal.reduce((a, b) => a + b, 0);
  };
  snapshot(0);

  const years = c.months / 12;
  for (let m = 0; m < c.months; m++) {
    const acc = ledger?.years[Math.floor(m / 12)];
    let nAlive = 0;
    for (let i = 0; i < nPeople; i++) if (m < death[i]) nAlive++;
    if (nPeople > 0 && nAlive === 0) {
      // Everyone has died: the plan succeeded. Freeze the estate for the remaining snapshots.
      for (let y = Math.floor(m / 12) + 1; y <= years; y++) snapshot(y);
      break;
    }

    let net = 0;
    let taxes = 0;

    for (const inc of c.incomes) {
      let gross = 0;
      if (inc.kind === 'death-benefit') {
        if (inc.owner >= 0 && m === death[inc.owner]) gross = inc.amount;
      } else {
        const active = inc.kind === 'lump' ? m === inc.start : m >= inc.start && m <= inc.end;
        if (active) {
          const ownerAlive = inc.owner < 0 ? true : m < death[inc.owner];
          gross = inc.amount * (ownerAlive ? 1 : nAlive > 0 ? inc.survivor : 0);
        }
      }
      if (gross === 0) continue;
      if (inc.inflation) gross *= cpi;
      const tax = inc.taxable ? gross * c.ordinary : 0;
      taxes += tax;
      if (acc) acc.income += gross;
      if (inc.deposit >= 0) bal[inc.deposit] += gross - tax;
      else net += gross - tax;
    }

    let ss = 0;
    for (let i = 0; i < nPeople; i++) {
      if (m >= death[i]) continue;
      const p = c.people[i];
      const own = m >= p.claimMonth ? p.benefit : 0;
      let survivor = 0;
      if (p.age0 + m / 12 >= 60) {
        for (let j = 0; j < nPeople; j++) if (j !== i && m >= death[j]) survivor = Math.max(survivor, c.people[j].benefit);
      }
      ss += Math.max(own, survivor) * cpi;
    }
    if (ss > 0) {
      const tax = ss * c.ssTaxable * c.ordinary;
      taxes += tax;
      net += ss - tax;
      if (acc) acc.socialSecurity += ss;
    }

    // Household spending scales down after a death; personal expenses stop with their owner.
    const spendFactor = nPeople >= 2 && nAlive < nPeople ? c.spendAfterDeath : 1;
    let spend = 0;
    for (const e of c.expenses) {
      if (m < e.start || m > e.end) continue;
      if (e.freq === 'once' && m !== e.start) continue;
      if (e.freq === 'annual' && (((m - e.start) % 12) + 12) % 12 !== 0) continue;
      if (e.owner >= 0 && m >= death[e.owner]) continue;
      spend += e.amount * (e.inflation ? cpi : 1) * (e.owner >= 0 ? 1 : spendFactor);
    }
    net -= spend;
    if (acc) acc.expenses += spend;

    let debt = 0;
    for (let i = 0; i < c.loans.length; i++) {
      const b = loanBal[i];
      if (b <= 0) continue;
      const loan = c.loans[i];
      let pay: number;
      if (m === loan.payoff) {
        pay = b;
        loanBal[i] = 0;
        acc?.events.push(`${loan.name} paid off early`);
      } else {
        const interest = b * loan.rate;
        pay = Math.min(loan.payment, b + interest);
        loanBal[i] = b + interest - pay;
        if (loanBal[i] < 0.005) {
          loanBal[i] = 0;
          acc?.events.push(`${loan.name} paid off`);
        }
      }
      debt += pay;
    }
    net -= debt;
    if (acc) acc.debtPayments += debt;

    if (net >= 0) {
      bal[c.surplus] += net;
    } else {
      let need = -net;
      for (const i of c.order) {
        if (bal[i] <= 0) continue;
        const t = c.accounts[i].tax;
        const take = Math.min(need, bal[i] * (1 - t));
        const gross = take / (1 - t);
        bal[i] -= gross;
        taxes += gross - take;
        if (acc) acc.withdrawals += gross;
        need -= take;
        if (need <= 1e-6) break;
      }
      if (need > 0.01 && depletedAt === Infinity) {
        depletedAt = m;
        acc?.events.push('Savings run out');
      }
    }
    if (acc) acc.taxes += taxes;
    if (acc) {
      for (let i = 0; i < nPeople; i++) if (death[i] === m + 1) acc.events.push(`${c.people[i].name} dies (plan assumption)`);
    }

    // Market returns and inflation for the month.
    let stockR: number, bondR: number, infl: number;
    if (rng) {
      const z1 = rng.normal();
      const z2 = rng.normal();
      const z3 = rng.normal();
      stockR = Math.exp(mp.stockMu + mp.stockSigma * z1) - 1;
      bondR = Math.exp(mp.bondMu + mp.bondSigma * (mp.rho * z1 + mp.rhoC * z2)) - 1;
      infl = mp.inflMu + mp.inflSigma * z3;
    } else {
      stockR = mp.stockFixed;
      bondR = mp.bondFixed;
      infl = mp.inflMu;
    }
    for (let i = 0; i < bal.length; i++) {
      if (bal[i] <= 0) continue;
      const a = c.accounts[i];
      const r = a.type === 'cash' ? mp.cash : a.stock * stockR + (1 - a.stock) * bondR;
      bal[i] *= 1 + r;
    }
    cpi *= 1 + infl;

    if ((m + 1) % 12 === 0) snapshot((m + 1) / 12);
  }

  return { depletedAt };
}

function percentile(sorted: Float64Array | number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function bands(values: Float64Array, runs: number, snapshots: number): Bands {
  const out = Object.fromEntries(PERCENTILES.map((p) => [p, new Array<number>(snapshots)])) as Bands;
  const column = new Float64Array(runs);
  for (let y = 0; y < snapshots; y++) {
    for (let r = 0; r < runs; r++) column[r] = values[r * snapshots + y];
    column.sort();
    for (const p of PERCENTILES) out[p][y] = percentile(column, p);
  }
  return out;
}

export function simulateScenario(
  settings: SimulationSettings,
  scenario: SimScenario,
  onProgress?: (fraction: number) => void,
): ScenarioResult {
  const c = compile(settings, scenario);
  const mp = marketParams(scenario.market);
  const runs = Math.max(1, Math.round(settings.runs));
  const years = c.months / 12;
  const snapshots = years + 1;
  const stochastic = settings.mortality === 'stochastic';

  const nominal = new Float64Array(runs * snapshots);
  const real = new Float64Array(runs * snapshots);
  const depletion = new Float64Array(runs);
  const funded = new Array<number>(snapshots).fill(0);

  for (let r = 0; r < runs; r++) {
    const rng = new Rng(settings.seed, r);
    const { depletedAt } = runPath(c, mp, rng, stochastic, nominal, real, r * snapshots);
    depletion[r] = depletedAt;
    for (let y = 0; y < snapshots; y++) if (depletedAt >= y * 12) funded[y]++;
    if (onProgress && r % 250 === 0) onProgress(r / runs);
  }

  // Deterministic "expected case" ledger (fixed mortality, expected returns).
  const ledgerYears: YearAccumulator[] = Array.from({ length: years }, () => ({
    income: 0,
    socialSecurity: 0,
    expenses: 0,
    debtPayments: 0,
    taxes: 0,
    withdrawals: 0,
    events: [],
  }));
  const debt = new Array<number>(snapshots).fill(0);
  const detNominal = new Float64Array(snapshots);
  const detReal = new Float64Array(snapshots);
  runPath(c, mp, null, false, detNominal, detReal, 0, { years: ledgerYears, debt });

  const startIndex = toMonthIndex(settings.startDate);
  const snapshotDates = Array.from({ length: snapshots }, (_, y) => fromMonthIndex(startIndex + y * 12));
  const ages = c.people.map((p) => ({
    name: p.name,
    values: Array.from({ length: snapshots }, (_, y) => p.age0 + y),
  }));

  // Stop the ledger once everyone has died under the fixed-mortality assumption.
  const ledgerLength = c.people.length
    ? Math.min(years, Math.max(1, Math.ceil(Math.max(...c.people.map((p) => p.fixedDeathMonth)) / 12)))
    : years;
  const ledger: LedgerRow[] = ledgerYears.slice(0, ledgerLength).map((acc, y) => ({
    startDate: fromMonthIndex(startIndex + y * 12),
    ages: c.people.map((p) => Math.floor(p.age0 + y)),
    ...acc,
    endLiquid: detNominal[y + 1],
    endLiquidReal: detReal[y + 1],
    endDebt: debt[y + 1],
  }));

  depletion.sort();
  const toYears = (months: number) => (Number.isFinite(months) ? months / 12 : null);
  const endingReal = new Float64Array(runs);
  for (let r = 0; r < runs; r++) endingReal[r] = real[r * snapshots + years];
  endingReal.sort();

  onProgress?.(1);
  return {
    scenarioId: scenario.id,
    name: scenario.name,
    colorSlot: scenario.colorSlot,
    snapshotDates,
    ages,
    liquidReal: bands(real, runs, snapshots),
    liquidNominal: bands(nominal, runs, snapshots),
    fundedPct: funded.map((n) => (n / runs) * 100),
    successRate: (depletion.filter((d) => !Number.isFinite(d)).length / runs) * 100,
    runwayP10Years: toYears(depletion[Math.floor(0.1 * (runs - 1))]),
    runwayP50Years: toYears(depletion[Math.floor(0.5 * (runs - 1))]),
    medianEndingReal: percentile(endingReal, 50),
    p10EndingReal: percentile(endingReal, 10),
    ledger,
    warnings: c.warnings,
    runs,
  };
}
