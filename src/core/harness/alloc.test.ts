// The session loop retains nothing per round (harness doc §14.3; this measures retained heap,
// not allocation churn, which the plugin's own arrays account for). Heap
// growth after a forced GC over 100k rounds stays under 1 MB, and does not scale with the number
// of rounds (10x the rounds, the same growth).
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { STAGED_COIN, coin, coinDefinition, compileTestStrategy } from '../testing';
import { buildRunner } from './handler';
import { checkpointSchedule, chunkSizeFor } from './schedule';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

function heapAfterGc(): number {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
}

describe('session loop memory', () => {
  const def = coinDefinition({
    strategy: STAGED_COIN,
    sessions: 1000,
    maxRounds: 100,
    bankroll: 1_000_000,
    sampleSessions: 0,
  });
  const schedule = checkpointSchedule(100, 1000, 'auto');
  const chunkSize = chunkSizeFor(100);
  const runner = buildRunner(coin, def, schedule, chunkSize, 1000, compileTestStrategy);
  const chunks = Math.ceil(1000 / chunkSize);

  function playRounds(batches: number): number {
    let rounds = 0;
    for (let b = 0; b < batches; b++) {
      const out = runner.runBatch(0, chunks, []);
      for (let i = 0; i < out.count; i++) rounds += out.table.roundsPlayed[i]!;
    }
    return rounds;
  }

  it('retains nothing per round: 100k rounds grow the heap by less than 1 MB, and 1M rounds by about the same', () => {
    playRounds(3); // warm up the JIT and every lazily built cache
    const h0 = heapAfterGc();
    const r1 = playRounds(1);
    const h1 = heapAfterGc();
    expect(r1).toBeGreaterThanOrEqual(100_000 * 0.9);
    expect(h1 - h0).toBeLessThan(1024 * 1024);

    const r2 = playRounds(10);
    const h2 = heapAfterGc();
    expect(r2).toBeGreaterThanOrEqual(1_000_000 * 0.9);
    expect(h2 - h1).toBeLessThan(1024 * 1024);
  });
});
