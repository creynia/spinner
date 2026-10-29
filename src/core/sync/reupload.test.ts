// WP-S5b: Library → Runs "Re-upload" (`reuploadRun`) on the memory remote, on memory AND
// fake-indexeddb. It rewrites a bundle in Drive in place, so the property under test is that it
// never makes Drive worse: a lesser local copy never replaces a bundle, a good bundle is never
// rewritten, and after any single crash a retry leaves the stub's sha256 and the file in step.
// Bytes are compared by hash, never with toEqual.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunMeta } from '../contracts/run';
import { RemoteError, type RemoteFile, type RemoteStore } from '../contracts/sync';
import { sha256Hex } from '../experiment';
import { encodeRunBundleWithDigest, loadRun, resultsDigest } from '../store';
import { makeDevice, marks, useIdb, worldClock, wrapRemote, type Dev } from './engine-testkit';
import { createMemoryRemote } from './memory-remote';
import {
  bundleFiles,
  finishRun,
  newLog,
  putStubRun,
  recording,
  runStubs,
  tinyRun,
} from './__fixtures__/runs-kit';
import { downloadRun, reuploadRun } from './runs';

const A = 'aaaaaaaaaa';
const B = 'bbbbbbbbbb';
useIdb(() => new IDBFactory());

let clock: () => number;
beforeEach(() => {
  const base = worldClock();
  clock = () => base();
  vi.spyOn(Date, 'now').mockImplementation(() => clock());
});
afterEach(() => vi.restoreAllMocks());

const crash = (): RemoteError => new RemoteError('network', 0, 'injected');
type Fault = (op: string, name: string | undefined, phase: 'before' | 'after') => Error | undefined;

async function world(idb: boolean, opts: { fault?: Fault; active?: () => boolean } = {}) {
  const inner = createMemoryRemote();
  const log = newLog();
  const a = await makeDevice({
    id: A,
    idb,
    now: clock,
    remote: wrapRemote(recording(inner, log), opts.fault ? { fault: opts.fault } : {}),
    ...(opts.active ? { isRunActive: opts.active } : {}),
  });
  const b = await makeDevice({ id: B, idb, now: clock, remote: recording(inner, log) });
  return { inner, log, a, b };
}

const bytesOf = async (r: RemoteStore, f: RemoteFile): Promise<Uint8Array> => r.download(f.id);
const bundle = async (r: RemoteStore): Promise<RemoteFile> => (await bundleFiles(r))[0]!;
/** The bundle's current sha256 in Drive. */
const driveSha = async (r: RemoteStore): Promise<string> =>
  sha256Hex(await bytesOf(r, await bundle(r)));
const stubSha = async (d: Dev, runId: string): Promise<string | undefined> =>
  (await runStubs(d)).get(runId)?.bundle?.sha256;

/** A finished run on A, uploaded, and B has the stub. */
async function uploaded(idb: boolean, n: number, opts: Parameters<typeof world>[1] = {}) {
  const w = await world(idb, opts);
  const data = await tinyRun(n);
  const made = await finishRun(w.a, data);
  await w.a.cycle();
  await w.b.cycle();
  const good = await driveSha(w.inner);
  expect(await stubSha(w.b, made.runId)).toBe(good);
  return { ...w, data, made, good };
}

/** Same size, other bytes: what a damaged upload looks like. */
async function damage(inner: RemoteStore): Promise<string> {
  const f = await bundle(inner);
  const bad = new Uint8Array(f.bytes).fill(7);
  await inner.update(f.id, bad);
  return sha256Hex(bad);
}

/**
 * The stub names a sha256 that no file in Drive has (what a content-differing upload looks like:
 * another encoder's gzip, or damage). A's `bundles` ref is skewed and pushed; the peer sees it.
 */
async function skewed(idb: boolean, n: number, opts: Parameters<typeof world>[1] = {}) {
  const w = await uploaded(idb, n, opts);
  const fake = 'f'.repeat(64);
  await w.a.raw.update(['syncMeta', 'syncDirty'], async (r, t) => {
    const cur = await r.get<{
      k: string;
      v: Record<string, { name: string; bytes: number; sha256: string }>;
    }>('syncMeta', 'bundles');
    t.put('syncMeta', {
      k: 'bundles',
      v: { ...cur!.v, [w.made.runId]: { ...cur!.v[w.made.runId]!, sha256: fake } },
    });
    t.put('syncDirty', { key: `run:${w.made.runId}`, last: clock(), n: 'skew' });
  });
  await w.a.cycle();
  await w.b.cycle();
  expect(await stubSha(w.b, w.made.runId)).toBe(fake);
  expect(await downloadRun(await w.b.ctx(), w.made.runId)).toBe('corrupt');
  const bad = await damage(w.inner);
  return { ...w, fake, bad };
}

describe.each([false, true])('reuploadRun (idb %s)', (idb) => {
  it('repairs a damaged bundle: sha256 of the encoded bytes, ref and stub updated, the peer downloads and verifies', async () => {
    const { inner, a, b, data, made, good } = await uploaded(idb, 1);
    const bad = await damage(inner);
    expect(bad).not.toBe(good);
    // the peer sees the damage
    await b.cycle();
    expect(await downloadRun(await b.ctx(), made.runId)).toBe('corrupt');

    expect(await reuploadRun(await a.ctx(), made.runId)).toBe('uploaded');
    const enc = await encodeRunBundleWithDigest(data, { gzip: true });
    const want = await sha256Hex(enc.bytes);
    expect(await driveSha(inner)).toBe(want);
    // the ref and the mark are written; the next cycle pushes the stub with the new sha
    expect(await marks(a)).toContain(`run:${made.runId}`);
    const ref = (await a.raw.get<{ k: string; v: Record<string, { sha256: string }> }>(
      'syncMeta',
      'bundles',
    ))!.v[made.runId]!;
    expect(ref.sha256).toBe(want);
    await a.cycle();
    expect(await stubSha(a, made.runId)).toBe(want);
    expect(await marks(a)).toEqual([]);

    await b.cycle();
    expect(await stubSha(b, made.runId)).toBe(want);
    expect(await downloadRun(await b.ctx(), made.runId)).toBe('ok');
    const back = (await loadRun(b.raw, made.runId))!;
    expect(await resultsDigest(back)).toBe(await resultsDigest(data));
  });

  it('recreates a bundle that is missing from Drive', async () => {
    const { inner, a, b, made } = await uploaded(idb, 2);
    await inner.delete((await bundle(inner)).id);
    expect(await bundleFiles(inner)).toHaveLength(0);
    expect(await reuploadRun(await a.ctx(), made.runId)).toBe('uploaded');
    await a.cycle();
    await b.cycle();
    expect(await bundleFiles(inner)).toHaveLength(1);
    expect(await stubSha(b, made.runId)).toBe(await driveSha(inner));
    expect(await downloadRun(await b.ctx(), made.runId)).toBe('ok');
  });

  it('writes nothing when Drive already has the good copy', async () => {
    const { inner, log, a, made, good } = await uploaded(idb, 3);
    const before = log.ops.length;
    expect(await reuploadRun(await a.ctx(), made.runId)).toBe('unchanged');
    expect(log.ops.slice(before).filter((o) => o === 'update' || o.startsWith('create'))).toEqual(
      [],
    );
    expect(await driveSha(inner)).toBe(good);
    expect(await marks(a)).toEqual([]);
  });

  describe('refuses a lesser local copy and leaves the bundle in Drive alone', () => {
    const cases: [string, (a: Dev, runId: string) => Promise<void>, RegExp][] = [
      [
        'a run that is not done',
        async (a, id) => putStubRun(a, (await a.raw.get<RunMeta>('runs', id))!, 'paused'),
        /not on this device/,
      ],
      [
        'a run that is not complete',
        async (a, id) => {
          const m = (await a.raw.get<RunMeta>('runs', id))!;
          await a.raw.tx(['runs'], 'readwrite', (t) =>
            t.put('runs', { ...m, completedSessions: m.sessions - 1 }),
          );
        },
        /not complete/,
      ],
      ...(['trimmed', 'partial'] as const).map(
        (k): [string, (a: Dev, runId: string) => Promise<void>, RegExp] => [
          `an imported ${k} run`,
          async (a, id) => {
            const m = (await a.raw.get<RunMeta>('runs', id))!;
            await a.raw.tx(['runs'], 'readwrite', (t) =>
              t.put('runs', {
                ...m,
                imported: {
                  appVersion: '1',
                  importedAt: new Date(0).toISOString(),
                  fileSha256: 'x',
                  trimmed: k === 'trimmed',
                  partial: k === 'partial',
                },
              }),
            );
          },
          /trimmed or partial/,
        ],
      ),
      [
        'results that differ from the stub',
        async (a, id) => {
          const m = (await a.raw.get<RunMeta>('runs', id))!;
          await a.raw.tx(['runs'], 'readwrite', (t) =>
            t.put('runs', { ...m, resultsDigest: 'f'.repeat(64) }),
          );
        },
        /differ from the copy in Drive/,
      ],
    ];
    it.each(cases)('%s', async (_name, mutate, msg) => {
      const { inner, log, a, made } = await uploaded(idb, 4);
      const bad = await damage(inner); // Drive is damaged, yet a lesser copy must not replace it
      await mutate(a, made.runId);
      const marked = await marks(a); // the mutation itself may mark (a tracked write)
      const before = log.ops.length;
      await expect(reuploadRun(await a.ctx(), made.runId)).rejects.toThrow(msg);
      expect(log.ops.slice(before).filter((o) => o === 'update' || o.startsWith('create'))).toEqual(
        [],
      );
      expect(await driveSha(inner)).toBe(bad);
      expect(await marks(a)).toEqual(marked);
    });
  });

  it('refuses a run that is not in Drive yet, and a run that is active', async () => {
    let active = false;
    const w = await world(idb, { active: () => active });
    const made = await finishRun(w.a, await tinyRun(5));
    // no cycle yet: no stub, no bundle
    await expect(reuploadRun(await w.a.ctx(), made.runId)).rejects.toThrow(/not in Drive yet/);
    await w.a.cycle();
    const good = await driveSha(w.inner);
    await damage(w.inner);
    active = true;
    const before = w.log.ops.length;
    await expect(reuploadRun(await w.a.ctx(), made.runId)).rejects.toThrow(/still going/);
    expect(w.log.ops.length).toBe(before); // not even a listing
    expect(await driveSha(w.inner)).not.toBe(good);
    active = false;
    expect(await reuploadRun(await w.a.ctx(), made.runId)).toBe('uploaded');
    expect(await driveSha(w.inner)).toBe(good);
  });

  describe('crash injection: one fault, then a retry; the file and the stub end up in step', () => {
    type Where = [string, Fault];
    const bundleName = (n?: string): boolean => n?.startsWith('run.') === true;
    const libName = (n?: string): boolean => n?.startsWith('lib.') === true;
    const wheres: Where[] = [
      [
        'before update()',
        (op, n, ph) => (op === 'update' && bundleName(n) && ph === 'before' ? crash() : undefined),
      ],
      [
        'after update()',
        (op, n, ph) => (op === 'update' && bundleName(n) && ph === 'after' ? crash() : undefined),
      ],
    ];
    it.each(wheres)('%s', async (_name, fault) => {
      let armed = false;
      const { inner, a, b, made, data, fake, bad } = await skewed(idb, 6, {
        fault: (op, n, ph) => (armed ? fault(op, n, ph) : undefined),
      });
      const enc = await encodeRunBundleWithDigest(data, { gzip: true });
      const want = await sha256Hex(enc.bytes);
      armed = true;
      await expect(reuploadRun(await a.ctx(), made.runId)).rejects.toThrow();
      armed = false;
      // the file holds the old (damaged) or the new bytes and the stub still names the old sha:
      // a peer sees `corrupt` exactly as it did before, never anything new
      expect([bad, want]).toContain(await driveSha(inner));
      expect(await stubSha(a, made.runId)).toBe(fake);
      await b.cycle();
      expect(await downloadRun(await b.ctx(), made.runId)).toBe('corrupt');

      // after a restart the retry converges: file and stub carry the same, true sha
      a.restart();
      expect(await reuploadRun(await a.ctx(), made.runId)).toBe('uploaded');
      await a.cycle();
      expect(await driveSha(inner)).toBe(want);
      expect(await stubSha(a, made.runId)).toBe(want);
      await b.cycle();
      expect(await downloadRun(await b.ctx(), made.runId)).toBe('ok');
    });

    const commits: Where[] = [
      [
        'lib upload fails before the commit',
        (op, n, ph) =>
          (op === 'create' || op === 'update') && libName(n) && ph === 'before'
            ? crash()
            : undefined,
      ],
      [
        'lib uploaded, commit lost',
        (op, n, ph) =>
          (op === 'create' || op === 'update') && libName(n) && ph === 'after'
            ? crash()
            : undefined,
      ],
    ];
    it.each(commits)('%s', async (_name, fault) => {
      let armed = false;
      const { inner, a, b, made, data, fake } = await skewed(idb, 7, {
        fault: (op, n, ph) => (armed ? fault(op, n, ph) : undefined),
      });
      const enc = await encodeRunBundleWithDigest(data, { gzip: true });
      const want = await sha256Hex(enc.bytes);
      expect(await reuploadRun(await a.ctx(), made.runId)).toBe('uploaded');
      armed = true;
      const r1 = await a.cycle();
      armed = false;
      expect(r1.outcome).not.toBe('ok');
      // the new bytes are in Drive and the mark survives for the next cycle
      expect(await driveSha(inner)).toBe(want);
      expect(await marks(a)).toContain(`run:${made.runId}`);
      // a peer sees the old stub (corrupt, as before) or, when the lib did go out, the new one
      await b.cycle();
      const seen = await stubSha(b, made.runId);
      expect([fake, want]).toContain(seen);
      if (seen === want) expect(await downloadRun(await b.ctx(), made.runId)).toBe('ok');
      a.restart();
      expect((await a.cycle()).outcome).toBe('ok');
      expect(await stubSha(a, made.runId)).toBe(want);
      await b.cycle();
      expect(await stubSha(b, made.runId)).toBe(want);
      expect(await downloadRun(await b.ctx(), made.runId)).toBe('ok');
      expect((await a.cycle()).pushed).toBe(0); // stable
    });
  });
});
