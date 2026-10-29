// Crash injection (sync.md §7.3, §11.1): the version counter (S-B), the upload/commit boundary, and
// a fault at the k-th remote call of a cycle for every k. After a crash the in-memory engine is
// dropped (`restart`) and the cycle runs again over the same backend and remote.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteError, type SyncEntry } from '../contracts/sync';
import { createMemoryRemote } from './memory-remote';
import {
  dump,
  group,
  groupBody,
  makeDevice,
  marks,
  newSpy,
  records,
  userPut,
  worldClock,
  wrapRemote,
  type Dev,
  useIdb,
} from './engine-testkit';
import { decodeLib, LIB_NAME } from './libfile';
import type { Backend } from '../store';

const A = 'aaaaaaaaaa';
const B = 'bbbbbbbbbb';

useIdb(() => new IDBFactory());

let clock: () => number;
beforeEach(() => {
  clock = worldClock();
  vi.spyOn(Date, 'now').mockImplementation(() => clock());
});
afterEach(() => vi.restoreAllMocks());

const crash = (): RemoteError => new RemoteError('network', 0, 'injected');
const stored = async (d: Dev): Promise<number> =>
  (await d.raw.get<{ v: number }>('syncMeta', 'vvCounter'))?.v ?? 0;

/** Every (minter, counter) exposed in an uploaded lib maps to ONE entry (key + hash). */
function exposedOnce(published: SyncEntry[]): void {
  const seen = new Map<string, string>();
  for (const e of published) {
    if (e.kind === 'def') continue; // a joined def carries a maximal entry's counter
    const minter = e.hlc.slice(-10);
    const k = `${minter}:${e.vv[minter] ?? 0}`;
    const v = `${e.key}|${e.hash}`;
    expect(seen.get(k) ?? v, `counter ${k} used for two entries`).toBe(v);
    seen.set(k, v);
  }
}

describe.each([false, true])('crash injection (idb %s)', (idb) => {
  it('S-B: a crash after RESERVE and before the upload never reuses a counter', async () => {
    const inner = createMemoryRemote();
    const spy = newSpy();
    const minted = new Set<string>();
    const violations: string[] = [];
    let failUpload = true;
    const a = await makeDevice({
      id: A,
      idb,
      now: clock,
      minted,
      violations,
      remote: wrapRemote(inner, {
        spy,
        fault: (op, name, phase) =>
          failUpload &&
          phase === 'before' &&
          (op === 'create' || op === 'update') &&
          name?.startsWith('lib.')
            ? crash()
            : undefined,
      }),
    });
    await userPut(a, 'group', group('g', 'one'));
    const r1 = await a.cycle();
    expect(r1.outcome).toBe('offline');
    // RESERVE had run: the counter consumed by the candidate is durable
    expect(await stored(a)).toBeGreaterThanOrEqual(1);
    expect(await marks(a)).toEqual(['group:g']); // nothing was committed
    a.restart();
    await userPut(a, 'group', group('g', 'two'));
    failUpload = false;
    const r2 = await a.cycle();
    expect(r2.outcome).toBe('ok');
    expect(violations).toEqual([]);
    exposedOnce(spy.published);
    const lib = await decodeLib(
      await inner.download((await inner.list()).find((f) => f.name === LIB_NAME(A))!.id),
    );
    expect(lib.entries[0]!.vv[A]).toBeGreaterThan(1);
  });

  it('crash after the upload and before the commit: the next cycle reads its own lib and converges with no copy', async () => {
    const inner = createMemoryRemote();
    const spy = newSpy();
    const violations: string[] = [];
    const minted = new Set<string>();
    let lose = false;
    const a = await makeDevice({
      id: A,
      idb,
      now: clock,
      minted,
      violations,
      remote: wrapRemote(inner, {
        spy,
        fault: (op, name, phase) =>
          lose &&
          phase === 'after' &&
          (op === 'create' || op === 'update') &&
          name?.startsWith('lib.')
            ? crash()
            : undefined,
      }),
    });
    const b = await makeDevice({
      id: B,
      idb,
      now: clock,
      minted,
      violations,
      remote: wrapRemote(inner, { spy }),
    });
    await userPut(a, 'group', group('g', 'v0'));
    await a.cycle();
    await userPut(a, 'group', group('g', 'v1'));
    lose = true; // the update lands; the response is lost
    expect((await a.cycle()).outcome).toBe('offline');
    expect(await marks(a)).toEqual(['group:g']); // the commit never ran
    lose = false;
    a.restart();
    for (let i = 0; i < 3; i++) {
      expect((await a.cycle()).outcome).toBe('ok');
      expect((await b.cycle()).outcome).toBe('ok');
    }
    expect(await marks(a)).toEqual([]);
    const g = await records(b, 'group');
    expect([...g.keys()]).toEqual(['g']); // our own earlier upload is not a conflict with our edit
    expect(groupBody(g.get('g'))).toBe('v1');
    expect(await dump(a)).toBe(await dump(b));
    expect(violations).toEqual([]);
    exposedOnce(spy.published);
  });

  it('crash mid-commit: the commit is one transaction, so nothing of it survives', async () => {
    const inner = createMemoryRemote();
    const spy = newSpy();
    let failCommit = false;
    const wrapRaw = (b: Backend): Backend => ({
      ...b,
      kind: b.kind,
      get: (s, k) => b.get(s, k),
      getAll: (s, i, r) => b.getAll(s, i, r),
      getAllKeys: (s, r) => b.getAllKeys(s, r),
      tx: (s, m, f) => b.tx(s, m, f),
      update: (stores, fn) =>
        failCommit &&
        stores.includes('syncIndex') &&
        stores.includes('syncDirty') &&
        stores.length === 3
          ? Promise.reject(new Error('injected: commit'))
          : b.update(stores, fn),
    });
    const violations: string[] = [];
    const minted = new Set<string>();
    const a = await makeDevice({
      id: A,
      idb,
      now: clock,
      minted,
      violations,
      wrapRaw,
      remote: wrapRemote(inner, { spy }),
    });
    const b = await makeDevice({
      id: B,
      idb,
      now: clock,
      minted,
      violations,
      remote: wrapRemote(inner, { spy }),
    });
    await userPut(a, 'group', group('g', 'one'));
    failCommit = true;
    const r = await a.cycle();
    expect(r.outcome).toBe('error');
    expect(await marks(a)).toEqual(['group:g']);
    expect((await a.raw.getAll('syncIndex')).length).toBe(0); // the index did not move
    failCommit = false;
    a.restart();
    for (let i = 0; i < 3; i++) {
      await a.cycle();
      await b.cycle();
    }
    expect(await marks(a)).toEqual([]);
    expect((await records(b, 'group')).size).toBe(1);
    expect(await dump(a)).toBe(await dump(b));
    expect(violations).toEqual([]);
    exposedOnce(spy.published);
  });

  it('on start the counter is the max of the stored value, every seen[self] and every vv[self] read', async () => {
    const inner = createMemoryRemote();
    const spy = newSpy();
    const a = await makeDevice({ id: A, idb, now: clock, remote: wrapRemote(inner, { spy }) });
    for (const v of ['1', '2', '3']) {
      await userPut(a, 'group', group('g', v));
      await a.cycle();
    }
    const high = Math.max(...spy.published.map((e) => e.vv[A] ?? 0));
    // the counter row is lost (and, below, the index too): the own lib on the remote still says
    await a.raw.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k: 'vvCounter', v: 0 }));
    a.restart();
    await userPut(a, 'group', group('g', '4'));
    await a.cycle();
    const newest = spy.published.at(-1 - 0)!;
    expect(spy.published.some((e) => (e.vv[A] ?? 0) > high)).toBe(true);
    expect(newest.vv[A]).toBeGreaterThan(high);
    // seen[self] in the index counts too, even when nothing on the remote does
    await a.raw.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k: 'vvCounter', v: 0 }));
    const files = await inner.list();
    for (const f of files.filter((f) => f.name === LIB_NAME(A))) await inner.delete(f.id);
    await a.raw.tx(['syncMeta'], 'readwrite', (t) => {
      t.put('syncMeta', { k: 'files', v: {} });
      t.put('syncMeta', { k: 'seen', v: {} });
    });
    a.restart();
    await userPut(a, 'group', group('g', '5'));
    await a.cycle();
    const last = (await a.raw.get<{ entry: SyncEntry }>('syncIndex', 'group:g'))!.entry;
    expect(last.vv[A]).toBeGreaterThan(newest.vv[A]!);
    exposedOnce(spy.published);
  });

  it('a fault at the k-th remote call of a cycle, before and after the effect, for every k', async () => {
    for (const phase of ['before', 'after'] as const) {
      for (let k = 1; k <= 14; k++) {
        const inner = createMemoryRemote();
        const spy = newSpy();
        const minted = new Set<string>();
        const violations: string[] = [];
        let n = 0;
        let armed = false;
        const mk = (id: string, arm: boolean) =>
          makeDevice({
            id,
            idb,
            now: clock,
            minted,
            violations,
            remote: wrapRemote(inner, {
              spy,
              fault: (_op, _name, ph) => {
                if (!arm || !armed || ph !== phase) return undefined;
                return ++n === k ? crash() : undefined;
              },
            }),
          });
        const a = await mk(A, true);
        const b = await mk(B, false);
        await userPut(a, 'group', group('g', 'v0'));
        await userPut(a, 'group', group('h', 'h0'));
        await a.cycle();
        await b.cycle();
        await userPut(a, 'group', group('g', `A${k}`));
        await userPut(b, 'group', group('g', `B${k}`));
        await userPut(a, 'group', group('new', 'n'));
        await b.cycle();
        armed = true;
        await a.cycle(); // this cycle meets the fault (or finishes, for a large k)
        armed = false;
        a.restart();
        const before = await dump(b);
        void before;
        for (let i = 0; i < 4; i++) {
          expect((await a.cycle()).outcome).toBe('ok');
          expect((await b.cycle()).outcome).toBe('ok');
        }
        const where = `${phase} k=${k}`;
        expect(await dump(a), where).toBe(await dump(b));
        expect(await marks(a), where).toEqual([]);
        const bodies = [...(await records(a, 'group')).values()].map(groupBody).sort();
        expect(bodies, where).toContain(`A${k}`);
        expect(bodies, where).toContain(`B${k}`);
        expect(bodies, where).toContain('n');
        expect(bodies.length, where).toBe(4); // g, its one copy, h and new
        expect(violations, where).toEqual([]);
        exposedOnce(spy.published);
      }
    }
  });
});

describe.each([false, true])(
  'create lost, listing lag, and a racing user write (idb %s)',
  (idb) => {
    it('a create whose response is lost leaves a second lib file; both are read, nothing is copied', async () => {
      const inner = createMemoryRemote({ listingLag: { ownLib: 4 } });
      const spy = newSpy();
      let lose = true;
      const a = await makeDevice({
        id: A,
        idb,
        now: clock,
        remote: wrapRemote(inner, {
          spy,
          fault: (op, name, phase) =>
            lose && op === 'create' && phase === 'after' && name?.startsWith('lib.')
              ? crash()
              : undefined,
        }),
      });
      const b = await makeDevice({ id: B, idb, now: clock, remote: wrapRemote(inner, { spy }) });
      await userPut(a, 'group', group('g', 'one'));
      expect((await a.cycle()).outcome).toBe('offline'); // the lib exists, a never learned its id
      lose = false;
      a.restart();
      await userPut(a, 'group', group('g', 'two'));
      for (let i = 0; i < 5; i++) {
        await a.cycle();
        await b.cycle();
      }
      const libs = (await inner.list()).filter((f) => f.name === LIB_NAME(A));
      expect(libs.length).toBeGreaterThanOrEqual(1);
      expect(libs.length).toBeLessThanOrEqual(2); // GC (S2c) merges and removes the extra one
      const g = await records(b, 'group');
      expect([...g.keys()]).toEqual(['g']);
      expect(groupBody(g.get('g'))).toBe('two');
      expect(await dump(a)).toBe(await dump(b));
    });

    it('a user write that lands between the read of a mark and the apply transaction is kept (retry)', async () => {
      const inner = createMemoryRemote();
      let racing = false;
      let fired = 0;
      const wrapRaw = (b: Backend): Backend => ({
        ...b,
        kind: b.kind,
        get: (s, k) => b.get(s, k),
        getAll: (s, i, r) => b.getAll(s, i, r),
        getAllKeys: (s, r) => b.getAllKeys(s, r),
        tx: (s, m, f) => b.tx(s, m, f),
        update: async (stores, fn) => {
          if (racing && stores.includes('groups') && stores.includes('syncIndex') && fired === 0) {
            fired++;
            // a user edit, written the way the tracked backend writes it: record + a fresh mark
            await b.tx(['groups', 'syncDirty'], 'readwrite', (t) => {
              t.put('groups', group('g', 'USER-2'));
              t.put('syncDirty', { key: 'group:g', last: Date.now(), n: 'racing-nonce' });
            });
          }
          return b.update(stores, fn);
        },
      });
      const a = await makeDevice({ id: A, idb, now: clock, remote: inner });
      const b = await makeDevice({ id: B, idb, now: clock, remote: inner, wrapRaw });
      await userPut(a, 'group', group('g', 'v0'));
      await a.cycle();
      await b.cycle();
      await userPut(a, 'group', group('g', 'A1'));
      await a.cycle();
      await userPut(b, 'group', group('g', 'USER-1'));
      racing = true;
      for (let i = 0; i < 3; i++) {
        await b.cycle();
        await a.cycle();
      }
      expect(fired).toBe(1);
      const bodies = [...(await records(b, 'group')).values()].map(groupBody).sort();
      expect(bodies).toContain('USER-2'); // the later write was neither lost nor overwritten
      expect(bodies).toContain('A1');
      expect(bodies).not.toContain('USER-1'); // superseded by the user's own later edit
      expect(await dump(a)).toBe(await dump(b));
      expect(await marks(b)).toEqual([]);
    });
  },
);
