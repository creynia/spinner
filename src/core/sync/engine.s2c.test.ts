// The seam to WP-S2c (SyncCtx) and the run entries the engine itself owns: the stub snapshot of a
// local run, D13 (a running run's mark is ignored until it is done), dry-run exclusion, and run
// tombstones. S2c's functions are mocked here so the call order and arguments are pinned.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunStub, SyncEntry } from '../contracts/sync';
import { createMemoryRemote } from './memory-remote';
import {
  def,
  group,
  makeDevice,
  marks,
  newSpy,
  userDel,
  userPut,
  worldClock,
  wrapRemote,
  records,
  type Dev,
  useIdb,
} from './engine-testkit';
import { createSyncEngine } from './engine';
import { entryOf } from './fingerprint';
import { encodeLib, LIB_NAME } from './libfile';
import { hlcOf } from './testkit';

const calls: string[] = [];
/** `calls` plus the remote operations, in the order they happened. */
const trace: string[] = [];
const rec = (s: string): void => {
  calls.push(s);
  trace.push(s);
};
vi.mock('./runs', () => ({
  uploadPendingRuns: vi.fn((_c: unknown, deadline: number) => {
    rec(`uploadPendingRuns(${typeof deadline})`);
    return Promise.resolve();
  }),
  downloadRun: vi.fn((_c: unknown, id: string) => {
    rec(`downloadRun(${id})`);
    return Promise.resolve('ok');
  }),
  evictRun: vi.fn((_c: unknown, id: string) => {
    rec(`evictRun(${id})`);
    return Promise.resolve();
  }),
}));
vi.mock('./gc', () => ({
  runGc: vi.fn(() => {
    rec('runGc');
    return Promise.resolve();
  }),
}));
vi.mock('./first', () => ({
  previewFirst: vi.fn(() => {
    rec('previewFirst');
    return Promise.resolve({ remoteEmpty: true });
  }),
  beginFirst: vi.fn((_c: unknown, choice: string) => {
    rec(`beginFirst(${choice})`);
    return Promise.resolve({ outcome: 'ok' });
  }),
  reseed: vi.fn(() => {
    rec('reseed');
    return Promise.resolve();
  }),
}));
vi.mock('./erase', () => ({
  eraseRemote: vi.fn(() => {
    rec('eraseRemote');
    return Promise.resolve();
  }),
  resetLocalSyncState: vi.fn(() => {
    rec('resetLocalSyncState');
    return Promise.resolve();
  }),
}));

const A = 'aaaaaaaaaa';
const B = 'bbbbbbbbbb';
useIdb(() => new IDBFactory());

let clock: () => number;
beforeEach(() => {
  calls.length = 0;
  trace.length = 0;
  clock = worldClock();
  vi.spyOn(Date, 'now').mockImplementation(() => clock());
});
afterEach(() => vi.restoreAllMocks());

const DIGEST = 'ab'.repeat(32);
const bundle = {
  name: `run.r1.${DIGEST.slice(0, 16)}.spinner.json.gz`,
  bytes: 10,
  sha256: 'cd'.repeat(32),
};

const runMeta = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  v: 1,
  runId: id,
  definitionId: 'defid',
  simKey: 'sim',
  runKey: 'rk',
  gameId: 'roulette',
  gameVersion: '1',
  coreVersion: '1',
  appVersion: '1.0.0',
  createdAt: '2026-03-01T00:00:00.000Z',
  status,
  sessions: 100,
  completedSessions: status === 'done' ? 100 : 40,
  prefixSessions: status === 'done' ? 100 : 40,
  chunkSize: 10,
  chunks: 10,
  bitmap: new Uint8Array(2),
  schedule: new Int32Array(1),
  labels: {},
  columns: [],
  storage: 'idb',
  device: { cores: 4, workers: 2, ua: 'test' },
  timing: { startedAt: '2026-03-01T00:00:00.000Z', elapsedMs: 5 },
  resumes: [],
  visibility: [],
  ...extra,
});

const indexEntry = async (d: Dev, key: string): Promise<SyncEntry | undefined> =>
  (await d.raw.get<{ entry: SyncEntry }>('syncIndex', key))?.entry;

describe.each([false, true])('engine <-> S2c (idb %s)', (idb) => {
  it('the cycle calls the S2c functions in order: uploadPendingRuns before the lib is written', async () => {
    const inner = createMemoryRemote();
    const a = await makeDevice({
      id: A,
      idb,
      now: clock,
      remote: wrapRemote(inner, {
        before: (op) => {
          trace.push(`remote:${op}`);
          return Promise.resolve();
        },
      }),
    });
    await userPut(a, 'group', group('g', '1'));
    await a.cycle();
    expect(calls).toEqual(['uploadPendingRuns(number)', 'runGc']);
    const iUpload = trace.indexOf('uploadPendingRuns(number)');
    const iLib = trace.lastIndexOf('remote:create'); // the lib (the root was created first)
    expect(trace.indexOf('remote:list')).toBeLessThan(iUpload);
    expect(iUpload).toBeLessThan(iLib);
    expect(trace.indexOf('runGc')).toBeGreaterThan(iLib);
  });

  it('uploadRuns:false and an active run skip uploadPendingRuns; GC runs once per 24 h and records gcAt', async () => {
    const inner = createMemoryRemote();
    let active = false;
    const a = await makeDevice({
      id: A,
      idb,
      now: clock,
      remote: inner,
      isRunActive: () => active,
    });
    await a.cycle({ uploadRuns: false });
    expect(calls).toEqual(['runGc']);
    const gcAt = (await a.raw.get<{ v: number }>('syncMeta', 'gcAt'))!.v;
    expect(gcAt).toBeGreaterThan(0);
    calls.length = 0;
    active = true;
    await a.cycle();
    expect(calls).toEqual([]); // not due again, and a run is active
    active = false;
    await a.cycle();
    expect(calls).toEqual(['uploadPendingRuns(number)']);
    await a.raw.tx(['syncMeta'], 'readwrite', (t) =>
      t.put('syncMeta', { k: 'gcAt', v: gcAt - 25 * 3600_000 }),
    );
    calls.length = 0;
    await a.cycle();
    expect(calls).toContain('runGc');
  });

  it('reseed is called when the own lib is missing and the index is not empty; never on a first sync', async () => {
    const inner = createMemoryRemote();
    const a = await makeDevice({ id: A, idb, now: clock, remote: inner });
    await a.cycle(); // first sync of an empty device
    expect(calls).not.toContain('reseed');
    await userPut(a, 'group', group('g', '1'));
    await a.cycle();
    expect(calls).not.toContain('reseed');
    for (const f of await inner.list()) if (f.name === LIB_NAME(A)) await inner.delete(f.id);
    await a.raw.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k: 'files', v: {} }));
    a.restart();
    calls.length = 0;
    const r = await a.cycle();
    expect(r.outcome).toBe('ok');
    expect(calls).toContain('reseed');
    // the engine itself writes the lib again from the kept index: no false copies
    expect((await inner.list()).filter((f) => f.name === LIB_NAME(A))).toHaveLength(1);
    expect([...(await records(a, 'group')).keys()]).toEqual(['g']);
  });

  it('prefs.runDownload=all downloads remote-only runs newest first; onOpen does not', async () => {
    const inner = createMemoryRemote();
    const mk = async (runDownload: 'all' | 'onOpen') =>
      makeDevice({ id: B, idb, now: clock, remote: inner, prefs: { runDownload } });
    // A's lib holds two done run stubs
    const stub = (id: string, at: string): RunStub => ({
      runId: id,
      definitionId: 'defid',
      simKey: 's',
      runKey: 'k',
      status: 'done',
      sessions: 1,
      completedSessions: 1,
      prefixSessions: 1,
      createdAt: at,
      appVersion: '1',
      gameId: 'roulette',
      gameVersion: '1',
      coreVersion: '1',
      resultsDigest: DIGEST,
      owner: A,
      extra: { device: { cores: 1, workers: 1, ua: '' }, timing: { elapsedMs: 1 }, resumes: [] },
      bundle: {
        name: `run.${id}.${DIGEST.slice(0, 16)}.spinner.json.gz`,
        bytes: 5,
        sha256: 'ee'.repeat(32),
      },
    });
    const entries = [
      await entryOf(
        'run',
        'old',
        stub('old', '2026-01-01T00:00:00.000Z') as never,
        hlcOf(5, A),
        undefined,
        A,
        1,
      ),
      await entryOf(
        'run',
        'new',
        stub('new', '2026-02-01T00:00:00.000Z') as never,
        hlcOf(6, A),
        undefined,
        A,
        2,
      ),
    ];
    await inner.create(
      LIB_NAME(A),
      await encodeLib({
        format: 'spinner-sync-lib',
        version: 1,
        device: { id: A, name: 'A', appVersion: '1', coreVersion: '1' },
        hlc: entries[1]!.hlc,
        writtenAt: new Date().toISOString(),
        entries,
      }),
      {},
    );
    const onOpen = await mk('onOpen');
    await onOpen.cycle();
    expect(calls.filter((c) => c.startsWith('downloadRun'))).toEqual([]);
    expect((await indexEntry(onOpen, 'run:new'))?.deleted).toBeUndefined();
    const all = await mk('all');
    calls.length = 0;
    const r = await all.cycle();
    expect(calls.filter((c) => c.startsWith('downloadRun'))).toEqual([
      'downloadRun(new)',
      'downloadRun(old)',
    ]);
    expect(r.changed).toContain('run');
    // the engine facade lists them newest first and delegates the rest to S2c
    const engine = createSyncEngine(all.deps);
    expect((await engine.listRemoteRuns()).map((s) => s.runId)).toEqual(['new', 'old']);
    await engine.evict('new');
    await engine.preview();
    await engine.begin('replace');
    await engine.eraseRemote();
    await engine.resetLocalSyncState();
    expect(calls.slice(-5)).toEqual([
      'evictRun(new)',
      'previewFirst',
      'beginFirst(replace)',
      'eraseRemote',
      'resetLocalSyncState',
    ]);
  });

  it('devices() lists the lib files with their device info', async () => {
    const inner = createMemoryRemote();
    const a = await makeDevice({ id: A, idb, now: clock, remote: inner, name: 'Pixel' });
    const b = await makeDevice({ id: B, idb, now: clock, remote: inner, name: 'Laptop' });
    await userPut(a, 'group', group('g', '1'));
    await a.cycle();
    await b.cycle();
    const list = await createSyncEngine(a.deps).devices();
    expect(list.map((d) => [d.id, d.name]).sort()).toEqual([
      [A, 'Pixel'],
      [B, 'Laptop'],
    ]);
    expect(list[0]!.appVersion).toBe('1.0.0');
  });

  describe('run entries', () => {
    it('a running or queued run is not pushed and its mark is kept (D13); a paused one is a stub only', async () => {
      const inner = createMemoryRemote();
      const spy = newSpy();
      const a = await makeDevice({ id: A, idb, now: clock, remote: wrapRemote(inner, { spy }) });
      await userPut(a, 'run', runMeta('r1', 'running'));
      await userPut(a, 'run', runMeta('r2', 'queued'));
      await a.cycle();
      expect(await marks(a)).toEqual(['run:r1', 'run:r2']);
      expect(spy.published.filter((e) => e.kind === 'run')).toEqual([]);
      await userPut(a, 'run', runMeta('r1', 'paused', { interrupted: true }));
      await a.cycle();
      expect(await marks(a)).toEqual(['run:r2']);
      const stub = (await indexEntry(a, 'run:r1'))!.value as RunStub;
      expect(stub).toMatchObject({
        runId: 'r1',
        status: 'paused',
        interrupted: true,
        owner: A,
        completedSessions: 40,
      });
      expect(stub.bundle).toBeUndefined();
      expect(stub.resultsDigest).toBeUndefined();
      expect(JSON.stringify(stub)).not.toContain('bitmap');
    });

    it('a run that is active in this tab is deferred even when its status says paused', async () => {
      const inner = createMemoryRemote();
      const active = new Set<string>(['r1']);
      const a = await makeDevice({
        id: A,
        idb,
        now: clock,
        remote: inner,
        isRunActive: (id) => (id === undefined ? active.size > 0 : active.has(id)),
      });
      await userPut(a, 'run', runMeta('r1', 'paused'));
      await a.cycle();
      expect(await marks(a)).toEqual(['run:r1']);
      active.clear();
      await a.cycle();
      expect(await marks(a)).toEqual([]);
    });

    it('a done run waits for its bundle (S2c records it in syncMeta.bundles), then goes out with verdict and bundle', async () => {
      const inner = createMemoryRemote();
      const spy = newSpy();
      const a = await makeDevice({
        id: A,
        idb,
        now: clock,
        remote: wrapRemote(inner, { spy }),
        describeRun: () =>
          Promise.resolve({
            meanNet: 1,
            halfWidth: 2,
            pAhead: 0.5,
            pBust: 0.1,
            n: 100,
            roundsPerSession: 10,
            roundsPerHour: 60,
          }),
      });
      await userPut(a, 'run', runMeta('r1', 'done', { resultsDigest: DIGEST }));
      await a.cycle();
      expect(await marks(a)).toEqual(['run:r1']); // no bundle yet: the stub would reference nothing
      expect(spy.published.some((e) => e.kind === 'run')).toBe(false);
      await a.raw.tx(['syncMeta'], 'readwrite', (t) =>
        t.put('syncMeta', { k: 'bundles', v: { r1: bundle } }),
      );
      await a.cycle();
      expect(await marks(a)).toEqual([]);
      const stub = (await indexEntry(a, 'run:r1'))!.value as RunStub;
      expect(stub).toMatchObject({
        status: 'done',
        resultsDigest: DIGEST,
        bundle,
        verdict: { n: 100 },
      });
      // the verdict is derived, so it is not part of the fingerprint
      const again = (await indexEntry(a, 'run:r1'))!.hash;
      await userPut(a, 'run', runMeta('r1', 'done', { resultsDigest: DIGEST }));
      const r = await a.cycle();
      expect(r).toMatchObject({ pushed: 0, requests: 1 });
      expect((await indexEntry(a, 'run:r1'))!.hash).toBe(again);
    });

    it('runs of a dry-run definition are never pushed; the mark goes', async () => {
      const inner = createMemoryRemote();
      const spy = newSpy();
      const a = await makeDevice({ id: A, idb, now: clock, remote: wrapRemote(inner, { spy }) });
      const dry = await def('dry', { dry: true });
      await a.raw.tx(['definitions'], 'readwrite', (t) => t.put('definitions', dry.rec));
      await userPut(a, 'run', runMeta('r1', 'paused', { definitionId: dry.id }));
      await a.cycle();
      expect(await marks(a)).toEqual([]);
      expect(spy.published.filter((e) => e.kind === 'run')).toEqual([]);
    });

    it('a run that arrived by download keeps its owner; deleting it pushes a tombstone', async () => {
      const inner = createMemoryRemote();
      const a = await makeDevice({ id: A, idb, now: clock, remote: inner });
      const b = await makeDevice({ id: B, idb, now: clock, remote: inner });
      await userPut(a, 'run', runMeta('r1', 'paused'));
      await a.cycle();
      await b.cycle();
      const e = await indexEntry(b, 'run:r1');
      expect((e!.value as RunStub).owner).toBe(A);
      // B has the run locally too (as S2c's downloadRun would have written it, with `synced`)
      await b.raw.tx(['runs'], 'readwrite', (t) =>
        t.put('runs', runMeta('r1', 'paused', { synced: { from: A, fromName: 'A', at: 'x' } })),
      );
      await userDel(b, 'run', 'r1');
      await b.cycle();
      expect((await indexEntry(b, 'run:r1'))!.deleted).toBe(true);
      await a.cycle();
      expect((await indexEntry(a, 'run:r1'))!.deleted).toBe(true);
      expect(await a.raw.get('runs', 'r1')).toBeUndefined(); // the delete wins on A
    });

    it('a remote delete of a run that is active here keeps the run and re-pushes it when done, with a notice', async () => {
      const inner = createMemoryRemote();
      let active = true;
      const a = await makeDevice({
        id: A,
        idb,
        now: clock,
        remote: inner,
        isRunActive: (id) => active && (id === undefined || id === 'r1'),
      });
      const b = await makeDevice({ id: B, idb, now: clock, remote: inner });
      await userPut(a, 'run', runMeta('r1', 'paused'));
      active = false;
      await a.cycle();
      await b.cycle();
      await b.raw.tx(['runs'], 'readwrite', (t) => t.put('runs', runMeta('r1', 'paused')));
      await userDel(b, 'run', 'r1');
      await b.cycle();
      active = true; // the run is going again on A when the tombstone arrives
      await a.cycle();
      expect(await a.raw.get('runs', 'r1')).toBeDefined();
      expect(await marks(a)).toContain('run:r1');
      const notices = (await a.raw.get<{ v: { message: string }[] }>('syncMeta', 'conflicts'))!.v;
      expect(notices.some((n) => /deleted on another device/.test(n.message))).toBe(true);
      active = false;
      await a.cycle();
      expect((await indexEntry(a, 'run:r1'))!.deleted).toBeUndefined(); // lives again
      await b.cycle();
      expect((await indexEntry(b, 'run:r1'))!.deleted).toBeUndefined();
    });
  });
});
