import { useEffect, useRef, useState } from 'preact/hooks';
import type { ScenarioResult } from '../engine/simulate';
import type { WorkerRequest, WorkerResponse } from '../engine/worker';
import { blankPlan, duplicateScenario, newOption, newScenario, nextColorSlot, samplePlan } from '../model/defaults';
import { normalizePlan } from '../model/normalize';
import { formatAge } from '../model/socialSecurity';
import type { Household, Person, PlanFile, Scenario } from '../model/types';
import { ExplorePanel, type ScenarioPick } from './ExplorePanel';
import { PlanEditor } from './PlanEditor';
import { Results } from './Results';
import { ScenarioMatrix } from './ScenarioMatrix';
import { SettingsPanel } from './SettingsPanel';
import { SolverPanel, type ApplyClaiming } from './SolverPanel';

const STORAGE_KEY = 'retirement-planner:plan:v2';
const LEGACY_STORAGE_KEYS = ['retirement-planner:plan:v1'];
const MAX_SCENARIOS = 8;

function loadInitialPlan(): PlanFile {
  try {
    for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
      const saved = localStorage.getItem(key);
      if (saved) return normalizePlan(JSON.parse(saved));
    }
  } catch {
    /* storage unavailable or corrupt — fall back to the example */
  }
  return samplePlan();
}

function savePlan(plan: PlanFile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    /* private mode / quota — the plan still lives in memory and can be downloaded */
  }
}

function downloadPlan(plan: PlanFile) {
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `retirement-plan-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Runs the plan in a Web Worker, debounced; a newer plan cancels an in-flight run. */
function useSimulation(plan: PlanFile) {
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      worker.current?.terminate();
      const w = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      const id = ++requestId.current;
      setProgress(0);
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.id !== id) return;
        if (msg.type === 'progress') return setProgress(msg.fraction);
        setProgress(null);
        if (msg.type === 'simulated') {
          setResults(msg.results);
          setElapsed(msg.elapsedMs);
          setError(null);
        } else if (msg.type === 'error') setError(msg.message);
        w.terminate();
        if (worker.current === w) worker.current = null;
      };
      w.onerror = (e) => {
        setProgress(null);
        setError(e.message || 'Simulation failed.');
      };
      w.postMessage({ id, type: 'simulate', plan } satisfies WorkerRequest);
    }, 400);
    return () => clearTimeout(timer);
  }, [plan]);

  useEffect(() => () => worker.current?.terminate(), []);
  return { results, progress, error, elapsed };
}

type Tab = 'plan' | 'scenarios' | 'assumptions';

/**
 * Make sure each person has a claim-age option for the given ages (reusing a matching one),
 * returning the updated people and the option ids to pick.
 */
function ensureClaimOptions(people: Person[], ages: Record<string, number>) {
  const choices: Record<string, string> = {};
  const next = people.map((person) => {
    const age = ages[person.id];
    if (age === undefined) return person;
    let option = person.ssOptions.find((o) => !o.off && o.value.auto && Math.abs(o.value.claimAge - age) < 1e-6);
    if (option) {
      choices[person.id] = option.id;
      return person;
    }
    option = newOption(`Claim at ${formatAge(age)}`, { claimAge: age, monthlyBenefit: 0, auto: true });
    choices[person.id] = option.id;
    return { ...person, ssOptions: [...person.ssOptions, option] };
  });
  return { people: next, choices };
}

export function App() {
  const [plan, setPlan] = useState<PlanFile>(loadInitialPlan);
  const [tab, setTab] = useState<Tab>('plan');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { results, progress, error, elapsed } = useSimulation(plan);

  useEffect(() => savePlan(plan), [plan]);

  const updateHousehold = (fn: (h: Household) => Household) => setPlan((p) => ({ ...p, household: fn(p.household) }));
  const setScenarios = (scenarios: Scenario[]) => setPlan((p) => ({ ...p, scenarios }));

  /** Pick the solver's claim ages, as a new scenario or in place. */
  const applyClaiming: ApplyClaiming = (scenarioId, ages, asNew) =>
    setPlan((p) => {
      const source = p.scenarios.find((s) => s.id === scenarioId);
      if (!source) return p;
      const { people, choices: claimChoices } = ensureClaimOptions(p.household.people, ages);
      const choices = { ...source.choices, ...claimChoices };
      const label = p.household.people
        .filter((person) => ages[person.id] !== undefined)
        .map((person) => `${person.name.replace(/^Person /, '')} ${formatAge(ages[person.id])}`)
        .join(', ');
      const scenarios = asNew
        ? [...p.scenarios, { ...duplicateScenario(source, nextColorSlot(p.scenarios)), name: `${source.name} · SS ${label}`, choices }]
        : p.scenarios.map((s) => (s.id === scenarioId ? { ...s, choices } : s));
      return { ...p, household: { ...p.household, people }, scenarios };
    });

  /** Promote explored combinations into the comparison. */
  const addPicks = (picks: ScenarioPick[]) =>
    setPlan((p) => {
      let people = p.household.people;
      const scenarios = [...p.scenarios];
      for (const pick of picks) {
        if (scenarios.length >= MAX_SCENARIOS) break;
        const ensured = ensureClaimOptions(people, pick.claimAges);
        people = ensured.people;
        scenarios.push(
          newScenario({ name: pick.name, colorSlot: nextColorSlot(scenarios), choices: { ...pick.choices, ...ensured.choices } }),
        );
      }
      return { ...p, household: { ...p.household, people }, scenarios };
    });

  const importFile = async (file: File) => {
    try {
      const next = normalizePlan(JSON.parse(await file.text()));
      setPlan(next);
      setImportError(null);
    } catch (err) {
      setImportError(`Couldn't load ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const resetTo = (next: PlanFile, label: string) => {
    if (!window.confirm(`Replace the current plan with ${label}? Download it first if you want to keep it.`)) return;
    setPlan(next);
    setTab('plan');
  };

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--series-1)" />
            <path d="M7 23l6-7 5 4 7-10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <div>
            <h1>Retirement Planner</h1>
            <p>Monte Carlo scenario comparison · runs entirely in your browser</p>
          </div>
        </div>
        <div class="topbar__actions">
          <button type="button" class="btn" onClick={() => downloadPlan(plan)}>
            Download plan
          </button>
          <button type="button" class="btn" onClick={() => fileInput.current?.click()}>
            Load plan…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              const file = input.files?.[0];
              if (file) void importFile(file);
              input.value = '';
            }}
          />
          <details class="menu">
            <summary class="btn btn--ghost" aria-label="More actions">
              ⋯
            </summary>
            <div class="menu__list">
              <button type="button" onClick={() => resetTo(samplePlan(), 'the example plan')}>
                Load example plan
              </button>
              <button type="button" onClick={() => resetTo(blankPlan(), 'a blank plan')}>
                Start blank plan
              </button>
            </div>
          </details>
        </div>
      </header>
      {importError && (
        <div class="banner banner--error" role="alert">
          {importError}
          <button type="button" class="icon-btn" aria-label="Dismiss" onClick={() => setImportError(null)}>
            ×
          </button>
        </div>
      )}

      <main class="layout">
        <aside class="panel">
          <nav class="tabs" role="tablist" aria-label="Editor">
            {(
              [
                ['plan', 'Plan'],
                ['scenarios', `Scenarios (${plan.scenarios.length})`],
                ['assumptions', 'Assumptions'],
              ] as const
            ).map(([key, label]) => (
              <button type="button" role="tab" key={key} class="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </nav>

          {tab === 'plan' && <PlanEditor household={plan.household} scenarios={plan.scenarios} startDate={plan.settings.startDate} update={updateHousehold} />}
          {tab === 'scenarios' && <ScenarioMatrix household={plan.household} scenarios={plan.scenarios} onChange={setScenarios} />}
          {tab === 'assumptions' && (
            <SettingsPanel
              settings={plan.settings}
              onChange={(settings) => setPlan((p) => ({ ...p, settings }))}
              taxes={plan.household.taxes}
              onTaxesChange={(taxes) => updateHousehold((h) => ({ ...h, taxes }))}
            />
          )}
        </aside>

        <section class="output" aria-live="polite">
          <div class="status">
            {progress !== null ? (
              <>
                <span class="spinner" aria-hidden="true" />
                Simulating… {Math.round(progress * 100)}%
                <progress max={1} value={progress} />
              </>
            ) : error ? (
              <span class="is-bad">Simulation error: {error}</span>
            ) : (
              results.length > 0 && (
                <span class="muted">
                  Updated · {plan.scenarios.length} scenario{plan.scenarios.length === 1 ? '' : 's'} × {plan.settings.runs.toLocaleString()} runs in {(elapsed / 1000).toFixed(1)}s
                </span>
              )
            )}
          </div>
          <Results
            results={results}
            horizonYears={plan.settings.horizonYears}
            extra={
              <>
                <ExplorePanel plan={plan} onAdd={addPicks} capacity={MAX_SCENARIOS - plan.scenarios.length} />
                <SolverPanel plan={plan} onApply={applyClaiming} canAddScenario={plan.scenarios.length < MAX_SCENARIOS} />
              </>
            }
          />
        </section>
      </main>
    </div>
  );
}
