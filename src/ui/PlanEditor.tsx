import type { ComponentChildren } from 'preact';
import { ageAt, fromMonthIndex, isYearMonth, toMonthIndex } from '../model/dates';
import {
  ACCOUNT_TYPE_LABELS,
  DEFAULT_WITHDRAWAL_PRIORITY,
  expenseChoice,
  incomeChoice,
  newAccount,
  newExpense,
  newIncome,
  newLoan,
  newOption,
  newPerson,
  newPhase,
} from '../model/defaults';
import { chosenOption, describeWhen, ssBenefit } from '../model/resolve';
import { formatAge, fullRetirementAge, MAX_CLAIM_AGE, MIN_CLAIM_AGE } from '../model/socialSecurity';
import type {
  Account,
  AccountType,
  Expense,
  ExpenseChoice,
  Household,
  Income,
  IncomeChoice,
  Loan,
  Option,
  Person,
  Scenario,
} from '../model/types';
import { AgeField, CheckField, MonthField, NumField, SelectField, TextField } from './fields';
import { money } from './format';
import { OptionTabs, type Usage } from './OptionTabs';
import { WhenField } from './WhenField';

type UpdateHousehold = (fn: (h: Household) => Household) => void;
type ListKey = 'people' | 'accounts' | 'loans' | 'expenses' | 'incomes';

export function Section(props: { title: string; summary?: string; description?: string; defaultOpen?: boolean; children: ComponentChildren }) {
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

function Item(props: { label: string; onRemove: () => void; fields: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="item">
      <div class="row">
        <div class="row__fields">{props.fields}</div>
        <button type="button" class="icon-btn row__remove" title={`Remove ${props.label}`} aria-label={`Remove ${props.label}`} onClick={props.onRemove}>
          ×
        </button>
      </div>
      {props.children}
    </div>
  );
}

/** Which scenarios pick which option, for the colored dots on option chips. */
function buildUsage(h: Household, scenarios: Scenario[]): Usage {
  const map = new Map<string, { name: string; colorSlot: number }[]>();
  const note = (key: string, options: Option<unknown>[]) => {
    for (const s of scenarios) {
      const o = chosenOption(options, s, key);
      if (!o) continue;
      const list = map.get(o.id) ?? [];
      list.push({ name: s.name, colorSlot: s.colorSlot });
      map.set(o.id, list);
    }
  };
  h.people.forEach((p) => note(p.id, p.ssOptions));
  h.accounts.forEach((a) => note(a.id, a.options));
  h.loans.forEach((l) => note(l.id, l.options));
  h.expenses.forEach((e) => note(e.id, e.options));
  h.incomes.forEach((i) => note(i.id, i.options));
  return map;
}

export function PlanEditor(props: { household: Household; scenarios: Scenario[]; startDate: string; update: UpdateHousehold }) {
  const { household: h, scenarios, startDate, update } = props;
  const usage = buildUsage(h, scenarios);

  function ops<K extends ListKey>(key: K) {
    type It = Household[K][number];
    return {
      patch: (id: string, patch: Partial<It>) =>
        update((x) => ({ ...x, [key]: (x[key] as It[]).map((it) => (it.id === id ? { ...it, ...patch } : it)) })),
      remove: (id: string) => update((x) => ({ ...x, [key]: (x[key] as It[]).filter((it) => it.id !== id) })),
      add: (item: It) => update((x) => ({ ...x, [key]: [...(x[key] as It[]), item] })),
    };
  }
  const people = ops('people');
  const accounts = ops('accounts');
  const loans = ops('loans');
  const expenses = ops('expenses');
  const incomes = ops('incomes');

  const personOptions = [{ value: '', label: 'Household' }, ...h.people.map((p) => ({ value: p.id, label: p.name }))];
  const accountOptions = (empty: string) => [{ value: '', label: empty }, ...h.accounts.map((a) => ({ value: a.id, label: a.name }))];
  const firstBalance = (a: Account) => a.options.find((o) => !o.off)?.value.balance ?? 0;
  const byType = (types: AccountType[]) => h.accounts.filter((a) => types.includes(a.type)).reduce((s, a) => s + firstBalance(a), 0);
  const totalDebt = h.loans.reduce((s, l) => s + l.balance, 0);
  const monthlyNow = h.expenses.reduce((sum, e) => {
    const c = e.options.find((o) => !o.off)?.value;
    if (!c || c.frequency === 'once') return sum;
    return sum + (c.phases[0]?.amount ?? 0) / (c.frequency === 'annual' ? 12 : 1);
  }, 0);

  return (
    <div class="editor">
      <Section title="People & Social Security" summary={h.people.map((p) => p.name).join(' · ') || 'None'} description="Enter the benefit from your SSA statement at any age. Other claim ages are derived with SSA's early-reduction and delayed-credit rules; add several claim-age options to compare them, or use the claiming solver.">
        {h.people.map((p) => (
          <PersonItem key={p.id} person={p} startDate={startDate} usage={usage} patch={(x) => people.patch(p.id, x)} remove={() => people.remove(p.id)} />
        ))}
        <button type="button" class="btn btn--ghost" onClick={() => people.add(newPerson({ name: `Person ${String.fromCharCode(65 + h.people.length)}` }))}>
          + Add person
        </button>
      </Section>

      <Section
        title="Cash & retirement accounts"
        summary={`Cash ${money(byType(['cash']))} · Pre-tax ${money(byType(['traditional']))} · Post-tax ${money(byType(['taxable', 'roth', 'hsa']))}`}
        description="Starting balances. Withdrawals come from the lowest order number first when spending exceeds income."
      >
        {h.accounts.map((a) => (
          <AccountItem key={a.id} account={a} usage={usage} patch={(x) => accounts.patch(a.id, x)} remove={() => accounts.remove(a.id)} />
        ))}
        <div class="btn-row">
          {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((type) => (
            <button type="button" class="btn btn--ghost" key={type} onClick={() => accounts.add(newAccount(type))}>
              + {ACCOUNT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
        <SelectField label="Deposit monthly surpluses into" value={h.surplusAccountId} options={accountOptions('First cash account')} onChange={(surplusAccountId) => update((x) => ({ ...x, surplusAccountId }))} />
      </Section>

      <Section title="Loans & debts" summary={`${money(totalDebt)} owed`} description="Payments count as spending until the balance is gone. Add a “pay off” option to compare paying a loan off from savings.">
        {h.loans.map((l) => (
          <LoanItem key={l.id} loan={l} startDate={startDate} usage={usage} patch={(x) => loans.patch(l.id, x)} remove={() => loans.remove(l.id)} />
        ))}
        <button type="button" class="btn btn--ghost" onClick={() => loans.add(newLoan())}>
          + Add loan
        </button>
      </Section>

      <Section title="Expenses" summary={`${money(monthlyNow)}/mo now`} description="Today's dollars. Amounts can change over time — e.g. private insurance until someone turns 65, then Medicare. An expense with an owner stops when they die.">
        {h.expenses.map((e) => (
          <ExpenseItem
            key={e.id}
            expense={e}
            people={h.people}
            personOptions={personOptions}
            startDate={startDate}
            usage={usage}
            patch={(x) => expenses.patch(e.id, x)}
            remove={() => expenses.remove(e.id)}
          />
        ))}
        <div class="btn-row">
          <button type="button" class="btn btn--ghost" onClick={() => expenses.add(newExpense('Monthly expense'))}>
            + Monthly
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => expenses.add(newExpense('Annual expense', expenseChoice('annual', [newPhase(3000)])))}>
            + Annual
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => expenses.add(newExpense('One-time expense', expenseChoice('once', [newPhase(10000, { type: 'date', date: startDate })])))}>
            + One-time
          </button>
          {h.people.length > 0 && (
            <button
              type="button"
              class="btn btn--ghost"
              onClick={() =>
                h.people.forEach((p) =>
                  expenses.add(
                    newExpense(`Health insurance — ${p.name}`, expenseChoice('monthly', [newPhase(850), newPhase(380, { type: 'age', personId: p.id, age: 65 })]), {
                      ownerId: p.id,
                    }),
                  ),
                )
              }
            >
              + Insurance → Medicare
            </button>
          )}
        </div>
        <NumField
          label="Household spending after first death"
          hint="In a household of two or more, expenses without an owner scale to this % once someone dies."
          value={h.survivorExpensePct}
          suffix="%"
          min={0}
          max={200}
          onChange={(survivorExpensePct) => update((x) => ({ ...x, survivorExpensePct }))}
        />
      </Section>

      <Section title="Income & events" summary={`${h.incomes.length} item${h.incomes.length === 1 ? '' : 's'}`} description="Severance, pensions, salary, annuities, inheritances, life insurance. Add options (e.g. lump sum vs. N monthly payments) to compare them across scenarios.">
        {h.incomes.map((i) => (
          <IncomeItem
            key={i.id}
            income={i}
            people={h.people}
            personOptions={personOptions}
            accountOptions={accountOptions('Cash flow')}
            startDate={startDate}
            usage={usage}
            patch={(x) => incomes.patch(i.id, x)}
            remove={() => incomes.remove(i.id)}
          />
        ))}
        <div class="btn-row">
          <button type="button" class="btn btn--ghost" onClick={() => incomes.add(newIncome('Monthly income', [newOption('Monthly', incomeChoice('monthly'))]))}>
            + Monthly income
          </button>
          <button
            type="button"
            class="btn btn--ghost"
            onClick={() =>
              incomes.add(
                newIncome(
                  'Severance',
                  [
                    newOption('Lump sum', incomeChoice('lump', { amount: 90000, start: { type: 'date', date: startDate } })),
                    newOption('Monthly × 12', incomeChoice('monthly', { amount: 7500, start: { type: 'date', date: startDate }, payments: 12, survivorPct: 100 })),
                  ],
                  { ownerId: h.people[0]?.id ?? '' },
                ),
              )
            }
          >
            + Severance (lump vs. monthly)
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => incomes.add(newIncome('Lump sum', [newOption('Lump sum', incomeChoice('lump', { start: { type: 'date', date: startDate } }))]))}>
            + Lump sum
          </button>
          <button
            type="button"
            class="btn btn--ghost"
            onClick={() => incomes.add(newIncome('Life insurance', [newOption('Policy', incomeChoice('death-benefit', { amount: 250000 }))], { ownerId: h.people[0]?.id ?? '' }))}
          >
            + Life insurance
          </button>
        </div>
      </Section>
    </div>
  );
}

function PersonItem(props: { person: Person; startDate: string; usage: Usage; patch: (p: Partial<Person>) => void; remove: () => void }) {
  const { person: p, patch } = props;
  const valid = isYearMonth(p.birthDate);
  const age = valid ? ageAt(p.birthDate, props.startDate) : 0;
  const fra = valid ? fullRetirementAge(+p.birthDate.slice(0, 4)) : 67;
  const addAge = (claimAge: number) =>
    patch({ ssOptions: [...p.ssOptions, newOption(`Claim at ${formatAge(claimAge)}`, { claimAge, monthlyBenefit: 0, auto: true })] });
  const has = (a: number) => p.ssOptions.some((o) => Math.abs(o.value.claimAge - a) < 1e-6);
  return (
    <Item
      label={p.name}
      onRemove={props.remove}
      fields={
        <>
          <TextField label="Name" value={p.name} onChange={(name) => patch({ name })} />
          <MonthField label={`Born${valid ? ` (age ${Math.floor(age)})` : ''}`} value={p.birthDate} onChange={(birthDate) => patch({ birthDate })} />
          <NumField label="Life expectancy" hint="Age at death in fixed mortality mode; expected age at death in random mortality mode." value={p.lifeExpectancy} suffix="yrs" min={1} max={120} onChange={(lifeExpectancy) => patch({ lifeExpectancy })} />
          <NumField label="SS benefit / mo" hint="From your SSA statement, in today's dollars." value={p.ssKnownBenefit} prefix="$" min={0} onChange={(ssKnownBenefit) => patch({ ssKnownBenefit })} />
          <AgeField label="…if claiming at" hint={`Full retirement age is ${formatAge(fra)}.`} value={p.ssKnownAge} min={MIN_CLAIM_AGE} max={MAX_CLAIM_AGE} onChange={(ssKnownAge) => patch({ ssKnownAge })} />
        </>
      }
    >
      <OptionTabs
        options={p.ssOptions}
        onChange={(ssOptions) => patch({ ssOptions })}
        usage={props.usage}
        nextLabel={() => 'Claim at 70'}
        addLabel="+ Claim-age option"
        allowOff
        offValue={() => ({ claimAge: 67, monthlyBenefit: 0, auto: true })}
        extraActions={[62, fra, 70]
          .filter((a) => !has(a))
          .map((a) => (
            <button key={a} type="button" class="link-btn" onClick={() => addAge(a)}>
              + {formatAge(a)}
            </button>
          ))}
      >
        {(opt, set) => (
          <div class="option-body">
            <AgeField
              label="Claim Social Security at"
              value={opt.value.claimAge}
              min={MIN_CLAIM_AGE}
              max={MAX_CLAIM_AGE}
              onChange={(claimAge) => {
                // Keep auto-generated labels ("Claim at 67") in sync with the age.
                if (/^Claim at/.test(opt.label)) {
                  patch({ ssOptions: p.ssOptions.map((o) => (o.id === opt.id ? { ...o, label: `Claim at ${formatAge(claimAge)}`, value: { ...o.value, claimAge } } : o)) });
                } else set({ claimAge });
              }}
            />
            {opt.value.auto ? (
              <div class="derived">
                <span class="field__label">Benefit</span>
                <strong>{money(ssBenefit(p, opt.value))}/mo</strong>
                <button type="button" class="link-btn" onClick={() => set({ auto: false, monthlyBenefit: ssBenefit(p, opt.value) })}>
                  override
                </button>
              </div>
            ) : (
              <div class="derived">
                <NumField label="Benefit / mo" value={opt.value.monthlyBenefit} prefix="$" min={0} onChange={(monthlyBenefit) => set({ monthlyBenefit })} />
                <button type="button" class="link-btn" onClick={() => set({ auto: true })}>
                  use calculated
                </button>
              </div>
            )}
          </div>
        )}
      </OptionTabs>
    </Item>
  );
}

function AccountItem(props: { account: Account; usage: Usage; patch: (a: Partial<Account>) => void; remove: () => void }) {
  const { account: a, patch } = props;
  return (
    <Item
      label={a.name}
      onRemove={props.remove}
      fields={
        <>
          <TextField label="Name" value={a.name} onChange={(name) => patch({ name })} />
          <SelectField
            label="Type"
            value={a.type}
            options={(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t] }))}
            onChange={(type) => patch({ type, withdrawalPriority: DEFAULT_WITHDRAWAL_PRIORITY[type], stockPct: type === 'cash' ? 0 : a.stockPct || 60 })}
          />
          {a.type !== 'cash' && <NumField label="Stocks" hint="Rest is in bonds. Rebalanced monthly." value={a.stockPct} suffix="%" min={0} max={100} onChange={(stockPct) => patch({ stockPct })} />}
          <NumField label="Withdraw order" value={a.withdrawalPriority} min={0} onChange={(withdrawalPriority) => patch({ withdrawalPriority })} />
        </>
      }
    >
      <OptionTabs options={a.options} onChange={(options) => patch({ options })} usage={props.usage} nextLabel={(n) => `Balance ${n}`} addLabel="+ Alternative balance" allowOff offValue={() => ({ balance: 0 })}>
        {(opt, set) => (
          <div class="option-body">
            <NumField label="Starting balance" value={opt.value.balance} prefix="$" min={0} onChange={(balance) => set({ balance })} />
          </div>
        )}
      </OptionTabs>
    </Item>
  );
}

function LoanItem(props: { loan: Loan; startDate: string; usage: Usage; patch: (l: Partial<Loan>) => void; remove: () => void }) {
  const { loan: l, patch } = props;
  const hasPayoff = l.options.some((o) => o.value.payoffDate);
  return (
    <Item
      label={l.name}
      onRemove={props.remove}
      fields={
        <>
          <TextField label="Name" value={l.name} onChange={(name) => patch({ name })} />
          <NumField label="Balance" value={l.balance} prefix="$" min={0} onChange={(balance) => patch({ balance })} />
          <NumField label="Interest" value={l.annualRate} suffix="%" min={0} onChange={(annualRate) => patch({ annualRate })} />
          <NumField label="Payment / mo" value={l.monthlyPayment} prefix="$" min={0} onChange={(monthlyPayment) => patch({ monthlyPayment })} />
        </>
      }
    >
      <OptionTabs
        options={l.options}
        onChange={(options) => patch({ options })}
        usage={props.usage}
        nextLabel={() => 'Pay off now'}
        addLabel={hasPayoff ? '+ Add option' : '+ “Pay off” option'}
        allowOff
        offValue={() => ({ payoffDate: '' })}
      >
        {(opt, set) => (
          <div class="option-body">
            <SelectField
              label="Plan"
              value={opt.value.payoffDate ? 'payoff' : 'keep'}
              options={[
                { value: 'keep', label: 'Keep paying on schedule' },
                { value: 'payoff', label: 'Pay off from savings' },
              ]}
              onChange={(v) => set({ payoffDate: v === 'payoff' ? fromMonthIndex(toMonthIndex(props.startDate) + 1) : '' })}
            />
            {opt.value.payoffDate && <MonthField label="Pay off in" value={opt.value.payoffDate} onChange={(payoffDate) => set({ payoffDate })} />}
          </div>
        )}
      </OptionTabs>
    </Item>
  );
}

function ExpenseItem(props: {
  expense: Expense;
  people: Person[];
  personOptions: { value: string; label: string }[];
  startDate: string;
  usage: Usage;
  patch: (e: Partial<Expense>) => void;
  remove: () => void;
}) {
  const { expense: e, patch, people } = props;
  return (
    <Item
      label={e.name}
      onRemove={props.remove}
      fields={
        <>
          <TextField label="Expense" value={e.name} onChange={(name) => patch({ name })} />
          <SelectField label="Owner" hint="Stops when this person dies. Household expenses scale down after a death instead." value={e.ownerId} options={props.personOptions} onChange={(ownerId) => patch({ ownerId })} />
          <CheckField label="Grows with inflation" checked={e.inflationAdjusted} onChange={(inflationAdjusted) => patch({ inflationAdjusted })} />
        </>
      }
    >
      <OptionTabs
        options={e.options}
        onChange={(options) => patch({ options })}
        usage={props.usage}
        nextLabel={(n) => `Amount ${n}`}
        addLabel="+ Alternative amount"
        allowOff
        offValue={() => expenseChoice('monthly', [newPhase(0)])}
      >
        {(opt, set) => <ExpensePhases choice={opt.value} people={people} startDate={props.startDate} set={set} />}
      </OptionTabs>
    </Item>
  );
}

function ExpensePhases(props: { choice: ExpenseChoice; people: Person[]; startDate: string; set: (c: Partial<ExpenseChoice>) => void }) {
  const { choice: c, people, set } = props;
  const once = c.frequency === 'once';
  const patchPhase = (id: string, patch: Partial<ExpenseChoice['phases'][number]>) =>
    set({ phases: c.phases.map((ph) => (ph.id === id ? { ...ph, ...patch } : ph)) });
  const unit = c.frequency === 'monthly' ? '/mo' : c.frequency === 'annual' ? '/yr' : '';
  const summary = once
    ? c.phases.map((ph) => `${money(ph.amount)} ${describeWhen(ph.from, people)}`).join(', ')
    : c.phases.map((ph, i) => `${money(ph.amount)}${unit}${i === 0 ? '' : ` from ${describeWhen(ph.from, people)}`}`).join(' → ') +
      (c.until.type === 'never' ? '' : ` until ${describeWhen(c.until, people)}`);

  const [first, ...later] = c.phases;
  const removeButton = (id: string) =>
    c.phases.length > 1 && (
      <button type="button" class="icon-btn phase__remove" aria-label="Remove step" onClick={() => set({ phases: c.phases.filter((x) => x.id !== id) })}>
        ×
      </button>
    );
  const frequencySelect = (
    <SelectField
      label="Every"
      value={c.frequency}
      options={[
        { value: 'monthly', label: 'Month' },
        { value: 'annual', label: 'Year' },
        { value: 'once', label: 'Once' },
      ]}
      onChange={(frequency) =>
        set({ frequency, phases: frequency === 'once' ? c.phases.map((ph) => (ph.from.type === 'start' ? { ...ph, from: { type: 'date', date: props.startDate } } : ph)) : c.phases })
      }
    />
  );

  return (
    <div class="option-body option-body--column">
      {once ? (
        c.phases.map((ph, i) => (
          <div class="phase-grid" key={ph.id}>
            {i === 0 ? frequencySelect : <span />}
            <NumField label="Amount" value={ph.amount} prefix="$" min={0} onChange={(amount) => patchPhase(ph.id, { amount })} />
            <WhenField label="When" value={ph.from} people={people} defaultDate={props.startDate} modes={['start', 'date', 'age']} onChange={(from) => patchPhase(ph.id, { from })} />
            {removeButton(ph.id)}
          </div>
        ))
      ) : (
        <>
          <div class="phase-grid">
            {frequencySelect}
            <NumField label={later.length ? `Amount${unit} now` : `Amount${unit}`} value={first.amount} prefix="$" min={0} onChange={(amount) => patchPhase(first.id, { amount })} />
            <WhenField label="Ends" value={c.until} people={people} defaultDate={props.startDate} modes={['never', 'date', 'age']} onChange={(until) => set({ until })} />
            {removeButton(first.id)}
          </div>
          {later.map((ph) => (
            <div class="phase-grid" key={ph.id}>
              <span class="phase__step">then</span>
              <NumField label={`Amount${unit}`} value={ph.amount} prefix="$" min={0} onChange={(amount) => patchPhase(ph.id, { amount })} />
              <WhenField label="Starting" value={ph.from} people={people} defaultDate={props.startDate} modes={['date', 'age']} onChange={(from) => patchPhase(ph.id, { from })} />
              {removeButton(ph.id)}
            </div>
          ))}
        </>
      )}
      <div class="phase-foot">
        <button
          type="button"
          class="link-btn"
          onClick={() =>
            set({
              phases: [
                ...c.phases,
                newPhase(c.phases[c.phases.length - 1]?.amount ?? 0, people[0] ? { type: 'age', personId: people[0].id, age: 65 } : { type: 'date', date: props.startDate }),
              ],
            })
          }
        >
          {once ? '+ Another occurrence' : '+ Change amount later'}
        </button>
        {c.phases.length > 1 && <span class="muted phase-summary">{summary}</span>}
      </div>
    </div>
  );
}

function IncomeItem(props: {
  income: Income;
  people: Person[];
  personOptions: { value: string; label: string }[];
  accountOptions: { value: string; label: string }[];
  startDate: string;
  usage: Usage;
  patch: (i: Partial<Income>) => void;
  remove: () => void;
}) {
  const { income: inc, patch, people } = props;
  return (
    <Item
      label={inc.name}
      onRemove={props.remove}
      fields={
        <>
          <TextField label="Name" value={inc.name} onChange={(name) => patch({ name })} />
          <SelectField label="Owner" hint="Payments depend on this person being alive." value={inc.ownerId} options={props.personOptions} onChange={(ownerId) => patch({ ownerId })} />
        </>
      }
    >
      <OptionTabs
        options={inc.options}
        onChange={(options) => patch({ options })}
        usage={props.usage}
        nextLabel={(n) => `Option ${n}`}
        allowOff
        offValue={() => incomeChoice('monthly', { amount: 0 })}
      >
        {(opt, set) => <IncomeFields choice={opt.value} set={set} people={people} hasOwner={!!inc.ownerId} accountOptions={props.accountOptions} startDate={props.startDate} />}
      </OptionTabs>
    </Item>
  );
}

function IncomeFields(props: {
  choice: IncomeChoice;
  set: (c: Partial<IncomeChoice>) => void;
  people: Person[];
  hasOwner: boolean;
  accountOptions: { value: string; label: string }[];
  startDate: string;
}) {
  const { choice: v, set, people } = props;
  const total = v.kind === 'monthly' && v.payments > 0 ? v.amount * v.payments : null;
  return (
    <div class="option-body">
      <SelectField
        label="Paid as"
        value={v.kind}
        options={[
          { value: 'monthly', label: 'Monthly payments' },
          { value: 'lump', label: 'Lump sum' },
          { value: 'death-benefit', label: 'Lump sum at owner’s death' },
        ]}
        onChange={(kind) => set({ kind })}
      />
      <NumField label={v.kind === 'monthly' ? 'Amount / mo' : 'Amount'} value={v.amount} prefix="$" min={0} onChange={(amount) => set({ amount })} />
      {v.kind !== 'death-benefit' && (
        <WhenField label={v.kind === 'lump' ? 'Paid' : 'Starts'} value={v.start} people={people} defaultDate={props.startDate} modes={['start', 'date', 'age']} onChange={(start) => set({ start })} />
      )}
      {v.kind === 'monthly' && (
        <NumField label="# of payments" hint="0 = until the end date below (or for life)." value={v.payments} min={0} onChange={(payments) => set({ payments: Math.round(payments) })} />
      )}
      {v.kind === 'monthly' && v.payments === 0 && (
        <WhenField label="Ends" value={v.end} people={people} defaultDate={props.startDate} modes={['never', 'date', 'age']} onChange={(end) => set({ end })} />
      )}
      {v.kind !== 'death-benefit' && props.hasOwner && (
        <NumField label="Survivor gets" hint="Share that continues after the owner dies (0% = stops, 100% = full survivorship)." value={v.survivorPct} suffix="%" min={0} max={100} onChange={(survivorPct) => set({ survivorPct })} />
      )}
      <SelectField label="Deposit to" value={v.depositToId} options={props.accountOptions} onChange={(depositToId) => set({ depositToId })} />
      <CheckField label="Taxable" checked={v.taxable} onChange={(taxable) => set({ taxable })} />
      {v.kind === 'monthly' && <CheckField label="Inflation-adjusted" checked={v.inflationAdjusted} onChange={(inflationAdjusted) => set({ inflationAdjusted })} />}
      {total !== null && <div class="derived muted">Total {money(total)}</div>}
      {v.kind !== 'monthly' && v.start.type === 'start' && v.kind === 'lump' && <div class="derived muted">Paid at plan start</div>}
    </div>
  );
}

