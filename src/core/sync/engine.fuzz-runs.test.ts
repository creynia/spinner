// WP-S2c: the convergence fuzz of engine.fuzz.test.ts with runs in the mix: private runs (paused,
// then finished), shared imports of one file on several devices, deletes, bundle uploads and
// downloads interleaved with other devices' cycles, and injected network faults. The harness and
// the assertions are in __fixtures__/engine-fuzz-kit.ts (every S2b assertion still runs).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { check, FROM, fuzzAfter, fuzzBefore, SEEDS } from './__fixtures__/engine-fuzz-kit';
import { useIdb } from './engine-testkit';

useIdb(() => new IDBFactory());
beforeEach(fuzzBefore);
afterEach(fuzzAfter);

describe('engine fuzz with runs', () => {
  it(`converges with runs and shared imports (${SEEDS} seeds, faults on)`, async () => {
    for (let seed = FROM; seed <= SEEDS; seed++) {
      await check({ seed, steps: 300, faults: true, runs: true }, 'runs');
    }
  }, 1_800_000);

  it('the same on fake-indexeddb (5 seeds)', async () => {
    for (let seed = 1; seed <= 5; seed++) {
      await check({ seed, steps: 120, faults: true, idb: true, runs: true }, 'runs-idb');
    }
  }, 900_000);

  it('a small content pool (identical edits are common) with runs', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      await check({ seed, steps: 200, pool: 2, healAt: 120, runs: true }, 'runs-pool');
    }
  }, 900_000);
});
