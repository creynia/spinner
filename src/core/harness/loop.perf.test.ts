// Perf budget of the harness (harness doc §14.1-§14.2; reconciliation P6): enabled with PERF=1 and
// run through the resource baton (`res browser`), never as part of `npm test`.
//
//   PERF=1 PERF_BUDGET_MS=20000 npx vitest run src/core/harness/loop.perf.test.ts
//
// `PERF_BUDGET_MS` bounds the end-to-end reference run (10,000 sessions x 500 rounds, in-thread
// transport so the whole run is one thread: the real pool only makes it faster). The default is
// 20000 locally and 60000 when `CI` is set. `PERF_MIN_ROUNDS_PER_SEC` (default 40000, the doc's
// generous CI floor) bounds the single-thread loop. Both numbers go to the step summary file when
// `GITHUB_STEP_SUMMARY` is set.
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  STAGED_COIN,
  coin,
  coinDefinition,
  compileTestStrategy,
  digestRunData,
  runCoinToEnd,
} from '../testing';
import { buildRunner } from './handler';
import { checkpointSchedule, chunkSizeFor } from './schedule';

const enabled = process.env.PERF === '1';
const budgetMs = Number(process.env.PERF_BUDGET_MS ?? (process.env.CI ? 60_000 : 20_000));
const minRoundsPerSec = Number(process.env.PERF_MIN_ROUNDS_PER_SEC ?? 40_000);

describe.skipIf(!enabled)('reference run (coin, staged, 10,000 x 500)', () => {
  it('micro-benchmark: runBatch over 64 sessions, single thread, stays above the floor', () => {
    const def = coinDefinition({
      strategy: STAGED_COIN,
      sessions: 10_000,
      maxRounds: 500,
      bankroll: 500_000,
      sampleSessions: 0,
    });
    const runner = buildRunner(
      coin,
      def,
      checkpointSchedule(500, 10_000, 'auto'),
      chunkSizeFor(500),
      10_000,
      compileTestStrategy,
    );
    runner.runBatch(0, 2, []); // warm up
    let rounds = 0;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      const out = runner.runBatch(0, 2, []); // chunk size 32: two chunks = 64 sessions
      for (const r of out.table.roundsPlayed) rounds += r;
    }
    const rps = rounds / ((performance.now() - t0) / 1000);
    console.info(`harness loop: ${Math.round(rps)} rounds/s single thread`);
    expect(rps).toBeGreaterThan(minRoundsPerSec);
  });

  it(
    'finishes inside PERF_BUDGET_MS at a healthy rounds/s',
    async () => {
      const def = coinDefinition({
        strategy: STAGED_COIN,
        sessions: 10_000,
        maxRounds: 500,
        bankroll: 500_000,
        seed: 1,
      });
      const t0 = performance.now();
      const data = await runCoinToEnd(def, { workers: 3 });
      const ms = performance.now() - t0;
      let rounds = 0;
      for (const r of data.summary.roundsPlayed) rounds += r;
      const rps = rounds / (ms / 1000);
      const line = `harness reference run: ${rounds} rounds in ${Math.round(ms)} ms = ${Math.round(rps)} rounds/s (budget ${budgetMs} ms, floor ${minRoundsPerSec} rounds/s), digest ${digestRunData(data)}`;
      console.info(line);
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
      expect(ms).toBeLessThan(budgetMs);
      expect(rps).toBeGreaterThan(minRoundsPerSec);
    },
    budgetMs + 30_000,
  );
});
