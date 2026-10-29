// Test helpers for the engine tests and the fuzz (not exported from the barrel). A "device" is a
// tracked backend (memory or fake-indexeddb), an engine over a shared remote, and record builders.
import { SYNCED_SETTING_KEYS, type SyncDevicePrefs } from '../contracts/sync';
import type {
  DeviceId,
  RemoteFile,
  RemoteStore,
  SyncDirtyRecord,
  SyncEntry,
  SyncIndexRecord,
  SyncKind,
} from '../contracts/sync';
import { canonicalJson, definitionId, sha256Hex } from '../experiment';
import { createMemoryBackend, layoutHash, openStore, type Backend, type StoreName } from '../store';
import { createTrackedBackend, type TrackedBackend } from '../store/tracking';
import type { SyncCtx } from './ctx';
import { createCtx, runCycle, type SyncEngineDeps } from './engine';
import { fingerprintValue } from './fingerprint';
import { decodeLib } from './libfile';
import { libDevice } from './apply';
import type { CycleResult } from '../contracts/sync';
import { STORE_OF } from './apply';

export const SYNCED: readonly SyncKind[] = ['def', 'strategy', 'layout', 'group', 'setting'];

export const ISO = '2026-01-01T00:00:00.000Z';

// ------------------------------------------------------------------ records

export const group = (id: string, body: string, name = id): Record<string, unknown> => ({
  v: 1,
  id,
  kind: 'compare',
  name,
  runIds: [body],
  createdAt: ISO,
  updatedAt: ISO,
});
export const groupBody = (r: unknown): string => (r as { runIds: string[] }).runIds[0]!;

export async function strategy(id: string, body: string, name = id): Promise<unknown> {
  const strat = { id, name, body };
  return {
    v: 1,
    id,
    strategy: strat,
    hash: await sha256Hex(canonicalJson(strat)),
    createdAt: ISO,
    updatedAt: ISO,
  };
}
export const strategyBody = (r: unknown): string =>
  (r as { strategy: { body: string } }).strategy.body;

export async function layout(id: string, body: string, name = id): Promise<unknown> {
  const lay = {
    id,
    name,
    game: 'roulette',
    variant: 'european',
    spots: [{ bet: `straight:${body}`, chips: 1 }],
  };
  return {
    v: 1,
    id,
    layout: lay,
    hash: await layoutHash(lay as never),
    createdAt: ISO,
    updatedAt: ISO,
    origin: 'user',
  };
}
export const layoutBody = (r: unknown): string =>
  (r as { layout: { spots: { bet: string }[] } }).layout.spots[0]!.bet;

/** A definition whose id is the hash of its `definition` (the engine verifies that). */
export async function def(
  body: string,
  extra: Record<string, unknown> = {},
  runIds: string[] = [],
): Promise<{ id: string; rec: Record<string, unknown> }> {
  const definition = { name: `def ${body}`, body };
  const id = await definitionId(definition as never);
  return {
    id,
    rec: { v: 1, id, definition, createdAt: ISO, updatedAt: ISO, origin: 'user', runIds, ...extra },
  };
}

export const setting = (key: string, value: unknown): Record<string, unknown> => ({ key, value });

// ------------------------------------------------------------------ the remote

export interface RemoteSpy {
  /** Every entry of every lib upload ATTEMPTED (a faulted upload is included: it was minted). */
  published: SyncEntry[];
  libs: { device: DeviceId; entries: SyncEntry[] }[];
}

export interface WrapOptions {
  /** Awaited before every call of this device (the fuzz interleaves other devices here). */
  before?: (op: string) => Promise<void>;
  /** Hide files from this device (a network partition). */
  visible?: (f: RemoteFile) => boolean;
  spy?: RemoteSpy;
  /** Return an error to fail the call; `after` = the effect happened. */
  fault?: (op: string, name: string | undefined, phase: 'before' | 'after') => Error | undefined;
}

/** A per-device view of a shared remote. */
export function wrapRemote(inner: RemoteStore, o: WrapOptions): RemoteStore {
  const names = new Map<string, string>();
  const gate = async (op: string, name?: string): Promise<void> => {
    if (o.before) await o.before(op);
    const f = o.fault?.(op, name, 'before');
    if (f) throw f;
  };
  const after = (op: string, name?: string): void => {
    const f = o.fault?.(op, name, 'after');
    if (f) throw f;
  };
  const spy = async (name: string, bytes: Uint8Array): Promise<void> => {
    if (!o.spy || libDevice(name) === null) return;
    const lib = await decodeLib(bytes);
    o.spy.published.push(...lib.entries);
    o.spy.libs.push({ device: lib.device.id, entries: lib.entries });
  };
  return {
    kind: inner.kind,
    async list(opts) {
      await gate('list');
      const files = await inner.list(opts);
      for (const f of files) names.set(f.id, f.name);
      const out = o.visible ? files.filter(o.visible) : files;
      after('list');
      return out;
    },
    async download(id, opts) {
      await gate('download', names.get(id));
      const b = await inner.download(id, opts);
      after('download', names.get(id));
      return b;
    },
    async create(name, bytes, opts) {
      await gate('create', name);
      await spy(name, bytes);
      const f = await inner.create(name, bytes, opts);
      names.set(f.id, f.name);
      after('create', name);
      return f;
    },
    async update(id, bytes, opts) {
      const name = names.get(id);
      await gate('update', name);
      if (name) await spy(name, bytes);
      const f = await inner.update(id, bytes, opts);
      after('update', name);
      return f;
    },
    async delete(id, opts) {
      await gate('delete', names.get(id));
      await inner.delete(id, opts);
      after('delete', names.get(id));
    },
    about: () => inner.about(),
  };
}

export const newSpy = (): RemoteSpy => ({ published: [], libs: [] });

// ------------------------------------------------------------------ devices

export interface Dev {
  id: DeviceId;
  name: string;
  raw: Backend;
  tracked: TrackedBackend;
  deps: SyncEngineDeps;
  progress: string[];
  /** (device, counter) pairs handed out by `ctx.vv.next()`, across restarts. */
  minted: Set<string>;
  /** Drop the in-memory engine state (a reload); the backend stays. */
  restart(): void;
  ctx(): Promise<SyncCtx>;
  cycle(o?: { uploadRuns?: boolean; timeBudgetMs?: number }): Promise<CycleResult>;
}

export interface DeviceOptions {
  id: DeviceId;
  remote: RemoteStore;
  now: () => number;
  idb?: boolean;
  name?: string;
  minted?: Set<string>;
  /** Receives every `(device:counter)` that `ctx.vv.next()` hands out twice. */
  violations?: string[];
  isRunActive?: (runId?: string) => boolean;
  isDryRun?: SyncEngineDeps['isDryRun'];
  describeRun?: SyncEngineDeps['describeRun'];
  signal?: AbortSignal;
  /** Decorates the raw backend (to fail a commit, say); the tracked backend sits on top. */
  wrapRaw?: (b: Backend) => Backend;
  prefs?: Partial<SyncDevicePrefs>;
}

let idbCounter = 0;
let newFactory: (() => IDBFactory) | undefined;
/** The test file supplies fake-indexeddb (this module may not import a package). */
export const useIdb = (f: () => IDBFactory): void => {
  newFactory = f;
};

export async function makeDevice(o: DeviceOptions): Promise<Dev> {
  if (o.idb && !newFactory) throw new Error('call useIdb(() => new IDBFactory()) first');
  const base =
    o.idb && newFactory
      ? (await openStore(`engine-test-${++idbCounter}`, { factory: newFactory() })).backend
      : createMemoryBackend();
  const raw = o.wrapRaw ? o.wrapRaw(base) : base;
  await raw.tx(['syncMeta'], 'readwrite', (t) =>
    t.put('syncMeta', { k: 'device', v: { id: o.id, createdAt: ISO } }),
  );
  if (o.prefs) {
    await raw.tx(['syncMeta'], 'readwrite', (t) =>
      t.put('syncMeta', {
        k: 'prefs',
        v: { enabled: true, deviceName: 'x', runDownload: 'onOpen', ...o.prefs },
      }),
    );
  }
  const tracked = createTrackedBackend(raw);
  const progress: string[] = [];
  const deps: SyncEngineDeps = {
    backend: tracked,
    remote: o.remote,
    now: o.now,
    appVersion: '1.0.0',
    coreVersion: '1',
    gameId: 'roulette',
    deviceName: () => o.name ?? `dev-${o.id.slice(0, 2)}`,
    describeRun: o.describeRun ?? (() => Promise.resolve(undefined)),
    isDryRun: o.isDryRun ?? ((d) => (d as unknown as { dry?: boolean }).dry === true),
    isRunActive: o.isRunActive ?? (() => false),
    onProgress: (p) => progress.push(p.phase),
    ...(o.signal ? { signal: o.signal } : {}),
  };
  const minted = o.minted ?? new Set<string>();
  let ctxP: Promise<SyncCtx> | undefined;
  const dev: Dev = {
    id: o.id,
    name: o.name ?? `dev-${o.id.slice(0, 2)}`,
    raw,
    tracked,
    deps,
    progress,
    minted,
    restart: () => {
      ctxP = undefined;
    },
    ctx: () =>
      (ctxP ??= createCtx(deps).then((ctx) => {
        const vv = ctx.vv;
        const next = vv.next.bind(vv);
        vv.next = () => {
          const n = next();
          const k = `${o.id}:${n}`;
          if (minted.has(k)) o.violations?.push(k);
          minted.add(k);
          return n;
        };
        return ctx;
      })),
    cycle: async (opts) => runCycle(await dev.ctx(), opts),
  };
  return dev;
}

// ------------------------------------------------------------------ user writes and dumps

export const STORE_FOR: Record<SyncKind, StoreName> = STORE_OF;

/** A user write: through the tracked backend, so a dirty mark appears. */
export async function userPut(d: Dev, kind: SyncKind, rec: unknown): Promise<void> {
  const s = STORE_FOR[kind];
  await d.tracked.tx([s], 'readwrite', (t) => t.put(s, rec));
}
export async function userDel(d: Dev, kind: SyncKind, id: string): Promise<void> {
  const s = STORE_FOR[kind];
  await d.tracked.tx([s], 'readwrite', (t) => t.delete(s, id));
}

/** The synced stores as one comparable string (volatile fields left out, like the fingerprint). */
export async function dump(d: Dev): Promise<string> {
  const rows: string[] = [];
  for (const kind of SYNCED) {
    for (const rec of await d.raw.getAll<Record<string, unknown>>(STORE_FOR[kind])) {
      const id = (kind === 'setting' ? rec.key : rec.id) as string;
      if (kind === 'setting' && !(SYNCED_SETTING_KEYS as readonly string[]).includes(id)) continue;
      rows.push(`${kind}:${id}=${canonicalJson(fingerprintValue(kind, rec))}`);
    }
  }
  return rows.sort().join('\n');
}

export async function records(
  d: Dev,
  kind: SyncKind,
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const rec of await d.raw.getAll<Record<string, unknown>>(STORE_FOR[kind])) {
    out.set((kind === 'setting' ? rec.key : rec.id) as string, rec);
  }
  return out;
}

export const marks = async (d: Dev): Promise<string[]> =>
  (await d.raw.getAll<SyncDirtyRecord>('syncDirty')).map((m) => m.key).sort();

export const indexOf = async (d: Dev): Promise<Map<string, SyncIndexRecord>> =>
  new Map((await d.raw.getAll<SyncIndexRecord>('syncIndex')).map((r) => [r.key, r]));

/** A clock that advances by 1 ms per read; also stands in for `Date.now` (the tracker's marks). */
export function worldClock(start = Date.UTC(2026, 2, 1)): () => number {
  let t = start;
  return () => (t += 1);
}
