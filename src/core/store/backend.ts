// Storage backends: IndexedDB, or Maps with structuredClone as the memory fallback
// (harness-data-analysis.md §9.2-§9.3). Nothing here throws out of `openStore`.
import type { SyncKind } from '../contracts/sync';

/** The ten stores of schema v1. FROZEN: upgrade 1 creates exactly these (layouts.md §8). */
export const V1_STORE_NAMES = [
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

/** The eleven stores of schema v2: v1 plus `layouts`. FROZEN: upgrades 1 and 2 create these. */
export const V2_STORE_NAMES = [...V1_STORE_NAMES, 'layouts'] as const;

/** Every store of the current schema: v2 plus the three sync side stores (v3, sync.md §4.2). */
export const STORE_NAMES = [...V2_STORE_NAMES, 'syncIndex', 'syncDirty', 'syncMeta'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

export const DB_VERSION = 3;

interface StoreDef {
  keyPath: string | string[];
  indexes: Record<string, string>;
}

/** Schema v2 (§9.1; reconciliation R6; layouts.md §8). */
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
  layouts: { keyPath: 'id', indexes: { byUpdated: 'updatedAt' } },
  syncIndex: { keyPath: 'key', indexes: { byKind: 'kind' } },
  syncDirty: { keyPath: 'key', indexes: {} },
  syncMeta: { keyPath: 'k', indexes: {} },
};

/** Which sync kind each store's records belong to; stores not listed are never replicated. */
export const SYNCED_STORES: Partial<Record<StoreName, SyncKind>> = {
  definitions: 'def',
  strategies: 'strategy',
  layouts: 'layout',
  groups: 'group',
  settings: 'setting',
  runs: 'run',
  runParts: 'run',
  summaries: 'run',
  checkpoints: 'run',
  breakdowns: 'run',
  samples: 'run',
};

function createStores(db: IDBDatabase, names: readonly StoreName[]): void {
  for (const name of names) {
    if (db.objectStoreNames.contains(name)) continue;
    const def = STORE_DEFS[name];
    const os = db.createObjectStore(name, { keyPath: def.keyPath });
    for (const [ix, path] of Object.entries(def.indexes)) os.createIndex(ix, path);
  }
}

/** Structural upgrades only, by target version (§9.1); record contents migrate lazily via `v`. */
export const DB_UPGRADES: Record<number, (db: IDBDatabase) => void> = {
  // Each upgrade creates only its own stores, each guarded by `contains`, so a fresh install
  // (oldVersion 0 runs 1, 2, then 3) never creates a store twice.
  1: (db) => createStores(db, V1_STORE_NAMES),
  2: (db) => createStores(db, ['layouts']),
  3: (db) => createStores(db, ['syncIndex', 'syncDirty', 'syncMeta']),
};

/** Reads inside `Backend.update`, on the same transaction as the writes. */
export interface TxReader {
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
}

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
  /**
   * One readwrite transaction with an atomic read-modify-write (sync.md §4.2, review B2): `fn` may
   * await only `r.get` on this transaction, then queue writes on `w`. Reads see the writes queued
   * so far. All or nothing: if `fn` rejects, nothing is written and `update` rejects with it.
   *
   * Rules for `fn`:
   * - **No awaits on anything but `r.get`.** IndexedDB commits a transaction as soon as it has no
   *   pending request, so a timer, a fetch, `crypto.subtle` (hashing) or any other async work
   *   inside `fn` lets it commit early. The IDB backend then rejects with "transaction committed
   *   before update fn settled"; compute candidates, hashes and copies **before** calling `update`.
   * - **No nested `tx` or `update` on the same backend from inside `fn`.** It would wait for this
   *   transaction while this one waits for it: a deadlock.
   * - The memory backend does not model transaction deactivation: it serialises updates with a
   *   lock but lets `fn` await anything. Code that is only tested on memory can still break on
   *   IDB, so every `update` test also runs against fake-indexeddb.
   */
  update(stores: StoreName[], fn: (r: TxReader, w: TxOps) => Promise<void>): Promise<void>;
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

  type Staged = { store: StoreName; id: string; key: IDBValidKey; value?: unknown; del?: true };
  /** Write ops that stage into `staged` (applied by the caller, all or nothing). */
  function stagingOps(
    stores: StoreName[],
    mode: 'readonly' | 'readwrite',
    staged: Staged[],
  ): TxOps {
    const check = (store: StoreName): void => {
      if (mode === 'readonly') throw new DOMException('read-only transaction', 'ReadOnlyError');
      if (!stores.includes(store)) {
        throw new DOMException(`${store} not in transaction`, 'NotFoundError');
      }
    };
    return {
      put: (store, value) => {
        check(store);
        const key = extract(value, STORE_DEFS[store].keyPath) as IDBValidKey | undefined;
        if (key === undefined || (Array.isArray(key) && key.some((k) => k === undefined))) {
          throw new DOMException('record has no key', 'DataError');
        }
        staged.push({ store, id: idOf(key), key, value: structuredClone(value) });
      },
      delete: (store, key) => {
        check(store);
        staged.push({ store, id: idOf(key), key, del: true });
      },
    };
  }
  const commit = (staged: Staged[]): void => {
    for (const s of staged) {
      if (s.del) table(s.store).delete(s.id);
      else table(s.store).set(s.id, { key: s.key, value: s.value });
    }
  };

  function runTx(
    stores: StoreName[],
    mode: 'readonly' | 'readwrite',
    fn: (t: TxOps) => void,
  ): void {
    for (const s of stores) table(s);
    const staged: Staged[] = [];
    fn(stagingOps(stores, mode, staged));
    commit(staged);
  }

  // `update` awaits inside its transaction, so it holds a lock that other readwrite work waits on
  // (IndexedDB serialises overlapping readwrite transactions the same way).
  let lock: Promise<void> = Promise.resolve();
  let updating = 0;
  async function runUpdate(
    stores: StoreName[],
    fn: (r: TxReader, w: TxOps) => Promise<void>,
  ): Promise<void> {
    for (const s of stores) table(s);
    const staged: Staged[] = [];
    const ops = stagingOps(stores, 'readwrite', staged);
    const reader: TxReader = {
      get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
        return later(() => {
          if (!stores.includes(store)) {
            throw new DOMException(`${store} not in transaction`, 'NotFoundError');
          }
          const id = idOf(key);
          for (let i = staged.length - 1; i >= 0; i--) {
            const w = staged[i]!;
            if (w.store === store && w.id === id) {
              return w.del ? undefined : (structuredClone(w.value) as T);
            }
          }
          const e = table(store).get(id);
          return e ? (structuredClone(e.value) as T) : undefined;
        });
      },
    };
    await fn(reader, ops);
    commit(staged);
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
      if (mode === 'readwrite' && updating > 0) return lock.then(() => runTx(stores, mode, fn));
      return later(() => runTx(stores, mode, fn));
    },
    update(stores, fn): Promise<void> {
      updating++;
      const run = lock.then(() => runUpdate(stores, fn));
      const done = run.then(
        () => undefined,
        () => undefined,
      );
      lock = done;
      return run.finally(() => {
        updating--;
      });
    },
  };
}

// ---------------------------------------------------------------- IndexedDB

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** `db.transaction()` throws synchronously on a closed connection: turn that into a rejection. */
function attempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return fn();
  } catch (e) {
    return Promise.reject(asError(e));
  }
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
      return attempt(
        () =>
          wrap(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<
            T | undefined
          >,
      );
    },
    getAll<T>(store: StoreName, index?: string, range?: IDBKeyRange): Promise<T[]> {
      return attempt(() => {
        const os = db.transaction(store, 'readonly').objectStore(store);
        return wrap((index ? os.index(index) : os).getAll(range)) as Promise<T[]>;
      });
    },
    getAllKeys(store: StoreName, range?: IDBKeyRange): Promise<IDBValidKey[]> {
      return attempt(() =>
        wrap(db.transaction(store, 'readonly').objectStore(store).getAllKeys(range)),
      );
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
    update(stores, fn): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        let t: IDBTransaction;
        try {
          t = db.transaction(stores, 'readwrite');
        } catch (e) {
          reject(asError(e));
          return;
        }
        // Resolve only when the transaction has completed AND `fn` has settled. A transaction
        // that commits while `fn` is still awaiting something that is not an IDB request would
        // otherwise resolve here while later writes are lost (or throw into nobody's hands).
        let fnDone = false;
        let failed = false;
        const fail = (e: unknown): void => {
          if (failed) return;
          failed = true;
          try {
            t.abort();
          } catch {
            // already finished
          }
          reject(asError(e));
        };
        t.oncomplete = () => {
          if (failed) return;
          if (fnDone) resolve();
          else {
            failed = true;
            reject(
              new Error(
                'transaction committed before update fn settled; compute async work (hashes) before update',
              ),
            );
          }
        };
        t.onabort = () => {
          if (failed) return;
          failed = true;
          reject(asError(t.error ?? new DOMException('transaction aborted', 'AbortError')));
        };
        t.onerror = () => {
          // the abort handler reports it
        };
        const reader: TxReader = {
          get: (store, key) => wrap(t.objectStore(store).get(key)) as Promise<never>,
        };
        const ops: TxOps = {
          put: (store, value) => {
            t.objectStore(store).put(value);
          },
          delete: (store, key) => {
            t.objectStore(store).delete(key);
          },
        };
        let running: Promise<void>;
        try {
          running = fn(reader, ops);
        } catch (e) {
          fail(e);
          return;
        }
        running.then(
          () => {
            fnDone = true;
          },
          (e: unknown) => fail(e),
        );
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
 * Never throws. Tries `indexedDB.open(name, DB_VERSION)` with a timeout; on a `SecurityError`, an
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
          for (let v = ev.oldVersion + 1; v <= DB_VERSION; v++) DB_UPGRADES[v]?.(req.result);
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
