import { ageAt, fromMonthIndex, offsetFrom, toMonthIndex } from '../model/dates';
import type { AccountType, MarketAssumptions, SimScenario, SimulationSettings } from '../model/types';
import { ssTaxTier, taxableSocialSecurity, taxableSocialSecurityShare } from '../model/ssTax';
import { sampleDeathAge, solveModalAge } from './mortality';
import { Rng } from './rng';

/** Mortality draws per path are fixed so scenarios with different households stay in sync. */
const MORTALITY_DRAWS = 8;
const PERCENTILES = [10, 25, 50, 75, 90] as const;
export type Percentile = (typeof PERCENTILES)[number];
export type Bands = Record<Percentile, number[]>;

/** How Social Security was taxed in one calendar (tax) year. */
export interface SsTaxDetail {
  /** assumed: first partial year at the configured share; irs: trued up to the IRS rule; flat: configured share. */
  basis: 'assumed' | 'irs' | 'flat';
  benefits: number;
  /** Taxable dollars of benefits for the year (after true-up). */
  taxable: number;
  /** Taxable dollars used for monthly withholding during the year (the estimate). */
  estimatedTaxable: number;
  /** Taxable non-SS income: taxable income, pre-tax withdrawals, half of brokerage withdrawals. */
  otherIncome: number;
  provisionalIncome: number;
  joint: boolean;
  tier: 0 | 50 | 85;
  /** Tax owed (+) or refunded (−) the following April when the estimate is trued up. */
  settlement: number;
}

export interface LedgerRow {
  /** Calendar (tax) year. The first and last rows may be partial. */
  year: number;
  firstMonth: string;
  lastMonth: string;
  /** Ages at the start of the row. */
  ages: number[];
  income: number;
  socialSecurity: number;
  expenses: number;
  debtPayments: number;
  taxes: number;
  withdrawals: number;
  /** Dollars of Social Security subject to income tax this year, and that as a share of benefits (%). */
  ssTaxable: number;
  ssTaxablePct: number;
  ssDetail: SsTaxDetail | null;
  /** Prior-year true-up included in this row's taxes (paid in April). */
  settlementPaid: number;
  endLiquid: number;
  endLiquidReal: number;
  endDebt: number;
  events: string[];
}

export interface ScenarioResult {
  scenarioId: string;
  name: string;
  colorSlot: number;
  /** Snapshot 0 is the plan start ("today"); snapshot k ≥ 1 is the end of calendar year `snapshotYears[k]`. */
  snapshotYears: (number | null)[];
  /** Months elapsed at each snapshot. */
  snapshotMonths: number[];
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
  irsSsRule: boolean;
  /** Calendar month (0–11) of the plan start, so tax years can follow the calendar. */
  startCalMonth: number;
  warnings: string[];
}

/** Share of brokerage withdrawals assumed to be realized gains when estimating provisional income. */
const BROKERAGE_GAIN_SHARE = 0.5;
/**
 * Tax years (the rest of this year, then next Jan–Dec) taxed at the configured Social Security
 * share, without a true-up, before the IRS rule takes over.
 */
export const SS_ASSUMED_TAX_YEARS = 2;


function compile(settings: SimulationSettings, s: SimScenario): Compiled {
  const { startDate, horizonYears } = settings;
  // The rest of this calendar year plus `horizonYears` full calendar years.
  const months = 12 - (toMonthIndex(startDate) % 12) + Math.max(1, Math.round(horizonYears)) * 12;
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
    irsSsRule: s.taxes.ssTaxRule !== 'flat',
    startCalMonth: toMonthIndex(startDate) % 12,
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

/** One calendar year of the deterministic ledger. */
interface YearAccumulator {
  months: number;
  income: number;
  socialSecurity: number;
  expenses: number;
  debtPayments: number;
  taxes: number;
  withdrawals: number;
  settlementPaid: number;
  ss: SsTaxDetail | null;
  events: string[];
  endLiquid: number;
  endLiquidReal: number;
  endDebt: number;
}

function newYearAccumulator(): YearAccumulator {
  return {
    months: 0,
    income: 0,
    socialSecurity: 0,
    expenses: 0,
    debtPayments: 0,
    taxes: 0,
    withdrawals: 0,
    settlementPaid: 0,
    ss: null,
    events: [],
    endLiquid: 0,
    endLiquidReal: 0,
    endDebt: 0,
  };
}

/**
 * Simulate one path month by month. With `rng === null` every random quantity takes its
 * expected value, which produces the deterministic ledger.
 *
 * `liquidNominal`/`liquidReal` receive one value per snapshot: the start, then each calendar year end.
 */
function runPath(
  c: Compiled,
  mp: MarketParams,
  rng: Rng | null,
  stochasticMortality: boolean,
  liquidNominal: Float64Array,
  liquidReal: Float64Array,
  offset: number,
  ledger?: YearAccumulator[],
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

  // Social Security taxation follows calendar (tax) years. Each month is taxed at an estimate:
  // the configured share in a partial first year (income before the plan is unknown), otherwise
  // the IRS rule on the prior year's other income. After each year the actual taxable amount is
  // computed from that year's simulated income and the difference is settled the next April —
  // like filing a return — which avoids the circularity of taxes driving withdrawals driving taxes.
  let taxYear = 0;
  let ytdSs = 0;
  let ytdOther = 0;
  let ytdEstimated = 0;
  let ytdMonths = 0;
  let priorOther = 0;
  let pendingSettlement = 0;
  let joint = nPeople >= 2;

  const closeTaxYear = (settle: boolean) => {
    let actual = ytdEstimated;
    let basis: SsTaxDetail['basis'] = c.irsSsRule ? 'irs' : 'flat';
    if (c.irsSsRule && taxYear < SS_ASSUMED_TAX_YEARS) basis = 'assumed';
    if (basis === 'irs') actual = taxableSocialSecurity(ytdSs, ytdOther, joint);
    const raw = (actual - ytdEstimated) * c.ordinary;
    const settlement = Math.abs(raw) < 0.01 ? 0 : raw;
    if (settle) pendingSettlement = settlement;
    if (ledger && ytdSs > 0) {
      ledger[taxYear].ss = {
        basis,
        benefits: ytdSs,
        taxable: actual,
        estimatedTaxable: ytdEstimated,
        otherIncome: ytdOther,
        provisionalIncome: ytdOther + ytdSs / 2,
        joint,
        tier: ssTaxTier(ytdSs, ytdOther, joint),
        settlement: basis === 'irs' ? settlement : 0,
      };
    }
    // Annualize a partial first year so next year's estimate isn't biased low.
    priorOther = ytdMonths > 0 ? (ytdOther * 12) / ytdMonths : 0;
    ytdSs = 0;
    ytdOther = 0;
    ytdEstimated = 0;
    ytdMonths = 0;
  };

  const snapshot = (y: number) => {
    let liquid = 0;
    for (let i = 0; i < bal.length; i++) liquid += bal[i];
    liquidNominal[offset + y] = liquid;
    liquidReal[offset + y] = liquid / cpi;
  };
  const closeLedgerYear = (ty: number) => {
    if (!ledger) return;
    let liquid = 0;
    for (let i = 0; i < bal.length; i++) liquid += bal[i];
    ledger[ty].endLiquid = liquid;
    ledger[ty].endLiquidReal = liquid / cpi;
    ledger[ty].endDebt = loanBal.reduce((a, b) => a + b, 0);
  };
  snapshot(0);

  const lastSnapshot = Math.floor((c.startCalMonth + c.months - 1) / 12) + 1;
  for (let m = 0; m < c.months; m++) {
    const calMonth = (c.startCalMonth + m) % 12;
    const ty = Math.floor((c.startCalMonth + m) / 12);
    let nAlive = 0;
    for (let i = 0; i < nPeople; i++) if (m < death[i]) nAlive++;
    if (ty !== taxYear) {
      closeTaxYear(true);
      taxYear = ty;
      joint = nAlive >= 2;
    }
    if (nPeople > 0 && nAlive === 0) {
      // Everyone has died: the plan succeeded. Freeze the estate for the remaining snapshots.
      closeTaxYear(false);
      for (let y = ty + 1; y <= lastSnapshot; y++) snapshot(y);
      break;
    }
    const acc = ledger?.[ty];
    if (acc) acc.months++;
    ytdMonths++;

    let net = 0;
    let taxes = 0;

    if (calMonth === 3 && pendingSettlement !== 0) {
      taxes += pendingSettlement;
      net -= pendingSettlement;
      if (acc) acc.settlementPaid += pendingSettlement;
      pendingSettlement = 0;
    }

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
      if (inc.taxable) ytdOther += gross;
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
      const assumed = !c.irsSsRule || taxYear < SS_ASSUMED_TAX_YEARS;
      const share = assumed ? c.ssTaxable : taxableSocialSecurityShare(ss * 12, priorOther, nAlive >= 2);
      const tax = ss * share * c.ordinary;
      taxes += tax;
      net += ss - tax;
      ytdSs += ss;
      ytdEstimated += ss * share;
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
        const type = c.accounts[i].type;
        if (type === 'traditional') ytdOther += gross;
        else if (type === 'taxable') ytdOther += gross * BROKERAGE_GAIN_SHARE;
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

    if (calMonth === 11 || m === c.months - 1) {
      snapshot(ty + 1);
      closeLedgerYear(ty);
    }
    if (m === c.months - 1) closeTaxYear(false);
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
  const taxYears = Math.floor((c.startCalMonth + c.months - 1) / 12) + 1;
  const snapshots = taxYears + 1;
  const snapshotMonths = Array.from({ length: snapshots }, (_, k) => (k === 0 ? 0 : Math.min(c.months, 12 - c.startCalMonth + (k - 1) * 12)));
  const stochastic = settings.mortality === 'stochastic';

  const nominal = new Float64Array(runs * snapshots);
  const real = new Float64Array(runs * snapshots);
  const depletion = new Float64Array(runs);
  const funded = new Array<number>(snapshots).fill(0);

  for (let r = 0; r < runs; r++) {
    const rng = new Rng(settings.seed, r);
    const { depletedAt } = runPath(c, mp, rng, stochastic, nominal, real, r * snapshots);
    depletion[r] = depletedAt;
    for (let k = 0; k < snapshots; k++) if (depletedAt >= snapshotMonths[k]) funded[k]++;
    if (onProgress && r % 250 === 0) onProgress(r / runs);
  }

  // Deterministic "expected case" ledger (fixed mortality, expected returns), by calendar year.
  const ledgerYears = Array.from({ length: taxYears }, newYearAccumulator);
  const detNominal = new Float64Array(snapshots);
  const detReal = new Float64Array(snapshots);
  runPath(c, mp, null, false, detNominal, detReal, 0, ledgerYears);

  const startIndex = toMonthIndex(settings.startDate);
  const startYear = Math.floor(startIndex / 12);
  const snapshotYears = snapshotMonths.map((_, k) => (k === 0 ? null : startYear + k - 1));
  const ages = c.people.map((p) => ({
    name: p.name,
    values: snapshotMonths.map((months) => p.age0 + months / 12),
  }));

  const ledger: LedgerRow[] = ledgerYears
    .map((acc, ty) => {
      const firstOffset = Math.max(0, ty * 12 - c.startCalMonth);
      const ss = acc.ss;
      return {
        year: startYear + ty,
        firstMonth: fromMonthIndex(startIndex + firstOffset),
        lastMonth: fromMonthIndex(startIndex + firstOffset + acc.months - 1),
        ages: c.people.map((p) => Math.floor(p.age0 + firstOffset / 12)),
        income: acc.income,
        socialSecurity: acc.socialSecurity,
        expenses: acc.expenses,
        debtPayments: acc.debtPayments,
        taxes: acc.taxes,
        withdrawals: acc.withdrawals,
        ssTaxable: ss?.taxable ?? 0,
        ssTaxablePct: ss && ss.benefits > 0 ? (ss.taxable / ss.benefits) * 100 : 0,
        ssDetail: ss,
        settlementPaid: acc.settlementPaid,
        endLiquid: acc.endLiquid,
        endLiquidReal: acc.endLiquidReal,
        endDebt: acc.endDebt,
        events: acc.events,
      };
    })
    // Rows exist only for months simulated (the path stops once everyone has died).
    .filter((_, ty) => ledgerYears[ty].months > 0);

  depletion.sort();
  const toYears = (months: number) => (Number.isFinite(months) ? months / 12 : null);
  const endingReal = new Float64Array(runs);
  for (let r = 0; r < runs; r++) endingReal[r] = real[r * snapshots + snapshots - 1];
  endingReal.sort();

  onProgress?.(1);
  return {
    scenarioId: scenario.id,
    name: scenario.name,
    colorSlot: scenario.colorSlot,
    snapshotYears,
    snapshotMonths,
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

export interface SummaryResult {
  successRate: number;
  runwayP10Years: number | null;
  runwayP50Years: number | null;
  medianEndingReal: number;
  p10EndingReal: number;
}

/** Headline numbers only (no chart bands or ledger) — for searches over many candidates. */
export function simulateSummary(settings: SimulationSettings, scenario: SimScenario): SummaryResult {
  const c = compile(settings, scenario);
  const mp = marketParams(scenario.market);
  const runs = Math.max(1, Math.round(settings.runs));
  const snapshots = Math.floor((c.startCalMonth + c.months - 1) / 12) + 2;
  const stochastic = settings.mortality === 'stochastic';
  const nominal = new Float64Array(snapshots);
  const real = new Float64Array(snapshots);
  const depletion = new Float64Array(runs);
  const endingReal = new Float64Array(runs);
  let successes = 0;
  for (let r = 0; r < runs; r++) {
    const { depletedAt } = runPath(c, mp, new Rng(settings.seed, r), stochastic, nominal, real, 0);
    depletion[r] = depletedAt;
    endingReal[r] = real[snapshots - 1];
    if (!Number.isFinite(depletedAt)) successes++;
  }
  depletion.sort();
  endingReal.sort();
  const toYears = (months: number) => (Number.isFinite(months) ? months / 12 : null);
  return {
    successRate: (successes / runs) * 100,
    runwayP10Years: toYears(depletion[Math.floor(0.1 * (runs - 1))]),
    runwayP50Years: toYears(depletion[Math.floor(0.5 * (runs - 1))]),
    medianEndingReal: percentile(endingReal, 50),
    p10EndingReal: percentile(endingReal, 10),
  };
}
