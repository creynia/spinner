// PULL + APPLY of one sync cycle (sync.md §7.3, §7.4, §7.7) and the local snapshot of one record.
//
// RULES THAT SHAPE EVERY FUNCTION HERE
//  - Inside `raw.update(stores, fn)`, `fn` awaits only `r.get`. Every hash (candidates, copies,
//    fingerprints) is computed BEFORE the transaction; a nested tx/update would deadlock.
//  - The engine writes through `backend.raw`, so its writes leave no dirty marks. Marks come from
//    user writes only (`<kind>:<id>`; a run's parts and summaries all map to `run:<runId>`).
//  - A key is applied in one transaction. The dirty mark is read before and inside the
//    transaction; a user write in between changes its nonce and the key is retried.
import {
  DEVICE_ID_PATTERN,
  SYNCED_SETTING_KEYS,
  type ConflictNotice,
  type DeviceId,
  type RunBundleRef,
  type RunStub,
  type SyncDirtyRecord,
  type SyncEntry,
  type SyncIndexRecord,
  type SyncKey,
  type SyncKind,
  type SyncMetaKey,
  type SyncMetaValues,
} from '../contracts/sync';
import type { RunMeta } from '../contracts/run';
import type { DefinitionRecord } from '../contracts/experiment';
import { canonicalJson, sha256Hex } from '../experiment';
import { evictRunResults, layoutHash, type Backend, type StoreName } from '../store';
import type { SyncCtx } from './ctx';
import { entryOf, hashOf, SUPPORTED_V, verifyEntry } from './fingerprint';
import { hlcDevice, hlcWall } from './hlc';
import { decodeLib, LibFileError } from './libfile';
import { copyIdChain, copyOf, equivalent, foldEntries, isCopyOf, resolve } from './merge';
import { descends } from './vv';
import type { RemoteFile } from '../contracts/sync';

// ------------------------------------------------------------------ shared helpers

export const KIND_ORDER: readonly SyncKind[] = [
  'def',
  'strategy',
  'layout',
  'group',
  'setting',
  'run',
];

export const STORE_OF: Record<SyncKind, StoreName> = {
  def: 'definitions',
  strategy: 'strategies',
  layout: 'layouts',
  group: 'groups',
  setting: 'settings',
  run: 'runs',
};

export const CONFLICTS_MAX = 50;

/** Tunables; tests lower `pullParallel` to 1 so that a fuzz seed replays exactly. */
export const LIMITS = { pullParallel: 4 };

/**
 * Test seam: called with every entry this device mints (candidates and conflict copies), whether
 * or not it is ever published. The fuzz needs them: a discarded candidate (a delete that lost to
 * an edit) still supersedes the entries it descends.
 */
export const TEST_HOOKS: {
  onMint?: (e: SyncEntry) => void;
  /** A minted candidate dropped because an equivalent published entry was applied instead. */
  onTwin?: (e: SyncEntry) => void;
  /** Every fold of one key: what went in and what the engine decided. */
  onFold?: (f: {
    self: DeviceId;
    key: SyncKey;
    base: SyncEntry | undefined;
    remote: readonly SyncEntry[];
    cand: SyncEntry | undefined;
    did: string;
    snap: string;
    winner: SyncEntry | undefined;
    losers: readonly SyncEntry[];
  }) => void;
} = {};
const RETRIES = 4;
const LIB_FILE = /^lib\.([0-9a-hjkmnp-tv-z]{10})\.json\.gz$/;

/** The device a lib file name belongs to, or null when it is not a lib file. */
export const libDevice = (name: string): DeviceId | null => LIB_FILE.exec(name)?.[1] ?? null;

export const syncKey = (kind: SyncKind, id: string): SyncKey => `${kind}:${id}`;

/** Thrown for a failure that has a code the UI understands. */
export class EngineError extends Error {
  constructor(
    readonly code:
      | 'local-full'
      | 'newer-layout'
      | 'access-removed'
      | 'account-mismatch'
      | 'erased'
      | 'network'
      | 'quota'
      | 'auth'
      | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export async function metaGet<K extends SyncMetaKey>(
  raw: Backend,
  k: K,
): Promise<SyncMetaValues[K] | undefined> {
  const row = await raw.get<{ k: K; v: SyncMetaValues[K] }>('syncMeta', k);
  return row?.v;
}

type Vv = Record<DeviceId, number>;
export function joinVvs(...vs: Vv[]): Vv {
  const out = new Map<string, number>();
  for (const v of vs)
    for (const [d, n] of Object.entries(v)) out.set(d, Math.max(out.get(d) ?? 0, n));
  return Object.fromEntries([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Newer record schema, or a kind this build does not know: kept, never interpreted. */
export const isOpaque = (e: SyncEntry): boolean =>
  !Object.hasOwn(SUPPORTED_V, e.kind) || e.v > SUPPORTED_V[e.kind];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The per-ctx state of the engine. Lives for the life of a `SyncCtx`. */
export interface Internal {
  ctx: SyncCtx;
  raw: Backend;
  self: DeviceId;
  /** `n` = the highest value consumed; `persisted` = what `syncMeta.vvCounter` holds. */
  vv: { n: number; persisted: number };
  requests: { n: number };
  // reloaded at the start of every cycle (S2c functions may change the rows between cycles)
  copies: Set<string>;
  conflicts: ConflictNotice[];
  seen: Record<string, string>;
  files: SyncMetaValues['files'];
  names: Map<DeviceId, string>;
  // per cycle
  deletedRuns: Set<string>;
  changed: Set<SyncKind>;
  /** Keys left opaque this cycle -> HLC of the opaque entry kept as their base. */
  deferred: Map<SyncKey, string>;
  /** Lib files that carry a deferred key's other entries: id -> version; they stay unseen. */
  deferredFiles: Map<string, string>;
  counts: { applied: number; copies: number; pushed: number };
}

export const internals = new WeakMap<SyncCtx, Internal>();
export function internalOf(ctx: SyncCtx): Internal {
  const st = internals.get(ctx);
  if (!st) throw new Error('SyncCtx was not made by createCtx');
  return st;
}

function nonce(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const nameOfValue = (kind: SyncKind, value: unknown): string => {
  if (!isObj(value)) return '';
  if (kind === 'def') {
    const d = value as unknown as DefinitionRecord;
    return d.displayName ?? (isObj(d.definition) ? String(d.definition.name ?? '') : '');
  }
  if (kind === 'strategy' || kind === 'layout') {
    const inner = value[kind];
    return isObj(inner) && typeof inner.name === 'string' ? inner.name : '';
  }
  return typeof value.name === 'string' ? value.name : '';
};

// ------------------------------------------------------------------ the local candidate

export type Snap =
  | { k: 'none' }
  /** Nothing to push and the mark can go: a dry run, a no-op re-save, a never-synced delete. */
  | { k: 'drop' }
  /** Keep the mark, no candidate yet (a running run, an opaque key, a bundle not uploaded). */
  | { k: 'defer' }
  | { k: 'cand'; entry: SyncEntry };

async function runStub(
  st: Internal,
  meta: RunMeta,
  base: SyncIndexRecord | undefined,
): Promise<RunStub | 'defer'> {
  const { deps } = st.ctx;
  let bundle: RunBundleRef | undefined;
  let verdict: RunStub['verdict'];
  if (meta.status === 'done') {
    const digest = meta.resultsDigest;
    const d16 = digest?.slice(0, 16);
    const mine = (await metaGet(st.raw, 'bundles'))?.[meta.runId];
    if (mine && d16 && mine.name.includes(`.${d16}.`)) bundle = mine;
    const prev = base && !base.entry.deleted ? (base.entry.value as RunStub | null) : null;
    if (!bundle && prev && prev.resultsDigest === digest && prev.bundle) bundle = prev.bundle;
    // bundles go before the lib file that references them (§7.6): wait for the upload
    if (!bundle || !digest) return 'defer';
    verdict = await deps.describeRun(meta);
  }
  const stub: RunStub = {
    runId: meta.runId,
    definitionId: meta.definitionId,
    simKey: meta.simKey,
    runKey: meta.runKey,
    status: meta.status,
    sessions: meta.sessions,
    completedSessions: meta.completedSessions,
    prefixSessions: meta.prefixSessions,
    createdAt: meta.createdAt,
    appVersion: meta.appVersion,
    gameId: meta.gameId,
    gameVersion: meta.gameVersion,
    coreVersion: meta.coreVersion,
    extra: {
      device: meta.device,
      timing: meta.timing,
      resumes: meta.resumes,
      ...(meta.imported ? { imported: meta.imported } : {}),
    },
  };
  if (meta.timing.finishedAt) stub.finishedAt = meta.timing.finishedAt;
  if (meta.interrupted) stub.interrupted = true;
  if (meta.error) stub.error = meta.error;
  const owner = meta.synced ? meta.synced.from : meta.imported ? undefined : st.self;
  if (owner !== undefined) stub.owner = owner;
  if (meta.status === 'done') {
    stub.resultsDigest = meta.resultsDigest!;
    stub.bundle = bundle!;
    if (verdict) stub.verdict = verdict;
  }
  return JSON.parse(JSON.stringify(stub)) as RunStub; // no `undefined`, no shared references
}

/**
 * What a dirty mark means right now (SNAPSHOT of §7.3, and the candidate of PULL+APPLY): reads
 * the local record, applies the exclusion rules (dry runs, running runs, other devices' settings)
 * and mints the candidate with a fresh `vvCounter` value. Mutates nothing.
 */
export async function snapshotLocal(
  st: Internal,
  key: SyncKey,
  dirty: SyncDirtyRecord,
  base: SyncIndexRecord | undefined,
): Promise<Snap> {
  const { deps, clock } = st.ctx;
  const kind = key.slice(0, key.indexOf(':')) as SyncKind;
  const id = key.slice(key.indexOf(':') + 1);
  if (!Object.hasOwn(STORE_OF, kind)) return { k: 'drop' };
  if (base && base.local === 0 && !base.entry.deleted && isOpaque(base.entry)) {
    return { k: 'defer' }; // until the app upgrades
  }
  let value: unknown = null;
  const rec = await st.raw.get<unknown>(STORE_OF[kind], id);
  if (kind === 'run') {
    if (rec !== undefined) {
      const meta = rec as RunMeta;
      // D13: a running run's mark is ignored until the run is done
      if (meta.status === 'queued' || meta.status === 'running' || deps.isRunActive(id)) {
        return { k: 'defer' };
      }
      const def = await st.raw.get<DefinitionRecord>('definitions', meta.definitionId);
      if (def && deps.isDryRun(def)) return { k: 'drop' };
      const stub = await runStub(st, meta, base);
      if (stub === 'defer') return { k: 'defer' };
      value = stub;
    }
  } else if (rec !== undefined) {
    if (kind === 'def' && deps.isDryRun(rec as DefinitionRecord)) return { k: 'drop' };
    if (kind === 'setting' && !(SYNCED_SETTING_KEYS as readonly string[]).includes(id)) {
      return { k: 'drop' };
    }
    value = rec;
  }
  if (value === null && (!base || base.entry.deleted)) return { k: 'drop' }; // nothing to delete
  const hash = await hashOf(kind, value);
  // a re-save that changed nothing the fingerprint sees: no push, the mark goes (§7.2)
  if (base && base.entry.hash === hash && (base.entry.deleted === true) === (value === null)) {
    return { k: 'drop' };
  }
  const entry = await entryOf(
    kind,
    id,
    value as never,
    clock.tickAt(dirty.last),
    base ? { hlc: base.entry.hlc, seen: base.seen } : undefined,
    st.self,
    st.ctx.vv.next(),
  );
  TEST_HOOKS.onMint?.(entry);
  return { k: 'cand', entry };
}

// ------------------------------------------------------------------ PULL

export interface Pulled {
  /** Every entry of every changed lib file, per key (a SET; no pairwise folding). */
  remote: Map<SyncKey, SyncEntry[]>;
  /** The lib files read, id -> version, to mark `seen` once they are fully applied. */
  versions: Record<string, string>;
  /** Per lib file read: the (key, hlc) of every entry it carried. */
  fileKeys: Record<string, { key: SyncKey; hlc: string }[]>;
}

const isLibFile = (f: RemoteFile): boolean => libDevice(f.name) !== null;

/** The lib files whose version this device has not applied yet. */
export const unseenLibs = (st: Internal, files: readonly RemoteFile[]): RemoteFile[] =>
  files.filter((f) => isLibFile(f) && st.seen[f.id] !== f.version);

function pushNotice(st: Internal, n: Omit<ConflictNotice, 'id' | 'at' | 'read'>): void {
  const at = new Date(st.ctx.deps.now()).toISOString();
  st.conflicts = [
    ...st.conflicts,
    { ...n, id: `${n.key}@${at}@${st.conflicts.length}`, at, read: false },
  ].slice(-CONFLICTS_MAX);
}

/** Checks of §7.5 that need more than the fingerprint (hashes inside the value). */
async function validEntry(e: SyncEntry): Promise<boolean> {
  if (e.deleted || e.value === null) return true;
  const v = e.value as unknown;
  if (!isObj(v)) return false;
  switch (e.kind) {
    case 'strategy': {
      const s = v.strategy;
      if (!isObj(s) || s.id !== v.id) return false;
      return v.hash === (await sha256Hex(canonicalJson(s as never)));
    }
    case 'layout': {
      const l = v.layout;
      if (!isObj(l) || l.id !== v.id) return false;
      return v.hash === (await layoutHash(l as never));
    }
    case 'setting':
      return (SYNCED_SETTING_KEYS as readonly string[]).includes(e.id);
    default:
      return true;
  }
}

/** Entries (as JSON) that passed `verifyEntry` and `validEntry`; bounded, cleared when full. */
const verified = new Set<string>();
const VERIFIED_MAX = 20_000;

export async function pull(st: Internal, files: readonly RemoteFile[]): Promise<Pulled> {
  const { remote: store, clock, deps } = st.ctx;
  const todo = unseenLibs(st, files);
  const out: Pulled = { remote: new Map(), versions: {}, fileKeys: {} };
  let next = 0;
  let done = 0;
  const one = async (f: RemoteFile): Promise<void> => {
    const bytes = await store.download(f.id, deps.signal ? { signal: deps.signal } : undefined);
    let lib;
    try {
      lib = await decodeLib(bytes);
    } catch (e) {
      if (e instanceof LibFileError && e.code === 'newer-version') {
        throw new EngineError('newer-layout', 'A device uses a newer version of spinner.');
      }
      if (e instanceof LibFileError) return; // damaged file: skipped, retried when it changes
      throw e;
    }
    if (!DEVICE_ID_PATTERN.test(lib.device.id) || lib.device.id !== libDevice(f.name)) return;
    st.names.set(lib.device.id, lib.device.name);
    try {
      clock.recv(lib.hlc);
    } catch {
      return; // a forged clock: the file is not trusted
    }
    let bad = 0;
    const kept: SyncEntry[] = [];
    for (const e of lib.entries) {
      // every device re-publishes the merged view, so most entries of a changed lib were checked
      // before: the exact same bytes need no second hash
      const sig = JSON.stringify(e);
      if (verified.has(sig)) {
        kept.push(e);
        continue;
      }
      const v = await verifyEntry(e);
      if (v === 'ok' && (await validEntry(e))) {
        kept.push(e);
        if (verified.size >= VERIFIED_MAX) verified.clear();
        verified.add(sig);
      } else if (v === 'newer' || v === 'unknown-kind')
        kept.push(e); // kept opaquely
      else bad++;
    }
    if (bad > 0) {
      pushNotice(st, {
        key: `setting:sync`,
        kind: 'setting',
        message: `${bad} item${bad === 1 ? '' : 's'} from ${lib.device.name} could not be verified and ${bad === 1 ? 'was' : 'were'} skipped.`,
      });
    }
    const carried: { key: SyncKey; hlc: string }[] = [];
    for (const e of kept) {
      try {
        clock.recv(e.hlc);
      } catch {
        continue;
      }
      carried.push({ key: e.key, hlc: e.hlc });
      const list = out.remote.get(e.key);
      if (list) list.push(e);
      else out.remote.set(e.key, [e]);
    }
    out.versions[f.id] = f.version;
    out.fileKeys[f.id] = carried;
  };
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const f = todo[next++]!;
      await one(f);
      deps.onProgress({ phase: 'pull', done: ++done, total: todo.length });
    }
  };
  if (todo.length > 0) deps.onProgress({ phase: 'pull', done: 0, total: todo.length });
  await Promise.all(Array.from({ length: Math.min(LIMITS.pullParallel, todo.length) }, worker));
  return out;
}

// ------------------------------------------------------------------ APPLY

class Retry extends Error {}

interface CopyPlan {
  entry: SyncEntry;
  loser: SyncEntry;
  editMs: number;
}

/**
 * The copy of a conflict loser, following the copy-id chain contract (§7.7), or null when none is
 * to be made. Everything async happens here, before the transaction. It runs for EVERY loser on
 * EVERY cycle, so a copy that exists (rule 2 or 3) is never made again.
 *
 * KNOWN LIMIT (accepted): a copy is an ordinary record. If the user edits it, another device that
 * has not seen the edit still holds the old copy; the two versions of the copy's key resolve by
 * the ordinary rules and may make one more copy there. Nothing is lost.
 */
async function planCopy(
  st: Internal,
  loser: SyncEntry,
  incoming: ReadonlyMap<SyncKey, SyncEntry[]>,
  reserved: ReadonlySet<string>,
): Promise<CopyPlan | null> {
  const chain = copyIdChain(loser);
  if (chain.length === 0) return null;
  if (chain.some((id) => st.copies.has(id) || reserved.has(id))) return null; // rule 2
  const taken = new Set<string>();
  for (const id of chain) {
    const key = syncKey(loser.kind, id);
    const present: SyncEntry[] = [];
    const idx = await st.raw.get<SyncIndexRecord>('syncIndex', key);
    if (idx) present.push(idx.entry);
    present.push(...(incoming.get(key) ?? []));
    const rec = await st.raw.get<unknown>(STORE_OF[loser.kind], id);
    if (rec !== undefined) {
      present.push({
        key,
        kind: loser.kind,
        id,
        hlc: loser.hlc,
        basis: null,
        vv: {},
        hash: await hashOf(loser.kind, rec),
        v: 1,
        value: rec as never,
      });
    }
    for (const e of present) if (await isCopyOf(loser, e)) return null; // rule 3
    if (present.some((e) => !e.deleted)) taken.add(id); // rule 4: live, other content
  }
  const editMs = hlcWall(loser.hlc);
  const entry = await copyOf(loser, taken, {
    hlc: st.ctx.clock.tickAt(editMs),
    self: st.self,
    counter: st.ctx.vv.next(),
  });
  if (entry) TEST_HOOKS.onMint?.(entry);
  return entry ? { entry, loser, editMs } : null;
}

const sameVv = (a: Vv, b: Vv): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/** One key: fold, decide, write (one transaction). Throws `Retry` when a user write got in between. */
async function applyKeyOnce(
  st: Internal,
  key: SyncKey,
  remote: readonly SyncEntry[],
  incoming: ReadonlyMap<SyncKey, SyncEntry[]>,
): Promise<void> {
  const { raw } = st;
  const kind = remote[0]!.kind;
  const id = remote[0]!.id;
  const store = Object.hasOwn(STORE_OF, kind) ? STORE_OF[kind] : null;
  const [base, dirty] = await Promise.all([
    raw.get<SyncIndexRecord>('syncIndex', key),
    raw.get<SyncDirtyRecord>('syncDirty', key),
  ]);
  const snap: Snap = dirty ? await snapshotLocal(st, key, dirty, base) : { k: 'none' };
  const cand = snap.k === 'cand' ? snap.entry : undefined;
  const { res, losers, seen } = resolve(remote, base, cand, st.deletedRuns);
  if (cand && res.do === 'apply' && equivalent(res.entry, cand)) TEST_HOOKS.onTwin?.(cand);
  TEST_HOOKS.onFold?.({
    self: st.self,
    key,
    base: base?.entry,
    remote,
    cand,
    did: res.do,
    snap: snap.k,
    winner: res.do === 'apply' || res.do === 'join' ? res.entry : undefined,
    losers,
  });

  // --- everything async, before the transaction
  const plans: CopyPlan[] = [];
  const reserved = new Set<string>();
  for (const l of losers) {
    const p = await planCopy(st, l, incoming, reserved);
    if (p) {
      plans.push(p);
      reserved.add(p.entry.id);
    }
  }
  const published = base ? [...remote, base.entry] : [...remote];
  // An opaque (newer-schema) maximal entry becomes the base, so the key stays deferred; nothing
  // that is concurrent with it is folded into `seen` or published over it (see the 'opaque' case).
  const opaqueMax =
    res.do === 'opaque'
      ? published
          .filter(
            (e) =>
              isOpaque(e) && !published.some((o) => o !== e && descends(o, e) && !descends(e, o)),
          )
          .sort((a, b) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : 0))[0]
      : undefined;
  const winnerOf = res.do === 'apply' || res.do === 'join' ? res.entry : (cand ?? base?.entry);
  const runGone =
    kind === 'run' &&
    res.do === 'apply' &&
    res.entry.deleted === true &&
    (await raw.get('runs', id)) !== undefined;
  const runActive = runGone && st.ctx.deps.isRunActive(id);

  const copyStores = [...new Set(plans.map((p) => STORE_OF[p.entry.kind]))];
  const stores: StoreName[] = [
    ...new Set<StoreName>([
      ...(store ? [store] : []),
      'syncIndex',
      'syncDirty',
      'syncMeta',
      ...copyStores,
      ...(kind === 'run' ? (['runs'] as StoreName[]) : []),
    ]),
  ];
  const newCopies = new Set(st.copies);
  let notices = st.conflicts;
  const savedConflicts = st.conflicts;
  const stats = { applied: 0, copies: 0 };

  await raw
    .update(stores, async (r, w) => {
      const d2 = await r.get<SyncDirtyRecord>('syncDirty', key);
      if (d2?.n !== dirty?.n) throw new Retry(); // the user wrote in between
      for (const p of plans) {
        if ((await r.get(STORE_OF[p.entry.kind], p.entry.id)) !== undefined) throw new Retry();
      }
      const hasRun = kind === 'run' ? (await r.get('runs', id)) !== undefined : false;
      const put = (entry: SyncEntry, local: 0 | 1, s: Vv = seen): void =>
        w.put('syncIndex', { key, kind, entry, seen: s, local } satisfies SyncIndexRecord);
      const dropMark = (): void => {
        if (d2) w.delete('syncDirty', key);
      };
      const sameAsLocal = (e: SyncEntry): boolean =>
        cand !== undefined &&
        cand.hash === e.hash &&
        (cand.deleted === true) === (e.deleted === true);

      switch (res.do) {
        case 'skip-older': {
          // a run re-saved unchanged that exists here: the index says so (local = 1)
          const local = base && kind === 'run' && hasRun && !base.entry.deleted ? 1 : base?.local;
          if (base && (!sameVv(base.seen, seen) || local !== base.local)) {
            put(base.entry, local ?? base.local);
          }
          if (snap.k === 'drop') dropMark();
          break;
        }
        case 'apply': {
          const e = res.entry;
          const live = !e.deleted && e.value !== null;
          if (store && kind !== 'run' && !sameAsLocal(e)) {
            if (live) w.put(store, e.value);
            else w.delete(store, id);
            stats.applied++;
            st.changed.add(kind);
          }
          if (kind === 'run' && !live && runGone) {
            stats.applied++;
            st.changed.add('run');
          }
          if (runActive) {
            // the delete lost to a run that is still going: keep it and re-push it when done
            w.put('syncDirty', {
              key,
              last: st.ctx.deps.now(),
              n: nonce(),
            } satisfies SyncDirtyRecord);
            put(e, 1);
            pushNotice(st, {
              key,
              kind,
              message: 'A run was deleted on another device while it was running here. It is kept.',
            });
            notices = st.conflicts;
          } else {
            put(e, live ? (kind === 'run' ? (hasRun ? 1 : 0) : 1) : 0);
            if (dirty && snap.k !== 'defer') dropMark();
          }
          break;
        }
        case 'join': {
          const e = res.entry;
          if (store) w.put(store, e.value);
          stats.applied++;
          st.changed.add(kind);
          put(e, 1);
          if (dirty && snap.k !== 'defer' && (snap.k !== 'cand' || sameAsLocal(e))) dropMark();
          break;
        }
        case 'keep-local': {
          const top = foldEntries(published, st.deletedRuns).winner;
          put(top, 1);
          break; // the mark stays: the push mints from `seen`
        }
        case 'opaque':
          // the local value is left alone and the mark stays; `seen` is not advanced past the
          // opaque entry (our own edit stays concurrent with it), and what is concurrent with it is
          // folded again after the upgrade
          put(opaqueMax!, 0, base?.seen ?? {});
          break;
      }

      for (const p of plans) {
        const c = p.entry;
        const cs = STORE_OF[c.kind];
        w.put(cs, c.value);
        w.put('syncDirty', { key: c.key, last: p.editMs, n: nonce() } satisfies SyncDirtyRecord);
        newCopies.add(c.id);
        const mine = st.ctx.deps.deviceName();
        const devName = (d: DeviceId): string =>
          d === st.self ? mine : (st.names.get(d) ?? 'another device');
        const a = winnerOf ? devName(hlcDevice(winnerOf.hlc)) : mine;
        const b = devName(hlcDevice(p.loser.hlc));
        const orig = nameOfValue(c.kind, p.loser.value) || p.loser.id;
        const copyName = nameOfValue(c.kind, c.value) || c.id;
        const text = `“${orig}” was changed on two devices (${a} and ${b}). Both are kept: the other version is “${copyName}”.`;
        st.conflicts = [
          ...st.conflicts,
          {
            id: `${c.key}@${p.loser.hlc}`,
            at: new Date(st.ctx.deps.now()).toISOString(),
            key: p.loser.key,
            kind: c.kind,
            message: text,
            copyId: c.id,
            read: false,
          },
        ].slice(-CONFLICTS_MAX);
        notices = st.conflicts;
        stats.copies++;
        st.changed.add(c.kind);
      }
      w.put('syncMeta', { k: 'vvCounter', v: st.vv.n });
      if (plans.length > 0) w.put('syncMeta', { k: 'copies', v: [...newCopies].sort() });
      if (notices !== savedConflicts || plans.length > 0) {
        w.put('syncMeta', { k: 'conflicts', v: notices });
      }
    })
    .catch((e: unknown) => {
      st.conflicts = savedConflicts; // nothing was written
      throw e;
    });
  // after the commit: a retry that kept the run must not find its results gone
  if (runGone && !runActive) await evictRunResults(raw, id);
  st.vv.persisted = st.vv.n;
  if (res.do === 'opaque') st.deferred.set(key, opaqueMax!.hlc);
  else st.deferred.delete(key);
  st.copies = newCopies;
  st.counts.applied += stats.applied;
  st.counts.copies += stats.copies;
}

/**
 * Applies every pulled key, in kind order, then marks the pulled lib files `seen`: only when every
 * key was applied, and never a file that carries an entry concurrent with an opaque one (those
 * files are read again every cycle until the app can interpret the opaque entry). Returns whether
 * every key was applied.
 */
export async function applyRemote(
  st: Internal,
  pulled: Pulled,
  reapply: ReadonlyMap<SyncKey, SyncEntry[]>,
): Promise<boolean> {
  const all = new Map<SyncKey, SyncEntry[]>();
  for (const [k, v] of reapply) all.set(k, [...v]);
  for (const [k, v] of pulled.remote) all.set(k, [...(all.get(k) ?? []), ...v]);
  const order = (k: SyncKey): number => {
    const i = KIND_ORDER.indexOf(k.slice(0, k.indexOf(':')) as SyncKind);
    return i < 0 ? KIND_ORDER.length : i;
  };
  const keys = [...all.keys()].sort((a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0));
  const { deps } = st.ctx;
  let ok = true;
  let n = 0;
  deps.onProgress({ phase: 'apply', done: 0, total: keys.length });
  for (const key of keys) {
    let applied = false;
    for (let attempt = 0; attempt < RETRIES && !applied; attempt++) {
      try {
        await applyKeyOnce(st, key, all.get(key)!, all);
        applied = true;
      } catch (e) {
        if (!(e instanceof Retry)) throw e;
      }
    }
    if (!applied) ok = false;
    deps.onProgress({ phase: 'apply', done: ++n, total: keys.length });
  }
  if (ok) {
    for (const [id, version] of Object.entries(pulled.versions)) {
      const blocked = (pulled.fileKeys[id] ?? []).some((e) => {
        const kept = st.deferred.get(e.key);
        return kept !== undefined && kept !== e.hlc;
      });
      if (blocked) st.deferredFiles.set(id, version);
      else {
        st.seen[id] = version;
        st.deferredFiles.delete(id);
      }
    }
  }
  return ok;
}

/**
 * Index entries that were opaque (newer schema) and that this build can now read: fed through
 * APPLY again, as if they had just arrived.
 */
export function reapplyUpgraded(rows: readonly SyncIndexRecord[]): Map<SyncKey, SyncEntry[]> {
  const out = new Map<SyncKey, SyncEntry[]>();
  for (const r of rows) {
    if (r.local === 0 && !r.entry.deleted && r.entry.kind !== 'run' && !isOpaque(r.entry)) {
      out.set(r.key, [r.entry]);
    }
  }
  return out;
}
