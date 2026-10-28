// The §7.2 / harness-data-analysis.md §14.2 gate: the 10,000 x 500 reference run through the real
// Worker pool, harness and store of the built app, driven from Settings -> Benchmark. Wall-clock is
// measured from the click on Run (pool spin-up included) to the card showing the result.
// PERF_BUDGET_MS: default 20000 locally; CI sets 60000. The node projection test is
// tests/build/perf/roulette-budget.perf.test.ts. Resume after reload is covered by e2e/resume.spec.ts.
import { expect, test } from '@playwright/test';

const budgetMs = Number(process.env.PERF_BUDGET_MS ?? (process.env.CI ? 60_000 : 20_000));
const SESSIONS = 10_000;
const MAX_ROUNDS = 500;

interface Bench {
  ms: number;
  rounds: number;
  sessions: number;
  roundsPerSec: number;
  workers: number;
  projectedMs: number;
  digest: string;
}

test('reference run 10,000 x 500 on real Workers finishes inside PERF_BUDGET_MS', async ({
  page,
}) => {
  test.setTimeout(budgetMs + 120_000);
  await page.goto('./?e2e#/settings/benchmark');
  await expect(page.locator('h1')).toBeVisible();

  const t0 = Date.now();
  await page.getByRole('button', { name: 'Run benchmark' }).click();
  const card = page.locator('[data-bench]');
  await expect(card).toBeVisible({ timeout: budgetMs + 60_000 });
  const wall = Date.now() - t0;

  const bench = JSON.parse((await card.getAttribute('data-bench')) as string) as Bench;
  const line = `real-Worker reference run: ${bench.rounds} rounds in ${Math.round(bench.ms)} ms (click-to-done ${wall} ms) = ${Math.round(bench.roundsPerSec)} rounds/s, ${bench.workers} workers, budget ${budgetMs} ms, digest ${bench.digest.slice(0, 16)}`;
  console.info(line);
  test
    .info()
    .annotations.push(
      { type: 'ms', description: String(Math.round(bench.ms)) },
      { type: 'rounds/s', description: String(Math.round(bench.roundsPerSec)) },
      { type: 'workers', description: String(bench.workers) },
    );

  expect(bench.sessions).toBe(SESSIONS);
  // No stops: nearly every session plays all 500 rounds, so a run cannot win by busting early.
  expect(bench.rounds).toBeGreaterThan(0.8 * SESSIONS * MAX_ROUNDS);
  expect(bench.workers).toBeGreaterThanOrEqual(1);
  expect(bench.ms).toBeLessThan(budgetMs);
  expect(wall).toBeLessThan(budgetMs + 2_000);
  await expect(card.locator('[data-field=workers]')).toHaveText(String(bench.workers));
});
