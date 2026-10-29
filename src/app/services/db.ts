// Storage access (architecture.md §6.4): one `Repo` interface over what the shell needs from the
// store (runs, definitions, settings, usage, export/import all). `core/store` implements the real
// backend; until it lands, or when storage is unavailable, an in-memory repo takes over and
// `storageStatus` says so (the StorageBanner reads it).
import type { DefinitionRecord } from '@core/contracts/experiment';
import type { LayoutRecord } from '@core/contracts/layout';
import type { RunMeta } from '@core/contracts/run';
import {
  createTrackedBackend,
  openStore,
  STORE_DEFS,
  STORE_NAMES,
  type Backend,
  type StoreName,
  type TrackedBackend,
} from '@core';
import { createStore } from '../state/store';

export interface StorageUsage {
  /** Bytes in use by this origin, or null when the browser cannot say. */
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

/**
 * What "Export definitions" writes. Definitions and settings only for now: the full per-run bundle
 * export lands with ui-results (core/store `encodeRunBundle`), so runs are not in this file.
 */
export interface AllData {
  format: 'spinner-definitions';
  v: 1;
  exportedAt: string;
  settings: Record<string, unknown>;
  definitions: DefinitionRecord[];
  /** Optional and additive (layouts.md §8): old files have none, older builds ignore it. */
  layouts?: LayoutRecord[];
}

/** Settings are one `{ key, value }` record per setting (core/store `settings`, keyPath `key`). */
export interface Repo {
  readonly kind: 'idb' | 'memory';
  /** Newest first. */
  listRuns(): Promise<RunMeta[]>;
  listDefinitions(): Promise<DefinitionRecord[]>;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
  exportDefinitions(): Promise<AllData>;
  importDefinitions(data: AllData): Promise<{ definitions: number; layouts: number }>;
  /** Clears every store: definitions, layouts, strategies, runs and their parts, groups, settings. */
  deleteAll(): Promise<void>;
}

export interface StorageStatus {
  /** 'ok' | 'memory' (IndexedDB unavailable or blocked) | 'full'. */
  state: 'ok' | 'memory' | 'full';
  dismissed: boolean;
}

export const storageStatus = createStore<StorageStatus>({ state: 'ok', dismissed: false });

export function setStorageState(state: StorageStatus['state']): void {
  storageStatus.update((s) => (s.state === state ? s : { state, dismissed: false }));
}
export function dismissStorageBanner(): void {
  storageStatus.update((s) => ({ ...s, dismissed: true }));
}

/** Records whose id is not yet in `seen`; the first of a repeated id wins. Mutates `seen`. */
function freshById<T extends { id: string }>(recs: readonly T[], seen: Set<string>): T[] {
  return recs.filter((x) => {
    if (seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });
}

const hasStringId = (x: unknown): boolean =>
  !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string';

export class ImportError extends Error {}

/** Validates the shape of an "export all" file; throws `ImportError` with a readable reason. */
export function parseAllData(text: string): AllData {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    throw new ImportError('That file is not valid JSON.');
  }
  const o = x as Partial<AllData> | null;
  if (!o || typeof o !== 'object' || o.format !== 'spinner-definitions') {
    throw new ImportError('That file is not a spinner definitions export.');
  }
  if (o.v !== 1) throw new ImportError('That export is from a newer version of spinner.');
  return {
    format: 'spinner-definitions',
    v: 1,
    exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
    settings: o.settings && typeof o.settings === 'object' ? o.settings : {},
    definitions: Array.isArray(o.definitions) ? o.definitions.filter(hasStringId) : [],
    layouts: Array.isArray(o.layouts) ? o.layouts.filter(hasStringId) : [],
  };
}

const newestFirst = (a: RunMeta, b: RunMeta): number =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.runId < b.runId ? 1 : -1;

/** In-memory repo: the fallback, and the fake used by tests. */
export function createMemoryRepo(seed?: {
  definitions?: DefinitionRecord[];
  runs?: RunMeta[];
  layouts?: LayoutRecord[];
}): Repo {
  const settings = new Map<string, unknown>();
  let definitions = [...(seed?.definitions ?? [])];
  let runs = [...(seed?.runs ?? [])];
  let layouts = [...(seed?.layouts ?? [])];
  return {
    kind: 'memory',
    listRuns: () => Promise.resolve([...runs].sort(newestFirst)),
    listDefinitions: () => Promise.resolve([...definitions]),
    getSetting: (key) => Promise.resolve(settings.get(key)),
    setSetting: (key, value) => {
      settings.set(key, value);
      return Promise.resolve();
    },
    exportDefinitions: () =>
      Promise.resolve({
        format: 'spinner-definitions',
        v: 1,
        exportedAt: new Date().toISOString(),
        settings: Object.fromEntries(settings),
        definitions: [...definitions],
        layouts: [...layouts],
      }),
    importDefinitions: (d) => {
      const have = new Set(definitions.map((x) => x.id));
      const fresh = freshById(d.definitions, have);
      definitions = [...definitions, ...fresh];
      const haveL = new Set(layouts.map((x) => x.id));
      const freshL = freshById(d.layouts ?? [], haveL);
      layouts = [...layouts, ...freshL];
      return Promise.resolve({ definitions: fresh.length, layouts: freshL.length });
    },
    deleteAll: () => {
      definitions = [];
      layouts = [];
      runs = [];
      settings.clear();
      return Promise.resolve();
    },
  };
}

/** Key of a record in each store, derived from core/store `STORE_DEFS` keyPaths. */
export function keyOf(store: StoreName, rec: Record<string, unknown>): IDBValidKey {
  const kp = STORE_DEFS[store].keyPath;
  return (Array.isArray(kp) ? kp.map((k) => rec[k]) : rec[kp]) as IDBValidKey;
}

/**
 * `syncMeta` rows that survive "Delete everything on this device" (sync.md D7, D19): the device id,
 * the never-reset `vvCounter`, and the settings that describe this device or account. The rest
 * (`seen`, `libSha`, `uploads`, `conflicts`) describes data that is gone, so the next sync pulls
 * Drive's copy back as new.
 */
const KEEP_SYNC_META = new Set([
  'device',
  'vvCounter',
  'prefs',
  'account',
  'clock',
  'files',
  'copies',
]);

/**
 * Repo over a `core/store` backend (IndexedDB, or its own memory fallback). `raw` is the
 * undecorated backend that `deleteAll` writes through, so the wipe leaves no sync marks and Drive
 * keeps its copy; it defaults to `backend`.
 */
export function createBackendRepo(backend: Backend, raw: Backend = backend): Repo {
  return {
    kind: backend.kind,
    listRuns: async () => (await backend.getAll<RunMeta>('runs')).sort(newestFirst),
    listDefinitions: async () =>
      (await backend.getAll<DefinitionRecord>('definitions')).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    getSetting: async (key) =>
      (await backend.get<{ key: string; value: unknown }>('settings', key))?.value,
    setSetting: (key, value) =>
      backend.tx(['settings'], 'readwrite', (t) => t.put('settings', { key, value })),
    async exportDefinitions() {
      const settings: Record<string, unknown> = {};
      for (const r of await backend.getAll<{ key: string; value: unknown }>('settings')) {
        settings[r.key] = r.value;
      }
      return {
        format: 'spinner-definitions',
        v: 1,
        exportedAt: new Date().toISOString(),
        settings,
        definitions: await backend.getAll<DefinitionRecord>('definitions'),
        layouts: await backend.getAll<LayoutRecord>('layouts'),
      };
    },
    async importDefinitions(d) {
      const have = new Set(
        (await backend.getAll<DefinitionRecord>('definitions')).map((x) => x.id),
      );
      const fresh = freshById(d.definitions, have);
      const haveL = new Set((await backend.getAll<LayoutRecord>('layouts')).map((x) => x.id));
      const freshL = freshById(d.layouts ?? [], haveL);
      await backend.tx(['definitions', 'layouts'], 'readwrite', (t) => {
        fresh.forEach((x) => t.put('definitions', x));
        freshL.forEach((x) => t.put('layouts', x));
      });
      return { definitions: fresh.length, layouts: freshL.length };
    },
    async deleteAll() {
      const all = await Promise.all(
        STORE_NAMES.map(
          async (name) => [name, await raw.getAll<Record<string, unknown>>(name)] as const,
        ),
      );
      await raw.tx([...STORE_NAMES], 'readwrite', (t) => {
        for (const [name, recs] of all) {
          for (const r of recs) {
            if (name === 'syncMeta' && KEEP_SYNC_META.has(String(r.k))) continue;
            t.delete(name, keyOf(name, r));
          }
        }
      });
    },
  };
}

let repoPromise: Promise<Repo> | null = null;
let current: Repo | null = null;
let currentBackend: Backend | null = null;
let currentRaw: Backend | null = null;

/**
 * The backend behind the repo, when there is one (the run sink needs it). On a persistent store
 * this is the tracked backend: every write through it leaves a sync mark (sync.md D8).
 */
export function getBackend(): Backend | null {
  return currentBackend;
}

/** The undecorated backend: writes through it leave no sync marks (the sync engine, erase). */
export function getRawBackend(): Backend | null {
  return currentRaw;
}

/** The tracked backend, or null on the memory backend or the in-memory repo: sync stays off. */
export function getTrackedBackend(): TrackedBackend | null {
  return currentBackend && 'onDirty' in currentBackend ? (currentBackend as TrackedBackend) : null;
}

/** The app's repo; opens the store once, falls back to memory and says so. Never rejects. */
export function getRepo(): Promise<Repo> {
  repoPromise ??= (async () => {
    try {
      const { backend, persistent } = await openStore('spinner');
      if (!persistent || backend.kind === 'memory') setStorageState('memory');
      // Sync is disabled on a memory backend (sync.md §7.13): no tracking there.
      const tracked = backend.kind === 'idb' ? createTrackedBackend(backend) : backend;
      currentRaw = backend;
      currentBackend = tracked;
      current = createBackendRepo(tracked, backend);
    } catch {
      // core/store not ready, or IndexedDB blocked
      setStorageState('memory');
      current = createMemoryRepo();
    }
    return current;
  })();
  return repoPromise;
}

/** Tests: install a repo (or reset with null). */
export function setRepoForTests(r: Repo | null): void {
  current = r;
  currentBackend = null;
  currentRaw = null;
  repoPromise = r ? Promise.resolve(r) : null;
  storageStatus.set({ state: r?.kind === 'memory' ? 'memory' : 'ok', dismissed: false });
}

/** Browser storage estimate; every field null when the API is missing. */
export async function readUsage(): Promise<StorageUsage> {
  try {
    const s = navigator.storage;
    const est = s?.estimate ? await s.estimate() : null;
    const persisted = s?.persisted ? await s.persisted() : null;
    return { usage: est?.usage ?? null, quota: est?.quota ?? null, persisted };
  } catch {
    return { usage: null, quota: null, persisted: null };
  }
}

/** Ask the browser not to evict our data; true when granted. */
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
