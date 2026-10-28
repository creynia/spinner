// Benchmark this device (harness-data-analysis.md §14.2): the 10,000 x 500 reference run through the
// real pool, controller and store. Same strategy as tests/build/perf/roulette-budget.perf.test.ts.
import { normalizeDefinition, type HarnessRunController, type NormalizedDefinition } from '@core';
import { game } from '../../services/game';
import { DRY_RUN_TAG, startRun } from '../../services/runs';

export const BENCH_SESSIONS = 10_000;
export const BENCH_ROUNDS = 500;

/** Warm (20 flat red) -> martingale on red -> two dozens, no session stops. */
const REFERENCE_STRATEGY = {
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

export function benchmarkDefinition(): NormalizedDefinition {
  const res = normalizeDefinition(
    {
      schema: 1,
      name: 'Benchmark this device',
      tags: [DRY_RUN_TAG], // keeps the run out of Home and the Library
      game: { id: 'roulette', rules: 'european' },
      strategy: REFERENCE_STRATEGY as never,
      session: { bankroll: 500_000, maxRounds: BENCH_ROUNDS },
      run: { sessions: BENCH_SESSIONS, seed: 1, sampleSessions: 24 },
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

/** Start the reference run and resolve when it is done (t0 = before the pool spins up). */
export async function runBenchmark(): Promise<BenchResult> {
  let ctl: HarnessRunController | undefined;
  let workers = 0;
  const t0 = performance.now();
  await startRun(benchmarkDefinition(), {
    onController: (c) => {
      ctl = c;
      c.subscribe((p) => {
        workers = Math.max(workers, p.workers);
      });
    },
  });
  if (!ctl) throw new Error('The benchmark run did not start.');
  const status = await ctl.settled();
  const ms = performance.now() - t0;
  if (status !== 'done') throw new Error(`The benchmark run ended as ${status}.`);
  const snap = ctl.snapshot();
  let rounds = 0;
  for (const r of snap.summary.roundsPlayed) rounds += r;
  return summarize(ms, rounds, snap.sessions, workers, ctl.meta?.resultsDigest ?? '');
}
