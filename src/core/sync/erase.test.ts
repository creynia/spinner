// WP-S2c: "Remove my data from Drive" (sync.md §7.10): the root is rewritten with `erased`, every
// other file goes, local sync state is reset (copies included), local data stays.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RemoteError,
  type SyncMetaKey,
  type SyncMetaValues,
  type SyncRootV1,
} from '../contracts/sync';
import { utf8Decode } from '../experiment';
import { bundleFiles, finishRun, tinyRun } from './__fixtures__/runs-kit';
import {
  dump,
  group,
  makeDevice,
  marks,
  records,
  useIdb,
  userPut,
  worldClock,
  wrapRemote,
  type Dev,
} from './engine-testkit';
import { eraseRemote } from './erase';
import type { RemoteStore } from '../contracts/sync';
import { LIB_NAME } from './libfile';
import { beginFirst } from './first';
import { ROOT_NAME } from './libfile';
import { createMemoryRemote } from './memory-remote';

const A = 'aaaaaaaaaa';
const B = 'bbbbbbbbbb';
useIdb(() => new IDBFactory());

let clock: () => number;
beforeEach(() => {
  clock = worldClock();
  vi.spyOn(Date, 'now').mockImplementation(() => clock());
});
afterEach(() => vi.restoreAllMocks());

const meta = async <K extends SyncMetaKey>(d: Dev, k: K): Promise<SyncMetaValues[K] | undefined> =>
  (await d.raw.get<{ v: SyncMetaValues[K] }>('syncMeta', k))?.v;
const settle = async (...ds: Dev[]): Promise<void> => {
  for (let r = 0; r < 3; r++) for (const d of ds) await d.cycle();
};

describe.each([false, true])('erase (idb %s)', (idb) => {
  async function world() {
    const inner = createMemoryRemote();
    const a = await makeDevice({ id: A, idb, now: clock, remote: inner });
    const b = await makeDevice({ id: B, idb, now: clock, remote: inner });
    await userPut(a, 'group', group('g', 'one'));
    await finishRun(a, await tinyRun(1));
    await settle(a, b);
    return { inner, a, b };
  }
  const rootOf = async (r: ReturnType<typeof createMemoryRemote>): Promise<SyncRootV1> => {
    const f = (await r.list()).find((x) => x.name === ROOT_NAME)!;
    return JSON.parse(utf8Decode(await r.download(f.id))) as SyncRootV1;
  };

  it('marks the root erased, deletes every other file, resets local sync state; data stays', async () => {
    const { inner, a } = await world();
    expect((await inner.list()).length).toBeGreaterThan(3); // root, two libs, a bundle
    await a.raw.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k: 'copies', v: ['c1'] }));
    const vv = (await meta(a, 'vvCounter'))!;
    const device = await meta(a, 'device');
    await eraseRemote(await a.ctx());
    const left = await inner.list();
    expect(left.map((f) => f.name)).toEqual([ROOT_NAME]);
    const root = await rootOf(inner);
    expect(root.erased).toMatchObject({ by: A });
    expect(Number.isNaN(Date.parse(root.erased!.at))).toBe(false);
    // local
    expect(await a.raw.getAllKeys('syncIndex')).toEqual([]);
    expect(await marks(a)).toEqual([]);
    expect(await meta(a, 'last')).toBeUndefined();
    expect(await meta(a, 'copies')).toBeUndefined(); // erase clears copies too
    expect(await meta(a, 'vvCounter')).toBe(vv);
    expect(await meta(a, 'device')).toEqual(device);
    expect((await records(a, 'group')).size).toBe(1);
    expect((await a.raw.getAllKeys('runs')).length).toBe(1);
    expect(await bundleFiles(inner)).toHaveLength(0);
  });

  it('other devices see the marker and turn off', async () => {
    const { a, b } = await world();
    await eraseRemote(await a.ctx());
    const r = await b.cycle();
    expect(r.outcome).toBe('off');
    expect(r.error?.code).toBe('erased');
    expect((await records(b, 'group')).size).toBe(1); // their data stays
  });

  it('a later sign-in rewrites the root without `erased` and uploads the data again', async () => {
    const { inner, a } = await world();
    const vv = (await meta(a, 'vvCounter'))!;
    await eraseRemote(await a.ctx());
    const r = await beginFirst(await a.ctx(), 'merge');
    expect(r.outcome).toBe('ok');
    expect((await rootOf(inner)).erased).toBeUndefined();
    expect((await bundleFiles(inner)).length).toBe(1);
    expect((await meta(a, 'vvCounter'))!).toBeGreaterThan(vv);
    const fresh = await makeDevice({ id: 'cccccccccc', idb, now: clock, remote: inner });
    await fresh.cycle();
    expect(await dump(fresh)).toBe(await dump(a));
  });

  it('an interrupted erase keeps the local state; running it again finishes', async () => {
    const inner = createMemoryRemote();
    let deletes = 0;
    let armed = true;
    const a = await makeDevice({
      id: A,
      idb,
      now: clock,
      remote: wrapRemote(inner, {
        fault: (op, _n, phase) =>
          armed && op === 'delete' && phase === 'before' && ++deletes === 2
            ? new RemoteError('network', 0, 'injected')
            : undefined,
      }),
    });
    await userPut(a, 'group', group('g', 'one'));
    await finishRun(a, await tinyRun(2));
    await a.cycle();
    await expect(eraseRemote(await a.ctx())).rejects.toBeInstanceOf(RemoteError);
    expect((await rootOf(inner)).erased).toBeDefined(); // others already stop
    expect(await meta(a, 'last')).toBeDefined(); // this device did not reset yet
    armed = false;
    await eraseRemote(await a.ctx());
    expect((await inner.list()).map((f) => f.name)).toEqual([ROOT_NAME]);
    expect(await meta(a, 'last')).toBeUndefined();
  });

  it('a listing that lags our own lib and a peer lib: nothing survives, then local state resets', async () => {
    const inner = createMemoryRemote({ listingLag: { ownLib: 4 } });
    const a = await makeDevice({ id: A, idb, now: clock, remote: inner });
    const b = await makeDevice({ id: B, idb, now: clock, remote: inner });
    await userPut(a, 'group', group('g', 'one'));
    await b.cycle(); // B's lib is created just now: A has never seen it, and the listing hides it
    await a.cycle(); // so is A's
    await eraseRemote(await a.ctx());
    for (let i = 0; i < 6; i++)
      expect((await inner.list()).map((f) => f.name)).toEqual([ROOT_NAME]);
    expect(await meta(a, 'last')).toBeUndefined();
  });

  it('files that never leave the listing: erase fails and local state is NOT reset', async () => {
    const inner = createMemoryRemote();
    // a peer file whose delete "succeeds" but does not take (a flaky or racing remote)
    const sticky: RemoteStore = {
      ...inner,
      kind: inner.kind,
      list: (o) => inner.list(o),
      download: (id, o) => inner.download(id, o),
      create: (n, b, o) => inner.create(n, b, o),
      update: (id, b, o) => inner.update(id, b, o),
      about: () => inner.about(),
      delete: async (id, o) => {
        const f = (await inner.list()).find((x) => x.id === id);
        if (f?.name === LIB_NAME(B)) return;
        await inner.delete(id, o);
      },
    };
    const a = await makeDevice({ id: A, idb, now: clock, remote: sticky });
    const b = await makeDevice({ id: B, idb, now: clock, remote: inner });
    await userPut(a, 'group', group('g', 'one'));
    await a.cycle();
    await b.cycle();
    await expect(eraseRemote(await a.ctx())).rejects.toThrow(/still in Drive/);
    expect(await meta(a, 'last')).toBeDefined();
    expect((await a.raw.getAllKeys('syncIndex')).length).toBeGreaterThan(0);
  });

  it('tolerates files that vanish while it deletes, and an erase with no root', async () => {
    const inner = createMemoryRemote();
    const a = await makeDevice({ id: A, idb, now: clock, remote: inner });
    await eraseRemote(await a.ctx()); // nothing there at all
    expect((await rootOf(inner)).erased).toBeDefined();
    await eraseRemote(await a.ctx()); // again: idempotent
    expect((await inner.list()).map((f) => f.name)).toEqual([ROOT_NAME]);
  });
});
