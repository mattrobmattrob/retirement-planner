import type { Person, When } from '../model/types';
import { Field } from './fields';

type Mode = When['type'];

/** Pick a moment: now, a calendar month, when someone reaches an age, or never. */
export function WhenField(props: {
  label: string;
  value: When;
  people: Person[];
  onChange: (w: When) => void;
  modes?: Mode[];
  defaultDate: string;
}) {
  const { value, people, onChange } = props;
  const modes = props.modes ?? ['start', 'date', 'age', 'never'];
  const labels: Record<Mode, string> = { start: 'Now', date: 'Month…', age: 'Age…', never: 'Never' };
  const setMode = (mode: Mode) => {
    if (mode === value.type) return;
    if (mode === 'date') onChange({ type: 'date', date: props.defaultDate });
    else if (mode === 'age') onChange({ type: 'age', personId: people[0]?.id ?? '', age: 65 });
    else onChange({ type: mode });
  };
  return (
    <Field label={props.label} extraClass={value.type === 'date' || value.type === 'age' ? 'field--when-wide' : undefined}>
      <span class="when">
        <select value={value.type} onChange={(e) => setMode((e.target as HTMLSelectElement).value as Mode)}>
          {modes.map((m) => (
            <option key={m} value={m} disabled={m === 'age' && people.length === 0}>
              {labels[m]}
            </option>
          ))}
        </select>
        {value.type === 'date' && (
          <input
            type="month"
            value={value.date}
            onInput={(e) => {
              const date = (e.target as HTMLInputElement).value;
              if (/^\d{4}-\d{2}$/.test(date)) onChange({ type: 'date', date });
            }}
          />
        )}
        {value.type === 'age' && (
          <>
            <select value={value.personId} aria-label="Person" onChange={(e) => onChange({ ...value, personId: (e.target as HTMLSelectElement).value })}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              class="when__age"
              type="text"
              inputMode="decimal"
              aria-label="Age"
              value={value.age}
              onChange={(e) => {
                const age = Number((e.target as HTMLInputElement).value);
                if (Number.isFinite(age) && age > 0) onChange({ ...value, age });
              }}
            />
          </>
        )}
      </span>
    </Field>
  );
}
