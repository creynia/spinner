// Storage backends: IndexedDB, or Maps with structuredClone as the memory fallback
// (harness-data-analysis.md §9.2-§9.3). Nothing here throws out of `openStore`.

export const STORE_NAMES = [
  'definitions',
  'strategies',
  'runs',
  'runParts',
  'summaries',
  'checkpoints',
  'breakdowns',
  'samples',
  'groups',
  'settings',
] as const;
export type StoreName = (typeof STORE_NAMES)[number];

export const DB_VERSION = 1;

interface StoreDef {
  keyPath: string | string[];
  indexes: Record<string, string>;
}

/** Schema v1 (§9.1; reconciliation R6). */
export const STORE_DEFS: Record<StoreName, StoreDef> = {
  definitions: { keyPath: 'id', indexes: { byUpdated: 'updatedAt' } },
  strategies: { keyPath: 'id', indexes: { byUpdated: 'updatedAt' } },
  runs: {
    keyPath: 'runId',
    indexes: { byDefinition: 'definitionId', byCreated: 'createdAt', byStatus: 'status' },
  },
  runParts: { keyPath: ['runId', 'firstChunk'], indexes: {} },
  summaries: { keyPath: 'runId', indexes: {} },
  checkpoints: { keyPath: 'runId', indexes: {} },
  breakdowns: { keyPath: 'runId', indexes: {} },
  samples: { keyPath: 'runId', indexes: {} },
  groups: { keyPath: 'id', indexes: { byUpdated: 'updatedAt' } },
  settings: { keyPath: 'key', indexes: {} },
};

/** Structural upgrades only, by target version (§9.1); record contents migrate lazily via `v`. */
export const UPGRADES: Record<number, (db: IDBDatabase) => void> = {
  1: (db) => {
    for (const name of STORE_NAMES) {
      const def = STORE_DEFS[name];
      const os = db.createObjectStore(name, { keyPath: def.keyPath });
      for (const [ix, path] of Object.entries(def.indexes)) os.createIndex(ix, path);
    }
  },
};

/** Operations inside one atomic transaction. */
export interface TxOps {
  put(store: StoreName, value: unknown): void;
  delete(store: StoreName, key: IDBValidKey): void;
}

/** Duck type of `IDBKeyRange` so the memory backend works without an IndexedDB global. */
export interface KeyRangeLike {
  includes(key: unknown): boolean;
}

/** Storage backend: IndexedDB, or `Map`s with `structuredClone` as the memory fallback (§9.2). */
export interface Backend {
  readonly kind: 'idb' | 'memory';
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: StoreName, index?: string, range?: IDBKeyRange): Promise<T[]>;
  getAllKeys(store: StoreName, range?: IDBKeyRange): Promise<IDBValidKey[]>;
  /** One atomic transaction: `fn` queues puts and deletes synchronously; all or nothing. */
  tx(stores: StoreName[], mode: 'readonly' | 'readwrite', fn: (t: TxOps) => void): Promise<void>;
}

export function isQuotaError(e: unknown): boolean {
  const x = e as { name?: string; code?: number } | null;
  return (
    !!x &&
    (x.name === 'QuotaExceededError' || x.code === 22 || x.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

// ---------------------------------------------------------------- key ordering (IndexedDB rules)

function rank(k: unknown): number {
  if (typeof k === 'number') return 0;
  if (k instanceof Date) return 1;
  if (typeof k === 'string') return 2;
  if (Array.isArray(k)) return 4;
  return 3;
}

export function compareKeys(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    const n = Math.min(a.length, bb.length);
    for (let i = 0; i < n; i++) {
      const c = compareKeys(a[i], bb[i]);
      if (c !== 0) return c;
    }
    return a.length === bb.length ? 0 : a.length < bb.length ? -1 : 1;
  }
  const x = a as number | string;
  const y = b as number | string;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** `IDBKeyRange.bound` when the global exists, else a duck-typed range for the memory backend. */
export function boundRange(lower: IDBValidKey, upper: IDBValidKey): IDBKeyRange {
  if (typeof IDBKeyRange !== 'undefined') return IDBKeyRange.bound(lower, upper);
  return {
    includes: (k: unknown) => compareKeys(k, lower) >= 0 && compareKeys(k, upper) <= 0,
  } as unknown as IDBKeyRange;
}

function extract(value: unknown, path: string | string[]): unknown {
  if (Array.isArray(path)) return path.map((p) => extract(value, p));
  let cur: unknown = value;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ---------------------------------------------------------------- memory

/** Maps with `structuredClone` on put and get, so tests catch aliasing bugs (§9.2). */
export function createMemoryBackend(): Backend {
  const data = new Map<StoreName, Map<string, { key: IDBValidKey; value: unknown }>>();
  for (const n of STORE_NAMES) data.set(n, new Map());
  const table = (s: StoreName): Map<string, { key: IDBValidKey; value: unknown }> => {
    const t = data.get(s);
    if (!t) throw new DOMException(`no such store: ${s}`, 'NotFoundError');
    return t;
  };
  const idOf = (k: unknown): string => JSON.stringify(k);
  const inRange = (k: unknown, r?: IDBKeyRange): boolean =>
    !r || (r as unknown as KeyRangeLike).includes(k);

  const later = <T>(fn: () => T): Promise<T> =>
    new Promise<T>((resolve) => {
      resolve(fn());
    });

  function allOf<T>(store: StoreName, index?: string, range?: IDBKeyRange): T[] {
    const def = STORE_DEFS[store];
    let entries = [...table(store).values()];
    if (index) {
      const path = def.indexes[index];
      if (path === undefined) throw new DOMException(`no such index: ${index}`, 'NotFoundError');
      const keyed = entries
        .map((e) => ({ e, ik: extract(e.value, path) }))
        .filter((x) => x.ik !== undefined && inRange(x.ik, range));
      keyed.sort((a, b) => compareKeys(a.ik, b.ik) || compareKeys(a.e.key, b.e.key));
      entries = keyed.map((x) => x.e);
    } else {
      entries = entries.filter((e) => inRange(e.key, range));
      entries.sort((a, b) => compareKeys(a.key, b.key));
    }
    return entries.map((e) => structuredClone(e.value) as T);
  }

  function runTx(
    stores: StoreName[],
    mode: 'readonly' | 'readwrite',
    fn: (t: TxOps) => void,
  ): void {
    for (const s of stores) table(s);
    const staged: (() => void)[] = [];
    const check = (store: StoreName): void => {
      if (mode === 'readonly') throw new DOMException('read-only transaction', 'ReadOnlyError');
      if (!stores.includes(store)) {
        throw new DOMException(`${store} not in transaction`, 'NotFoundError');
      }
    };
    fn({
      put: (store, value) => {
        check(store);
        const key = extract(value, STORE_DEFS[store].keyPath) as IDBValidKey | undefined;
        if (key === undefined || (Array.isArray(key) && key.some((k) => k === undefined))) {
          throw new DOMException('record has no key', 'DataError');
        }
        const copy = structuredClone(value);
        staged.push(() => table(store).set(idOf(key), { key, value: copy }));
      },
      delete: (store, key) => {
        check(store);
        staged.push(() => table(store).delete(idOf(key)));
      },
    });
    for (const apply of staged) apply();
  }

  return {
    kind: 'memory',
    get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
      return later(() => {
        const e = table(store).get(idOf(key));
        return e ? (structuredClone(e.value) as T) : undefined;
      });
    },
    getAll<T>(store: StoreName, index?: string, range?: IDBKeyRange): Promise<T[]> {
      return later(() => allOf<T>(store, index, range));
    },
    getAllKeys(store: StoreName, range?: IDBKeyRange): Promise<IDBValidKey[]> {
      return later(() =>
        [...table(store).values()]
          .filter((e) => inRange(e.key, range))
          .map((e) => e.key)
          .sort(compareKeys),
      );
    },
    tx(stores, mode, fn): Promise<void> {
      return later(() => runTx(stores, mode, fn));
    },
  };
}

// ---------------------------------------------------------------- IndexedDB

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(asError(req.error));
  });
}

export function createIdbBackend(db: IDBDatabase): Backend {
  return {
    kind: 'idb',
    get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
      return wrap(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<
        T | undefined
      >;
    },
    getAll<T>(store: StoreName, index?: string, range?: IDBKeyRange): Promise<T[]> {
      const os = db.transaction(store, 'readonly').objectStore(store);
      return wrap((index ? os.index(index) : os).getAll(range)) as Promise<T[]>;
    },
    getAllKeys(store: StoreName, range?: IDBKeyRange): Promise<IDBValidKey[]> {
      return wrap(db.transaction(store, 'readonly').objectStore(store).getAllKeys(range));
    },
    tx(stores, mode, fn): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        let t: IDBTransaction;
        try {
          t = db.transaction(stores, mode);
        } catch (e) {
          reject(asError(e));
          return;
        }
        t.oncomplete = () => resolve();
        t.onabort = () =>
          reject(asError(t.error ?? new DOMException('transaction aborted', 'AbortError')));
        t.onerror = () => {
          // the abort handler reports it
        };
        try {
          fn({
            put: (store, value) => {
              t.objectStore(store).put(value);
            },
            delete: (store, key) => {
              t.objectStore(store).delete(key);
            },
          });
        } catch (e) {
          try {
            t.abort();
          } catch {
            // already finished
          }
          reject(asError(e));
        }
      });
    },
  };
}

export type OpenFailure = 'unavailable' | 'timeout' | 'security' | 'version' | 'blocked' | 'error';

export interface OpenOptions {
  /** Default 4000 ms (§9.3). */
  timeoutMs?: number;
  /** Default `globalThis.indexedDB`. */
  factory?: IDBFactory | undefined;
  /** Called when another tab holds an older connection ("close other spinner tabs to update"). */
  onBlocked?: () => void;
  /** Called when another tab upgrades the database; the connection has been closed. */
  onVersionChange?: () => void;
}

export interface OpenResult {
  backend: Backend;
  persistent: boolean;
  /** Why the memory backend was chosen, when `persistent` is false. */
  reason?: OpenFailure;
  /** The IndexedDB connection, when persistent (the caller may close it). */
  db?: IDBDatabase;
}

/**
 * Never throws. Tries `indexedDB.open(name, 1)` with a timeout; on a `SecurityError`, an
 * `InvalidStateError`, a missing `indexedDB`, the timeout or a `VersionError` (the stored database
 * is newer) it returns the memory backend with `persistent: false`. It deletes and overwrites
 * nothing it cannot read (§9.3).
 */
export async function openStore(name: string, opts: OpenOptions = {}): Promise<OpenResult> {
  const memory = (reason: OpenFailure): OpenResult => ({
    backend: createMemoryBackend(),
    persistent: false,
    reason,
  });
  try {
    const factory = 'factory' in opts ? opts.factory : globalThis.indexedDB;
    if (!factory) return memory('unavailable');
    const timeoutMs = opts.timeoutMs ?? 4000;
    return await new Promise<OpenResult>((resolve) => {
      let settled = false;
      let req: IDBOpenDBRequest;
      const done = (r: OpenResult): void => {
        if (settled) {
          r.db?.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => done(memory('timeout')), timeoutMs);
      try {
        req = factory.open(name, DB_VERSION);
      } catch (e) {
        const n = (e as { name?: string }).name;
        done(memory(n === 'SecurityError' ? 'security' : 'error'));
        return;
      }
      req.onupgradeneeded = (ev) => {
        try {
          for (let v = ev.oldVersion + 1; v <= DB_VERSION; v++) UPGRADES[v]?.(req.result);
        } catch {
          req.transaction?.abort();
        }
      };
      req.onblocked = () => opts.onBlocked?.();
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          opts.onVersionChange?.();
        };
        done({ backend: createIdbBackend(db), persistent: true, db });
      };
      req.onerror = () => {
        const n = req.error?.name;
        done(
          memory(n === 'VersionError' ? 'version' : n === 'SecurityError' ? 'security' : 'error'),
        );
      };
    });
  } catch {
    return memory('error');
  }
}
