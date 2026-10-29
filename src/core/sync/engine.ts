// The sync engine (sync.md §4.4, §7.3). WP-S2b: the cycle (PULL+APPLY, SNAPSHOT, RECHECK, RESERVE,
// push, commit), status/progress and the `SyncCtx` that the S2c functions (runs, GC, first sync,
// erase) receive. The S2c bodies are called through `ctx`; nothing of them lives here.
import type { DefinitionRecord } from '../contracts/experiment';
import type { RunMeta } from '../contracts/run';
import {
  RemoteError,
  SYNC_FORMAT,
  SYNC_LAYOUT_VERSION,
  type CycleResult,
  type DeviceId,
  type FirstSyncPreview,
  type RemoteFile,
  type RemoteStore,
  type RunStub,
  type SyncDeviceInfo,
  type SyncEntry,
  type SyncErrorCode,
  type SyncIndexRecord,
  type SyncKey,
  type SyncKind,
  type SyncProgress,
  type SyncRootV1,
} from '../contracts/sync';
import { canonicalJson, utf8Decode, utf8Encode } from '../experiment';
import { evictRunResults, isQuotaError, type Backend } from '../store';
import type { SyncCtx } from './ctx';
import {
  applyRemote,
  EngineError,
  internalOf,
  internals,
  libDevice,
  metaGet,
  pull,
  reapplyUpgraded,
  type Internal,
  type Pulled,
} from './apply';
import { eraseRemote, resetLocalSyncState } from './erase';
import { beginFirst, previewFirst, reseed } from './first';
import { runGc } from './gc';
import { createClock } from './hlc';
import { decodeLib, LIB_NAME, ROOT_NAME } from './libfile';
import { foldEntries } from './merge';
import { buildLib, changedLibs, commit, reserve, snapshotAll, uploadLib } from './push';
import { downloadRun, evictRun, reuploadRun, uploadPendingRuns } from './runs';

/**
 * A backend with change tracking: `createTrackedBackend()` from WP-S1's `core/store/tracking.ts`
 * returns this shape (`TrackedBackend`). Declared structurally here because core/sync may not
 * import a file of another module; WP-S1's type is assignable to it.
 */
export interface SyncBackend extends Backend {
  /** The untracked backend: writes through it leave no dirty mark. */
  readonly raw: Backend;
  onDirty(fn: (keys: SyncKey[]) => void): () => void;
}

export interface SyncEngineDeps {
  backend: SyncBackend;
  remote: RemoteStore;
  now: () => number;
  appVersion: string;
  coreVersion: string;
  gameId: string;
  deviceName: () => string;
  describeRun(meta: RunMeta): Promise<RunStub['verdict'] | undefined>;
  /** `DRY_RUN_TAG` definitions never reach the remote. */
  isDryRun(def: DefinitionRecord): boolean;
  /** No argument: any run active in this tab. */
  isRunActive(runId?: string): boolean;
  onProgress(p: SyncProgress): void;
  signal?: AbortSignal;
}

export interface SyncEngine {
  preview(): Promise<FirstSyncPreview>;
  begin(choice: 'merge' | 'replace'): Promise<CycleResult>;
  /**
   * One sync cycle. Never returns `busy`: the app service wraps this in the Web Lock
   * `spinner:sync` and synthesises `busy` itself.
   */
  cycle(o?: { uploadRuns?: boolean; timeBudgetMs?: number }): Promise<CycleResult>;
  downloadRun(runId: string, o?: DownloadRunOptions): Promise<'ok' | 'missing' | 'corrupt'>;
  /** Run stubs on the remote (newest first), for lists and pickers. */
  listRemoteRuns(): Promise<RunStub[]>;
  /** Devices that have written a lib file. */
  devices(): Promise<SyncDeviceInfo[]>;
  /** Download every remote-only run (the "Download all" button); `skipped` = already local. */
  downloadAllRemote(o?: DownloadRunOptions): Promise<{ done: number; skipped: number }>;
  evict(runId: string): Promise<void>;
  /** Uploads this device's copy of a done run over its bundle in Drive (Library → Re-upload). */
  reupload(runId: string): Promise<'uploaded' | 'unchanged'>;
  eraseRemote(): Promise<void>;
  resetLocalSyncState(): Promise<void>;
}

export interface DownloadRunOptions {
  onProgress?: (doneBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

/**
 * `syncMeta` rows that survive every reset path (sync.md D7, D19, §7.7):
 *  - `deleteAll` ("Delete everything on this device") keeps `device`, `vvCounter`, `prefs`,
 *    `account`, `clock`, `files` and `copies`, and clears the rest (`conflicts`, `bundles`, ...);
 *  - `resetLocalSyncState` (account switch or Replace) keeps `device`, `vvCounter`, `copies` and
 *    `conflicts`, and clears `files`, `bundles`, `seen`, `last`, `libSha` and the index;
 *  - only `eraseRemote` also clears `copies`.
 * `SYNC_META_KEEP` is what every path keeps. Accepted caveat: a kept `copies` set can suppress the
 * same conflict copy recurring in a new account (the loser is skipped, the edit is not copied).
 */
export const SYNC_META_KEEP = ['device', 'vvCounter', 'copies'] as const;

// ------------------------------------------------------------------ ctx

const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

function newDeviceId(): DeviceId {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(10));
  return Array.from(b, (x) => ID_ALPHABET[x & 31]).join('');
}

/**
 * The `SyncCtx` the S2c functions receive. One per engine; every remote call through
 * `ctx.remote` is counted into `CycleResult.requests`. S2c's `beginFirst` runs the cycle with
 * `runCycle(ctx, ...)`.
 */
export async function createCtx(deps: SyncEngineDeps): Promise<SyncCtx> {
  const raw = deps.backend.raw;
  let device = await metaGet(raw, 'device');
  if (!device) {
    const made = { id: newDeviceId(), createdAt: new Date(deps.now()).toISOString() };
    device = made;
    await raw.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k: 'device', v: made }));
  }
  const lastHlc = await metaGet(raw, 'clock');
  const clock = createClock(device.id, deps.now, lastHlc);
  const stored = (await metaGet(raw, 'vvCounter')) ?? 0;
  const requests = { n: 0 };
  const count =
    <A extends unknown[], R>(f: (...a: A) => Promise<R>) =>
    (...a: A): Promise<R> => {
      requests.n++;
      return f(...a);
    };
  const r = deps.remote;
  const remote: RemoteStore = {
    kind: r.kind,
    list: count((o) => r.list(o)),
    download: count((id, o) => r.download(id, o)),
    create: count((n, b, o) => r.create(n, b, o)),
    update: count((id, b, o) => r.update(id, b, o)),
    delete: count((id, o) => r.delete(id, o)),
    about: () => r.about(),
  };
  const st = {
    raw,
    self: device.id,
    vv: { n: stored, persisted: stored },
    requests,
    copies: new Set<string>(),
    conflicts: [],
    seen: {},
    files: {},
    names: new Map<DeviceId, string>(),
    deletedRuns: new Set<string>(),
    changed: new Set<SyncKind>(),
    deferred: new Map<SyncKey, string>(),
    deferredFiles: new Map<string, string>(),
    counts: { applied: 0, copies: 0, pushed: 0 },
  } as unknown as Internal;
  const ctx: SyncCtx = {
    backend: deps.backend,
    remote,
    clock,
    deviceId: device.id,
    vv: {
      next: () => ++st.vv.n,
      reserve: () => reserve(st),
    },
    deps,
  };
  st.ctx = ctx;
  internals.set(ctx, st);
  return ctx;
}

async function reloadMeta(st: Internal): Promise<void> {
  const { raw } = st;
  st.copies = new Set((await metaGet(raw, 'copies')) ?? []);
  st.conflicts = (await metaGet(raw, 'conflicts')) ?? [];
  st.seen = (await metaGet(raw, 'seen')) ?? {};
  st.files = (await metaGet(raw, 'files')) ?? {};
  const stored = (await metaGet(raw, 'vvCounter')) ?? 0;
  st.vv.n = Math.max(st.vv.n, stored);
  st.vv.persisted = stored;
}

/** Saves what APPLY learned: `seen`, the clock, the counter, copies and notices. */
async function persistProgress(st: Internal): Promise<void> {
  const n = Math.max(st.vv.n, st.vv.persisted);
  await st.raw.tx(['syncMeta'], 'readwrite', (t) => {
    t.put('syncMeta', { k: 'seen', v: st.seen });
    t.put('syncMeta', { k: 'clock', v: st.ctx.clock.last });
    t.put('syncMeta', { k: 'files', v: st.files });
    t.put('syncMeta', { k: 'vvCounter', v: n });
    t.put('syncMeta', { k: 'copies', v: [...st.copies].sort() });
    t.put('syncMeta', { k: 'conflicts', v: st.conflicts });
  });
  st.vv.persisted = n;
}

// ------------------------------------------------------------------ the cycle

const NOT_IMPLEMENTED = /^not implemented \(WP-/;

/** Calls an S2c function; its WP-S0 stub ("not implemented") is tolerated, any other error is not. */
async function viaS2c<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    if (e instanceof Error && NOT_IMPLEMENTED.test(e.message)) return { ok: false };
    throw e;
  }
}

const sig = (deps: SyncEngineDeps): { signal: AbortSignal } | undefined =>
  deps.signal ? { signal: deps.signal } : undefined;

/** Reads the root marker; creates it on a first sync; refuses a newer layout; honours "erased". */
async function checkRoot(
  st: Internal,
  files: readonly RemoteFile[],
  first: boolean,
): Promise<'ok' | 'erased'> {
  const { remote, deps } = st.ctx;
  const roots = files
    .filter((f) => f.name === ROOT_NAME)
    .sort((a, b) =>
      a.modifiedTime < b.modifiedTime ? -1 : a.modifiedTime > b.modifiedTime ? 1 : 0,
    );
  const root = roots[0];
  const fresh = (): Uint8Array => {
    const doc: SyncRootV1 = {
      format: SYNC_FORMAT,
      version: SYNC_LAYOUT_VERSION,
      createdAt: new Date(deps.now()).toISOString(),
      createdBy: st.self,
    };
    return utf8Encode(canonicalJson(doc as never));
  };
  if (!root) {
    const known = st.files.root;
    if (known && !first) {
      // not in the listing: lag, or really gone? Ask for the file itself.
      try {
        await remote.download(known.id, sig(deps));
        return 'ok';
      } catch (e) {
        if (!(e instanceof RemoteError) || e.code !== 'not-found') throw e;
      }
    }
    if (!first && (known || (await st.raw.getAllKeys('syncIndex')).length > 0)) {
      throw new EngineError('erased', 'The sync data on Drive is gone.');
    }
    const made = await remote.create(ROOT_NAME, fresh(), {
      appProperties: { kind: 'root' },
      ...sig(deps),
    });
    st.files = { ...st.files, root: { id: made.id, version: made.version } };
    st.seen[made.id] = made.version;
    return 'ok';
  }
  if (st.seen[root.id] !== root.version) {
    const bytes = await remote.download(root.id, sig(deps));
    let doc: unknown;
    try {
      doc = JSON.parse(utf8Decode(bytes));
    } catch {
      throw new RemoteError('bad-response', 0, 'spinner-sync.json is not JSON');
    }
    const r = doc as Partial<SyncRootV1> | null;
    if (!r || typeof r !== 'object' || r.format !== SYNC_FORMAT) {
      throw new RemoteError('bad-response', 0, 'spinner-sync.json has the wrong format');
    }
    if (typeof r.version === 'number' && r.version > SYNC_LAYOUT_VERSION) {
      throw new EngineError('newer-layout', 'The sync layout on Drive is newer than this app.');
    }
    if (r.erased) {
      if (first) {
        // a later sign-in rewrites the root without `erased` (§7.10)
        const next = await remote.update(root.id, fresh(), sig(deps));
        st.files = { ...st.files, root: { id: next.id, version: next.version } };
        st.seen[next.id] = next.version;
        return 'ok';
      }
      const account = await metaGet(st.raw, 'account');
      if (!account || r.erased.at > account.boundAt) return 'erased';
    }
  }
  st.files = { ...st.files, root: { id: root.id, version: root.version } };
  st.seen[root.id] = root.version;
  return 'ok';
}

/** Raises the counter above every `vv[self]` this device can see (S-B). */
function noteEntries(st: Internal, entries: Iterable<SyncEntry>): void {
  for (const e of entries) {
    const n = e.vv[st.self] ?? 0;
    if (n > st.vv.n) st.vv.n = n;
  }
}

/**
 * `deletedRuns`: ids of runs whose entry is a tombstone after folding, so a run that was deleted
 * and then imported again (a live entry that descends the tombstone, pulled or made here) is not
 * in it. Definitions drop these ids from `runIds` when they are joined. Every pulled run key is
 * folded with its base; a live local run with a dirty mark counts as the (live) candidate.
 */
async function noteRuns(
  st: Internal,
  rows: readonly SyncIndexRecord[],
  pulled?: Pulled,
): Promise<void> {
  const localLive = async (key: SyncKey, id: string): Promise<boolean> =>
    (await st.raw.get('syncDirty', key)) !== undefined &&
    (await st.raw.get('runs', id)) !== undefined;
  if (!pulled) {
    for (const r of rows) {
      if (r.kind === 'run' && r.entry.deleted && !(await localLive(r.key, r.entry.id))) {
        st.deletedRuns.add(r.entry.id);
      }
    }
    return;
  }
  for (const [key, list] of pulled.remote) {
    if (!key.startsWith('run:')) continue;
    const base = await st.raw.get<SyncIndexRecord>('syncIndex', key);
    const winner = foldEntries(base ? [...list, base.entry] : list, new Set()).winner;
    if (winner.deleted && !(await localLive(key, winner.id))) st.deletedRuns.add(winner.id);
    else st.deletedRuns.delete(winner.id);
  }
}
const notePulled = async (st: Internal, p: Pulled): Promise<void> => {
  for (const list of p.remote.values()) noteEntries(st, list);
  await noteRuns(st, [], p);
};

function failure(e: unknown): {
  outcome: CycleResult['outcome'];
  error: NonNullable<CycleResult['error']>;
} {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof EngineError) {
    return {
      outcome: e.code === 'auth' ? 'needs-auth' : e.code === 'network' ? 'offline' : 'error',
      error: { code: e.code, message },
    };
  }
  if (e instanceof RemoteError) {
    const map: Record<RemoteError['code'], [CycleResult['outcome'], SyncErrorCode]> = {
      auth: ['needs-auth', 'auth'],
      forbidden: ['error', 'access-removed'],
      rate: ['error', 'network'],
      quota: ['error', 'quota'],
      'not-found': ['error', 'unknown'],
      server: ['error', 'network'],
      network: ['offline', 'network'],
      'bad-response': ['error', 'unknown'],
    };
    const [outcome, code] = map[e.code];
    return { outcome, error: { code, message } };
  }
  if (isQuotaError(e)) {
    return {
      outcome: 'error',
      error: { code: 'local-full', message: `local storage is full: ${message}` },
    };
  }
  return { outcome: 'error', error: { code: 'unknown', message } };
}

const DAY = 24 * 3600 * 1000;

/**
 * Idempotent clean-up: the index says a run is deleted (and it is not kept as active here) but its
 * results are still on this device, e.g. after a crash between the apply and the eviction.
 */
async function evictDeleted(st: Internal, rows: readonly SyncIndexRecord[]): Promise<void> {
  const gone = rows.filter((r) => r.kind === 'run' && r.entry.deleted && r.local === 0);
  if (gone.length === 0) return;
  const have = new Set((await st.raw.getAllKeys('runs')).map(String));
  for (const r of gone) {
    // a run with a dirty mark was imported again here: it competes with the tombstone instead
    if (
      have.has(r.entry.id) &&
      !st.ctx.deps.isRunActive(r.entry.id) &&
      (await st.raw.get('syncDirty', r.key)) === undefined
    ) {
      await evictRunResults(st.raw, r.entry.id);
      st.changed.add('run');
    }
  }
}

/** Done runs with a bundle that this device has not downloaded, newest first. */
function remoteOnly(rows: readonly SyncIndexRecord[]): RunStub[] {
  return rows
    .filter((r) => r.kind === 'run' && r.local === 0 && !r.entry.deleted && r.entry.value)
    .map((r) => r.entry.value as RunStub)
    .filter((s) => s.status === 'done' && s.bundle)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * One sync cycle (§7.3). Exported for WP-S2c's `beginFirst`, which seeds or wipes first and then
 * runs this. The Web Lock and the token check belong to the app service (S5a).
 *
 * Requests: a cycle with nothing to pull or push makes 1 (the listing). It makes 2 once every 7
 * days (the lib file is re-uploaded to refresh its `writtenAt`/`modifiedTime`, which GC reads for
 * staleness) and 2 while the listing lags the own lib (the lib is then updated every cycle, as the
 * listing cannot confirm it exists).
 *
 * Outcomes: `rate` and `server` errors are outcome `error` with code `network` (retryable);
 * `network` is `offline`; an IndexedDB quota error is `error` with code `local-full`.
 */
export async function runCycle(
  ctx: SyncCtx,
  o: { uploadRuns?: boolean; timeBudgetMs?: number } = {},
): Promise<CycleResult> {
  const st = internalOf(ctx);
  const { deps, remote } = ctx;
  const req0 = st.requests.n;
  st.changed = new Set();
  st.counts = { applied: 0, copies: 0, pushed: 0 };
  st.deletedRuns = new Set();
  st.deferred = new Map();
  st.deferredFiles = new Map();
  const deadline = deps.now() + (o.timeBudgetMs ?? 120_000);
  const done = (outcome: CycleResult['outcome'], error?: CycleResult['error']): CycleResult => ({
    outcome,
    requests: st.requests.n - req0,
    pushed: st.counts.pushed,
    applied: st.counts.applied,
    copies: st.counts.copies,
    changed: [...st.changed],
    ...(error ? { error } : {}),
  });
  try {
    await reloadMeta(st);
    const prefs = await metaGet(st.raw, 'prefs');
    if (prefs && prefs.enabled === false) return done('off');
    const first = (await metaGet(st.raw, 'last')) === undefined;

    deps.onProgress({ phase: 'list', done: 0, total: 1 });
    let files = await remote.list(sig(deps));
    deps.onProgress({ phase: 'list', done: 1, total: 1 });
    if ((await checkRoot(st, files, first)) === 'erased') {
      return done('off', { code: 'erased', message: 'The sync data was removed from Drive.' });
    }

    const rows = await st.raw.getAll<SyncIndexRecord>('syncIndex');
    // own lib missing (GC'd as stale, or deleted by hand): keep the index and the counter (§7.9 6)
    if (
      !first &&
      rows.length > 0 &&
      !st.files.ownLib &&
      !files.some((f) => f.name === LIB_NAME(st.self))
    ) {
      if ((await viaS2c(reseed(ctx))).ok) await reloadMeta(st);
    }

    // S-B: the counter starts above every vv[self] this device has ever seen
    noteEntries(
      st,
      rows.map((r) => r.entry),
    );
    await noteRuns(st, rows);
    await evictDeleted(st, rows);
    for (const r of rows) {
      const n = r.seen[st.self] ?? 0;
      if (n > st.vv.n) st.vv.n = n;
    }
    const pulled = await pull(st, files);
    await notePulled(st, pulled);
    await applyRemote(st, pulled, reapplyUpgraded(rows));
    await persistProgress(st);

    if (o.uploadRuns !== false && !deps.isRunActive()) {
      deps.onProgress({ phase: 'upload-runs', done: 0, total: 0 });
      await viaS2c(uploadPendingRuns(ctx, deadline));
    }

    let pending = await snapshotAll(st);
    // RECHECK (B1 window): did a peer write between our list and our write?
    for (let round = 0; round < 3 && pending.size > 0; round++) {
      files = await remote.list(sig(deps));
      if (changedLibs(st, files).length === 0) break;
      const again = await pull(st, files);
      await notePulled(st, again);
      await applyRemote(st, again, new Map());
      await persistProgress(st);
      pending = await snapshotAll(st);
    }

    await reserve(st); // S-B: the counter is durable BEFORE the lib that carries it goes out
    const built = await buildLib(st, pending);
    const uploaded = await uploadLib(st, built, files, await metaGet(st.raw, 'libSha'));
    await commit(st, {
      pending,
      uploaded,
      libSha: built.sha,
      at: new Date(deps.now()).toISOString(),
      live: new Set(files.map((f) => f.id)),
    });

    let outcome: CycleResult['outcome'] = 'ok';
    if (prefs?.runDownload === 'all' && !deps.isRunActive()) {
      const todo = remoteOnly(await st.raw.getAll<SyncIndexRecord>('syncIndex'));
      let n = 0;
      for (const s of todo) {
        if (deps.now() > deadline) {
          outcome = 'timeout';
          break;
        }
        deps.onProgress({ phase: 'download-runs', done: n++, total: todo.length });
        const r = await viaS2c(downloadRun(ctx, s.runId, sig(deps)));
        if (!r.ok) break;
        if (r.value === 'ok') st.changed.add('run');
      }
    }

    const gcAt = await metaGet(st.raw, 'gcAt');
    const saveData = (globalThis.navigator as { connection?: { saveData?: boolean } } | undefined)
      ?.connection?.saveData;
    if (!saveData && (gcAt === undefined || deps.now() - gcAt > DAY)) {
      deps.onProgress({ phase: 'gc', done: 0, total: 0 });
      if ((await viaS2c(runGc(ctx))).ok) {
        const at = deps.now();
        await st.raw.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k: 'gcAt', v: at }));
      }
    }
    return done(outcome);
  } catch (e) {
    const f = failure(e);
    return done(f.outcome, f.error);
  } finally {
    // values consumed by a cycle that stopped early (a fault, an abort) are never handed out again
    try {
      await reserve(st);
    } catch {
      // the store itself is failing; nothing consumed here has left this device
    }
  }
}

// ------------------------------------------------------------------ the engine

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  let ctxP: Promise<SyncCtx> | undefined;
  const ctx = (): Promise<SyncCtx> => (ctxP ??= createCtx(deps));
  let chain: Promise<unknown> = Promise.resolve();
  /** Cycles, first sync and erase never overlap within one engine (the app adds the Web Lock). */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  };
  const rows = (): Promise<SyncIndexRecord[]> =>
    deps.backend.raw.getAll<SyncIndexRecord>('syncIndex');
  const libCache = new Map<string, SyncDeviceInfo>();

  return {
    preview: () => serial(async () => previewFirst(await ctx())),
    begin: (choice) => serial(async () => beginFirst(await ctx(), choice)),
    cycle: (o) => serial(async () => runCycle(await ctx(), o)),
    downloadRun: async (runId, o) => downloadRun(await ctx(), runId, o),
    async listRemoteRuns() {
      return (await rows())
        .filter((r) => r.kind === 'run' && !r.entry.deleted && r.entry.value)
        .map((r) => r.entry.value as RunStub)
        .sort((a, b) => {
          const x = a.finishedAt ?? a.createdAt;
          const y = b.finishedAt ?? b.createdAt;
          return x < y ? 1 : x > y ? -1 : 0;
        });
    },
    async devices() {
      const files = (await deps.remote.list(sig(deps))).filter((f) => libDevice(f.name) !== null);
      const out: SyncDeviceInfo[] = [];
      for (const f of files) {
        const key = `${f.id}@${f.version}`;
        let info = libCache.get(key);
        if (!info) {
          try {
            const lib = await decodeLib(await deps.remote.download(f.id, sig(deps)));
            info = {
              id: lib.device.id,
              name: lib.device.name,
              lastSyncedAt: lib.writtenAt,
              appVersion: lib.device.appVersion,
            };
            libCache.set(key, info);
          } catch (e) {
            if (e instanceof RemoteError) throw e;
            continue; // a damaged lib file is not a device
          }
        }
        out.push(info);
      }
      return out.sort((a, b) => (a.lastSyncedAt < b.lastSyncedAt ? 1 : -1));
    },
    async downloadAllRemote(o) {
      const c = await ctx();
      const all = (await rows()).filter(
        (r) => r.kind === 'run' && !r.entry.deleted && (r.entry.value as RunStub | null)?.bundle,
      );
      const skipped = all.filter((r) => r.local === 1).length;
      let done = 0;
      for (const s of remoteOnly(all)) {
        if (o?.signal?.aborted) break;
        if ((await downloadRun(c, s.runId, o)) === 'ok') done++;
      }
      return { done, skipped };
    },
    evict: async (runId) => evictRun(await ctx(), runId),
    reupload: (runId) => serial(async () => reuploadRun(await ctx(), runId)),
    eraseRemote: () => serial(async () => eraseRemote(await ctx())),
    resetLocalSyncState: () => serial(async () => resetLocalSyncState(await ctx())),
  };
}
