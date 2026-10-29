// SNAPSHOT, RECHECK, RESERVE, the lib upload and the commit of one cycle (sync.md §7.3).
//
// Order of durability, the only thing that makes a crash at any point safe:
//   1. every `vvCounter` value consumed is persisted (RESERVE) BEFORE the lib that carries it is
//      uploaded, so no (device, counter) pair is ever minted twice (S-B);
//   2. the lib file is uploaded;
//   3. only then does the commit move `syncIndex`, drop the marks whose nonce is unchanged and
//      store `libSha`/`seen`/`last`. A crash between 2 and 3 re-reads our own lib next cycle: its
//      entries are equivalent to the re-minted candidates and collapse in the fold.
import {
  type LibFileV1,
  type RemoteFile,
  type SyncDirtyRecord,
  type SyncEntry,
  type SyncIndexRecord,
  type SyncKey,
  type SyncKind,
} from '../contracts/sync';
import { canonicalJson, sha256Hex } from '../experiment';
import { RemoteError } from '../contracts/sync';
import { joinVvs, KIND_ORDER, libDevice, snapshotLocal, type Internal } from './apply';
import { encodeLib, LIB_NAME } from './libfile';

export interface Pending {
  entry: SyncEntry;
  /** Nonce of the dirty mark the candidate was minted from. */
  n: string;
}

const order = (k: SyncKey): number => {
  const i = KIND_ORDER.indexOf(k.slice(0, k.indexOf(':')) as SyncKind);
  return i < 0 ? KIND_ORDER.length : i;
};

/** Drops marks that need no push (dry runs, no-op re-saves, never-synced deletes), by nonce. */
async function dropMarks(
  st: Internal,
  drops: readonly { key: SyncKey; n: string }[],
): Promise<void> {
  if (drops.length === 0) return;
  await st.raw.update(['syncDirty', 'syncIndex', 'runs'], async (r, w) => {
    for (const d of drops) {
      const cur = await r.get<SyncDirtyRecord>('syncDirty', d.key);
      if (!cur || cur.n !== d.n) continue;
      w.delete('syncDirty', d.key);
      // a run re-saved unchanged that exists here: the index must say it is local
      if (d.key.startsWith('run:')) {
        const idx = await r.get<SyncIndexRecord>('syncIndex', d.key);
        if (
          idx &&
          idx.local === 0 &&
          !idx.entry.deleted &&
          (await r.get('runs', d.key.slice(4))) !== undefined
        ) {
          w.put('syncIndex', { ...idx, local: 1 } satisfies SyncIndexRecord);
        }
      }
    }
  });
}

/**
 * SNAPSHOT: a candidate entry for every dirty mark that has something to push. Each candidate is
 * `basis = base.entry.hlc`, `vv = base.seen + { self: ++vvCounter }`, `hlc = tickAt(mark.last)`.
 */
export async function snapshotAll(st: Internal): Promise<Map<SyncKey, Pending>> {
  const marks = (await st.raw.getAll<SyncDirtyRecord>('syncDirty')).sort(
    (a, b) => order(a.key) - order(b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const pending = new Map<SyncKey, Pending>();
  const drops: { key: SyncKey; n: string }[] = [];
  for (const m of marks) {
    const base = await st.raw.get<SyncIndexRecord>('syncIndex', m.key);
    const snap = await snapshotLocal(st, m.key, m, base);
    if (snap.k === 'cand') pending.set(m.key, { entry: snap.entry, n: m.n });
    else if (snap.k === 'drop') drops.push({ key: m.key, n: m.n });
  }
  await dropMarks(st, drops);
  return pending;
}

/** RESERVE: persist `vvCounter` (also done inside every APPLY transaction that consumed values). */
export async function reserve(st: Internal): Promise<void> {
  if (st.vv.n <= st.vv.persisted) return;
  const n = st.vv.n;
  await st.raw.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k: 'vvCounter', v: n }));
  st.vv.persisted = n;
}

export interface BuiltLib {
  lib: LibFileV1;
  /** sha256 of the lib's canonical JSON with `writtenAt` blanked: equal content, equal sha. */
  sha: string;
}

/** The lib file: every `syncIndex` entry, with the pending candidates replacing their keys. */
export async function buildLib(
  st: Internal,
  pending: ReadonlyMap<SyncKey, Pending>,
): Promise<BuiltLib> {
  const { deps, clock, deviceId } = st.ctx;
  const rows = await st.raw.getAll<SyncIndexRecord>('syncIndex');
  const byKey = new Map<SyncKey, SyncEntry>(rows.map((r) => [r.key, r.entry]));
  for (const [k, p] of pending) byKey.set(k, p.entry);
  const entries = [...byKey.values()];
  const top = entries.reduce((m, e) => (e.hlc > m ? e.hlc : m), '');
  const lib: LibFileV1 = {
    format: 'spinner-sync-lib',
    version: 1,
    device: {
      id: deviceId,
      name: deps.deviceName(),
      appVersion: deps.appVersion,
      coreVersion: deps.coreVersion,
    },
    hlc: top === '' ? clock.last : top,
    writtenAt: '',
    entries,
  };
  const sha = await sha256Hex(canonicalJson(lib as never));
  return { lib, sha };
}

export interface Uploaded {
  file: RemoteFile;
  sha: string;
}

const STALE_MS = 7 * 24 * 3600 * 1000;

/**
 * Upload the lib unless its content is unchanged. `ownLib` comes from `syncMeta.files`, never from
 * the listing alone (a listing can lag a create). Returns null when nothing was uploaded.
 */
export async function uploadLib(
  st: Internal,
  built: BuiltLib,
  files: readonly RemoteFile[],
  libSha: string | undefined,
): Promise<Uploaded | null> {
  const { remote, deps, deviceId } = st.ctx;
  const own = st.files.ownLib;
  const listed = own ? files.find((f) => f.id === own.id) : undefined;
  const refresh = listed !== undefined && deps.now() - Date.parse(listed.modifiedTime) > STALE_MS;
  // Unknown to us, or missing from the listing (maybe gone, maybe lag): still upload; an update
  // answers 404 when it is really gone.
  const must = !own || !listed || refresh;
  if (!must && libSha === built.sha) return null;
  deps.onProgress({ phase: 'push', done: 0, total: 1 });
  const lib: LibFileV1 = { ...built.lib, writtenAt: new Date(deps.now()).toISOString() };
  const bytes = await encodeLib(lib);
  const opt = deps.signal ? { signal: deps.signal } : undefined;
  let target = own?.id;
  if (!target) {
    // adopt a lib file of ours that exists but that we never recorded (a crash before the commit)
    const mine = files
      .filter((f) => f.name === LIB_NAME(deviceId))
      .sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1))[0];
    target = mine?.id;
  }
  let file: RemoteFile | undefined;
  if (target) {
    try {
      file = await remote.update(target, bytes, opt);
    } catch (e) {
      if (!(e instanceof RemoteError) || e.code !== 'not-found') throw e;
      // 404 on that id: our lib is really gone; the whole index is written again below
    }
  }
  if (!file) {
    file = await remote.create(LIB_NAME(deviceId), bytes, {
      appProperties: { kind: 'lib', device: deviceId },
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  }
  st.files = { ...st.files, ownLib: { id: file.id, version: file.version } };
  // remember the id at once: a crash before the commit must not forget the file it just made
  await st.raw.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k: 'files', v: st.files }));
  deps.onProgress({ phase: 'push', done: 1, total: 1 });
  return { file, sha: built.sha };
}

/** The lib files of other devices (and ours) that changed since they were applied. */
export const changedLibs = (st: Internal, files: readonly RemoteFile[]): RemoteFile[] =>
  files.filter(
    (f) =>
      libDevice(f.name) !== null &&
      st.seen[f.id] !== f.version &&
      st.deferredFiles.get(f.id) !== f.version,
  );

export interface Commit {
  pending: ReadonlyMap<SyncKey, Pending>;
  uploaded: Uploaded | null;
  libSha: string;
  /** ISO time of this cycle. */
  at: string;
  /** Ids present in the last listing, to prune `seen`. */
  live: ReadonlySet<string>;
}

/** COMMIT: one transaction. A mark is dropped only if its nonce is unchanged. */
export async function commit(st: Internal, c: Commit): Promise<void> {
  const seen: Record<string, string> = {};
  for (const [id, v] of Object.entries(st.seen)) if (c.live.has(id)) seen[id] = v;
  if (c.uploaded) seen[c.uploaded.file.id] = c.uploaded.file.version;
  st.seen = seen;
  await st.raw.update(['syncIndex', 'syncDirty', 'syncMeta'], async (r, w) => {
    for (const [key, p] of c.pending) {
      const e = p.entry;
      const base = await r.get<SyncIndexRecord>('syncIndex', key);
      w.put('syncIndex', {
        key,
        kind: e.kind,
        entry: e,
        seen: base ? joinVvs(base.seen, e.vv) : { ...e.vv },
        local: e.deleted ? 0 : 1,
      } satisfies SyncIndexRecord);
      const cur = await r.get<SyncDirtyRecord>('syncDirty', key);
      if (cur && cur.n === p.n) w.delete('syncDirty', key);
    }
    w.put('syncMeta', { k: 'vvCounter', v: st.vv.n });
    w.put('syncMeta', { k: 'libSha', v: c.libSha });
    w.put('syncMeta', { k: 'seen', v: seen });
    w.put('syncMeta', { k: 'files', v: st.files });
    w.put('syncMeta', { k: 'clock', v: st.ctx.clock.last });
    w.put('syncMeta', { k: 'copies', v: [...st.copies].sort() });
    w.put('syncMeta', { k: 'conflicts', v: st.conflicts });
    w.put('syncMeta', { k: 'last', v: c.at });
  });
  st.vv.persisted = st.vv.n;
  st.counts.pushed += c.pending.size;
}
