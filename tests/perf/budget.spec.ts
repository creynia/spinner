// The §7.2 / harness-data-analysis.md §14.2 gate: the 10,000 x 500 reference run through the real
// Worker pool, harness and store of the built app, driven from Settings -> Benchmark. Wall-clock
// (`bench.ms`) runs from the click on Run (pool spin-up included) to the `done` status.
// PERF_BUDGET_MS: default 20000 locally; CI sets 60000. The node projection test is
// tests/build/perf/roulette-budget.perf.test.ts. Resume after reload is covered by e2e/resume.spec.ts.
import { expect, test } from '@playwright/test';

// Mirrors BenchResult and the sizes in src/app/screens/Settings/benchmark.ts (tsconfig.node.json does
// not include src/, so the spec cannot import them).
interface BenchResult {
  ms: number;
  rounds: number;
  sessions: number;
  roundsPerSec: number;
  workers: number;
  projectedMs: number;
  digest: string;
}
const BENCH_SESSIONS = 10_000;
const BENCH_ROUNDS = 500;

const budgetMs = Number(process.env.PERF_BUDGET_MS ?? (process.env.CI ? 60_000 : 20_000));
/** resultsDigest of the reference run (seed 1); it does not depend on the worker count. */
const PINNED_DIGEST = 'ecb1b8c968bdcffc0a37ff0cbd1c887338b0113932ba9cfc6f5fbaa3a4c8a157';

test('reference run 10,000 x 500 on real Workers finishes inside PERF_BUDGET_MS', async ({
  page,
}) => {
  test.setTimeout(budgetMs + 120_000);
  await page.goto('./?e2e#/settings/benchmark');
  await expect(page.locator('h1')).toBeVisible();

  await page.getByRole('button', { name: 'Run benchmark' }).click();
  const card = page.locator('[data-bench]');
  await expect(card).toBeVisible({ timeout: budgetMs + 60_000 });

  const bench = JSON.parse((await card.getAttribute('data-bench')) as string) as BenchResult;
  console.info(
    `real-Worker reference run: ${bench.rounds} rounds in ${Math.round(bench.ms)} ms = ${Math.round(bench.roundsPerSec)} rounds/s, ${bench.workers} workers, budget ${budgetMs} ms, digest ${bench.digest}`,
  );
  test
    .info()
    .annotations.push(
      { type: 'ms', description: String(Math.round(bench.ms)) },
      { type: 'rounds/s', description: String(Math.round(bench.roundsPerSec)) },
      { type: 'workers', description: String(bench.workers) },
    );

  expect(bench.sessions).toBe(BENCH_SESSIONS);
  // No stops: only busts shorten a session, so nearly all of the 5M rounds are played.
  expect(bench.rounds).toBeGreaterThan(0.98 * BENCH_SESSIONS * BENCH_ROUNDS);
  expect(bench.workers).toBeGreaterThanOrEqual(2);
  expect(bench.digest).toMatch(/^[0-9a-f]+$/);
  expect(bench.digest).toBe(PINNED_DIGEST);
  expect(bench.ms).toBeLessThan(budgetMs);
});
