// WP-S2c: garbage collection of the remote (sync.md §7.9, §11.1 "GC"). Time is driven by `skew`:
// the memory remote stamps files with Date.now(), so aging a file is advancing the clock.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibFileV1, RunStub, SyncEntry } from '../contracts/sync';
import { sha256Hex } from '../experiment';
import { encodeRunBundleWithDigest } from '../store';
import {
  forgeLib,
  entryOf,
  bundleFiles,
  finishRun,
  importRunFile,
  newLog,
  recording,
  runStubs,
  tinyRun,
} from './__fixtures__/runs-kit';
import {
  group,
  indexOf,
  makeDevice,
  marks,
  records,
  useIdb,
  userDel,
  userPut,
  worldClock,
  type Dev,
} from './engine-testkit';
import { runGc, GRACE_MS } from './gc';
import { decodeLib, LIB_NAME, ROOT_NAME, runBundleName } from './libfile';
import { createMemoryRemote } from './memory-remote';
import { downloadRun } from './runs';
import { hlcOf } from './testkit';
import type { RemoteStore } from '../contracts/sync';

const A = 'aaaaaaaaaa';
const B = 'bbbbbbbbbb';
const C = 'cccccccccc';
const DAY = 24 * 3600 * 1000;
const MIN = 60 * 1000;
useIdb(() => new IDBFactory());

let skew = 0;
let clock: () => number;
beforeEach(() => {
  skew = 0;
  const base = worldClock();
  clock = () => base() + skew;
  vi.spyOn(Date, 'now').mockImplementation(() => clock());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function world(idb: boolean) {
  const inner = createMemoryRemote();
  const log = newLog();
  const mk = (id: string, prefs = {}) =>
    makeDevice({ id, idb, now: clock, remote: recording(inner, log), prefs });
  return { inner, log, a: await mk(A), b: await mk(B), mk };
}
const settle = async (...ds: Dev[]): Promise<void> => {
  for (let r = 0; r < 3; r++) for (const d of ds) await d.cycle();
};
const gc = async (d: Dev): Promise<void> => runGc(await d.ctx());
const names = async (r: RemoteStore): Promise<string[]> =>
  (await r.list()).map((f) => f.name).sort();
const libOf = async (r: RemoteStore, dev: string): Promise<LibFileV1> => {
  const f = (await r.list()).find((x) => x.name === LIB_NAME(dev))!;
  return decodeLib(await r.download(f.id));
};
const keysIn = (l: LibFileV1): string[] => l.entries.map((e) => e.key);

describe.each([false, true])('GC (idb %s)', (idb) => {
  describe('tombstones (step 3)', () => {
    async function deleted() {
      const w = await world(idb);
      await userPut(w.a, 'group', group('g', 'one'));
      await settle(w.a, w.b);
      await userDel(w.a, 'group', 'g');
      await settle(w.a, w.b, w.a);
      expect(keysIn(await libOf(w.inner, A))).toContain('group:g');
      return w;
    }

    it('is dropped only after 30 days AND every peer acknowledged it', async () => {
      const w = await deleted();
      skew += 29 * DAY;
      await settle(w.a, w.b); // both keep their libs fresh
      await gc(w.a);
      expect(keysIn(await libOf(w.inner, A))).toContain('group:g'); // not old enough
      skew += 2 * DAY;
      await settle(w.a, w.b);
      await gc(w.a);
      expect(keysIn(await libOf(w.inner, A))).not.toContain('group:g');
      expect((await indexOf(w.a)).has('group:g')).toBe(false);
      expect(await marks(w.a)).toEqual([]);
      // B sees A's lib lack the key, written after the tombstone: acknowledged, B drops it too
      await w.b.cycle();
      await gc(w.b);
      expect(keysIn(await libOf(w.inner, B))).not.toContain('group:g');
      // nothing came back to life anywhere
      await settle(w.a, w.b);
      expect((await records(w.a, 'group')).size).toBe(0);
      expect((await records(w.b, 'group')).size).toBe(0);
    });

    it('stays while a peer still holds the key live or has not written since', async () => {
      const w = await deleted();
      skew += 31 * DAY;
      // a peer that still holds an older live g (it never saw the delete)
      const old = await entryOf(
        'group',
        'g',
        group('g', 'one') as never,
        hlcOf(Date.now() - 40 * DAY, C),
        undefined,
        C,
        1,
      );
      const f = await forgeLib(w.inner, C, [old], new Date(Date.now()).toISOString());
      await settle(w.a, w.b);
      await gc(w.a);
      expect(keysIn(await libOf(w.inner, A))).toContain('group:g');
      // the peer lacks the key but wrote BEFORE the tombstone: it may not have seen it yet
      await w.inner.delete(f.id);
      await forgeLib(w.inner, C, [], new Date(Date.now() - 45 * DAY).toISOString());
      await gc(w.a);
      expect(keysIn(await libOf(w.inner, A))).toContain('group:g');
    });

    it('a single device drops it after 30 days (no peer has to acknowledge)', async () => {
      const inner = createMemoryRemote();
      const a = await makeDevice({ id: A, idb, now: clock, remote: inner });
      await userPut(a, 'group', group('g', 'one'));
      await a.cycle();
      await userDel(a, 'group', 'g');
      await a.cycle();
      skew += 31 * DAY;
      await a.cycle();
      await gc(a);
      expect((await indexOf(a)).has('group:g')).toBe(false);
      expect(keysIn(await libOf(inner, A))).not.toContain('group:g');
    });

    it('a key with a new local edit (a mark) keeps its tombstone', async () => {
      const w = await deleted();
      skew += 31 * DAY; // no cycle in between: its own GC would have dropped the tombstone
      await userPut(w.a, 'group', group('g', 'again')); // recreated, not yet pushed
      await gc(w.a);
      expect((await indexOf(w.a)).get('group:g')).toBeDefined();
    });
  });

  describe('stale devices (step 2)', () => {
    it('deletes a lib file after 180 days, never a live peer or our own', async () => {
      const w = await world(idb);
      await userPut(w.a, 'group', group('g', 'one'));
      await settle(w.a, w.b);
      await forgeLib(w.inner, C, [], new Date(Date.now()).toISOString());
      skew += 100 * DAY;
      await w.a.cycle();
      await w.b.cycle();
      skew += 79 * DAY; // 179 days since C wrote
      await w.a.cycle();
      await w.b.cycle();
      await gc(w.a);
      expect(await names(w.inner)).toContain(LIB_NAME(C));
      skew += 2 * DAY; // 181
      await w.b.cycle(); // B is live: its lib is refreshed
      await gc(w.a);
      const left = await names(w.inner);
      expect(left).not.toContain(LIB_NAME(C));
      expect(left).toContain(LIB_NAME(B));
      expect(left).toContain(LIB_NAME(A));
      // even a long-idle peer is spared while its file is under 180 days old
      skew += 150 * DAY;
      await gc(w.a);
      expect(await names(w.inner)).toContain(LIB_NAME(B));
    });

    it('a device that returns after its lib was collected rewrites it: nothing re-minted, no copies', async () => {
      const w = await world(idb);
      await userPut(w.a, 'group', group('g', 'one'));
      await settle(w.a, w.b);
      const before = await indexOf(w.b);
      const vv = (await w.b.raw.get<{ v: number }>('syncMeta', 'vvCounter'))!.v;
      skew += 200 * DAY;
      await w.a.cycle();
      await gc(w.a);
      expect(await names(w.inner)).not.toContain(LIB_NAME(B));
      const r = await w.b.cycle(); // B returns: its ownLib id answers 404
      expect(r.outcome).toBe('ok');
      expect(r.copies).toBe(0);
      expect(await names(w.inner)).toContain(LIB_NAME(B));
      const after = await indexOf(w.b);
      for (const [k, row] of before) expect(after.get(k)!.entry).toEqual(row.entry);
      expect((await w.b.raw.get<{ v: number }>('syncMeta', 'vvCounter'))!.v).toBeGreaterThanOrEqual(
        vv,
      );
      expect(keysIn(await libOf(w.inner, B))).toContain('group:g');
      await settle(w.a, w.b);
      expect((await records(w.a, 'group')).size).toBe(1);
    });
  });

  describe('bundles (steps 1, 4, 5)', () => {
    async function withRun() {
      const w = await world(idb);
      const made = await finishRun(w.a, await tinyRun(40));
      await settle(w.a, w.b);
      const [file] = await bundleFiles(w.inner);
      return { ...w, made, file: file! };
    }

    it('an orphan goes after 1 h, not before; a bundle some lib references is kept', async () => {
      const w = await withRun();
      const stub = (await runStubs(w.a)).get(w.made.runId)!;
      await userDelRun(w.a, w.made.runId);
      await settle(w.a, w.b);
      skew += GRACE_MS - 5 * MIN;
      await gc(w.a);
      expect(await bundleFiles(w.inner)).toHaveLength(1);
      skew += 10 * MIN;
      // a peer's lib still holds a live entry for that run: the bundle stays (the keep rule)
      const live = await liveStubEntry(stub, C);
      const forged = await forgeLib(w.inner, C, [live], new Date(Date.now()).toISOString());
      await gc(w.a);
      expect(await bundleFiles(w.inner)).toHaveLength(1);
      await w.inner.delete(forged.id);
      await gc(w.a);
      expect(await bundleFiles(w.inner)).toHaveLength(0);
    });

    it('an upload whose stub is not pushed yet is kept for a run that still exists here', async () => {
      const inner = createMemoryRemote();
      const a = await makeDevice({ id: A, idb, now: clock, remote: inner });
      await finishRun(a, await tinyRun(41));
      const { uploadPendingRuns } = await import('./runs');
      await a.cycle({ uploadRuns: false });
      await uploadPendingRuns(await a.ctx(), Date.now() + 1e9);
      skew += 3 * 3600 * 1000;
      await gc(a);
      expect(await bundleFiles(inner)).toHaveLength(1);
    });

    it('does not delete orphans when a peer lib cannot be read', async () => {
      const w = await withRun();
      await userDelRun(w.a, w.made.runId);
      await settle(w.a, w.b);
      await w.inner.create(LIB_NAME(C), new Uint8Array([1, 2, 3]), {
        appProperties: { kind: 'lib' },
      });
      skew += 2 * 3600 * 1000;
      await gc(w.a);
      expect(await bundleFiles(w.inner)).toHaveLength(1);
    });

    it('a missing bundle is re-uploaded by its holder, even a downloader or a shared importer', async () => {
      const w = await withRun();
      const { b, inner } = w;
      expect(await downloadRun(await b.ctx(), w.made.runId)).toBe('ok');
      await inner.delete(w.file.id);
      expect(await downloadRun(await (await w.mk('dddddddddd')).ctx(), w.made.runId)).toBe(
        'missing',
      );
      // B holds the run (by download), not the owner: it heals the remote
      await b.cycle();
      await gc(b);
      const files = await bundleFiles(inner);
      expect(files).toHaveLength(1);
      expect(files[0]!.name).toBe(w.file.name);
      expect(files[0]!.bytes).toBe(w.file.bytes);
      expect(await marks(b)).toEqual([]); // same bytes, same sha: the stub is unchanged
      const d = await w.mk('eeeeeeeeee');
      await d.cycle();
      expect(await downloadRun(await d.ctx(), w.made.runId)).toBe('ok');
    });

    it('a bundle of the wrong size is replaced in place (no duplicate)', async () => {
      const w = await withRun();
      await w.inner.update(w.file.id, new Uint8Array(w.file.bytes - 3));
      await gc(w.a);
      const files = await bundleFiles(w.inner);
      expect(files).toHaveLength(1);
      expect(files[0]!.id).toBe(w.file.id);
      expect(files[0]!.bytes).toBe(w.file.bytes);
      expect(await downloadRun(await w.b.ctx(), w.made.runId)).toBe('ok');
    });

    it('after a shared import skipped its upload and the file vanished, the importer re-uploads', async () => {
      const w = await world(idb);
      const data = await tinyRun(42);
      const id = await importRunFile(w.a, data);
      await importRunFile(w.b, data);
      await settle(w.a, w.b);
      const [file] = await bundleFiles(w.inner);
      await w.inner.delete(file!.id);
      await gc(w.b);
      expect(await bundleFiles(w.inner)).toHaveLength(1);
      expect(await downloadRun(await (await w.mk('ffffffffff')).ctx(), id)).toBe('missing'); // no stub yet there
    });

    it('duplicates of one bundle name: the file matching the stub stays, the others go after 1 h', async () => {
      const w = await withRun();
      const junk = new Uint8Array(w.file.bytes).fill(7); // right size, wrong content
      await w.inner.create(w.file.name, junk, { appProperties: { kind: 'run' } });
      await gc(w.a);
      expect(await bundleFiles(w.inner)).toHaveLength(2); // the junk is young
      skew += GRACE_MS + MIN;
      await gc(w.a);
      const left = await bundleFiles(w.inner);
      expect(left).toHaveLength(1);
      expect(await sha256Hex(await w.inner.download(left[0]!.id))).toBe(
        (await runStubs(w.a)).get(w.made.runId)!.bundle!.sha256,
      );
      expect(await downloadRun(await w.b.ctx(), w.made.runId)).toBe('ok');
    });

    it('downloads try every file of the name until one has the right sha', async () => {
      const w = await withRun();
      const junk = new Uint8Array(w.file.bytes).fill(7);
      // the bad copy is listed first (older id)
      await w.inner.delete(w.file.id);
      await w.inner.create(w.file.name, junk, { appProperties: { kind: 'run' } });
      await w.inner.create(w.file.name, await encodedBundle(w.a, w.made.runId), {
        appProperties: { kind: 'run' },
      });
      expect(await downloadRun(await w.b.ctx(), w.made.runId)).toBe('ok');
    });
  });

  describe('duplicates (step 1)', () => {
    it('several roots: the earliest stays', async () => {
      const w = await world(idb);
      await w.a.cycle();
      const root = (await w.inner.list()).find((f) => f.name === ROOT_NAME)!;
      skew += 1000;
      const copy = await w.inner.download(root.id);
      await w.inner.create(ROOT_NAME, copy, { appProperties: { kind: 'root' } });
      await gc(w.a);
      const roots = (await w.inner.list()).filter((f) => f.name === ROOT_NAME);
      expect(roots.map((f) => f.id)).toEqual([root.id]);
    });

    it('several lib.<self>: files.ownLib stays, a duplicate goes once merged', async () => {
      const w = await world(idb);
      await userPut(w.a, 'group', group('g', 'one'));
      await w.a.cycle();
      const own = (await w.inner.list()).find((f) => f.name === LIB_NAME(A))!;
      const dup = await w.inner.create(LIB_NAME(A), await w.inner.download(own.id), {
        appProperties: { kind: 'lib', device: A },
      });
      await gc(w.a); // not merged yet (not seen): kept
      expect((await names(w.inner)).filter((n) => n === LIB_NAME(A))).toHaveLength(2);
      await w.a.cycle(); // pulls it
      await gc(w.a);
      const libs = (await w.inner.list()).filter((f) => f.name === LIB_NAME(A));
      expect(libs.map((f) => f.id)).toEqual([own.id]);
      expect(libs[0]!.id).not.toBe(dup.id);
    });
  });

  describe('through the cycle', () => {
    it('runs once per 24 h, writes gcAt, and is skipped on a metered connection', async () => {
      const w = await world(idb);
      await userPut(w.a, 'group', group('g', 'one'));
      vi.stubGlobal('navigator', { connection: { saveData: true } });
      await w.a.cycle();
      expect(await w.a.raw.get('syncMeta', 'gcAt')).toBeUndefined();
      vi.stubGlobal('navigator', { connection: { saveData: false } });
      await w.a.cycle();
      const at = (await w.a.raw.get<{ v: number }>('syncMeta', 'gcAt'))!.v;
      expect(at).toBeGreaterThan(0);
      w.log.ops.length = 0;
      await w.a.cycle();
      expect(w.log.ops).toEqual(['list']); // the no-change cycle: one request, no GC
      skew += 25 * 3600 * 1000;
      await w.a.cycle();
      expect((await w.a.raw.get<{ v: number }>('syncMeta', 'gcAt'))!.v).toBeGreaterThan(at);
    });
  });
});

// ------------------------------------------------------------------ helpers

async function userDelRun(d: Dev, runId: string): Promise<void> {
  for (const s of ['runs', 'summaries', 'checkpoints', 'breakdowns', 'samples'] as const) {
    await d.tracked.tx([s], 'readwrite', (t) => t.delete(s, runId));
  }
}

/** The run's real bytes as device `d` would upload them. */
async function encodedBundle(d: Dev, runId: string): Promise<Uint8Array> {
  const { loadRun } = await import('../store');
  const data = (await loadRun(d.raw, runId))!;
  return (await encodeRunBundleWithDigest(data, { gzip: true })).bytes;
}

/** A live run entry for `stub`, as a peer's lib would carry it. */
async function liveStubEntry(stub: RunStub, peer: string): Promise<SyncEntry> {
  return await entryOf('run', stub.runId, stub, hlcOf(Date.now(), peer), undefined, peer, 1);
}
void runBundleName;
void records;
void userDel;
