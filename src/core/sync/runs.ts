// Run bundles (sync.md §7.6): upload of finished local runs, download of remote ones, eviction.
// WP-S2c. Only done runs have a bundle; the stub itself is built by the engine (`runStub` in
// apply.ts) from the `bundles` row this module writes.
//
// Hand-off to the engine: after a bundle is on the remote, `uploadPendingRuns` writes the
// `RunBundleRef` into `syncMeta.bundles[runId]` and (re)puts a `syncDirty` mark `run:<id>` (both
// through raw, in one transaction). The next SNAPSHOT then finds the ref and mints the stub.
import type { DefinitionRecord } from '../contracts/experiment';
import type { RunMeta } from '../contracts/run';
import {
  RemoteError,
  type RemoteFile,
  type RunBundleRef,
  type RunStub,
  type SyncDirtyRecord,
  type SyncIndexRecord,
  type SyncKey,
} from '../contracts/sync';
import { sha256Hex } from '../experiment';
import {
  decodeRunBundle,
  encodeRunBundleWithDigest,
  evictRunResults,
  loadRun,
  writeCompacted,
  type Backend,
} from '../store';
import { internalOf, libDevice, metaGet, type Internal } from './apply';
import type { SyncCtx } from './ctx';
import type { DownloadRunOptions } from './engine';
import { hlcDevice } from './hlc';
import { decodeLib, runBundleName } from './libfile';
import { buildLib, commit, reserve, snapshotAll, uploadLib } from './push';

/** Peers see runs appear progressively: our lib file is written this often while uploading. */
const FLUSH_EVERY_MS = 30_000;

export type Bundles = Record<string, RunBundleRef>;

/** `syncMeta.bundles`: runId -> the bundle this device uploaded or adopted for it. */
export async function readBundles(raw: Backend): Promise<Bundles> {
  return (await metaGet(raw, 'bundles')) ?? {};
}

function nonce(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export const sigOf = (ctx: SyncCtx): { signal: AbortSignal } | undefined =>
  ctx.deps.signal ? { signal: ctx.deps.signal } : undefined;

export const digest16 = (digest: string): string => digest.slice(0, 16);

/** Records a bundle ref and marks the run, atomically (raw: no other mark appears). */
export async function recordBundle(ctx: SyncCtx, runId: string, ref: RunBundleRef): Promise<void> {
  const raw = ctx.backend.raw;
  const key: SyncKey = `run:${runId}`;
  await raw.update(['syncMeta', 'syncDirty'], async (r, w) => {
    const cur = await r.get<{ k: string; v: Bundles }>('syncMeta', 'bundles');
    w.put('syncMeta', { k: 'bundles', v: { ...(cur?.v ?? {}), [runId]: ref } });
    const m = await r.get<SyncDirtyRecord>('syncDirty', key);
    w.put('syncDirty', { key, last: m?.last ?? ctx.deps.now(), n: nonce() });
  });
}

/**
 * One interim write of our lib file (snapshot, reserve, upload, commit), as the cycle does at its
 * end, without the pull: used while bundles are uploading and by GC after it changed our index.
 */
export async function flushLib(ctx: SyncCtx, force = false): Promise<RemoteFile | null> {
  const st = internalOf(ctx);
  const files = await ctx.remote.list(sigOf(ctx));
  const pending = await snapshotAll(st);
  await reserve(st); // S-B: the counter is durable before the lib that carries it goes out
  const built = await buildLib(st, pending);
  const uploaded = await uploadLib(
    st,
    built,
    files,
    force ? undefined : await metaGet(st.raw, 'libSha'),
  );
  await commit(st, {
    pending,
    uploaded,
    libSha: built.sha,
    at: new Date(ctx.deps.now()).toISOString(),
    live: new Set(files.map((f) => f.id)),
  });
  return uploaded?.file ?? null;
}

/**
 * Upload bundles of finished local runs, before the lib file that references them. Candidates are
 * the `run:*` dirty marks of done, non-dry runs that have no bundle ref yet (newest first, one at
 * a time, only while no run is active).
 */
export async function uploadPendingRuns(ctx: SyncCtx, deadline: number): Promise<void> {
  const st = internalOf(ctx);
  const { deps, remote } = ctx;
  const raw = st.raw;
  const marks = (await raw.getAll<SyncDirtyRecord>('syncDirty')).filter((m) =>
    m.key.startsWith('run:'),
  );
  if (marks.length === 0) return;
  const bundles = await readBundles(raw);

  const todo: RunMeta[] = [];
  for (const m of marks) {
    const runId = m.key.slice(4);
    const meta = await raw.get<RunMeta>('runs', runId);
    if (!meta || meta.status !== 'done' || !meta.resultsDigest) continue;
    const mine = bundles[runId];
    if (mine && mine.name.includes(`.${digest16(meta.resultsDigest)}.`)) continue; // stub not pushed yet
    const base = await raw.get<SyncIndexRecord>('syncIndex', m.key);
    const prev = base && !base.entry.deleted ? (base.entry.value as RunStub | null) : null;
    // the remote already has a stub for this digest with a bundle (a shared import, a run that
    // arrived by download): that bundle is the one referenced; upload nothing (§7.6)
    if (prev && prev.resultsDigest === meta.resultsDigest && prev.bundle) {
      continue;
    }
    const def = await raw.get<DefinitionRecord>('definitions', meta.definitionId);
    if (def && deps.isDryRun(def)) continue; // dry runs never reach the remote
    todo.push(meta);
  }
  if (todo.length === 0) return;
  todo.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const files = await remote.list(sigOf(ctx));
  let lastFlush = deps.now();
  let n = 0;
  for (const meta of todo) {
    if (deps.now() > deadline || deps.isRunActive() || deps.signal?.aborted) break;
    const runId = meta.runId;
    const at = n++;
    deps.onProgress({ phase: 'upload-runs', done: at, total: todo.length });
    const data = await loadRun(raw, runId);
    if (!data) continue;
    const enc = await encodeRunBundleWithDigest(data, { gzip: true });
    if (enc.resultsDigest !== meta.resultsDigest) continue; // cannot be referenced under its digest
    const name = runBundleName(runId, enc.resultsDigest);
    // A file of that name and size (an upload whose lib never committed, or a peer's identical
    // import) is adopted only when its bytes ARE ours; otherwise it is replaced in place. The ref
    // always carries the sha256 of the bytes WE hold, never one read off the remote file.
    const sha = await sha256Hex(enc.bytes);
    const existing = files.find((f) => f.name === name && f.bytes === enc.bytes.length);
    let size = enc.bytes.length;
    if (existing) {
      const there = await sha256Hex(await remote.download(existing.id, sigOf(ctx)));
      if (there !== sha) size = (await remote.update(existing.id, enc.bytes, sigOf(ctx))).bytes;
    } else {
      size = (
        await remote.create(name, enc.bytes, {
          appProperties: { kind: 'run', runId, digest16: digest16(enc.resultsDigest) },
          contentType: 'application/gzip',
          resumeKey: `run:${runId}`,
          onProgress: (done) =>
            deps.onProgress({ phase: 'upload-runs', done: at, total: todo.length, bytes: done }),
          ...(deps.signal ? { signal: deps.signal } : {}),
        })
      ).bytes;
    }
    const ref: RunBundleRef = { name, bytes: size, sha256: sha };
    await recordBundle(ctx, runId, ref);
    if (deps.now() - lastFlush >= FLUSH_EVERY_MS) {
      await flushLib(ctx);
      lastFlush = deps.now();
    }
  }
}

// ------------------------------------------------------------------ download

function quotaError(): Error {
  return Object.assign(new Error('Not enough space on this device for the run.'), {
    name: 'QuotaExceededError',
  });
}

/** `estimate().quota - usage >= 3 x bytes`, when the platform can tell. */
async function checkSpace(bytes: number): Promise<void> {
  const s = (globalThis.navigator as { storage?: StorageManager } | undefined)?.storage;
  if (!s?.estimate) return;
  let e: StorageEstimate;
  try {
    e = await s.estimate();
  } catch {
    return;
  }
  if (e.quota !== undefined && e.usage !== undefined && e.quota - e.usage < 3 * bytes) {
    throw quotaError();
  }
}

/** The name of a device, for "made on Laptop": from this session, else from its lib file. */
async function deviceName(
  ctx: SyncCtx,
  st: Internal,
  d: string,
  files: readonly RemoteFile[],
): Promise<string> {
  if (d === ctx.deviceId) return ctx.deps.deviceName();
  const known = st.names.get(d);
  if (known) return known;
  const lib = files.find((f) => libDevice(f.name) === d);
  if (lib) {
    try {
      const l = await decodeLib(await ctx.remote.download(lib.id, sigOf(ctx)));
      st.names.set(d, l.device.name);
      return l.device.name;
    } catch (e) {
      if (e instanceof RemoteError && e.code !== 'not-found') throw e;
    }
  }
  return 'another device';
}

/**
 * A backend whose writes also set `syncIndex[key].local = 1` in the same transaction, so a run
 * downloaded through `writeCompacted` becomes local atomically. `writeCompacted` uses only `tx`.
 *
 * It also keeps the definition record equal to what sync says about it: when `def:<id>` is in the
 * index and its `runIds` do not list this run (the run was deleted, and the join dropped it),
 * `writeCompacted`'s "add the run id to the definition" is skipped. Otherwise a raw write would
 * make this device's definition differ from the synced one with no mark to repair it.
 */
function settingLocal(raw: Backend, key: SyncKey, definitionId: string, runId: string): Backend {
  return {
    kind: raw.kind,
    get: (s, k) => raw.get(s, k),
    getAll: (s, i, r) => raw.getAll(s, i, r),
    getAllKeys: (s, r) => raw.getAllKeys(s, r),
    update: (s, fn) => raw.update(s, fn),
    tx: (stores, mode, fn) =>
      mode === 'readonly'
        ? raw.tx(stores, mode, fn)
        : raw.update([...new Set([...stores, 'syncIndex' as const])], async (r, w) => {
            const base = await r.get<SyncIndexRecord>('syncIndex', key);
            const defRow = await r.get<SyncIndexRecord>('syncIndex', `def:${definitionId}`);
            const have = await r.get('definitions', definitionId);
            const synced = (defRow?.entry.value as { runIds?: string[] } | null | undefined)
              ?.runIds;
            const skipDef =
              have !== undefined &&
              !defRow?.entry.deleted &&
              Array.isArray(synced) &&
              !synced.includes(runId);
            fn(
              skipDef
                ? { ...w, put: (s, v) => (s === 'definitions' ? undefined : w.put(s, v)) }
                : w,
            );
            if (base && !base.entry.deleted) w.put('syncIndex', { ...base, local: 1 });
          }),
  };
}

async function markLocal(raw: Backend, key: SyncKey, local: 0 | 1): Promise<void> {
  await raw.update(['syncIndex'], async (r, w) => {
    const base = await r.get<SyncIndexRecord>('syncIndex', key);
    if (base && base.local !== local && (local === 0 || !base.entry.deleted)) {
      w.put('syncIndex', { ...base, local });
    }
  });
}

/**
 * Fetch a remote done run, verify it and write it to this device (§7.6). `missing`: no stub, no
 * bundle ref, or no such file listed. `corrupt`: no listed file has the stub's sha256, the bundle
 * does not decode, or its digest or runId is not the stub's. Neither writes anything.
 */
export async function downloadRun(
  ctx: SyncCtx,
  runId: string,
  opts: DownloadRunOptions = {},
): Promise<'ok' | 'missing' | 'corrupt'> {
  const st = internalOf(ctx);
  const { remote, deps } = ctx;
  const raw = st.raw;
  const key: SyncKey = `run:${runId}`;
  const base = await raw.get<SyncIndexRecord>('syncIndex', key);
  const stub = base && !base.entry.deleted ? (base.entry.value as RunStub | null) : null;
  if (!base || !stub || stub.status !== 'done' || !stub.bundle || !stub.resultsDigest) {
    return 'missing';
  }
  if ((await raw.get('runs', runId)) !== undefined) {
    await markLocal(raw, key, 1); // already here (an interrupted evict, say)
    return 'ok';
  }
  const signal = opts.signal ?? deps.signal;
  const o = signal ? { signal } : {};

  const files = await remote.list(o);
  const listed = files.filter((f) => f.name === stub.bundle!.name);
  let bytes: Uint8Array | null = null;
  let tried = 0;
  for (const f of listed) {
    let got: Uint8Array;
    try {
      got = await remote.download(f.id, {
        ...o,
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      });
    } catch (e) {
      if (e instanceof RemoteError && e.code === 'not-found') continue; // deleted since the listing
      throw e;
    }
    tried++;
    if ((await sha256Hex(got)) === stub.bundle.sha256) {
      bytes = got;
      break;
    }
  }
  if (!bytes) return tried === 0 ? 'missing' : 'corrupt';

  await checkSpace(bytes.length);
  const dec = await decodeRunBundle(bytes, deps.gameId, {
    now: () => new Date(deps.now()).toISOString(),
  });
  if ('error' in dec) return 'corrupt';
  const { data } = dec;
  // a trimmed bundle cannot recompute its digest: for it this is the declared-digest check
  if (data.meta.resultsDigest !== stub.resultsDigest || data.meta.runId !== runId) return 'corrupt';

  const from = stub.owner ?? hlcDevice(base.entry.hlc);
  const fromName = await deviceName(ctx, st, from, files);
  const { imported: _decoded, ...rest } = data.meta;
  const meta: RunMeta = {
    ...rest,
    status: 'done',
    device: stub.extra.device,
    timing: stub.extra.timing,
    resumes: stub.extra.resumes,
    visibility: [],
    ...(stub.extra.imported ? { imported: stub.extra.imported } : {}),
    synced: { from, fromName, at: new Date(deps.now()).toISOString() },
  };
  await writeCompacted(settingLocal(raw, key, meta.definitionId, runId), { ...data, meta }, meta);
  return 'ok';
}

/**
 * Drop a run's results from this device; the stub and `definitions.runIds` stay. Refused (it
 * throws) unless the bundle is really on the remote: eviction must never lose the only copy.
 */
export async function evictRun(ctx: SyncCtx, runId: string): Promise<void> {
  const raw = internalOf(ctx).raw;
  const key: SyncKey = `run:${runId}`;
  if (ctx.deps.isRunActive(runId)) throw new Error('The run is still going.');
  const base = await raw.get<SyncIndexRecord>('syncIndex', key);
  const stub = base && !base.entry.deleted ? (base.entry.value as RunStub | null) : null;
  const refuse = (): never => {
    throw new Error('This run is not in Drive, so it cannot be removed from this device.');
  };
  if (!stub || stub.status !== 'done' || !stub.bundle) return refuse();
  const bundle = stub.bundle;
  // the Drive copy must be the stub's file, byte for byte: a same-size damaged file is no copy
  const files = await ctx.remote.list(sigOf(ctx));
  let good = false;
  for (const f of files.filter((x) => x.name === bundle.name && x.bytes === bundle.bytes)) {
    try {
      const got = await ctx.remote.download(f.id, sigOf(ctx));
      if ((await sha256Hex(got)) === bundle.sha256) {
        good = true;
        break;
      }
    } catch (e) {
      if (!(e instanceof RemoteError) || e.code !== 'not-found') throw e;
    }
  }
  if (!good) return refuse();
  // index first: a crash in between leaves data that sync treats as remote-only, which the next
  // download or evict finishes; the other order would leave an index that claims data is here
  await markLocal(raw, key, 0);
  await evictRunResults(raw, runId);
}
