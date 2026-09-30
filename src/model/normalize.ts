import { isYearMonth } from './dates';
import {
  defaultMarket,
  defaultSettings,
  defaultTaxes,
  emptyHousehold,
  expenseChoice,
  incomeChoice,
  NEVER,
  newAccount,
  newExpense,
  newId,
  newIncome,
  newLoan,
  newOption,
  newPerson,
  newPhase,
  newScenario,
  START,
} from './defaults';
import type {
  AccountType,
  ExpenseChoice,
  ExpenseFrequency,
  Household,
  IncomeChoice,
  IncomeKind,
  Option,
  PlanFile,
  Scenario,
  When,
} from './types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Overlay the scalar fields of `raw` onto `defaults`, keeping only known keys whose type
 * matches the default. Nested objects/arrays are handled by the callers.
 */
function merge<T extends object>(defaults: T, raw: unknown): T {
  if (!isObj(raw)) return defaults;
  const out: Obj = { ...(defaults as Obj) };
  for (const [key, def] of Object.entries(defaults as Obj)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof def === typeof value && (typeof def !== 'number' || Number.isFinite(value))) {
      if (typeof def !== 'object') out[key] = value;
    }
  }
  return out as T;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const ACCOUNT_TYPES: AccountType[] = ['cash', 'taxable', 'traditional', 'roth', 'hsa'];
const FREQUENCIES: ExpenseFrequency[] = ['monthly', 'annual', 'once'];
const INCOME_KINDS: IncomeKind[] = ['monthly', 'lump', 'death-benefit'];

function normalizeWhen(raw: unknown, fallback: When): When {
  if (!isObj(raw)) return fallback;
  switch (raw.type) {
    case 'start':
      return START;
    case 'never':
      return NEVER;
    case 'date':
      return { type: 'date', date: isYearMonth(raw.date) ? raw.date : '' };
    case 'age':
      return { type: 'age', personId: str(raw.personId), age: num(raw.age, 65) };
    default:
      return fallback;
  }
}

function normalizeOptions<T>(raw: unknown, value: (raw: unknown) => T, fallback: () => Option<T>): Option<T>[] {
  const list = arr(raw)
    .filter(isObj)
    .map((o) => ({ id: str(o.id) || newId(), label: str(o.label, 'Option'), off: o.off === true, value: value(o.value) }));
  return list.length ? list : [fallback()];
}

function normalizeExpenseChoice(raw: unknown): ExpenseChoice {
  const r = isObj(raw) ? raw : {};
  const phases = arr(r.phases)
    .filter(isObj)
    .map((p) => ({ id: str(p.id) || newId(), amount: num(p.amount), from: normalizeWhen(p.from, START) }));
  return {
    frequency: oneOf(r.frequency, FREQUENCIES, 'monthly'),
    phases: phases.length ? phases : [newPhase(0)],
    until: normalizeWhen(r.until, NEVER),
  };
}

function normalizeIncomeChoice(raw: unknown): IncomeChoice {
  const r = isObj(raw) ? raw : {};
  const kind = oneOf(r.kind, INCOME_KINDS, 'monthly');
  const base = merge(incomeChoice(kind), r);
  return { ...base, kind, start: normalizeWhen(r.start, START), end: normalizeWhen(r.end, NEVER) };
}

function normalizeHousehold(raw: unknown): Household {
  const r = isObj(raw) ? raw : {};
  const h = merge(emptyHousehold(), r);
  h.taxes = merge(defaultTaxes(), r.taxes);
  h.people = arr(r.people).map((p) => {
    const base = merge(newPerson(), p);
    const po = isObj(p) ? p : {};
    base.ssOptions = normalizeOptions(
      po.ssOptions,
      (v) => merge({ claimAge: 67, monthlyBenefit: 0, auto: true }, v),
      () => newOption('Claim at 67', { claimAge: 67, monthlyBenefit: 0, auto: true }),
    );
    return base;
  });
  h.accounts = arr(r.accounts).map((a) => {
    const ao = isObj(a) ? a : {};
    const type = oneOf(ao.type, ACCOUNT_TYPES, 'taxable');
    const base = merge(newAccount(type), a);
    base.type = type;
    base.options = normalizeOptions(ao.options, (v) => merge({ balance: 0 }, v), () => newOption('Balance', { balance: 0 }));
    return base;
  });
  h.loans = arr(r.loans).map((l) => {
    const base = merge(newLoan(), l);
    base.options = normalizeOptions(
      isObj(l) ? l.options : undefined,
      (v) => {
        const payoffDate = isObj(v) ? str(v.payoffDate) : '';
        return { payoffDate: isYearMonth(payoffDate) ? payoffDate : '' };
      },
      () => newOption('Keep paying', { payoffDate: '' }),
    );
    return base;
  });
  h.expenses = arr(r.expenses).map((e) => {
    const base = merge(newExpense(), e);
    base.options = normalizeOptions(isObj(e) ? e.options : undefined, normalizeExpenseChoice, () =>
      newOption('Amount', expenseChoice('monthly', [newPhase(0)])),
    );
    return base;
  });
  h.incomes = arr(r.incomes).map((i) => {
    const base = merge(newIncome('Income', []), i);
    base.options = normalizeOptions(isObj(i) ? i.options : undefined, normalizeIncomeChoice, () =>
      newOption('Amount', incomeChoice('monthly')),
    );
    return base;
  });
  return h;
}

function normalizeScenario(raw: unknown, index: number): Scenario {
  const r = isObj(raw) ? raw : {};
  const s = merge(newScenario({ name: `Scenario ${index + 1}`, colorSlot: index % 8 }), r);
  s.choices = Object.fromEntries(Object.entries(isObj(r.choices) ? r.choices : {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  s.marketOverride = isObj(r.marketOverride) ? merge(defaultMarket(), r.marketOverride) : null;
  return s;
}

function normalizeSettings(raw: unknown) {
  const settings = merge(defaultSettings(), raw);
  settings.market = merge(defaultMarket(), isObj(raw) ? raw.market : undefined);
  if (!isYearMonth(settings.startDate)) settings.startDate = defaultSettings().startDate;
  settings.mortality = oneOf(settings.mortality, ['fixed', 'stochastic'] as const, 'fixed');
  return settings;
}

/** Parse and sanity-check a plan file (e.g. one the user downloaded earlier). */
export function normalizePlan(raw: unknown): PlanFile {
  if (!isObj(raw)) throw new Error('Plan file must be a JSON object.');
  if (raw.format !== undefined && raw.format !== 'retirement-planner') {
    throw new Error(`Unrecognized file format "${String(raw.format)}".`);
  }
  if (raw.version === 1 || (raw.household === undefined && Array.isArray(raw.scenarios))) return migrateV1(raw);
  if (!isObj(raw.household)) throw new Error('Plan file has no household.');
  const scenarios = arr(raw.scenarios).map(normalizeScenario);
  return {
    format: 'retirement-planner',
    version: 2,
    settings: normalizeSettings(raw.settings),
    household: normalizeHousehold(raw.household),
    scenarios: scenarios.length ? scenarios : [newScenario({ name: 'Scenario A' })],
  };
}

/**
 * Version 1 stored a full copy of the household in every scenario. Merge them: items with the
 * same name become one item, and each distinct version of it becomes an option.
 */
function migrateV1(raw: Obj): PlanFile {
  const v1 = arr(raw.scenarios).filter(isObj);
  if (v1.length === 0) throw new Error('Plan file has no scenarios.');
  const h = emptyHousehold();
  const first = v1[0];
  h.taxes = merge(defaultTaxes(), first.taxes);
  h.survivorExpensePct = num(first.survivorExpensePct, 70);
  const scenarios = v1.map((s, i) =>
    newScenario({
      name: str(s.name, `Scenario ${i + 1}`),
      notes: str(s.notes),
      colorSlot: num(s.colorSlot, i % 8),
      marketOverride: isObj(s.marketOverride) ? merge(defaultMarket(), s.marketOverride) : null,
    }),
  );

  /** Old id → new id, per scenario, for people and accounts (used by references). */
  const personIds = v1.map(() => new Map<string, string>());
  const accountIds = v1.map(() => new Map<string, string>());

  /** Group a list field by item name and hand each group's per-scenario copies to `build`. */
  function group(field: string, build: (name: string, copies: (Obj | undefined)[]) => void) {
    const names: string[] = [];
    v1.forEach((s) => arr(s[field]).filter(isObj).forEach((it) => names.includes(str(it.name)) || names.push(str(it.name))));
    for (const name of names) build(name, v1.map((s) => arr(s[field]).filter(isObj).find((it) => str(it.name) === name)));
  }

  /** Distinct values become options; scenarios missing the item get a "Not included" option. */
  function optionsFor<T>(itemId: string, copies: (Obj | undefined)[], value: (o: Obj, i: number) => T, label: (v: T, n: number) => string) {
    const options: Option<T>[] = [];
    const keys: string[] = [];
    copies.forEach((copy, i) => {
      let opt: Option<T>;
      if (!copy) {
        opt = options.find((o) => o.off) ?? newOption<T>('Not included', value({}, i), true);
        if (!options.includes(opt)) options.push(opt);
      } else {
        const v = value(copy, i);
        const key = JSON.stringify(v);
        const at = keys.indexOf(key);
        if (at >= 0) opt = options.filter((o) => !o.off)[at];
        else {
          keys.push(key);
          opt = newOption(label(v, keys.length), v);
          options.push(opt);
        }
      }
      scenarios[i].choices[itemId] = opt.id;
    });
    return options;
  }

  group('people', (name, copies) => {
    const base = copies.find(Boolean)!;
    const person = newPerson({
      name,
      birthDate: isYearMonth(base.birthDate) ? base.birthDate : '1965-01',
      lifeExpectancy: num(base.lifeExpectancy, 90),
      ssKnownBenefit: num(base.ssMonthlyBenefit, 2000),
      ssKnownAge: num(base.ssClaimAge, 67),
    });
    copies.forEach((c, i) => c && personIds[i].set(str(c.id), person.id));
    person.ssOptions = optionsFor(
      person.id,
      copies,
      (o) => ({ claimAge: num(o.ssClaimAge, 67), monthlyBenefit: num(o.ssMonthlyBenefit), auto: false }),
      (v) => `Claim at ${v.claimAge}`,
    );
    h.people.push(person);
  });

  group('accounts', (name, copies) => {
    const base = copies.find(Boolean)!;
    const type = oneOf(base.type, ACCOUNT_TYPES, 'taxable');
    const account = newAccount(type, { name, stockPct: num(base.stockPct, 60), withdrawalPriority: num(base.withdrawalPriority, 1) });
    copies.forEach((c, i) => c && accountIds[i].set(str(c.id), account.id));
    account.options = optionsFor(account.id, copies, (o) => ({ balance: num(o.balance) }), (_, n) => `Balance ${n}`);
    h.accounts.push(account);
  });
  h.surplusAccountId = accountIds[0].get(str(first.surplusAccountId)) ?? '';

  group('loans', (name, copies) => {
    const base = copies.find(Boolean)!;
    const loan = newLoan({ name, balance: num(base.balance), annualRate: num(base.annualRate), monthlyPayment: num(base.monthlyPayment) });
    loan.options = optionsFor(
      loan.id,
      copies,
      (o) => ({ payoffDate: isYearMonth(o.payoffDate) ? o.payoffDate : '' }),
      (v) => (v.payoffDate ? `Pay off ${v.payoffDate}` : 'Keep paying'),
    );
    h.loans.push(loan);
  });

  group('expenses', (name, copies) => {
    const base = copies.find(Boolean)!;
    const expense = newExpense(name, undefined, { inflationAdjusted: base.inflationAdjusted !== false });
    expense.options = optionsFor(
      expense.id,
      copies,
      (o) => {
        const start = str(o.startDate);
        const end = str(o.endDate);
        const phases = isYearMonth(start) ? [newPhase(0), newPhase(num(o.amount), { type: 'date', date: start })] : [newPhase(num(o.amount))];
        const choice = expenseChoice(oneOf(o.frequency, FREQUENCIES, 'monthly'), phases, isYearMonth(end) ? { type: 'date', date: end } : NEVER);
        if (choice.frequency === 'once') choice.phases = [newPhase(num(o.amount), isYearMonth(start) ? { type: 'date', date: start } : START)];
        // Phase ids are random; compare without them so identical copies share an option.
        return { ...choice, phases: choice.phases.map((p) => ({ ...p, id: '' })) };
      },
      (_, n) => (n === 1 ? 'Amount' : `Amount ${n}`),
    );
    expense.options.forEach((o) => (o.value.phases = o.value.phases.map((p) => ({ ...p, id: newId() }))));
    h.expenses.push(expense);
  });

  group('incomes', (name, copies) => {
    const base = copies.find(Boolean)!;
    const income = newIncome(name, []);
    const ownerOld = str(base.ownerId);
    const owner = copies.map((c, i) => (c ? personIds[i].get(ownerOld) : undefined)).find(Boolean);
    income.ownerId = owner ?? '';
    income.options = optionsFor(
      income.id,
      copies,
      (o, i) => {
        const start = str(o.startDate);
        const end = str(o.endDate);
        return incomeChoice(oneOf(o.kind, INCOME_KINDS, 'monthly'), {
          amount: num(o.amount),
          start: isYearMonth(start) ? { type: 'date', date: start } : START,
          end: isYearMonth(end) ? { type: 'date', date: end } : NEVER,
          survivorPct: num(o.survivorPct),
          inflationAdjusted: o.inflationAdjusted === true,
          taxable: o.taxable !== false,
          depositToId: accountIds[i].get(str(o.depositToId)) ?? '',
        });
      },
      (v) => (v.kind === 'lump' ? 'Lump sum' : v.kind === 'death-benefit' ? 'At death' : 'Monthly'),
    );
    h.incomes.push(income);
  });

  return { format: 'retirement-planner', version: 2, settings: normalizeSettings(raw.settings), household: h, scenarios };
}
