// WP-S2b: the S-A small-pool partition-and-heal fuzz through the engine (sync.md §11.1). Identical
// edits on different devices are common; the devices are partitioned 1 | 2 for most steps, then
// healed and settled. Asserts convergence, vv uniqueness and zero copies of copies. Harness: engine-fuzz-kit.ts.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { check, FROM, fuzzAfter, fuzzBefore, SEEDS } from './__fixtures__/engine-fuzz-kit';
import { useIdb } from './engine-testkit';

useIdb(() => new IDBFactory());
beforeEach(fuzzBefore);
afterEach(fuzzAfter);

describe('engine fuzz, S-A', () => {
  it('small content pool, partition then heal through the engine: zero copies of copies', async () => {
    let copies = 0;
    for (let seed = FROM; seed <= SEEDS; seed++) {
      copies += await check({ seed, steps: 300, pool: 2, healAt: 200 }, 'S-A');
    }
    expect(copies).toBeGreaterThan(0);
  }, 3_600_000);
});
