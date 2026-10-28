// Storage access (architecture.md §6.4): one `Repo` interface over what the shell needs from the
// store (runs, definitions, settings, usage, export/import all). `core/store` implements the real
// backend; until it lands, or when storage is unavailable, an in-memory repo takes over and
// `storageStatus` says so (the StorageBanner reads it).
import type { DefinitionRecord } from '@core/contracts/experiment';
import type { RunMeta } from '@core/contracts/run';
import { openStore, type Backend } from '@core';
import { createStore } from '../state/store';

export interface StorageUsage {
  /** Bytes in use by this origin, or null when the browser cannot say. */
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

export interface AllData {
  format: 'spinner-all';
  v: 1;
  exportedAt: string;
  settings: Record<string, unknown> | null;
  definitions: DefinitionRecord[];
  runs: RunMeta[];
}

export interface Repo {
  readonly kind: 'idb' | 'memory';
  listRuns(): Promise<RunMeta[]>;
  listDefinitions(): Promise<DefinitionRecord[]>;
  getSettings(): Promise<Record<string, unknown> | null>;
  putSettings(s: Record<string, unknown>): Promise<void>;
  exportAll(): Promise<AllData>;
  importAll(data: AllData): Promise<{ definitions: number; runs: number }>;
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
  if (!o || typeof o !== 'object' || o.format !== 'spinner-all') {
    throw new ImportError('That file is not a spinner export.');
  }
  if (o.v !== 1) throw new ImportError('That export is from a newer version of spinner.');
  return {
    format: 'spinner-all',
    v: 1,
    exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
    settings: o.settings && typeof o.settings === 'object' ? o.settings : null,
    definitions: Array.isArray(o.definitions) ? o.definitions : [],
    runs: Array.isArray(o.runs) ? o.runs : [],
  };
}

/** In-memory repo: the fallback, and the fake used by tests. */
export function createMemoryRepo(seed?: Partial<Pick<AllData, 'definitions' | 'runs'>>): Repo {
  let settings: Record<string, unknown> | null = null;
  let definitions = [...(seed?.definitions ?? [])];
  let runs = [...(seed?.runs ?? [])];
  return {
    kind: 'memory',
    listRuns: async () => [...runs],
    listDefinitions: async () => [...definitions],
    getSettings: async () => settings,
    putSettings: async (s) => void (settings = s),
    exportAll: async () => ({
      format: 'spinner-all',
      v: 1,
      exportedAt: new Date().toISOString(),
      settings,
      definitions: [...definitions],
      runs: [...runs],
    }),
    importAll: async (d) => {
      const dIds = new Set(definitions.map((x) => x.id));
      const rIds = new Set(runs.map((x) => x.runId));
      const newDefs = d.definitions.filter((x) => !dIds.has(x.id));
      const newRuns = d.runs.filter((x) => !rIds.has(x.runId));
      definitions = [...definitions, ...newDefs];
      runs = [...runs, ...newRuns];
      return { definitions: newDefs.length, runs: newRuns.length };
    },
    deleteAll: async () => {
      definitions = [];
      runs = [];
      settings = null;
    },
  };
}

/** Repo over a `core/store` backend (IndexedDB, or its own memory fallback). */
export function createBackendRepo(backend: Backend): Repo {
  return {
    kind: backend.kind,
    listRuns: () => backend.getAll<RunMeta>('runs'),
    listDefinitions: () => backend.getAll<DefinitionRecord>('definitions'),
    getSettings: async () =>
      (await backend.get<Record<string, unknown>>('settings', 'app')) ?? null,
    putSettings: (s) => backend.tx(['settings'], 'readwrite', (t) => t.put('settings', s)),
    async exportAll() {
      return {
        format: 'spinner-all',
        v: 1,
        exportedAt: new Date().toISOString(),
        settings: (await backend.get<Record<string, unknown>>('settings', 'app')) ?? null,
        definitions: await backend.getAll<DefinitionRecord>('definitions'),
        runs: await backend.getAll<RunMeta>('runs'),
      };
    },
    async importAll(d) {
      const have = new Set(
        (await backend.getAll<DefinitionRecord>('definitions')).map((x) => x.id),
      );
      const haveRuns = new Set((await backend.getAll<RunMeta>('runs')).map((x) => x.runId));
      const defs = d.definitions.filter((x) => !have.has(x.id));
      const rs = d.runs.filter((x) => !haveRuns.has(x.runId));
      await backend.tx(['definitions', 'runs'], 'readwrite', (t) => {
        defs.forEach((x) => t.put('definitions', x));
        rs.forEach((x) => t.put('runs', x));
      });
      return { definitions: defs.length, runs: rs.length };
    },
    async deleteAll() {
      const stores = ['definitions', 'runs'] as const;
      const [defs, runs] = [
        await backend.getAll<DefinitionRecord>('definitions'),
        await backend.getAll<RunMeta>('runs'),
      ];
      await backend.tx([...stores], 'readwrite', (t) => {
        defs.forEach((x) => t.delete('definitions', x.id));
        runs.forEach((x) => t.delete('runs', x.runId));
      });
    },
  };
}

let repoPromise: Promise<Repo> | null = null;
let current: Repo | null = null;
let currentBackend: Backend | null = null;

/** The raw backend behind the repo, when there is one (the run sink needs it). */
export function getBackend(): Backend | null {
  return currentBackend;
}

/** The app's repo; opens the store once, falls back to memory and says so. Never rejects. */
export function getRepo(): Promise<Repo> {
  repoPromise ??= (async () => {
    try {
      const { backend, persistent } = await openStore('spinner');
      if (!persistent || backend.kind === 'memory') setStorageState('memory');
      currentBackend = backend;
      current = createBackendRepo(backend);
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
