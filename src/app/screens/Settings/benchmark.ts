// Benchmark this device (harness-data-analysis.md §14.2): the 10,000 x 500 reference run through the
// real pool, controller and store. Same strategy as tests/build/perf/roulette-budget.perf.test.ts.
import { normalizeDefinition, type HarnessRunController, type NormalizedDefinition } from '@core';
import type { StrategyDefinition } from '@core/contracts/strategy';
import { game } from '../../services/game';
import { activeRun, DRY_RUN_TAG, getCoreRepo, runKeys, startRun } from '../../services/runs';

export const BENCH_SESSIONS = 10_000;
export const BENCH_ROUNDS = 500;

/** Warm (20 flat red) -> martingale on red -> two dozens, no session stops. */
const REFERENCE_STRATEGY: StrategyDefinition = {
  schema: 1,
  id: 'perf-reference',
  name: 'Perf reference: warm, mart, flat',
  game: 'roulette',
  unit: 2500,
  progressions: {
    m: { kind: 'martingale', base: { units: 1 }, maxSteps: 6, onCap: 'reset', track: 'red' },
  },
  stages: [
    {
      id: 'warm',
      layout: [{ bet: 'red', amount: { units: 1 } }],
      rules: [{ when: { cmp: ['roundsInStage', '>=', 20] }, then: [{ goto: 'mart' }] }],
    },
    {
      id: 'mart',
      layout: [{ bet: 'red', amount: { prog: 'm' } }],
      rules: [
        { when: { cmp: ['net', '>=', 50_000] }, then: [{ goto: 'flat' }] },
        { when: { cmp: ['net', '<=', -150_000] }, then: [{ goto: 'warm' }] },
      ],
    },
    {
      id: 'flat',
      layout: [
        { bet: 'dozen:1', amount: { units: 1 } },
        { bet: 'dozen:2', amount: { units: 1 } },
      ],
      rules: [{ when: { cmp: ['roundsInStage', '>=', 50] }, then: [{ goto: 'warm' }] }],
    },
  ],
};

export interface BenchResult {
  ms: number;
  rounds: number;
  sessions: number;
  roundsPerSec: number;
  workers: number;
  /** Wall time of exactly 10,000 x 500 rounds at the measured rounds/s. */
  projectedMs: number;
  digest: string;
}

/** The reference definition; `sessions` is only lowered by unit tests. */
export function benchmarkDefinition(sessions = BENCH_SESSIONS): NormalizedDefinition {
  const res = normalizeDefinition(
    {
      schema: 1,
      name: 'Benchmark this device',
      tags: [DRY_RUN_TAG], // keeps the run out of Home and the Library
      game: { id: 'roulette', rules: 'european' },
      strategy: REFERENCE_STRATEGY,
      session: { bankroll: 500_000, maxRounds: BENCH_ROUNDS },
      run: { sessions, seed: 1, sampleSessions: 24 },
    },
    { plugin: game.plugin, resolveStrategyRef: () => undefined },
  );
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.definition;
}

export function summarize(
  ms: number,
  rounds: number,
  sessions: number,
  workers: number,
  digest: string,
): BenchResult {
  const roundsPerSec = ms > 0 ? rounds / (ms / 1000) : 0;
  const projectedMs =
    roundsPerSec > 0 ? ((BENCH_SESSIONS * BENCH_ROUNDS) / roundsPerSec) * 1000 : 0;
  return { ms, rounds, sessions, roundsPerSec, workers, projectedMs, digest };
}

let benchRunning = false;

/** `settled()` only fires on the next transition, so a run already finished must not wait on it. */
function settle(c: HarnessRunController): Promise<string> {
  const s = c.status;
  return s === 'done' || s === 'cancelled' || s === 'error' ? Promise.resolve(s) : c.settled();
}

export interface BenchHandle {
  cancel(): void;
  result: Promise<BenchResult>;
}

/** Remove the benchmark's run (results, parts) and its own definition record. */
async function cleanup(runId: string, definitionId: string): Promise<void> {
  try {
    const repo = await getCoreRepo();
    await repo.deleteRun(runId);
    const rec = await repo.getDefinition(definitionId);
    if (
      rec &&
      rec.definition.tags?.includes(DRY_RUN_TAG) === true &&
      rec.runIds.length === 0 &&
      (await repo.listRunsOfDefinition(definitionId)).length === 0
    ) {
      await repo.backend.tx(['definitions'], 'readwrite', (t) =>
        t.delete('definitions', definitionId),
      );
    }
  } catch {
    // already gone
  }
}

/**
 * Start the reference run (t0 = before the pool spins up). The run is deleted from the store once
 * the result is read, whether it finished, failed or was cancelled. Throws (synchronously) when
 * another run is active.
 */
export function startBenchmark(sessions = BENCH_SESSIONS): BenchHandle {
  if (benchRunning) throw new Error('A benchmark is already running.');
  if (activeRun.get()) throw new Error('Another run is active. Wait for it to finish first.');
  benchRunning = true;
  let ctl: HarnessRunController | undefined;
  let cancelled = false;
  let started = false;
  const result = (async (): Promise<BenchResult> => {
    let workers = 0;
    const def = benchmarkDefinition(sessions);
    const t0 = performance.now();
    try {
      await startRun(def, {
        onController: (c) => {
          ctl = c;
          c.subscribe((p) => {
            workers = Math.max(workers, p.workers);
          });
        },
      });
      started = true;
      const c = ctl!;
      if (cancelled) await c.cancel();
      const status = await settle(c);
      const ms = performance.now() - t0;
      if (status !== 'done') throw new Error(`The benchmark run ended as ${status}.`);
      const snap = c.snapshot();
      let rounds = 0;
      for (const r of snap.summary.roundsPlayed) rounds += r;
      return summarize(ms, rounds, snap.sessions, workers, c.meta?.resultsDigest ?? '');
    } finally {
      benchRunning = false;
      if (ctl) {
        await settle(ctl).catch(() => undefined);
        await cleanup(ctl.runId, (await runKeys(def)).definitionId);
      }
    }
  })();
  return {
    cancel() {
      cancelled = true;
      if (ctl && started) void ctl.cancel();
    },
    result,
  };
}
