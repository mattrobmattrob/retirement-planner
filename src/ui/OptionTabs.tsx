import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { cloneOption, newOption } from '../model/defaults';
import type { Option } from '../model/types';
import { seriesColor } from './Results';

export interface Usage {
  /** Option id → color slots of the scenarios that pick it. */
  get(optionId: string): { name: string; colorSlot: number }[] | undefined;
}

/**
 * The alternatives for one item. With a single option it stays out of the way (just an
 * "+ Add option" link); with several, it shows a chip per option and which scenarios use it.
 */
export function OptionTabs<T>(props: {
  options: Option<T>[];
  onChange: (options: Option<T>[]) => void;
  usage: Usage;
  /** Label for a new copy of the active option. */
  nextLabel: (n: number) => string;
  addLabel?: string;
  /** Allow a "Not included" option. */
  allowOff?: boolean;
  offValue?: () => T;
  extraActions?: ComponentChildren;
  children: (option: Option<T>, patch: (value: Partial<T>) => void) => ComponentChildren;
}) {
  const { options, onChange } = props;
  const [activeId, setActiveId] = useState(options[0]?.id);
  const active = options.find((o) => o.id === activeId) ?? options[0];
  if (!active) return null;

  const replace = (next: Option<T>) => onChange(options.map((o) => (o.id === next.id ? next : o)));
  const patch = (value: Partial<T>) => replace({ ...active, value: { ...active.value, ...value } });
  const add = (option: Option<T>) => {
    onChange([...options, option]);
    setActiveId(option.id);
  };
  const remove = (id: string) => {
    const rest = options.filter((o) => o.id !== id);
    onChange(rest);
    setActiveId(rest[0]?.id);
  };

  const addButtons = (
    <span class="option-add">
      <button type="button" class="link-btn" onClick={() => add(cloneOption(active, props.nextLabel(options.length + 1)))}>
        {props.addLabel ?? '+ Add option'}
      </button>
      {props.allowOff && props.offValue && !options.some((o) => o.off) && (
        <button type="button" class="link-btn" onClick={() => add(newOption('Not included', props.offValue!(), true))}>
          + “Not included” option
        </button>
      )}
      {props.extraActions}
    </span>
  );

  return (
    <div class="options">
      {options.length > 1 && (
        <div class="option-tabs" role="tablist">
          {options.map((o) => (
            <button
              type="button"
              role="tab"
              key={o.id}
              class={`option-tab${o.off ? ' option-tab--off' : ''}`}
              aria-selected={o.id === active.id}
              onClick={() => setActiveId(o.id)}
            >
              <span class="option-tab__label">{o.label || 'Untitled'}</span>
              <span class="option-tab__dots">
                {props.usage.get(o.id)?.map((s) => (
                  <span key={s.colorSlot} class="dot" title={s.name} style={{ background: seriesColor(s.colorSlot) }} />
                ))}
              </span>
            </button>
          ))}
        </div>
      )}
      {options.length > 1 && (
        <div class="option-head">
          <label class="field option-head__label">
            <span class="field__label">Option name</span>
            <input type="text" value={active.label} onInput={(e) => replace({ ...active, label: (e.target as HTMLInputElement).value })} />
          </label>
          <button type="button" class="btn btn--small btn--danger" onClick={() => remove(active.id)}>
            Remove option
          </button>
        </div>
      )}
      {active.off ? <p class="muted option-off">Left out of scenarios that pick this option.</p> : props.children(active, patch)}
      {addButtons}
    </div>
  );
}
