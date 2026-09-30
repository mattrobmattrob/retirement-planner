import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { allCombinations, combinationCount, defaultMarket, duplicateScenario, newScenario, nextColorSlot } from '../model/defaults';
import { chosenOption, decisions } from '../model/resolve';
import type { Household, Scenario } from '../model/types';
import { CheckField, TextField } from './fields';
import { seriesColor } from './Results';
import { MarketFields } from './SettingsPanel';

const MAX_SCENARIOS = 8;

/**
 * Scenarios as columns, decisions (items with more than one option) as rows: each cell
 * picks which option that scenario uses.
 */
export function ScenarioMatrix(props: {
  household: Household;
  scenarios: Scenario[];
  onChange: (scenarios: Scenario[]) => void;
}) {
  const { household: h, scenarios, onChange } = props;
  const [selectedId, setSelectedId] = useState(scenarios[0]?.id);
  const selected = scenarios.find((s) => s.id === selectedId) ?? scenarios[0];
  const ds = decisions(h);
  const combos = combinationCount(h);

  const patch = (id: string, p: Partial<Scenario>) => onChange(scenarios.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const choose = (s: Scenario, key: string, optionId: string) => patch(s.id, { choices: { ...s.choices, [key]: optionId } });
  const add = (s: Scenario) => {
    onChange([...scenarios, s]);
    setSelectedId(s.id);
  };
  const remove = (id: string) => {
    const rest = scenarios.filter((s) => s.id !== id);
    onChange(rest);
    setSelectedId(rest[0]?.id);
  };
  const move = (id: string, delta: number) => {
    const list = [...scenarios];
    const i = list.findIndex((s) => s.id === id);
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    onChange(list);
  };
  const full = scenarios.length >= MAX_SCENARIOS;

  return (
    <div class="editor">
      <section class="section section--flat">
        <div class="section__body">
          <p class="section__desc section__desc--flush">
            Each scenario picks one option for every item that has alternatives. Add options in the Plan tab (claim ages, lump sum vs. monthly, pay off vs. keep…).
          </p>
          {ds.length === 0 && <p class="muted">No item has more than one option yet, so every scenario is identical.</p>}
          <div class="table-wrap">
            <table class="matrix">
              <thead>
                <tr>
                  <th />
                  {scenarios.map((s) => (
                    <th key={s.id} class={s.id === selected?.id ? 'is-selected' : ''}>
                      <button type="button" class="matrix__head" onClick={() => setSelectedId(s.id)} title="Select to edit name, notes, market">
                        <span class="swatch" style={{ background: seriesColor(s.colorSlot) }} />
                        <span class="matrix__name">{s.name}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ds.map((d, i) => (
                  <Fragment key={d.key}>
                    {(i === 0 || ds[i - 1].group !== d.group) && (
                      <tr class="matrix__group" key={`g-${d.group}`}>
                        <td colSpan={scenarios.length + 1}>{d.group}</td>
                      </tr>
                    )}
                    <tr>
                      <td class="matrix__row">{d.name}</td>
                      {scenarios.map((s) => (
                        <td key={s.id} class={s.id === selected?.id ? 'is-selected' : ''}>
                          <select value={chosenOption(d.options, s, d.key)?.id} onChange={(e) => choose(s, d.key, (e.target as HTMLSelectElement).value)}>
                            {d.options.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                ))}
                <tr class="matrix__group">
                  <td colSpan={scenarios.length + 1}>Market</td>
                </tr>
                <tr>
                  <td class="matrix__row">Assumptions</td>
                  {scenarios.map((s) => (
                    <td key={s.id} class={`muted ${s.id === selected?.id ? 'is-selected' : ''}`}>
                      {s.marketOverride ? 'Custom' : 'Plan default'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn--ghost" disabled={full} onClick={() => add(newScenario({ name: `Scenario ${String.fromCharCode(65 + scenarios.length)}`, colorSlot: nextColorSlot(scenarios) }))}>
              + New scenario
            </button>
            <button
              type="button"
              class="btn btn--ghost"
              disabled={combos < 2 || combos > MAX_SCENARIOS}
              title={combos > MAX_SCENARIOS ? `${combos} combinations — use “Explore all combinations” on the right to rank them all.` : undefined}
              onClick={() => {
                if (window.confirm(`Replace all scenarios with every combination (${combos})?`)) {
                  const next = allCombinations(h);
                  onChange(next);
                  setSelectedId(next[0]?.id);
                }
              }}
            >
              Every combination ({combos})
            </button>
          </div>
          {full && <p class="muted">Up to {MAX_SCENARIOS} scenarios can be compared at once.</p>}
          {combos > MAX_SCENARIOS && (
            <p class="muted">
              {combos.toLocaleString()} combinations is more than the comparison can chart — “Explore all combinations” (right) simulates and ranks all of them.
            </p>
          )}
        </div>
      </section>

      {selected && (
        <section class="section section--flat">
          <div class="section__body">
            <div class="scenario-actions">
              <span class="swatch" style={{ background: seriesColor(selected.colorSlot) }} />
              <strong class="grow">{selected.name}</strong>
              <button type="button" class="btn btn--small" disabled={full} onClick={() => add(duplicateScenario(selected, nextColorSlot(scenarios)))}>
                Duplicate
              </button>
              <button type="button" class="btn btn--small" aria-label="Move left" onClick={() => move(selected.id, -1)}>
                ←
              </button>
              <button type="button" class="btn btn--small" aria-label="Move right" onClick={() => move(selected.id, 1)}>
                →
              </button>
              <button type="button" class="btn btn--small btn--danger" disabled={scenarios.length <= 1} onClick={() => window.confirm(`Delete "${selected.name}"?`) && remove(selected.id)}>
                Delete
              </button>
            </div>
            <TextField label="Scenario name" value={selected.name} wide onChange={(name) => patch(selected.id, { name })} />
            <label class="field field--wide">
              <span class="field__label">Notes</span>
              <textarea rows={2} value={selected.notes} onInput={(e) => patch(selected.id, { notes: (e.target as HTMLTextAreaElement).value })} />
            </label>
            <CheckField
              label="Use custom market assumptions for this scenario"
              checked={selected.marketOverride !== null}
              onChange={(on) => patch(selected.id, { marketOverride: on ? defaultMarket() : null })}
            />
            {selected.marketOverride && <MarketFields market={selected.marketOverride} onChange={(m) => patch(selected.id, { marketOverride: m })} />}
          </div>
        </section>
      )}
    </div>
  );
}
