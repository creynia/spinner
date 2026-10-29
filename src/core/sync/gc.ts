// Garbage collection of the remote (sync.md §7.9, steps 1 to 5; step 6 is `reseed` in first.ts).
// WP-S2c. Runs at most once per 24 h per device, after a successful push (the engine decides when
// and writes `gcAt`). Deletions are sequential, so the Drive client's write bucket paces them.
//
// Safety rules that shape every step:
//  - another device's lib file is deleted only when it is stale (180 days, from the remote's own
//    `modifiedTime`); a live peer's lib is never touched;
//  - a step that needs the peers' libs is skipped when any of them cannot be read;
//  - orphan and duplicate bundles are deleted only when more than 1 h old, so a bundle whose
//    stub is still being written is safe.
import type { RunMeta } from '../contracts/run';
import {
  RemoteError,
  type LibFileV1,
  type RemoteFile,
  type RunBundleRef,
  type RunStub,
  type SyncDirtyRecord,
  type SyncEntry,
  type SyncIndexRecord,
} from '../contracts/sync';
import { sha256Hex } from '../experiment';
import { encodeRunBundleWithDigest, loadRun } from '../store';
import { internalOf, libDevice } from './apply';
import type { SyncCtx } from './ctx';
import { hlcWall } from './hlc';
import { decodeLib, LIB_NAME, ROOT_NAME, runBundleName } from './libfile';
import { digest16, flushLib, readBundles, recordBundle, sigOf } from './runs';
import { descends } from './vv';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
/** A lib file nobody has written for this long belongs to a device that is gone (step 2). */
export const STALE_LIB_DAYS = 180;
/** A tombstone is dropped no sooner than this (step 3). */
export const TOMBSTONE_DAYS = 30;
/** Orphan and duplicate bundles are left alone while younger than this (steps 1 and 4). */
export const GRACE_MS = HOUR;
/** GC is refused when the local clock is further ahead of the remote's than this. */
export const CLOCK_SLACK_MS = DAY;

const BUNDLE = /^run\.(.+)\.([0-9a-f]{16})\.spinner\.json\.gz$/;
const age = (f: RemoteFile, now: number): number => now - Date.parse(f.modifiedTime);
const byOldest = (a: RemoteFile, b: RemoteFile): number =>
  a.modifiedTime < b.modifiedTime ? -1 : a.modifiedTime > b.modifiedTime ? 1 : a.id < b.id ? -1 : 1;

/** The bundle names a stub points at (its `bundle.name`, and the name its digest implies). */
function refsOf(e: SyncEntry): string[] {
  if (e.kind !== 'run' || e.deleted || !e.value) return [];
  const v = e.value as RunStub;
  const out: string[] = [];
  if (v.bundle) out.push(v.bundle.name);
  if (v.resultsDigest) out.push(runBundleName(e.id, v.resultsDigest));
  return out;
}

const stubOf = (r: SyncIndexRecord): RunStub | null =>
  r.kind === 'run' && !r.entry.deleted ? (r.entry.value as RunStub | null) : null;

async function createBundle(
  ctx: SyncCtx,
  runId: string,
  name: string,
  bytes: Uint8Array,
  digest: string,
): Promise<RemoteFile> {
  return ctx.remote.create(name, bytes, {
    appProperties: { kind: 'run', runId, digest16: digest16(digest) },
    contentType: 'application/gzip',
    resumeKey: `run:${runId}`,
    ...(ctx.deps.signal ? { signal: ctx.deps.signal } : {}),
  });
}

export async function runGc(ctx: SyncCtx): Promise<void> {
  const st = internalOf(ctx);
  const { raw } = st;
  const { remote, deps, deviceId } = ctx;
  const o = sigOf(ctx);
  // Time comes from the remote, never from this clock: a clock set far ahead would age every
  // peer's lib past 180 days and every tombstone past 30. Our own lib is written afresh, so its
  // `modifiedTime` is the remote's "now"; a local clock more than a day ahead of it refuses GC.
  const written = await flushLib(ctx, true);
  const now = written ? Date.parse(written.modifiedTime) : Number.NaN;
  if (!Number.isFinite(now) || deps.now() - now > CLOCK_SLACK_MS) return;
  const aborted = (): boolean => deps.signal?.aborted === true;

  const files = await remote.list(o);
  const gone = new Set<string>();
  const live = (): RemoteFile[] => files.filter((f) => !gone.has(f.id));
  const del = async (f: RemoteFile): Promise<void> => {
    try {
      await remote.delete(f.id, o);
    } catch (e) {
      if (!(e instanceof RemoteError) || e.code !== 'not-found') throw e;
    }
    gone.add(f.id);
  };
  const rows = await raw.getAll<SyncIndexRecord>('syncIndex');

  // ---- 1. duplicates
  // several lib.<self>: files.ownLib stays; the others go once their content was merged (seen)
  const ownId = st.files.ownLib?.id;
  const ownLibs = files.filter((f) => f.name === LIB_NAME(deviceId));
  if (ownLibs.length > 1 && ownId !== undefined && ownLibs.some((f) => f.id === ownId)) {
    for (const f of ownLibs) {
      if (f.id !== ownId && st.seen[f.id] === f.version) await del(f);
    }
  }
  // several roots: the earliest stays
  for (const f of files
    .filter((x) => x.name === ROOT_NAME)
    .sort(byOldest)
    .slice(1))
    await del(f);
  // several files with one bundle name: the one whose sha256 matches the winning stub stays
  const byName = new Map<string, RemoteFile[]>();
  for (const f of live()) {
    if (BUNDLE.test(f.name)) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
  }
  const winning = new Map<string, RunBundleRef>();
  for (const r of rows) {
    const b = stubOf(r)?.bundle;
    if (b) winning.set(b.name, b);
  }
  for (const [name, group] of byName) {
    const want = winning.get(name);
    if (group.length < 2 || !want) continue;
    group.sort(byOldest);
    let keeper: RemoteFile | undefined;
    for (const f of group) {
      if (f.bytes !== want.bytes) continue; // cheap test first: a wrong size cannot match
      if ((await sha256Hex(await remote.download(f.id, o))) === want.sha256) {
        keeper = f;
        break;
      }
    }
    if (!keeper) continue; // nothing verifiably good: delete nothing
    for (const f of group) if (f !== keeper && age(f, now) > GRACE_MS) await del(f);
  }
  if (aborted()) return;

  // ---- 2. stale devices (never ours, never a live peer)
  for (const f of live()) {
    const d = libDevice(f.name);
    if (d !== null && d !== deviceId && age(f, now) > STALE_LIB_DAYS * DAY) await del(f);
  }

  // ---- the remaining peers' libs, for steps 3 and 4
  const peers: LibFileV1[] = [];
  let peersReadable = true;
  for (const f of live()) {
    const d = libDevice(f.name);
    if (d === null || d === deviceId) continue;
    try {
      peers.push(await decodeLib(await remote.download(f.id, o)));
    } catch (e) {
      if (e instanceof RemoteError && e.code !== 'not-found') throw e;
      peersReadable = false; // damaged, newer than we know, or just deleted: be conservative
    }
  }

  let changedLib = false;

  // ---- 3. tombstones: older than 30 days and acknowledged by every remaining peer
  if (peersReadable) {
    const marks = new Set((await raw.getAllKeys('syncDirty')).map(String));
    const drop: SyncIndexRecord[] = [];
    for (const r of rows) {
      const t = r.entry;
      if (!t.deleted || marks.has(r.key)) continue;
      if (now - hlcWall(t.hlc) <= TOMBSTONE_DAYS * DAY) continue;
      const acknowledged = peers.every((p) => {
        const e = p.entries.find((x) => x.key === r.key);
        if (e) return descends(e, t);
        return Date.parse(p.writtenAt) > hlcWall(t.hlc);
      });
      if (acknowledged) drop.push(r);
    }
    if (drop.length > 0) {
      await raw.update(['syncIndex', 'syncDirty'], async (r, w) => {
        for (const d of drop) {
          const cur = await r.get<SyncIndexRecord>('syncIndex', d.key);
          const mark = await r.get<SyncDirtyRecord>('syncDirty', d.key);
          // unchanged since we looked, and nobody has edited the key since
          if (cur && cur.entry.hlc === d.entry.hlc && cur.entry.deleted && !mark) {
            w.delete('syncIndex', d.key);
            changedLib = true;
          }
        }
      });
    }
  }

  // ---- 4. orphan bundles: no live run entry in any lib file references them
  if (peersReadable) {
    const referenced = new Set<string>();
    for (const r of rows) for (const n of refsOf(r.entry)) referenced.add(n);
    for (const p of peers) for (const e of p.entries) for (const n of refsOf(e)) referenced.add(n);
    // our own uploads whose stub is not pushed yet (kept for runs that still exist here)
    for (const [runId, ref] of Object.entries(await readBundles(raw))) {
      if ((await raw.get('runs', runId)) !== undefined) referenced.add(ref.name);
    }
    for (const f of live()) {
      if (BUNDLE.test(f.name) && !referenced.has(f.name) && age(f, now) > GRACE_MS) await del(f);
    }
  }
  if (aborted()) return;

  // ---- 5. re-upload: a done run held here whose index entry names a bundle the remote lacks
  if (!deps.isRunActive()) {
    const current = live();
    const todo: { meta: RunMeta; ref: RunBundleRef }[] = [];
    for (const r of rows) {
      const stub = stubOf(r);
      const ref = stub?.bundle;
      if (!stub || !ref || stub.status !== 'done' || r.local !== 1) continue;
      if (current.some((f) => f.name === ref.name && f.bytes === ref.bytes)) continue;
      const meta = await raw.get<RunMeta>('runs', r.entry.id);
      if (!meta || meta.status !== 'done' || meta.resultsDigest !== stub.resultsDigest) continue;
      todo.push({ meta, ref });
    }
    todo.sort((a, b) =>
      a.meta.createdAt < b.meta.createdAt ? 1 : a.meta.createdAt > b.meta.createdAt ? -1 : 0,
    );
    for (const { meta, ref } of todo) {
      if (aborted() || deps.isRunActive()) break;
      const data = await loadRun(raw, meta.runId);
      if (!data) continue;
      const enc = await encodeRunBundleWithDigest(data, { gzip: true });
      if (runBundleName(meta.runId, enc.resultsDigest) !== ref.name) continue;
      const wrongSize = current.find((f) => f.name === ref.name);
      let up: RemoteFile;
      if (wrongSize) {
        // present with the wrong size: replace the content in place (no duplicate)
        try {
          up = await remote.update(wrongSize.id, enc.bytes, o);
        } catch (e) {
          if (!(e instanceof RemoteError) || e.code !== 'not-found') throw e;
          up = await createBundle(ctx, meta.runId, ref.name, enc.bytes, enc.resultsDigest);
        }
      } else {
        up = await createBundle(ctx, meta.runId, ref.name, enc.bytes, enc.resultsDigest);
      }
      const next: RunBundleRef = {
        name: ref.name,
        bytes: up.bytes,
        sha256: await sha256Hex(enc.bytes),
      };
      // a different sha or size changes the stub: the push below carries it (§7.9 step 5)
      if (next.bytes !== ref.bytes || next.sha256 !== ref.sha256) {
        await recordBundle(ctx, meta.runId, next);
        changedLib = true;
      }
    }
  }

  // ---- prune: bundle refs of runs that are gone from this device
  const mine = await readBundles(raw);
  const stale: string[] = [];
  for (const runId of Object.keys(mine)) {
    if ((await raw.get('runs', runId)) === undefined) stale.push(runId);
  }
  if (stale.length > 0) {
    await raw.update(['syncMeta'], async (r, w) => {
      const cur = await r.get<{ k: string; v: Record<string, RunBundleRef> }>(
        'syncMeta',
        'bundles',
      );
      const v = { ...(cur?.v ?? {}) };
      for (const id of stale) delete v[id];
      w.put('syncMeta', { k: 'bundles', v });
    });
  }

  // our lib must say what GC changed, so peers can acknowledge a dropped tombstone at once
  if (changedLib && !aborted()) await flushLib(ctx);
}
