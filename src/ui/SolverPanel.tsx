import { useEffect, useRef, useState } from 'preact/hooks';
import { SOLVER_GOALS, type SolverCell, type SolverGoal, type SolverResult } from '../engine/solver';
import type { WorkerRequest, WorkerResponse } from '../engine/worker';
import { formatAge } from '../model/socialSecurity';
import type { PlanFile } from '../model/types';
import { moneyCompact, pct, runway } from './format';

/** Sequential blue ramp (light → dark) for the heatmap; the last three steps take light text. */
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'];

export type ApplyClaiming = (scenarioId: string, ages: Record<string, number>, asNew: boolean) => void;

function metric(goal: SolverGoal, c: SolverCell): number {
  return goal === 'success' ? c.successRate : goal === 'p10' ? c.p10EndingReal : c.medianEndingReal;
}

function formatMetric(goal: SolverGoal, v: number): string {
  return goal === 'success' ? pct(v) : moneyCompact(v);
}

export function SolverPanel(props: { plan: PlanFile; onApply: ApplyClaiming; canAddScenario: boolean }) {
  const { plan } = props;
  const [scenarioId, setScenarioId] = useState(plan.scenarios[0]?.id ?? '');
  const [goal, setGoal] = useState<SolverGoal>('success');
  const [runs, setRuns] = useState(400);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<SolverResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const worker = useRef<Worker | null>(null);
  const scenario = plan.scenarios.find((s) => s.id === scenarioId) ?? plan.scenarios[0];

  useEffect(() => () => worker.current?.terminate(), []);
  // A result for a scenario that no longer exists is meaningless.
  useEffect(() => {
    if (result && !plan.scenarios.some((s) => s.id === result.scenarioId)) setResult(null);
  }, [plan.scenarios]);

  const run = () => {
    if (!scenario) return;
    worker.current?.terminate();
    const w = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setProgress(0);
    setError(null);
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') return setProgress(msg.fraction);
      setProgress(null);
      if (msg.type === 'solved') {
        setResult(msg.result);
        setElapsed(msg.elapsedMs);
      } else if (msg.type === 'error') setError(msg.message);
      w.terminate();
    };
    w.postMessage({ id: 1, type: 'solve', plan, scenarioId: scenario.id, goal, runs } satisfies WorkerRequest);
  };
  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    setProgress(null);
  };

  const resultScenario = result && plan.scenarios.find((s) => s.id === result.scenarioId);
  const agesText = (r: SolverResult, c: SolverCell) => r.people.map((p, i) => `${p.name} ${formatAge(c.ages[i])}`).join(', ');
  const agesRecord = (r: SolverResult, c: SolverCell) => Object.fromEntries(r.people.map((p, i) => [p.id, c.ages[i]]));

  return (
    <section class="card">
      <h2>Social Security claiming solver</h2>
      <p class="card__sub">
        Tries every claim age from 62 to 70 for each person (whole years, then month by month around the best), keeping everything else in the scenario fixed. Random mortality (Assumptions tab) gives a fairer answer than fixed life expectancy.
      </p>
      <div class="controls solver-controls">
        <label class="field field--inline">
          <span class="field__label">Scenario</span>
          <select value={scenario?.id} onChange={(e) => setScenarioId((e.target as HTMLSelectElement).value)}>
            {plan.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label class="field field--inline">
          <span class="field__label">Goal</span>
          <select value={goal} onChange={(e) => setGoal((e.target as HTMLSelectElement).value as SolverGoal)}>
            {(Object.keys(SOLVER_GOALS) as SolverGoal[]).map((g) => (
              <option key={g} value={g}>
                {SOLVER_GOALS[g]}
              </option>
            ))}
          </select>
        </label>
        <label class="field field--inline">
          <span class="field__label">Runs each</span>
          <select value={runs} onChange={(e) => setRuns(+(e.target as HTMLSelectElement).value)}>
            {[200, 400, 1000, 2000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        {progress === null ? (
          <button type="button" class="btn btn--primary" onClick={run} disabled={!scenario}>
            Find best claim ages
          </button>
        ) : (
          <>
            <progress max={1} value={progress} />
            <span class="muted">{Math.round(progress * 100)}%</span>
            <button type="button" class="btn btn--small" onClick={cancel}>
              Cancel
            </button>
          </>
        )}
      </div>
      {error && <p class="is-bad">{error}</p>}
      {result && resultScenario && (
        <div class="solver-result">
          <div class="solver-best">
            <div>
              <div class="field__label">Best for “{resultScenario.name}”</div>
              <div class="solver-best__ages">{agesText(result, result.best)}</div>
              <div class="muted">
                Success {pct(result.best.successRate)} · Runway (90%) {runway(result.best.runwayP10Years, plan.settings.startDate)} · Median ending {moneyCompact(result.best.medianEndingReal)} · Poor-market ending{' '}
                {moneyCompact(result.best.p10EndingReal)}
              </div>
              <div class="muted">
                Current choice ({agesText(result, result.current)}): success {pct(result.current.successRate)}, median ending {moneyCompact(result.current.medianEndingReal)}
              </div>
            </div>
            <div class="btn-row">
              <button type="button" class="btn btn--primary" disabled={!props.canAddScenario} onClick={() => props.onApply(result.scenarioId, agesRecord(result, result.best), true)}>
                Add as new scenario
              </button>
              <button type="button" class="btn" onClick={() => props.onApply(result.scenarioId, agesRecord(result, result.best), false)}>
                Apply to “{resultScenario.name}”
              </button>
            </div>
          </div>
          <Heatmap result={result} />
          <p class="footnote">
            {result.runs.toLocaleString()} simulations per candidate, same market paths for all · {(elapsed / 1000).toFixed(1)}s. Small differences between neighboring cells are noise — raise “Runs each” to firm them up.
          </p>
        </div>
      )}
    </section>
  );
}

function Heatmap({ result }: { result: SolverResult }) {
  const { goal, people, grid } = result;
  const values = grid.map((c) => metric(goal, c));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const step = (v: number) => (hi > lo ? Math.round(((v - lo) / (hi - lo)) * (RAMP.length - 1)) : RAMP.length - 1);
  const rowAges = [...new Set(grid.map((c) => c.ages[0]))];
  const colAges = people.length > 1 ? [...new Set(grid.map((c) => c.ages[1]))] : [null];
  const cell = (a: number, b: number | null) => grid.find((c) => Math.abs(c.ages[0] - a) < 1e-6 && (b === null || Math.abs(c.ages[1] - b) < 1e-6));
  const near = (c: SolverCell, target: SolverCell) => c.ages.every((a, i) => Math.round(a) === Math.round(target.ages[i]));
  const isCurrent = (c: SolverCell) => c.ages.every((a, i) => Math.abs(a - result.current.ages[i]) < 1e-6);

  return (
    <div class="table-wrap">
      <table class="heatmap" aria-label={`${SOLVER_GOALS[goal]} by claim age`}>
        <thead>
          <tr>
            <th class="heatmap__corner">
              {people[0].name} ↓{people[1] ? ` · ${people[1].name} →` : ''}
            </th>
            {colAges.map((b) => (
              <th key={String(b)}>{b === null ? SOLVER_GOALS[goal].replace(/^(Highest|Best) /, '') : formatAge(b)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowAges.map((a) => (
            <tr key={a}>
              <th>{formatAge(a)}</th>
              {colAges.map((b) => {
                const c = cell(a, b);
                if (!c) return <td key={String(b)} />;
                const s = step(metric(goal, c));
                const best = near(c, result.best);
                return (
                  <td
                    key={String(b)}
                    class={`heatmap__cell${best ? ' is-best' : ''}${isCurrent(c) ? ' is-current' : ''}`}
                    style={{ background: RAMP[s], color: s >= RAMP.length - 4 ? '#fff' : '#0b0b0b' }}
                    title={`${people.map((p, i) => `${p.name} ${formatAge(c.ages[i])}`).join(', ')}\nSuccess ${pct(c.successRate)}\nMedian ending ${moneyCompact(c.medianEndingReal)}\nPoor-market ending ${moneyCompact(c.p10EndingReal)}`}
                  >
                    {formatMetric(goal, metric(goal, c))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p class="footnote">
        <span class="legend-box is-best" /> best whole-year cell · <span class="legend-box is-current" /> scenario's current choice. Darker = better.
      </p>
    </div>
  );
}
