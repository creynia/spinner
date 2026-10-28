// PLAYBOOK §7.2 / harness-data-analysis.md §14: the reference run on the real stack, 10,000 sessions
// x 500 European spins, bankroll $5,000, seed 1, the 3-stage strategy (warm -> mart -> flat), no
// session stops, through the real pool + controller + roulette plugin + interpreter with 3
// in-thread workers (one thread in node: this is the serial cost; with P real Workers the wall time
// divides by about P). Also the determinism test at scale: 1 worker and 3 workers give an identical
// `resultsDigest`. Enabled with PERF=1.
//
//   res cpu <me> -- env PERF=1 PERF_BUDGET_MS=20000 npx vitest run -c tests/perf/vitest.config.ts
//
// PERF_BUDGET_MS bounds the PROJECTED 3-worker wall time, i.e. the measured serial time divided by
// P = 3 (default 60000 under CI, 20000 locally; node has no parallel in-thread workers, the browser
// perf spec measures real Workers). "Projected" = serial / 3 is a LOWER BOUND: it has no worker
// spawn, transfer or merge overhead. The real-Worker Playwright spec (tests/perf/budget.spec.ts,
// via the Benchmark screen) is the §7.2 gate;
// PERF_MIN_ROUNDS_PER_SEC (default 40000) is the CI floor. Both numbers go to the step summary.
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PERF_ENABLED, REFERENCE_3_STAGE, rouletteDef, runViaPool } from '../roulette-helpers';

const budgetMs = Number(process.env.PERF_BUDGET_MS ?? (process.env.CI ? 60_000 : 20_000));
const P = 3;
const minRoundsPerSec = Number(process.env.PERF_MIN_ROUNDS_PER_SEC ?? 40_000);

function report(line: string): void {
  console.info(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function totalRounds(roundsPlayed: Uint16Array | Int32Array | number[]): number {
  let n = 0;
  for (const r of roundsPlayed) n += r;
  return n;
}

describe.skipIf(!PERF_ENABLED)('reference run 10,000 x 500 (roulette, 3-stage)', () => {
  const def = rouletteDef('perf-reference', {
    strategy: REFERENCE_3_STAGE,
    sessions: 10_000,
    maxRounds: 500,
    seed: 1,
    samples: 24,
  });

  it('finishes inside PERF_BUDGET_MS with 3 workers, and 1 worker gives the same resultsDigest', async () => {
    const three = await runViaPool(def, 3);
    const rounds = totalRounds(three.data.summary.roundsPlayed);
    const rps = rounds / (three.ms / 1000);
    const projected = three.ms / P;
    report(
      `roulette reference run (${P} in-thread workers, serial): ${rounds} rounds in ${Math.round(three.ms)} ms = ${Math.round(rps)} rounds/s per thread; projected ${P}-thread wall ${Math.round(projected)} ms (budget ${budgetMs} ms, floor ${minRoundsPerSec} rounds/s), digest ${three.digest.slice(0, 16)}`,
    );
    expect(three.data.sessions).toBe(10_000);
    // No stops: almost every session plays all 500 rounds, so the run cannot win by busting early.
    expect(rounds).toBeGreaterThan(0.8 * 10_000 * 500);
    expect(projected).toBeLessThan(budgetMs);
    expect(rps).toBeGreaterThan(minRoundsPerSec);

    const one = await runViaPool(def, 1);
    report(
      `roulette reference run (1 worker): ${Math.round(one.ms)} ms, digest ${one.digest.slice(0, 16)}`,
    );
    expect(one.digest).toBe(three.digest);
  });

  it('red-mart-then-flat (the preset; it stops after its 50 flat spins, so sessions are short)', async () => {
    const preset = rouletteDef('red-mart-then-flat', {
      sessions: 10_000,
      maxRounds: 500,
      seed: 1,
      samples: 0,
    });
    const r = await runViaPool(preset, 3);
    const rounds = totalRounds(r.data.summary.roundsPlayed);
    report(
      `red-mart-then-flat 10,000 x 500 (3 in-thread workers): ${rounds} rounds in ${Math.round(r.ms)} ms = ${Math.round(rounds / (r.ms / 1000))} rounds/s`,
    );
    expect(r.ms / P).toBeLessThan(budgetMs);
  });
});
