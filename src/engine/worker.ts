/// <reference lib="webworker" />
import type { PlanFile } from '../model/types';
import { simulateScenario, type ScenarioResult } from './simulate';

export type WorkerRequest = { id: number; plan: PlanFile };
export type WorkerResponse =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'done'; results: ScenarioResult[]; elapsedMs: number }
  | { id: number; type: 'error'; message: string };

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, plan } = event.data;
  const started = performance.now();
  try {
    const n = plan.scenarios.length;
    const results = plan.scenarios.map((scenario, i) =>
      simulateScenario(plan, scenario, (f) => post({ id, type: 'progress', fraction: (i + f) / n })),
    );
    post({ id, type: 'done', results, elapsedMs: performance.now() - started });
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
