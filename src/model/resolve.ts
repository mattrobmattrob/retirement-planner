import { fromMonthIndex, isYearMonth, toMonthIndex } from './dates';
import { benefitAtClaimAge, piaFromKnown } from './socialSecurity';
import type {
  Household,
  Option,
  Person,
  PlanFile,
  Scenario,
  SimExpense,
  SimIncome,
  SimScenario,
  SocialSecurityChoice,
  When,
  YearMonth,
} from './types';

/** The option a scenario picked for an item (first option when unset or stale). */
export function chosenOption<T>(options: Option<T>[], scenario: Scenario, key: string): Option<T> | undefined {
  return options.find((o) => o.id === scenario.choices[key]) ?? options[0];
}

/** Concrete month for a `When`; empty string for "plan start" / "never" / unresolvable. */
export function whenToMonth(when: When, people: Person[]): YearMonth {
  switch (when.type) {
    case 'date':
      return isYearMonth(when.date) ? when.date : '';
    case 'age': {
      const person = people.find((p) => p.id === when.personId);
      if (!person || !isYearMonth(person.birthDate)) return '';
      return fromMonthIndex(toMonthIndex(person.birthDate) + Math.round(when.age * 12));
    }
    default:
      return '';
  }
}

export function describeWhen(when: When, people: Person[]): string {
  switch (when.type) {
    case 'start':
      return 'now';
    case 'never':
      return 'forever';
    case 'date':
      return when.date || '—';
    case 'age': {
      const name = people.find((p) => p.id === when.personId)?.name ?? '?';
      return `${name} turns ${when.age}`;
    }
  }
}

export function birthYearOf(person: Person): number {
  return isYearMonth(person.birthDate) ? +person.birthDate.slice(0, 4) : 1960;
}

export function ssBenefit(person: Person, choice: SocialSecurityChoice): number {
  if (!choice.auto) return choice.monthlyBenefit;
  return benefitAtClaimAge(person.ssKnownBenefit, person.ssKnownAge, birthYearOf(person), choice.claimAge);
}

/** Full-retirement-age benefit (PIA), the base for spousal and survivor benefits. */
export function ssPia(person: Person): number {
  return piaFromKnown(person.ssKnownBenefit, person.ssKnownAge, birthYearOf(person));
}

const monthBefore = (ym: YearMonth) => (ym ? fromMonthIndex(toMonthIndex(ym) - 1) : '');

/** Pick every option for `scenario` and turn the household into the engine's flat input. */
export function resolveScenario(plan: PlanFile, scenario: Scenario): SimScenario {
  const h = plan.household;
  const personIndex = new Map(h.people.map((p, i) => [p.id, i]));
  const at = (w: When) => whenToMonth(w, h.people);

  const people = h.people.map((p) => {
    const ss = chosenOption(p.ssOptions, scenario, p.id);
    const claiming = ss && !ss.off;
    return {
      name: p.name,
      birthDate: p.birthDate,
      lifeExpectancy: p.lifeExpectancy,
      ssClaimAge: claiming ? ss.value.claimAge : 200,
      ssMonthlyBenefit: claiming ? ssBenefit(p, ss.value) : 0,
      ssPia: ssPia(p),
    };
  });

  const includedAccounts = h.accounts.flatMap((a) => {
    const opt = chosenOption(a.options, scenario, a.id);
    if (!opt || opt.off) return [];
    return [{ id: a.id, name: a.name, type: a.type, balance: opt.value.balance, stockPct: a.stockPct, withdrawalPriority: a.withdrawalPriority }];
  });
  const accountIndex = new Map(includedAccounts.map((a, i) => [a.id, i]));

  const loans = h.loans.flatMap((l) => {
    const opt = chosenOption(l.options, scenario, l.id);
    if (!opt || opt.off) return [];
    return [{ name: l.name, balance: l.balance, annualRate: l.annualRate, monthlyPayment: l.monthlyPayment, payoffDate: opt.value.payoffDate }];
  });

  const expenses: SimExpense[] = h.expenses.flatMap((e) => {
    const opt = chosenOption(e.options, scenario, e.id);
    if (!opt || opt.off) return [];
    const { frequency, phases, until } = opt.value;
    const owner = e.ownerId ? personIndex.get(e.ownerId) ?? -1 : -1;
    const starts = phases.map((ph, i) => (i === 0 && frequency !== 'once' ? '' : at(ph.from)));
    const end = at(until);
    return phases.map((ph, i) => ({
      amount: ph.amount,
      frequency,
      startDate: starts[i],
      // A phase runs until the month before the next one starts.
      endDate: frequency === 'once' ? '' : i + 1 < phases.length ? monthBefore(starts[i + 1]) : end,
      inflationAdjusted: e.inflationAdjusted,
      owner,
    }));
  });

  const incomes: SimIncome[] = h.incomes.flatMap((inc) => {
    const opt = chosenOption(inc.options, scenario, inc.id);
    if (!opt || opt.off) return [];
    const v = opt.value;
    const startDate = at(v.start) || plan.settings.startDate;
    const endDate =
      v.kind === 'monthly' && v.payments > 0 ? fromMonthIndex(toMonthIndex(startDate) + Math.round(v.payments) - 1) : at(v.end);
    return [
      {
        name: inc.name,
        kind: v.kind,
        amount: v.amount,
        startDate,
        endDate,
        owner: inc.ownerId ? personIndex.get(inc.ownerId) ?? -1 : -1,
        survivorPct: v.survivorPct,
        inflationAdjusted: v.inflationAdjusted,
        taxable: v.taxable,
        depositTo: v.depositToId ? accountIndex.get(v.depositToId) ?? -1 : -1,
      },
    ];
  });

  return {
    id: scenario.id,
    name: scenario.name,
    colorSlot: scenario.colorSlot,
    people,
    accounts: includedAccounts,
    loans,
    expenses,
    incomes,
    taxes: h.taxes,
    survivorExpensePct: h.survivorExpensePct,
    surplusAccount: accountIndex.get(h.surplusAccountId) ?? -1,
    married: h.married && h.people.length >= 2,
    market: scenario.marketOverride ?? plan.settings.market,
  };
}

/** A choice that actually differs between scenarios: an item with two or more options. */
export interface Decision {
  key: string;
  group: string;
  name: string;
  options: Option<unknown>[];
}

export function decisions(h: Household): Decision[] {
  const list: Decision[] = [];
  const add = (group: string, key: string, name: string, options: Option<unknown>[]) => {
    if (options.length > 1) list.push({ key, group, name, options });
  };
  h.people.forEach((p) => add('Social Security', p.id, `${p.name} — Social Security`, p.ssOptions));
  h.accounts.forEach((a) => add('Accounts', a.id, a.name, a.options));
  h.loans.forEach((l) => add('Loans', l.id, l.name, l.options));
  h.incomes.forEach((i) => add('Income & events', i.id, i.name, i.options));
  h.expenses.forEach((e) => add('Expenses', e.id, e.name, e.options));
  return list;
}
