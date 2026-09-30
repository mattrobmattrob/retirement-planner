import { useEffect, useRef, useState } from 'preact/hooks';
import type { ScenarioResult } from '../engine/simulate';
import type { WorkerRequest, WorkerResponse } from '../engine/worker';
import { defaultSettings, duplicateScenario, newScenario, nextColorSlot, samplePlan } from '../model/defaults';
import { normalizePlan } from '../model/normalize';
import type { PlanFile, Scenario } from '../model/types';
import { Results, seriesColor } from './Results';
import { ScenarioEditor } from './ScenarioEditor';
import { SettingsPanel } from './SettingsPanel';

const STORAGE_KEY = 'retirement-planner:plan:v1';

function loadInitialPlan(): PlanFile {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizePlan(JSON.parse(saved));
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
        if (msg.type === 'progress') setProgress(msg.fraction);
        else {
          setProgress(null);
          if (msg.type === 'done') {
            setResults(msg.results);
            setElapsed(msg.elapsedMs);
            setError(null);
          } else setError(msg.message);
          w.terminate();
          if (worker.current === w) worker.current = null;
        }
      };
      w.onerror = (e) => {
        setProgress(null);
        setError(e.message || 'Simulation failed.');
      };
      w.postMessage({ id, plan } satisfies WorkerRequest);
    }, 400);
    return () => clearTimeout(timer);
  }, [plan]);

  useEffect(() => () => worker.current?.terminate(), []);
  return { results, progress, error, elapsed };
}

export function App() {
  const [plan, setPlan] = useState<PlanFile>(loadInitialPlan);
  const [tab, setTab] = useState<string>(() => plan.scenarios[0]?.id ?? 'settings');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { results, progress, error, elapsed } = useSimulation(plan);

  useEffect(() => savePlan(plan), [plan]);

  const active = plan.scenarios.find((s) => s.id === tab);
  const updateScenario = (id: string) => (fn: (s: Scenario) => Scenario) =>
    setPlan((p) => ({ ...p, scenarios: p.scenarios.map((s) => (s.id === id ? fn(s) : s)) }));

  const addScenario = (source?: Scenario) => {
    const slot = nextColorSlot(plan.scenarios);
    const created = source
      ? duplicateScenario(source, slot)
      : newScenario({ name: `Scenario ${String.fromCharCode(65 + plan.scenarios.length)}`, colorSlot: slot });
    setPlan((p) => ({ ...p, scenarios: [...p.scenarios, created] }));
    setTab(created.id);
  };

  const removeScenario = (id: string) => {
    if (plan.scenarios.length <= 1) return;
    const name = plan.scenarios.find((s) => s.id === id)?.name;
    if (!window.confirm(`Delete "${name}"?`)) return;
    const remaining = plan.scenarios.filter((s) => s.id !== id);
    setPlan((p) => ({ ...p, scenarios: remaining }));
    setTab(remaining[0].id);
  };

  const moveScenario = (id: string, delta: number) =>
    setPlan((p) => {
      const list = [...p.scenarios];
      const i = list.findIndex((s) => s.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return p;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...p, scenarios: list };
    });

  const importFile = async (file: File) => {
    try {
      const next = normalizePlan(JSON.parse(await file.text()));
      setPlan(next);
      setTab(next.scenarios[0].id);
      setImportError(null);
    } catch (err) {
      setImportError(`Couldn't load ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const resetTo = (next: PlanFile, label: string) => {
    if (!window.confirm(`Replace the current plan with ${label}? Download it first if you want to keep it.`)) return;
    setPlan(next);
    setTab(next.scenarios[0].id);
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
              <button
                type="button"
                onClick={() =>
                  resetTo(
                    { format: 'retirement-planner', version: 1, settings: defaultSettings(), scenarios: [newScenario({ name: 'Scenario A' })] },
                    'a blank plan',
                  )
                }
              >
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
          <nav class="tabs" aria-label="Scenarios">
            {plan.scenarios.map((s) => (
              <button type="button" key={s.id} class="tab" aria-current={tab === s.id} onClick={() => setTab(s.id)}>
                <span class="swatch" style={{ background: seriesColor(s.colorSlot) }} />
                <span class="tab__label">{s.name}</span>
              </button>
            ))}
            <button type="button" class="tab tab--add" onClick={() => addScenario()} title="New empty scenario">
              + New
            </button>
            <button type="button" class="tab tab--settings" aria-current={tab === 'settings'} onClick={() => setTab('settings')}>
              ⚙ Assumptions
            </button>
          </nav>

          {active ? (
            <>
              <div class="scenario-actions">
                <button type="button" class="btn btn--small" onClick={() => addScenario(active)}>
                  Duplicate
                </button>
                <button type="button" class="btn btn--small" onClick={() => moveScenario(active.id, -1)} aria-label="Move left">
                  ←
                </button>
                <button type="button" class="btn btn--small" onClick={() => moveScenario(active.id, 1)} aria-label="Move right">
                  →
                </button>
                <button type="button" class="btn btn--small btn--danger" disabled={plan.scenarios.length <= 1} onClick={() => removeScenario(active.id)}>
                  Delete
                </button>
              </div>
              <ScenarioEditor key={active.id} scenario={active} startDate={plan.settings.startDate} update={updateScenario(active.id)} />
            </>
          ) : (
            <SettingsPanel settings={plan.settings} onChange={(settings) => setPlan((p) => ({ ...p, settings }))} />
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
          <Results results={results} horizonYears={plan.settings.horizonYears} />
        </section>
      </main>
    </div>
  );
}
