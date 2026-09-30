import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { isYearMonth } from '../model/dates';

interface LabelProps {
  label: string;
  hint?: string;
  wide?: boolean;
  extraClass?: string;
  children: ComponentChildren;
}

export function Field({ label, hint, wide, extraClass, children }: LabelProps) {
  return (
    <label class={`field${wide ? ' field--wide' : ''}${extraClass ? ` ${extraClass}` : ''}`} title={hint}>
      <span class="field__label">
        {label}
        {hint && <span class="field__hint" aria-hidden="true">?</span>}
      </span>
      {children}
    </label>
  );
}

interface NumProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
}

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

/**
 * Numeric input that keeps the user's in-progress text (e.g. "1,2" or "") locally and only
 * commits parseable values. Money-style values are shown with thousands separators.
 */
export function NumField({ label, value, onChange, hint, prefix, suffix, step, min, max }: NumProps) {
  const format = (v: number) => (prefix === '$' ? grouped.format(v) : String(v));
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(format(value));
  }, [value, focused]);

  const commit = (raw: string) => {
    const n = Number(raw.replace(/[,$%\s]/g, ''));
    if (raw.trim() !== '' && Number.isFinite(n)) {
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
      if (clamped !== value) onChange(clamped);
    }
  };

  return (
    <Field label={label} hint={hint}>
      <span class="input-affix">
        {prefix && <span class="input-affix__text">{prefix}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={text}
          step={step}
          onFocus={() => {
            setFocused(true);
            setText(String(value));
          }}
          onBlur={() => {
            setFocused(false);
            setText(format(value));
          }}
          onInput={(e) => {
            const raw = (e.target as HTMLInputElement).value;
            setText(raw);
            commit(raw);
          }}
        />
        {suffix && <span class="input-affix__text">{suffix}</span>}
      </span>
    </Field>
  );
}

export function TextField(props: { label: string; value: string; onChange: (v: string) => void; wide?: boolean; placeholder?: string }) {
  return (
    <Field label={props.label} wide={props.wide}>
      <input
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        onInput={(e) => props.onChange((e.target as HTMLInputElement).value)}
      />
    </Field>
  );
}

/** `YYYY-MM` picker. Uses the native month input where supported; plain text elsewhere. */
export function MonthField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const invalid = text !== '' && !isYearMonth(text);
  return (
    <Field label={props.label} hint={props.hint}>
      <span class="input-affix">
        <input
          type="month"
          value={text}
          placeholder={props.placeholder ?? 'YYYY-MM'}
          aria-invalid={invalid}
          onInput={(e) => {
            const raw = (e.target as HTMLInputElement).value;
            setText(raw);
            if (raw === '' ? props.optional : isYearMonth(raw)) props.onChange(raw);
          }}
        />
        {props.optional && props.value && (
          <button type="button" class="input-affix__clear" title="Clear" onClick={() => props.onChange('')}>
            ×
          </button>
        )}
      </span>
    </Field>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      <select value={props.value} onChange={(e) => props.onChange((e.target as HTMLSelectElement).value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label class="check" title={props.hint}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
      <span>{props.label}</span>
    </label>
  );
}

/** Age as whole years plus months (stored as a decimal: 67.5 = 67 years 6 months). */
export function AgeField(props: { label: string; value: number; onChange: (v: number) => void; hint?: string; min?: number; max?: number }) {
  const years = Math.floor(props.value + 1e-9);
  const months = Math.round((props.value - years) * 12);
  const set = (y: number, m: number) => {
    const v = y + m / 12;
    props.onChange(Math.min(props.max ?? 120, Math.max(props.min ?? 0, v)));
  };
  return (
    <Field label={props.label} hint={props.hint}>
      <span class="age-input">
        <span class="input-affix">
          <input
            type="text"
            inputMode="numeric"
            value={years}
            aria-label={`${props.label} years`}
            onChange={(e) => {
              const y = parseInt((e.target as HTMLInputElement).value, 10);
              if (Number.isFinite(y)) set(y, months);
            }}
          />
          <span class="input-affix__text">y</span>
        </span>
        <select value={months} aria-label={`${props.label} months`} onChange={(e) => set(years, +(e.target as HTMLSelectElement).value)}>
          {Array.from({ length: 12 }, (_, m) => (
            <option key={m} value={m}>
              {m}m
            </option>
          ))}
        </select>
      </span>
    </Field>
  );
}
