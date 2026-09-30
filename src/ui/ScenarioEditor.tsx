import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { ageAt } from '../model/dates';
import {
  ACCOUNT_TYPE_LABELS,
  DEFAULT_WITHDRAWAL_PRIORITY,
  defaultMarket,
  newAccount,
  newExpense,
  newIncome,
  newLoan,
  newPerson,
} from '../model/defaults';
import type { Account, AccountType, Expense, Income, Loan, Person, Scenario } from '../model/types';
import { CheckField, MonthField, NumField, SelectField, TextField } from './fields';
import { money } from './format';
import { MarketFields } from './SettingsPanel';

type Update = (fn: (s: Scenario) => Scenario) => void;

function Section(props: {
  title: string;
  summary?: string;
  description?: string;
  defaultOpen?: boolean;
  children: ComponentChildren;
}) {
  return (
    <details class="section" open={props.defaultOpen ?? true}>
      <summary>
        <span class="section__title">{props.title}</span>
        {props.summary && <span class="section__summary">{props.summary}</span>}
      </summary>
      {props.description && <p class="section__desc">{props.description}</p>}
      <div class="section__body">{props.children}</div>
    </details>
  );
}

function Row(props: { onRemove: () => void; children: ComponentChildren; label: string }) {
  return (
    <div class="row">
      <div class="row__fields">{props.children}</div>
      <button type="button" class="icon-btn row__remove" title={`Remove ${props.label}`} aria-label={`Remove ${props.label}`} onClick={props.onRemove}>
        ×
      </button>
    </div>
  );
}

/** Helpers to patch one item of a list field on the scenario. */
function listOps<K extends 'people' | 'accounts' | 'loans' | 'expenses' | 'incomes'>(update: Update, key: K) {
  type Item = Scenario[K][number];
  return {
    patch: (id: string, patch: Partial<Item>) =>
      update((s) => ({ ...s, [key]: (s[key] as Item[]).map((it) => (it.id === id ? { ...it, ...patch } : it)) })),
    remove: (id: string) => update((s) => ({ ...s, [key]: (s[key] as Item[]).filter((it) => it.id !== id) })),
    add: (item: Item) => update((s) => ({ ...s, [key]: [...(s[key] as Item[]), item] })),
  };
}

function monthlyEquivalent(e: Expense): number {
  if (e.frequency === 'monthly') return e.amount;
  if (e.frequency === 'annual') return e.amount / 12;
  return 0;
}

export function ScenarioEditor(props: { scenario: Scenario; startDate: string; update: Update }) {
  const { scenario: s, update, startDate } = props;
  const people = listOps(update, 'people');
  const accounts = listOps(update, 'accounts');
  const loans = listOps(update, 'loans');
  const expenses = listOps(update, 'expenses');
  const incomes = listOps(update, 'incomes');

  const personOptions = [{ value: '', label: 'Household' }, ...s.people.map((p) => ({ value: p.id, label: p.name }))];
  const accountOptions = (emptyLabel: string) => [
    { value: '', label: emptyLabel },
    ...s.accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  const totalAssets = s.accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalDebt = s.loans.reduce((sum, l) => sum + l.balance, 0);
  const monthlyDebt = s.loans.reduce((sum, l) => sum + l.monthlyPayment, 0);
  const monthlySpend = s.expenses
    .filter((e) => !e.endDate || e.endDate >= startDate)
    .filter((e) => !e.startDate || e.startDate <= startDate)
    .reduce((sum, e) => sum + monthlyEquivalent(e), 0);

  return (
    <div class="editor">
      <div class="scenario-meta">
        <TextField label="Scenario name" value={s.name} wide onChange={(name) => update((x) => ({ ...x, name }))} />
        <label class="field field--wide">
          <span class="field__label">Notes</span>
          <textarea rows={2} value={s.notes} onInput={(e) => update((x) => ({ ...x, notes: (e.target as HTMLTextAreaElement).value }))} />
        </label>
      </div>

      <Section title="People" summary={s.people.map((p) => p.name).join(' · ') || 'None'}>
        {s.people.map((p) => (
          <PersonRow key={p.id} person={p} startDate={startDate} patch={(x) => people.patch(p.id, x)} remove={() => people.remove(p.id)} />
        ))}
        <button type="button" class="btn btn--ghost" onClick={() => people.add(newPerson({ name: `Person ${String.fromCharCode(65 + s.people.length)}` }))}>
          + Add person
        </button>
      </Section>

      <Section title="Cash & investment accounts" summary={money(totalAssets)} description="Withdrawals come from the lowest priority number first when spending exceeds income.">
        {s.accounts.map((a) => (
          <AccountRow key={a.id} account={a} patch={(x) => accounts.patch(a.id, x)} remove={() => accounts.remove(a.id)} />
        ))}
        <div class="btn-row">
          {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((type) => (
            <button type="button" class="btn btn--ghost" key={type} onClick={() => accounts.add(newAccount({ type }))}>
              + {ACCOUNT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
        <SelectField
          label="Deposit monthly surpluses into"
          value={s.surplusAccountId}
          options={accountOptions('First cash account')}
          onChange={(surplusAccountId) => update((x) => ({ ...x, surplusAccountId }))}
        />
      </Section>

      <Section title="Loans & debts" summary={`${money(totalDebt)} · ${money(monthlyDebt)}/mo`} description="Payments are spending until the balance hits zero. Set a payoff month to clear the balance from savings.">
        {s.loans.map((l) => (
          <LoanRow key={l.id} loan={l} patch={(x) => loans.patch(l.id, x)} remove={() => loans.remove(l.id)} />
        ))}
        <button type="button" class="btn btn--ghost" onClick={() => loans.add(newLoan())}>
          + Add loan
        </button>
      </Section>

      <Section title="Monthly expenses" summary={`${money(monthlySpend)}/mo now`} description="Enter amounts in today's dollars. Annual items are charged once a year; one-time items in their month.">
        <div class="expense-list">
          {s.expenses.map((e) => (
            <ExpenseRow key={e.id} expense={e} patch={(x) => expenses.patch(e.id, x)} remove={() => expenses.remove(e.id)} />
          ))}
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn--ghost" onClick={() => expenses.add(newExpense())}>
            + Monthly
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => expenses.add(newExpense({ name: 'Annual expense', frequency: 'annual', amount: 3000 }))}>
            + Annual
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => expenses.add(newExpense({ name: 'One-time expense', frequency: 'once', amount: 10000, startDate }))}>
            + One-time
          </button>
        </div>
        <NumField
          label="Spending after first death"
          hint="In a household of two or more, all expenses scale to this % once someone dies."
          value={s.survivorExpensePct}
          suffix="%"
          min={0}
          max={200}
          onChange={(survivorExpensePct) => update((x) => ({ ...x, survivorExpensePct }))}
        />
      </Section>

      <Section title="Income & events" summary={`${s.incomes.length} item${s.incomes.length === 1 ? '' : 's'}`} description="Severance, pensions, salary, annuities, inheritances, life insurance. Survivorship sets how much continues after the owner dies.">
        {s.incomes.map((i) => (
          <IncomeRow
            key={i.id}
            income={i}
            personOptions={personOptions}
            accountOptions={accountOptions('Cash flow')}
            patch={(x) => incomes.patch(i.id, x)}
            remove={() => incomes.remove(i.id)}
          />
        ))}
        <div class="btn-row">
          <button type="button" class="btn btn--ghost" onClick={() => incomes.add(newIncome({ name: 'Monthly income', startDate }))}>
            + Monthly income
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => incomes.add(newIncome({ name: 'Lump sum', kind: 'lump', amount: 50000, startDate, survivorPct: 100 }))}>
            + Lump sum
          </button>
          <button
            type="button"
            class="btn btn--ghost"
            onClick={() => incomes.add(newIncome({ name: 'Life insurance', kind: 'death-benefit', amount: 250000, taxable: false, ownerId: s.people[0]?.id ?? '' }))}
          >
            + Life insurance
          </button>
        </div>
      </Section>

      <Section title="Taxes & market" defaultOpen={false} summary={s.marketOverride ? 'Custom market' : 'Plan market'}>
        <div class="grid">
          <NumField label="Ordinary income tax" hint="Effective rate on taxable income and traditional IRA/401(k) withdrawals." value={s.taxes.ordinaryRate} suffix="%" min={0} max={95} onChange={(ordinaryRate) => update((x) => ({ ...x, taxes: { ...x.taxes, ordinaryRate } }))} />
          <NumField label="Taxable-account withdrawals" hint="Effective tax per dollar withdrawn from a brokerage account (capital gains on the gain portion)." value={s.taxes.taxableWithdrawalRate} suffix="%" min={0} max={95} onChange={(taxableWithdrawalRate) => update((x) => ({ ...x, taxes: { ...x.taxes, taxableWithdrawalRate } }))} />
          <NumField label="Taxable share of Social Security" value={s.taxes.ssTaxablePct} suffix="%" min={0} max={100} onChange={(ssTaxablePct) => update((x) => ({ ...x, taxes: { ...x.taxes, ssTaxablePct } }))} />
        </div>
        <CheckField
          label="Override plan market assumptions for this scenario"
          checked={s.marketOverride !== null}
          onChange={(on) => update((x) => ({ ...x, marketOverride: on ? { ...defaultMarket() } : null }))}
        />
        {s.marketOverride && (
          <MarketFields market={s.marketOverride} onChange={(m) => update((x) => ({ ...x, marketOverride: m }))} />
        )}
      </Section>
    </div>
  );
}

function PersonRow(props: { person: Person; startDate: string; patch: (p: Partial<Person>) => void; remove: () => void }) {
  const { person: p, patch } = props;
  let age = '';
  try {
    age = `age ${Math.floor(ageAt(p.birthDate, props.startDate))}`;
  } catch {
    /* invalid date while typing */
  }
  return (
    <Row label={p.name} onRemove={props.remove}>
      <TextField label="Name" value={p.name} onChange={(name) => patch({ name })} />
      <MonthField label={`Born${age ? ` (${age})` : ''}`} value={p.birthDate} onChange={(birthDate) => patch({ birthDate })} />
      <NumField label="Life expectancy" hint="Age at death in fixed mortality mode; expected age at death in random mortality mode." value={p.lifeExpectancy} suffix="yrs" min={1} max={120} onChange={(lifeExpectancy) => patch({ lifeExpectancy })} />
      <NumField label="Social Security at" value={p.ssClaimAge} suffix="yrs" min={62} max={70} onChange={(ssClaimAge) => patch({ ssClaimAge })} />
      <NumField label="SS benefit / mo" hint="Monthly benefit at the claim age above, in today's dollars (see your SSA statement)." value={p.ssMonthlyBenefit} prefix="$" min={0} onChange={(ssMonthlyBenefit) => patch({ ssMonthlyBenefit })} />
    </Row>
  );
}

function AccountRow(props: { account: Account; patch: (a: Partial<Account>) => void; remove: () => void }) {
  const { account: a, patch } = props;
  return (
    <Row label={a.name} onRemove={props.remove}>
      <TextField label="Name" value={a.name} onChange={(name) => patch({ name })} />
      <SelectField
        label="Type"
        value={a.type}
        options={(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t] }))}
        onChange={(type) => patch({ type, withdrawalPriority: DEFAULT_WITHDRAWAL_PRIORITY[type], stockPct: type === 'cash' ? 0 : a.stockPct })}
      />
      <NumField label="Balance" value={a.balance} prefix="$" min={0} onChange={(balance) => patch({ balance })} />
      {a.type !== 'cash' && <NumField label="Stocks" hint="Rest is in bonds. Rebalanced monthly." value={a.stockPct} suffix="%" min={0} max={100} onChange={(stockPct) => patch({ stockPct })} />}
      <NumField label="Withdraw order" value={a.withdrawalPriority} min={0} onChange={(withdrawalPriority) => patch({ withdrawalPriority })} />
    </Row>
  );
}

function LoanRow(props: { loan: Loan; patch: (l: Partial<Loan>) => void; remove: () => void }) {
  const { loan: l, patch } = props;
  return (
    <Row label={l.name} onRemove={props.remove}>
      <TextField label="Name" value={l.name} onChange={(name) => patch({ name })} />
      <NumField label="Balance" value={l.balance} prefix="$" min={0} onChange={(balance) => patch({ balance })} />
      <NumField label="Interest" value={l.annualRate} suffix="%" min={0} onChange={(annualRate) => patch({ annualRate })} />
      <NumField label="Payment / mo" value={l.monthlyPayment} prefix="$" min={0} onChange={(monthlyPayment) => patch({ monthlyPayment })} />
      <MonthField label="Pay off early in" value={l.payoffDate} optional placeholder="—" onChange={(payoffDate) => patch({ payoffDate })} />
    </Row>
  );
}

function ExpenseRow(props: { expense: Expense; patch: (e: Partial<Expense>) => void; remove: () => void }) {
  const { expense: e, patch } = props;
  const [open, setOpen] = useState(Boolean(e.startDate || e.endDate || e.frequency === 'once' || !e.inflationAdjusted));
  return (
    <Row label={e.name} onRemove={props.remove}>
      <TextField label="Expense" value={e.name} onChange={(name) => patch({ name })} />
      <NumField label="Amount" value={e.amount} prefix="$" min={0} onChange={(amount) => patch({ amount })} />
      <SelectField
        label="Every"
        value={e.frequency}
        options={[
          { value: 'monthly', label: 'Month' },
          { value: 'annual', label: 'Year' },
          { value: 'once', label: 'Once' },
        ]}
        onChange={(frequency) => {
          patch({ frequency });
          if (frequency === 'once') setOpen(true);
        }}
      />
      {open ? (
        <>
          <MonthField label={e.frequency === 'once' ? 'In' : 'From'} value={e.startDate} optional={e.frequency !== 'once'} placeholder="Now" onChange={(startDate) => patch({ startDate })} />
          {e.frequency !== 'once' && <MonthField label="Until" value={e.endDate} optional placeholder="Forever" onChange={(endDate) => patch({ endDate })} />}
          <CheckField label="Grows with inflation" checked={e.inflationAdjusted} onChange={(inflationAdjusted) => patch({ inflationAdjusted })} />
        </>
      ) : (
        <button type="button" class="link-btn" onClick={() => setOpen(true)}>
          Dates & inflation…
        </button>
      )}
    </Row>
  );
}

function IncomeRow(props: {
  income: Income;
  personOptions: { value: string; label: string }[];
  accountOptions: { value: string; label: string }[];
  patch: (i: Partial<Income>) => void;
  remove: () => void;
}) {
  const { income: i, patch } = props;
  return (
    <Row label={i.name} onRemove={props.remove}>
      <TextField label="Name" value={i.name} onChange={(name) => patch({ name })} />
      <SelectField
        label="Type"
        value={i.kind}
        options={[
          { value: 'monthly', label: 'Monthly payments' },
          { value: 'lump', label: 'Lump sum' },
          { value: 'death-benefit', label: 'Paid at owner’s death' },
        ]}
        onChange={(kind) => patch({ kind })}
      />
      <NumField label={i.kind === 'monthly' ? 'Amount / mo' : 'Amount'} value={i.amount} prefix="$" min={0} onChange={(amount) => patch({ amount })} />
      {i.kind !== 'death-benefit' && <MonthField label={i.kind === 'lump' ? 'Paid in' : 'Starts'} value={i.startDate} onChange={(startDate) => patch({ startDate })} />}
      {i.kind === 'monthly' && <MonthField label="Ends" value={i.endDate} optional placeholder="Lifetime" onChange={(endDate) => patch({ endDate })} />}
      <SelectField label="Owner" hint="Payments depend on this person being alive." value={i.ownerId} options={props.personOptions} onChange={(ownerId) => patch({ ownerId })} />
      {i.kind !== 'death-benefit' && i.ownerId && (
        <NumField label="Survivor gets" hint="Share that continues to the survivor after the owner dies (0% = stops, 100% = full survivorship)." value={i.survivorPct} suffix="%" min={0} max={100} onChange={(survivorPct) => patch({ survivorPct })} />
      )}
      <SelectField label="Deposit to" value={i.depositToId} options={props.accountOptions} onChange={(depositToId) => patch({ depositToId })} />
      <CheckField label="Taxable" checked={i.taxable} onChange={(taxable) => patch({ taxable })} />
      <CheckField label="Inflation-adjusted" checked={i.inflationAdjusted} onChange={(inflationAdjusted) => patch({ inflationAdjusted })} />
    </Row>
  );
}
