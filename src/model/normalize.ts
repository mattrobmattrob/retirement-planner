import { isYearMonth } from './dates';
import {
  defaultMarket,
  defaultSettings,
  defaultTaxes,
  newAccount,
  newExpense,
  newIncome,
  newLoan,
  newPerson,
  newScenario,
} from './defaults';
import type { PlanFile, Scenario } from './types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Overlay `raw` onto `defaults`, keeping only known keys whose type matches the default.
 * This lets older or hand-edited files load: missing fields fall back, junk is dropped.
 */
function merge<T extends object>(defaults: T, raw: unknown): T {
  if (!isObj(raw)) return defaults;
  const out: Obj = { ...(defaults as Obj) };
  for (const [key, def] of Object.entries(defaults as Obj)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof def === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    } else if (typeof def === 'string') {
      if (typeof value === 'string') out[key] = value;
    } else if (typeof def === 'boolean') {
      if (typeof value === 'boolean') out[key] = value;
    } else if (isObj(def)) {
      out[key] = merge(def, value);
    }
  }
  return out as T;
}

function list<T extends object>(raw: unknown, make: () => T): T[] {
  return Array.isArray(raw) ? raw.map((item) => merge(make(), item)) : [];
}

function oneOf<T extends string>(value: T, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value) ? value : fallback;
}

function normalizeScenario(raw: unknown, index: number): Scenario {
  const s = merge(newScenario({ colorSlot: index % 8 }), raw);
  const r = isObj(raw) ? raw : {};
  s.people = list(r.people, () => newPerson());
  s.accounts = list(r.accounts, () => newAccount()).map((a) => ({
    ...a,
    type: oneOf(a.type, ['cash', 'taxable', 'traditional', 'roth', 'hsa'], 'taxable'),
  }));
  s.loans = list(r.loans, () => newLoan());
  s.expenses = list(r.expenses, () => newExpense()).map((e) => ({
    ...e,
    frequency: oneOf(e.frequency, ['monthly', 'annual', 'once'], 'monthly'),
  }));
  s.incomes = list(r.incomes, () => newIncome()).map((i) => ({
    ...i,
    kind: oneOf(i.kind, ['monthly', 'lump', 'death-benefit'], 'monthly'),
  }));
  s.taxes = merge(defaultTaxes(), r.taxes);
  s.marketOverride = isObj(r.marketOverride) ? merge(defaultMarket(), r.marketOverride) : null;
  return s;
}

/** Parse and sanity-check a plan file (e.g. one the user downloaded earlier). */
export function normalizePlan(raw: unknown): PlanFile {
  if (!isObj(raw)) throw new Error('Plan file must be a JSON object.');
  if (raw.format !== undefined && raw.format !== 'retirement-planner') {
    throw new Error(`Unrecognized file format "${String(raw.format)}".`);
  }
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length === 0) {
    throw new Error('Plan file has no scenarios.');
  }
  const settings = merge(defaultSettings(), raw.settings);
  if (!isYearMonth(settings.startDate)) settings.startDate = defaultSettings().startDate;
  settings.mortality = oneOf(settings.mortality, ['fixed', 'stochastic'], 'fixed');
  return {
    format: 'retirement-planner',
    version: 1,
    settings,
    scenarios: raw.scenarios.map(normalizeScenario),
  };
}
