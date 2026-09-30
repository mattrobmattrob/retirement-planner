import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  buildAxes,
  comboAt,
  comboCount,
  EXPLORE_SORTS,
  MAX_EXPLORE_COMBINATIONS,
  picksToChoices,
  rowScore,
  summarizeEffects,
  type Axis,
  type ExploreRow,
  type ExploreSort,
} from '../engine/explore';
import type { WorkerRequest, WorkerResponse } from '../engine/worker';
import type { PlanFile } from '../model/types';
import { moneyCompact, pct, runway } from './format';

export interface ScenarioPick {
  name: string;
  choices: Record<string, string>;
  claimAges: Record<string, number>;
}

interface Run {
  plan: PlanFile;
  axes: Axis[];
  rows: ExploreRow[];
  runs: number;
  elapsedMs: number;
  threads: number;
}

const PAGE = 25;

export function ExplorePanel(props: { plan: PlanFile; onAdd: (picks: ScenarioPick[]) => void; capacity: number }) {
  const { plan, capacity } = props;
  const [allClaimAges, setAllClaimAges] = useState(true);
  const [runs, setRuns] = useState(300);
  const [sort, setSort] = useState<ExploreSort>('success');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const workers = useRef<Worker[]>([]);

  const axes = useMemo(() => buildAxes(plan, allClaimAges), [plan.household, plan.settings.startDate, allClaimAges]);
  const count = comboCount(axes);
  const tooMany = count > MAX_EXPLORE_COMBINATIONS;
  const stale = result !== null && (result.plan.household !== plan.household || result.plan.settings !== plan.settings);

  const stop = () => {
    workers.current.forEach((w) => w.terminate());
    workers.current = [];
  };
  useEffect(() => stop, []);

  const run = () => {
    stop();
    setError(null);
    setProgress(0);
    const snapshot = plan;
    const threads = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8, Math.ceil(count / 8)));
    const size = Math.ceil(count / threads);
    const done = new Array<number>(threads).fill(0);
    const rows: ExploreRow[][] = new Array(threads);
    let finished = 0;
    const started = performance.now();
    for (let t = 0; t < threads; t++) {
      const from = t * size;
      const to = Math.min(count, from + size);
      const w = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
      workers.current.push(w);
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          done[t] = msg.fraction * (to - from);
          setProgress(done.reduce((a, b) => a + b, 0) / count);
        } else if (msg.type === 'explored') {
          rows[t] = msg.rows;
          w.terminate();
          if (++finished === threads) {
            workers.current = [];
            setProgress(null);
            setShown(PAGE);
            setResult({ plan: snapshot, axes, rows: rows.flat(), runs, elapsedMs: performance.now() - started, threads });
          }
        } else if (msg.type === 'error') {
          stop();
          setProgress(null);
          setError(msg.message);
        }
      };
      w.postMessage({ id: t, type: 'explore', plan: snapshot, allClaimAges, runs, from, to } satisfies WorkerRequest);
    }
  };

  const ranked = useMemo(
    () => (result ? [...result.rows].sort((a, b) => rowScore(sort, b) - rowScore(sort, a)) : []),
    [result, sort],
  );
  const effects = useMemo(() => (result ? summarizeEffects(result.axes, result.rows, sort) : []), [result, sort]);

  const toPick = (r: Run, row: ExploreRow): ScenarioPick => {
    const picks = comboAt(r.axes, row.index);
    const { choices, claimAges } = picksToChoices(r.axes, picks);
    const name = r.axes.map((a, i) => a.values[picks[i]].label.replace(/^Claim at /, `${shortName(a.name)} `)).join(' · ');
    return { name: name || 'Explored scenario', choices, claimAges };
  };

  return (
    <section class="card">
      <h2>Explore all combinations</h2>
      <p class="card__sub">
        Simulates every combination of your options{allClaimAges ? ' and every Social Security claim age (62–70)' : ''} with the same market paths, then ranks them. Promote the best into the comparison above for full-detail charts.
      </p>
      <div class="controls solver-controls">
        <label class="check">
          <input type="checkbox" checked={allClaimAges} onChange={(e) => setAllClaimAges((e.target as HTMLInputElement).checked)} />
          <span>Every claim age 62–70</span>
        </label>
        <label class="field field--inline">
          <span class="field__label">Runs each</span>
          <select value={runs} onChange={(e) => setRuns(+(e.target as HTMLSelectElement).value)}>
            {[100, 300, 1000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <span class={tooMany ? 'is-bad' : 'muted'}>
          {count.toLocaleString()} combination{count === 1 ? '' : 's'}
          {tooMany && ` — over ${MAX_EXPLORE_COMBINATIONS.toLocaleString()}; remove some options or turn off every claim age`}
        </span>
        {progress === null ? (
          <button type="button" class="btn btn--primary" disabled={tooMany || count < 1} onClick={run}>
            {result ? 'Re-run' : 'Explore'}
          </button>
        ) : (
          <>
            <progress max={1} value={progress} />
            <span class="muted">{Math.round(progress * 100)}%</span>
            <button
              type="button"
              class="btn btn--small"
              onClick={() => {
                stop();
                setProgress(null);
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {count === 1 && <p class="muted">Add options to items in the Plan tab (or tick “every claim age”) to have something to explore.</p>}
      {error && <p class="is-bad">{error}</p>}

      {result && (
        <>
          {stale && <p class="warnings">The plan changed since this run — re-run to refresh. Adding rows uses the options as they are now.</p>}
          <p class="footnote">
            {result.rows.length.toLocaleString()} combinations × {result.runs.toLocaleString()} runs in {(result.elapsedMs / 1000).toFixed(1)}s on {result.threads} thread
            {result.threads === 1 ? '' : 's'}. The very top of the ranking is partly luck at low run counts — “+ Compare” re-runs a combination at full precision in the comparison.
          </p>

          <h3 class="subhead">What matters most</h3>
          <p class="card__sub">
            Average success across every combination using each option, and how often it was the best choice when everything else was the same ({EXPLORE_SORTS[sort].toLowerCase()}).
          </p>
          <div class="effects">
            {effects.map((e) => (
              <div class="effect" key={e.axis.key}>
                <div class="effect__head">
                  <strong>{e.axis.name}</strong>
                  <span class="muted">{e.successSpread.toFixed(1)} pt spread</span>
                </div>
                <table class="effect__table">
                  <tbody>
                    {e.values.map((v) => (
                      <tr key={v.label}>
                        <td class="effect__label">{v.label}</td>
                        <td class="effect__bar">
                          <span class="bar" style={{ width: `${v.meanSuccess}%` }} />
                        </td>
                        <td>{pct(v.meanSuccess, 1)}</td>
                        <td class="muted" title="Share of like-for-like comparisons where this option was best">
                          best {pct(v.bestShare)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div class="card__head">
            <h3 class="subhead">Ranked combinations</h3>
            <div class="controls">
              <label class="field field--inline">
                <span class="field__label">Rank by</span>
                <select value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as ExploreSort)}>
                  {(Object.keys(EXPLORE_SORTS) as ExploreSort[]).map((k) => (
                    <option key={k} value={k}>
                      {EXPLORE_SORTS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" class="btn btn--small" disabled={capacity < 1} onClick={() => props.onAdd(ranked.slice(0, Math.min(3, capacity)).map((r) => toPick(result, r)))}>
                Compare top {Math.max(1, Math.min(3, capacity))}
              </button>
            </div>
          </div>
          {capacity < 1 && <p class="muted">The comparison holds 8 scenarios — delete one in the Scenarios tab to add more.</p>}
          <div class="table-wrap">
            <table class="ranked">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Success</th>
                  <th>Runway (90%)</th>
                  <th>Median ending</th>
                  <th>Poor-market ending</th>
                  {result.axes.map((a) => (
                    <th key={a.key} class="ranked__choice">
                      {a.name}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, shown).map((row, i) => {
                  const picks = comboAt(result.axes, row.index);
                  return (
                    <tr key={row.index}>
                      <td class="muted">{i + 1}</td>
                      <td>{pct(row.successRate)}</td>
                      <td>{runway(row.runwayP10Years, result.plan.settings.startDate)}</td>
                      <td>{moneyCompact(row.medianEndingReal)}</td>
                      <td>{moneyCompact(row.p10EndingReal)}</td>
                      {result.axes.map((a, k) => (
                        <td key={a.key} class="ranked__choice">
                          {a.values[picks[k]].label}
                        </td>
                      ))}
                      <td>
                        <button type="button" class="btn btn--small" disabled={capacity < 1} onClick={() => props.onAdd([toPick(result, row)])}>
                          + Compare
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown < ranked.length && (
            <button type="button" class="link-btn" onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, ranked.length - shown)} more of {ranked.length.toLocaleString()}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** "Person A — Social Security" → "A"; used to keep generated scenario names short. */
function shortName(axisName: string): string {
  return axisName.replace(/ — Social Security$/, '').replace(/^Person /, '');
}
