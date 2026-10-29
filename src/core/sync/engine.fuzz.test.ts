// WP-S2b: the call-level convergence fuzz through the real engine (sync.md §11.1). The harness and
// its assertions are in engine-fuzz-kit.ts. Three devices
// share one memory remote. Every remote call of every device first runs a scheduler hook, which
// may run steps of the OTHER devices (user edits, whole cycles, restarts) before the call
// proceeds, so cycles interleave mid-cycle and the B1 race falls anywhere in a cycle. Network
// faults (before and after the effect) are injected too. The harness ideas are merge.fuzz.test.ts's.
//
// Asserted, over every entry PUBLISHED OR ATTEMPTED (a faulted upload was still minted):
//   - every live maximal entry of a copyable kind survives (as itself or as a copy);
//   - a def's maximal entries all survive in the join (runIds union);
//   - no key whose maximal entries are all tombstones is alive on any device;
//   - no (device, counter) is minted twice, across restarts;
//   - zero copies of copies;
//   - the devices converge to identical stores, with no dirty marks left.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { check, FROM, fuzzAfter, fuzzBefore, SEEDS } from './__fixtures__/engine-fuzz-kit';
import { useIdb } from './engine-testkit';

useIdb(() => new IDBFactory());
beforeEach(fuzzBefore);
afterEach(fuzzAfter);

describe('engine fuzz', () => {
  it(`converges, keeps every maximal edit, never copies a copy (${SEEDS} seeds, faults on)`, async () => {
    let copies = 0;
    for (let seed = FROM; seed <= SEEDS; seed++) {
      copies += await check({ seed, steps: 300, faults: true }, 'main');
    }
    expect(copies).toBeGreaterThan(0); // the fuzz really exercises copies
  }, 900_000);

  it('the same on fake-indexeddb (5 seeds)', async () => {
    for (let seed = 1; seed <= 5; seed++) {
      await check({ seed, steps: 120, faults: true, idb: true }, 'idb');
    }
  }, 900_000);
});
