/// <reference lib="webworker" />
import { resolveScenario } from '../model/resolve';
import type { PlanFile } from '../model/types';
import { simulateScenario, type ScenarioResult } from './simulate';
import { solveClaiming, type SolverGoal, type SolverResult } from './solver';

export type WorkerRequest =
  | { id: number; type: 'simulate'; plan: PlanFile }
  | { id: number; type: 'solve'; plan: PlanFile; scenarioId: string; goal: SolverGoal; runs: number };

export type WorkerResponse =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'simulated'; results: ScenarioResult[]; elapsedMs: number }
  | { id: number; type: 'solved'; result: SolverResult; elapsedMs: number }
  | { id: number; type: 'error'; message: string };

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const { id } = req;
  const started = performance.now();
  const progress = (fraction: number) => post({ id, type: 'progress', fraction });
  try {
    if (req.type === 'simulate') {
      const n = req.plan.scenarios.length;
      const results = req.plan.scenarios.map((scenario, i) =>
        simulateScenario(req.plan.settings, resolveScenario(req.plan, scenario), (f) => progress((i + f) / n)),
      );
      post({ id, type: 'simulated', results, elapsedMs: performance.now() - started });
    } else {
      const result = solveClaiming(req.plan, req.scenarioId, req.goal, req.runs, progress);
      post({ id, type: 'solved', result, elapsedMs: performance.now() - started });
    }
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
