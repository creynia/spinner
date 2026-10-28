// layouts.md WP-L7: a chip-stage strategy (Red x5 + a split + voisins at $5 chips) runs the same
// 10,000 sessions x 500 spins reference as the roulette budget, inside the same budget, and plays
// exactly like the plain rows it compiles to (same resultsDigest). Same harness and rules as
// roulette-budget.perf.test.ts. Enabled with PERF=1.
//
//   res cpu <me> -- env PERF=1 PERF_BUDGET_MS=20000 npx vitest run -c tests/perf/vitest.config.ts chips-budget
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StageChips } from '@core/contracts/layout';
import { withStageChips } from '@core/strategy';
import { PERF_ENABLED, rouletteDef, runViaPool } from '../roulette-helpers';

const budgetMs = Number(process.env.PERF_BUDGET_MS ?? (process.env.CI ? 60_000 : 20_000));
const P = 3;
const minRoundsPerSec = Number(process.env.PERF_MIN_ROUNDS_PER_SEC ?? 40_000);

function report(line: string): void {
  console.info(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}
const total = (r: ArrayLike<number>): number => {
  let n = 0;
  for (let i = 0; i < r.length; i++) n += r[i]!;
  return n;
};

const CHIPS: StageChips = {
  v: 1,
  chip: 500,
  spots: [
    { bet: 'red', chips: 5 },
    { bet: 'split:17-20', chips: 1 },
    { bet: 'voisins', chips: 9 },
  ],
};
const strategy = (withChips: boolean) => {
  const stage = withStageChips({ id: 'play' }, CHIPS) as unknown as Record<string, unknown>;
  if (!withChips) delete stage['x-chips'];
  return {
    schema: 1,
    id: 'perf-chips',
    name: 'Perf: chips',
    game: 'roulette',
    unit: 2500,
    stages: [stage],
  };
};

describe.skipIf(!PERF_ENABLED)('chip-stage reference run 10,000 x 500 (roulette)', () => {
  const opts = { sessions: 10_000, maxRounds: 500, seed: 1, samples: 0 };

  it('finishes inside PERF_BUDGET_MS and plays exactly like its compiled rows', async () => {
    const chips = rouletteDef('perf-chips', { ...opts, strategy: strategy(true) });
    const rows = rouletteDef('perf-chips', { ...opts, strategy: strategy(false) });
    const a = await runViaPool(chips, 3);
    const rounds = total(a.data.summary.roundsPlayed);
    const rps = rounds / (a.ms / 1000);
    const projected = a.ms / P;
    report(
      `chip-stage reference run (${P} in-thread workers, serial): ${rounds} rounds in ${Math.round(a.ms)} ms = ${Math.round(rps)} rounds/s per thread; projected ${P}-thread wall ${Math.round(projected)} ms (budget ${budgetMs} ms, floor ${minRoundsPerSec} rounds/s), digest ${a.digest.slice(0, 16)}`,
    );
    expect(a.data.sessions).toBe(10_000);
    expect(rounds).toBeGreaterThan(0.5 * 10_000 * 500);
    expect(projected).toBeLessThan(budgetMs);
    expect(rps).toBeGreaterThan(minRoundsPerSec);
    const b = await runViaPool(rows, 3);
    expect(b.digest).toBe(a.digest);
  });
});
