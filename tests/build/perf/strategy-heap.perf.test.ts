// strategy.md §17.9 on the real stack: the interpreter (R19 red-with-zero-boost: stages, extends,
// cooldown, history trackers, once) driving the real roulette plugin through the session loop.
//  - heap: retained heap after a forced GC does not grow over 100k-window passes (no per-round
//    retention in the loop, the interpreter, the reconcile/apply path or the plugin);
//  - throughput: a generous floor (PERF_MIN_ROUNDS_PER_SEC, default 40,000/s single thread, the
//    harness doc's CI floor).
// Enabled with PERF=1.
import { appendFileSync } from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PERF_ENABLED, rouletteDef, runnerFor } from '../roulette-helpers';

const minRoundsPerSec = Number(process.env.PERF_MIN_ROUNDS_PER_SEC ?? 40_000);

function heapAfterGc(): number {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  gc();
  gc();
  return process.memoryUsage().heapUsed;
}

/** strategy.md R19 with the five-boost stop lifted so sessions run their full length. */
const R19 = {
  schema: 1,
  id: 'red-with-zero-boost',
  name: 'Red with a zero boost',
  game: 'roulette',
  unit: 2500,
  vars: { boosts: 0, zeroOff: 0 },
  stages: [
    {
      id: 'base',
      layout: [{ bet: 'red', amount: { units: 1 } }],
      rules: [
        {
          id: 'enough',
          when: { cmp: [{ var: 'boosts' }, '>=', 1_000_000] },
          then: [{ stop: 'five-boosts' }],
        },
        {
          id: 'boost-on',
          when: { countInLast: { event: 'zero', n: 20, atLeast: 2, partial: true } },
          cooldown: 20,
          then: [{ goto: 'boost' }],
        },
      ],
    },
    {
      id: 'boost',
      extends: 'base',
      onEnter: [{ inc: 'boosts' }],
      onExit: [{ set: 'zeroOff', to: 0 }],
      layout: [
        { bet: 'red', amount: { units: 2 } },
        { bet: 'straight:0', amount: 500, when: { cmp: [{ var: 'zeroOff' }, '==', 0] } },
      ],
      rules: [
        {
          id: 'zero-off',
          once: 'stage',
          when: { cmp: ['net', '>', 0] },
          then: [{ set: 'zeroOff', to: 1 }],
        },
        { id: 'boost-off', when: { cmp: ['roundsInStage', '>=', 10] }, then: [{ goto: 'base' }] },
      ],
    },
  ],
};

describe.skipIf(!PERF_ENABLED)('session loop over real roulette + interpreter (R19)', () => {
  const SESSIONS = 200;
  const ROUNDS = 500; // 100,000 windows per pass

  it('retains nothing per window over 100k-window passes, and meets the throughput floor', () => {
    const def = rouletteDef('red-with-zero-boost', {
      strategy: R19,
      sessions: SESSIONS,
      maxRounds: ROUNDS,
      bankroll: 50_000_000, // never busts: every pass plays exactly SESSIONS x ROUNDS windows
      samples: 0,
    });
    const runner = runnerFor(def);
    const chunks = Math.ceil(SESSIONS / runner.chunkSize);

    function pass(): number {
      let rounds = 0;
      const out = runner.runBatch(0, chunks, []);
      for (let i = 0; i < out.count; i++) rounds += out.table.roundsPlayed[i]!;
      return rounds;
    }

    expect(pass()).toBe(SESSIONS * ROUNDS); // warm-up (JIT, caches)
    const base = heapAfterGc();
    const growth: number[] = [];
    let rounds = 0;
    let ms = 0;
    for (let k = 0; k < 4; k++) {
      const t0 = performance.now();
      rounds += pass();
      ms += performance.now() - t0;
      growth.push(heapAfterGc() - base);
    }
    const rps = rounds / (ms / 1000);
    const line = `R19 session loop: ${rounds} rounds in ${Math.round(ms)} ms = ${Math.round(rps)} rounds/s; retained heap after each 100k-window pass: ${growth.map((g) => `${(g / 1024).toFixed(0)} KiB`).join(', ')}`;
    console.info(line);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
    // A per-window leak of even 8 bytes would retain 800 KB per pass: stay well under 1 MiB, and
    // do not trend upwards across passes.
    for (const g of growth) expect(g).toBeLessThan(1024 * 1024);
    expect(growth[3]! - growth[0]!).toBeLessThan(512 * 1024);
    expect(rps).toBeGreaterThan(minRoundsPerSec);
  });
});
