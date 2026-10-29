// First sync and re-seed (sync.md §7.3, §7.9 step 6, §8.3). WP-S2c.
import type { DefinitionRecord } from '../contracts/experiment';
import type { RunMeta } from '../contracts/run';
import {
  RemoteError,
  SYNCED_SETTING_KEYS,
  SYNC_LAYOUT_VERSION,
  type CycleResult,
  type FirstSyncPreview,
  type RemoteFile,
  type RunStub,
  type SyncDirtyRecord,
  type SyncEntry,
  type SyncIndexRecord,
  type SyncKey,
  type SyncKind,
  type SyncRootV1,
} from '../contracts/sync';
import { utf8Decode } from '../experiment';
import type { Backend, StoreName } from '../store';
import { EngineError, internalOf, libDevice, metaGet } from './apply';
import type { SyncCtx } from './ctx';
import { runCycle } from './engine';
import { clearLocal } from './erase';
import { decodeLib, LibFileError, ROOT_NAME } from './libfile';
import { foldEntries } from './merge';
import { readBundles, sigOf } from './runs';

// ------------------------------------------------------------------ preview

interface Counts {
  experiments: number;
  strategies: number;
  layouts: number;
  runs: number;
  runBytes: number;
}
const zero = (): Counts => ({ experiments: 0, strategies: 0, layouts: 0, runs: 0, runBytes: 0 });

/** Refuses a root of a newer layout (the same rule as the cycle's root check). */
async function checkRootLayout(ctx: SyncCtx, files: readonly RemoteFile[]): Promise<void> {
  const root = files.find((f) => f.name === ROOT_NAME);
  if (!root) return;
  const bytes = await ctx.remote.download(root.id, sigOf(ctx));
  let doc: Partial<SyncRootV1> | null;
  try {
    doc = JSON.parse(utf8Decode(bytes)) as Partial<SyncRootV1> | null;
  } catch {
    throw new RemoteError('bad-response', 0, 'spinner-sync.json is not JSON');
  }
  if (doc && typeof doc.version === 'number' && doc.version > SYNC_LAYOUT_VERSION) {
    throw new EngineError('newer-layout', 'The sync layout on Drive is newer than this app.');
  }
}

/**
 * Rough size of a done run's bundle, for the sheet only: raw column bytes per session plus the
 * checkpoints, halved for gzip. A run this device already uploaded reports its real size.
 */
function estimateBytes(m: RunMeta): number {
  const width = (d: string): number => (d === 'u8' ? 1 : d === 'u16' ? 2 : d === 'i32' ? 4 : 8);
  const row = m.columns.reduce((s, c) => s + c.width * width(c.dtype), 0) + m.schedule.length * 4;
  return Math.round((m.completedSessions * row) / 2);
}

/** What the first-sync sheet shows: counts of what Drive holds and of what is on this device. */
export async function previewFirst(ctx: SyncCtx): Promise<FirstSyncPreview> {
  const { raw } = internalOf(ctx);
  const { remote, deps } = ctx;
  const files = await remote.list(sigOf(ctx));
  await checkRootLayout(ctx, files);

  // remote: the fold winner of every key over every lib file
  const byKey = new Map<SyncKey, SyncEntry[]>();
  let newest: { name: string; at: string } | undefined;
  let libs = 0;
  for (const f of files.filter((x) => libDevice(x.name) !== null)) {
    try {
      const lib = await decodeLib(await remote.download(f.id, sigOf(ctx)));
      libs++;
      if (!newest || lib.writtenAt > newest.at)
        newest = { name: lib.device.name, at: lib.writtenAt };
      for (const e of lib.entries) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
    } catch (e) {
      if (e instanceof LibFileError && e.code === 'newer-version') {
        throw new EngineError('newer-layout', 'A device uses a newer version of spinner.');
      }
      if (!(e instanceof LibFileError)) throw e; // a damaged lib file is not a device
    }
  }
  const remoteCounts = zero();
  for (const list of byKey.values()) {
    const w = foldEntries(list, new Set()).winner;
    if (w.deleted || !w.value) continue;
    if (w.kind === 'def') remoteCounts.experiments++;
    else if (w.kind === 'strategy') remoteCounts.strategies++;
    else if (w.kind === 'layout') remoteCounts.layouts++;
    else if (w.kind === 'run') {
      const s = w.value as RunStub;
      if (s.status === 'done' && s.bundle) {
        remoteCounts.runs++;
        remoteCounts.runBytes += s.bundle.bytes;
      }
    }
  }

  // local: dry runs and their definitions are never synced
  const local = zero();
  const dry = new Set<string>();
  for (const d of await raw.getAll<DefinitionRecord>('definitions')) {
    if (deps.isDryRun(d)) dry.add(d.id);
    else local.experiments++;
  }
  local.strategies = (await raw.getAllKeys('strategies')).length;
  local.layouts = (await raw.getAllKeys('layouts')).length;
  const bundles = await readBundles(raw);
  for (const m of await raw.getAll<RunMeta>('runs')) {
    if (m.status !== 'done' || dry.has(m.definitionId)) continue;
    local.runs++;
    local.runBytes += bundles[m.runId]?.bytes ?? estimateBytes(m);
  }

  return {
    remoteEmpty: libs === 0,
    remote: {
      ...(newest ? { fromName: newest.name, syncedAt: newest.at } : {}),
      ...remoteCounts,
    },
    local,
  };
}

// ------------------------------------------------------------------ begin

const STORE_KIND: [StoreName, SyncKind][] = [
  ['definitions', 'def'],
  ['strategies', 'strategy'],
  ['layouts', 'layout'],
  ['groups', 'group'],
  ['settings', 'setting'],
  ['runs', 'run'],
];

function nonce(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Merge step 1: a mark for every record of the synced stores, through raw (no tracker). */
async function seedMarks(raw: Backend, now: number, isDry: (d: DefinitionRecord) => boolean) {
  const have = new Set((await raw.getAllKeys('syncDirty')).map(String));
  const puts: SyncDirtyRecord[] = [];
  for (const [store, kind] of STORE_KIND) {
    for (const rec of await raw.getAll<Record<string, unknown>>(store)) {
      const id = kind === 'setting' ? rec.key : kind === 'run' ? rec.runId : rec.id;
      if (typeof id !== 'string' || id === '') continue;
      if (kind === 'setting' && !(SYNCED_SETTING_KEYS as readonly string[]).includes(id)) continue;
      if (kind === 'def' && isDry(rec as unknown as DefinitionRecord)) continue;
      const key: SyncKey = `${kind}:${id}`;
      if (have.has(key)) continue; // an edit that is already marked keeps its own edit time
      // the HLC is minted from the record's own time, so LWW against the other device is honest
      const at = rec.updatedAt ?? rec.createdAt;
      const t = typeof at === 'string' ? Date.parse(at) : NaN;
      puts.push({ key, last: Number.isFinite(t) ? t : now, n: nonce() });
    }
  }
  if (puts.length > 0) {
    await raw.tx(['syncDirty'], 'readwrite', (t) => {
      for (const p of puts) t.put('syncDirty', p);
    });
  }
}

const waiting = (): CycleResult => ({
  outcome: 'waiting-run',
  requests: 0,
  pushed: 0,
  applied: 0,
  copies: 0,
  changed: [],
});

/**
 * The first sync. It waits until no run is active (`waiting-run`; the caller tries again).
 *  - merge: a mark for every local record, then one cycle. With no base, an identical fingerprint
 *    is a no-op; different content is concurrent (definitions join, other kinds get a copy).
 *  - replace: this device's synced records and its sync state go in ONE transaction (sync state
 *    first or together, never after: a crash cannot leave an emptied library that still thinks
 *    it is in sync), then one cycle pulls the remote library.
 */
export async function beginFirst(ctx: SyncCtx, choice: 'merge' | 'replace'): Promise<CycleResult> {
  const { raw } = internalOf(ctx);
  if (ctx.deps.isRunActive()) return waiting();
  if (choice === 'replace') await clearLocal(raw, { wipeData: true });
  else await seedMarks(raw, ctx.deps.now(), (d) => ctx.deps.isDryRun(d));
  return runCycle(ctx);
}

// ------------------------------------------------------------------ re-seed

/**
 * Own lib file missing (GC'd as stale, deleted by hand), index non-empty (§7.9 step 6). The
 * device keeps `syncIndex` and `vvCounter`, so nothing is re-minted: the next cycle pulls the
 * peers as always and writes a new lib file; its old entries are dominated by anything newer,
 * and edits made since the last push stay normal candidates. All that is forgotten is what
 * described the file that is gone: its id and the hash of its bytes.
 */
export async function reseed(ctx: SyncCtx): Promise<void> {
  const { raw } = internalOf(ctx);
  const files = await metaGet(raw, 'files');
  const rows = await raw.getAll<SyncIndexRecord>('syncIndex');
  let top = (await metaGet(raw, 'vvCounter')) ?? 0;
  for (const r of rows)
    top = Math.max(top, r.entry.vv[ctx.deviceId] ?? 0, r.seen[ctx.deviceId] ?? 0);
  await raw.tx(['syncMeta'], 'readwrite', (t) => {
    t.delete('syncMeta', 'libSha');
    t.put('syncMeta', { k: 'files', v: files?.root ? { root: files.root } : {} });
    t.put('syncMeta', { k: 'vvCounter', v: top });
  });
}
