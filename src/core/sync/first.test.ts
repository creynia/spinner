// WP-S2c: first sync (preview, merge, Replace), re-seed and the local reset (sync.md §7.3, §7.9
// step 6, §7.10, §8.3, §11.1). Every scenario runs on memory AND fake-indexeddb.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteError, type SyncMetaKey, type SyncMetaValues } from '../contracts/sync';
import type { Backend } from '../store';
import {
  bundleFiles,
  finishRun,
  newLog,
  putStubRun,
  recording,
  runStubs,
  tinyRun,
} from './__fixtures__/runs-kit';
import {
  dump,
  group,
  indexOf,
  layout,
  makeDevice,
  marks,
  records,
  strategy,
  strategyBody,
  useIdb,
  userDel,
  userPut,
  worldClock,
  type Dev,
} from './engine-testkit';
import { EngineError } from './apply';
import { SYNC_META_KEEP } from './engine';
import { beginFirst, previewFirst, reseed } from './first';
import { resetLocalSyncState } from './erase';
import { decodeLib, LIB_NAME, ROOT_NAME } from './libfile';
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
const counter = async (d: Dev): Promise<number> => (await meta(d, 'vvCounter')) ?? 0;
const settle = async (...ds: Dev[]): Promise<void> => {
  for (let r = 0; r < 3; r++) for (const d of ds) await d.cycle();
};

async function world(
  idb: boolean,
  over: Parameters<typeof makeDevice>[0] extends infer T ? Partial<T> : never = {},
) {
  const inner = createMemoryRemote();
  const log = newLog();
  const mk = (id: string, o: Partial<Parameters<typeof makeDevice>[0]> = {}) =>
    makeDevice({ id, idb, now: clock, remote: recording(inner, log), ...over, ...o });
  return { inner, log, a: await mk(A), b: await mk(B), mk };
}

describe.each([false, true])('first sync (idb %s)', (idb) => {
  describe('previewFirst', () => {
    it('an empty Drive: remoteEmpty, with the local counts', async () => {
      const { a } = await world(idb);
      await userPut(a, 'strategy', await strategy('s1', 'x'));
      await userPut(a, 'layout', await layout('l1', 'x'));
      await finishRun(a, await tinyRun(1));
      await putDry(a);
      const paused = await finishRun(a, await tinyRun(2));
      await putStubRun(a, paused, 'paused'); // Replace would delete this too: the sheet counts it
      const p = await previewFirst(await a.ctx());
      expect(p.remoteEmpty).toBe(true);
      expect(p.remote).toMatchObject({
        experiments: 0,
        strategies: 0,
        layouts: 0,
        runs: 0,
        runBytes: 0,
      });
      // everything Replace would delete: the dry definition and the paused run count
      expect(p.local).toMatchObject({ experiments: 3, strategies: 1, layouts: 1, runs: 2 });
      expect(p.local.runBytes).toBeGreaterThan(0);
    });

    it('a Drive with data: counts, who wrote last and when; tombstones and stubs not counted', async () => {
      const { a, b } = await world(idb);
      await userPut(a, 'strategy', await strategy('s1', 'x'));
      await userPut(a, 'strategy', await strategy('s2', 'y'));
      await userPut(a, 'layout', await layout('l1', 'x'));
      const done = await finishRun(a, await tinyRun(2));
      const other = await finishRun(a, await tinyRun(3));
      await putStubRun(a, other, 'paused');
      await userDel(a, 'strategy', 's2');
      await settle(a, b);
      await userPut(b, 'strategy', await strategy('s9', 'z'));
      const fresh = await (await world2(idb, a)).ctx();
      const pr = await previewFirst(fresh);
      expect(pr.remoteEmpty).toBe(false);
      expect(pr.remote).toMatchObject({ experiments: 2, strategies: 1, layouts: 1, runs: 1 });
      expect(pr.remote.runBytes).toBe((await runStubs(a)).get(done.runId)!.bundle!.bytes);
      expect(pr.remote.fromName).toBeDefined();
      expect(Number.isNaN(Date.parse(pr.remote.syncedAt!))).toBe(false);
      expect(pr.local).toMatchObject({ experiments: 0, strategies: 0, layouts: 0, runs: 0 });
    });

    it('refuses a root of a newer layout', async () => {
      const { inner, a } = await world(idb);
      await inner.create(
        ROOT_NAME,
        new TextEncoder().encode(JSON.stringify({ format: 'spinner-sync', version: 2 })),
        {},
      );
      await expect(previewFirst(await a.ctx())).rejects.toBeInstanceOf(EngineError);
    });
  });

  describe('merge', () => {
    it('identical content is a no-op; different content is a copy; nothing is lost', async () => {
      const { a, b } = await world(idb);
      await userPut(a, 'strategy', await strategy('same', 'x'));
      await userPut(a, 'strategy', await strategy('diff', 'from-A'));
      await userPut(a, 'group', group('only-a', 'a'));
      await a.cycle();
      await userPut(b, 'strategy', await strategy('same', 'x'));
      await userPut(b, 'strategy', await strategy('diff', 'from-B'));
      await userPut(b, 'group', group('only-b', 'b'));
      await b.tracked.tx(['syncDirty'], 'readwrite', (t) => t.delete('syncDirty', 'strategy:same'));
      // the marks the tracker wrote are not what a first sync relies on: it seeds its own
      await b.raw.tx(['syncDirty'], 'readwrite', (t) => {
        for (const k of ['strategy:diff', 'group:only-b']) t.delete('syncDirty', k);
      });
      expect(await marks(b)).toEqual([]);
      const r = await beginFirst(await b.ctx(), 'merge');
      expect(r.outcome).toBe('ok');
      expect(r.copies).toBe(1);
      await settle(a, b);
      const bodies = [...(await records(b, 'strategy')).values()].map(strategyBody).sort();
      expect(bodies).toEqual(['from-A', 'from-B', 'x']);
      expect((await records(b, 'group')).size).toBe(2);
      expect(await dump(a)).toBe(await dump(b));
      expect(await marks(b)).toEqual([]);
    });

    it('seeds a mark for every record through raw (no tracker), so definitions and runs go too', async () => {
      const { inner, a } = await world(idb);
      await finishRun(a, await tinyRun(4));
      await userPut(a, 'strategy', await strategy('s1', 'x'));
      // the pre-existing state of a device that never synced: records, no index, no marks
      await a.raw.tx(['syncDirty'], 'readwrite', (t) => {
        for (const k of ['strategy:s1']) t.delete('syncDirty', k);
      });
      for (const k of await a.raw.getAllKeys('syncDirty')) {
        await a.raw.tx(['syncDirty'], 'readwrite', (t) => t.delete('syncDirty', k));
      }
      const r = await beginFirst(await a.ctx(), 'merge');
      expect(r.outcome).toBe('ok');
      expect(r.pushed).toBeGreaterThanOrEqual(3); // def, run, strategy
      expect(await bundleFiles(inner)).toHaveLength(1);
      expect(await marks(a)).toEqual([]);
      expect(await meta(a, 'last')).toBeDefined();
    });

    it('waits for an active run: waiting-run, no request, nothing seeded', async () => {
      let active = true;
      const { log, a } = await world(idb, { isRunActive: () => active });
      await userPut(a, 'strategy', await strategy('s1', 'x'));
      await a.raw.tx(['syncDirty'], 'readwrite', (t) => t.delete('syncDirty', 'strategy:s1'));
      const r = await beginFirst(await a.ctx(), 'merge');
      expect(r).toMatchObject({ outcome: 'waiting-run', requests: 0, pushed: 0 });
      expect(log.ops).toEqual([]);
      expect(await marks(a)).toEqual([]);
      active = false;
      expect((await beginFirst(await a.ctx(), 'merge')).outcome).toBe('ok');
      expect((await indexOf(a)).has('strategy:s1')).toBe(true);
    });
  });

  describe('Replace', () => {
    it("wipes this device's synced data and state, then pulls the remote; vvCounter and copies survive", async () => {
      const { inner, a, b } = await world(idb);
      await userPut(a, 'strategy', await strategy('s1', 'from-A'));
      await finishRun(a, await tinyRun(5));
      await settle(a);
      // B has its own stuff, including a run, and a settings row that stays on its device
      await userPut(b, 'strategy', await strategy('mine', 'B-only'));
      await finishRun(b, await tinyRun(6));
      await b.raw.tx(['settings'], 'readwrite', (t) =>
        t.put('settings', { key: 'theme', value: 'dark' }),
      );
      await b.raw.tx(['syncMeta'], 'readwrite', (t) =>
        t.put('syncMeta', { k: 'copies', v: ['kept-copy'] }),
      );
      const vv0 = await counter(b);
      const r = await beginFirst(await b.ctx(), 'replace');
      expect(r.outcome).toBe('ok');
      expect([...(await records(b, 'strategy')).keys()]).toEqual(['s1']);
      expect((await b.raw.getAllKeys('runs')).length).toBe(0); // A's run is remote-only: onOpen
      expect((await records(b, 'def')).size).toBe(1); // A's definition, not B's
      expect((await b.raw.get('settings', 'theme')) !== undefined).toBe(true); // not synced: untouched
      expect(await counter(b)).toBeGreaterThanOrEqual(vv0);
      expect(await meta(b, 'copies')).toEqual(['kept-copy']);
      expect(await marks(b)).toEqual([]);
      // B's old records were not published as deletes: A still has everything
      await settle(a, b);
      expect((await records(a, 'strategy')).has('mine')).toBe(false);
      expect(await bundleFiles(inner)).toHaveLength(1);
      expect(await dump(a)).toBe(await dump(b));
    });

    describe.each([
      ['an empty Drive', (_inner: ReturnType<typeof createMemoryRemote>) => Promise.resolve()],
      [
        'a Drive where every lib is damaged',
        async (inner: ReturnType<typeof createMemoryRemote>) => {
          for (const d of ['cccccccccc', 'dddddddddd']) {
            await inner.create(LIB_NAME(d), new Uint8Array([1, 2, 3, 4]), {
              appProperties: { kind: 'lib' },
            });
          }
        },
      ],
      [
        'a Drive whose only lib has no entries',
        async (inner: ReturnType<typeof createMemoryRemote>) => {
          const empty = await makeDevice({
            id: 'cccccccccc',
            idb: false,
            now: clock,
            remote: inner,
          });
          await empty.cycle();
        },
      ],
    ])('Replace against %s', (_name, setup) => {
      it('wipes nothing and keeps the sync state', async () => {
        const { inner, a } = await world(idb);
        await setup(inner);
        await userPut(a, 'group', group('g', 'mine'));
        await finishRun(a, await tinyRun(60));
        const before = await dump(a);
        const runs = await a.raw.getAllKeys('runs');
        const index = (await indexOf(a)).size;
        const r = await beginFirst(await a.ctx(), 'replace');
        expect(r.outcome).toBe('error');
        expect(r.error?.message).toMatch(/Nothing was deleted/);
        expect(await dump(a)).toBe(before);
        expect(await a.raw.getAllKeys('runs')).toEqual(runs);
        expect((await a.raw.getAllKeys('summaries')).length).toBe(1);
        expect((await indexOf(a)).size).toBe(index);
        expect(await marks(a)).toEqual(
          [
            'def:' + (await a.raw.getAll<{ id: string }>('definitions'))[0]!.id,
            'group:g',
            `run:${runs[0] as string}`,
          ].sort(),
        );
      });
    });

    it('is one transaction: a failure leaves the device exactly as it was', async () => {
      let fail = true;
      const wrapRaw = (b: Backend): Backend => ({
        ...b,
        kind: b.kind,
        get: (s, k) => b.get(s, k),
        getAll: (s, i, r) => b.getAll(s, i, r),
        getAllKeys: (s, r) => b.getAllKeys(s, r),
        update: (s, f) => b.update(s, f),
        tx: (s, m, f) =>
          fail && s.includes('definitions') && s.includes('syncIndex')
            ? Promise.reject(new Error('injected: wipe'))
            : b.tx(s, m, f),
      });
      const { b, a } = await world(idb, {});
      const d = await makeDevice({
        id: 'dddddddddd',
        idb,
        now: clock,
        remote: a.deps.remote,
        wrapRaw,
      });
      await userPut(d, 'strategy', await strategy('mine', 'x'));
      await d.cycle();
      const before = await dump(d);
      const last = await meta(d, 'last');
      await expect(beginFirst(await d.ctx(), 'replace')).rejects.toThrow('injected');
      expect(await dump(d)).toBe(before);
      expect(await meta(d, 'last')).toBe(last);
      expect((await indexOf(d)).size).toBeGreaterThan(0);
      fail = false;
      void b;
      expect((await beginFirst(await d.ctx(), 'replace')).outcome).toBe('ok');
    });
  });

  describe('resetLocalSyncState', () => {
    it('keeps device, vvCounter, copies and the caller-owned rows; clears the rest; data stays', async () => {
      const { a } = await world(idb);
      await userPut(a, 'strategy', await strategy('s1', 'x'));
      await a.cycle();
      await a.raw.tx(['syncMeta'], 'readwrite', (t) => {
        t.put('syncMeta', { k: 'copies', v: ['c1'] });
        t.put('syncMeta', { k: 'bundles', v: { r: { name: 'n', bytes: 1, sha256: 's' } } });
        t.put('syncMeta', { k: 'uploads', v: { k: 'u' } });
        t.put('syncMeta', {
          k: 'prefs',
          v: { enabled: true, deviceName: 'x', runDownload: 'all' },
        });
        t.put('syncMeta', { k: 'account', v: { accountId: 'a', email: 'e', boundAt: 'b' } });
      });
      await userPut(a, 'strategy', await strategy('s2', 'y')); // a pending mark
      const keep = {
        device: await meta(a, 'device'),
        vv: await counter(a),
        clock: await meta(a, 'clock'),
      };
      await resetLocalSyncState(await a.ctx());
      for (const k of SYNC_META_KEEP) expect(await meta(a, k), k).toBeDefined();
      expect(await meta(a, 'device')).toEqual(keep.device);
      expect(await counter(a)).toBe(keep.vv);
      expect(await meta(a, 'clock')).toBe(keep.clock);
      expect(await meta(a, 'copies')).toEqual(['c1']);
      expect(await meta(a, 'prefs')).toBeDefined();
      expect(await meta(a, 'account')).toBeDefined();
      for (const k of ['seen', 'files', 'last', 'libSha', 'bundles', 'uploads', 'gcAt'] as const) {
        expect(await meta(a, k as SyncMetaKey), k).toBeUndefined();
      }
      expect(await a.raw.getAllKeys('syncIndex')).toEqual([]);
      expect(await marks(a)).toEqual([]);
      expect((await records(a, 'strategy')).size).toBe(2); // local data untouched
    });

    it('the next cycle is a first sync: identical content matches, nothing is copied', async () => {
      const { a, b } = await world(idb);
      await userPut(a, 'strategy', await strategy('s1', 'x'));
      await settle(a, b);
      await resetLocalSyncState(await b.ctx());
      // a reset device re-seeds its marks the way beginFirst does
      const r = await beginFirst(await b.ctx(), 'merge');
      expect(r.copies).toBe(0);
      await settle(a, b);
      expect((await records(b, 'strategy')).size).toBe(1);
    });
  });

  describe('account switch and the counter (N1)', () => {
    it('vvCounter never goes down across re-seed, Replace, account switch and erase', async () => {
      const { a } = await world(idb);
      const seen: number[] = [];
      const note = async (): Promise<void> => void seen.push(await counter(a));
      for (let i = 0; i < 3; i++) {
        await userPut(a, 'group', group('g', `v${i}`));
        await a.cycle();
      }
      await note();
      // re-seed: our lib file is lost
      await lose(a);
      await a.cycle();
      await note();
      // Replace
      await beginFirst(await a.ctx(), 'replace');
      await note();
      // account switch: a different Drive account, reset, then merge
      await userPut(a, 'group', group('g2', 'x'));
      await resetLocalSyncState(await a.ctx());
      await note();
      await beginFirst(await a.ctx(), 'merge'); // ... and the first sync on the new account
      await note();
      // erase
      const { eraseRemote } = await import('./erase');
      await eraseRemote(await a.ctx());
      await note();
      for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
      expect(seen[0]!).toBeGreaterThan(0);
    });

    it('push 3 edits, lose the own lib, re-seed, edit: the edit wins on the peer', async () => {
      const { inner, a, b } = await world(idb);
      for (let i = 0; i < 3; i++) {
        await userPut(a, 'group', group('g', `v${i}`));
        await a.cycle();
      }
      await b.cycle();
      const vv = await counter(a);
      await lose(a); // lib file gone, files.ownLib forgotten
      expect(await inner.list().then((l) => l.some((f) => f.name === LIB_NAME(A)))).toBe(false);
      await userPut(a, 'group', group('g', 'after'));
      const r = await a.cycle();
      expect(r.outcome).toBe('ok');
      expect(r.copies).toBe(0);
      expect(await counter(a)).toBeGreaterThan(vv);
      await settle(a, b);
      expect(
        [...(await records(b, 'group')).values()].map((g) => (g.runIds as string[])[0]),
      ).toEqual(['after']);
    });
  });

  describe('re-seed (§7.9 step 6)', () => {
    it('keeps the index and the counter, rewrites the lib with the SAME entries, no false copies', async () => {
      const { inner, a, b } = await world(idb);
      await userPut(a, 'group', group('g', 'one'));
      await userPut(a, 'strategy', await strategy('s1', 'x'));
      await settle(a, b);
      const before = await indexOf(a);
      const libBefore = await decodeLib(
        await inner.download((await inner.list()).find((f) => f.name === LIB_NAME(A))!.id),
      );
      const vv = await counter(a);
      await lose(a);
      const r = await a.cycle();
      expect(r.outcome).toBe('ok');
      expect(r.copies).toBe(0);
      expect(r.pushed).toBe(0); // nothing is re-minted
      expect(await counter(a)).toBe(vv);
      const after = await indexOf(a);
      for (const [k, row] of before) expect(after.get(k)!.entry).toEqual(row.entry);
      const libAfter = await decodeLib(
        await inner.download((await inner.list()).find((f) => f.name === LIB_NAME(A))!.id),
      );
      expect(libAfter.entries).toEqual(libBefore.entries);
      await settle(a, b);
      expect(await dump(a)).toBe(await dump(b));
      expect((await records(b, 'group')).size).toBe(1);
    });

    it('reseed() itself only forgets what described the lost file', async () => {
      const { a } = await world(idb);
      await userPut(a, 'group', group('g', 'one'));
      await a.cycle();
      const files = (await meta(a, 'files'))!;
      expect(files.ownLib).toBeDefined();
      await reseed(await a.ctx());
      expect(await meta(a, 'libSha')).toBeUndefined();
      expect((await meta(a, 'files'))!.ownLib).toBeUndefined();
      expect((await meta(a, 'files'))!.root).toEqual(files.root);
      expect((await indexOf(a)).size).toBe(1);
    });
  });

  it('a network fault while previewing surfaces as a RemoteError (nothing is half-done)', async () => {
    const inner = createMemoryRemote({
      fault: (op) => (op === 'list' ? new RemoteError('network', 0, 'x') : undefined),
    });
    const a = await makeDevice({ id: A, idb, now: clock, remote: inner });
    await expect(previewFirst(await a.ctx())).rejects.toBeInstanceOf(RemoteError);
  });
});

// ------------------------------------------------------------------ helpers

/** Our lib file is gone from Drive and from `files.ownLib` (GC'd as stale, or deleted by hand). */
async function lose(d: Dev): Promise<void> {
  const remote = d.deps.remote;
  const f = (await remote.list()).find((x) => x.name === LIB_NAME(d.id));
  if (f) await remote.delete(f.id);
  const files = (await meta(d, 'files')) ?? {};
  await d.raw.tx(['syncMeta'], 'readwrite', (t) => {
    t.put('syncMeta', { k: 'files', v: files.root ? { root: files.root } : {} });
  });
  d.restart();
}

async function putDry(d: Dev): Promise<void> {
  const rec = {
    v: 1,
    id: 'dry-def',
    definition: { name: 'dry' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    origin: 'user',
    runIds: [],
    dry: true,
  };
  await d.tracked.tx(['definitions'], 'readwrite', (t) => t.put('definitions', rec));
}

/** A second device on the same remote as `of`, with an empty store. */
async function world2(idb: boolean, of: Dev): Promise<Dev> {
  return makeDevice({ id: 'eeeeeeeeee', idb, now: clock, remote: of.deps.remote });
}
