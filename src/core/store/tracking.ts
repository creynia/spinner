// Change tracking (sync.md §4.3, D8): a `Backend` decorator that writes one `syncDirty` mark per
// tracked put/delete, in the same transaction as the write. An aborted transaction leaves no mark,
// and a write through `raw` (the engine's own writes) leaves none. Pure core: no clock or random
// other than the wall time and a nonce the mark carries by contract.
import { SYNCED_SETTING_KEYS, type SyncDirtyRecord, type SyncKey } from '../contracts/sync';
import {
  boundRange,
  STORE_DEFS,
  SYNCED_STORES,
  type Backend,
  type StoreName,
  type TxOps,
} from './backend';

export interface TrackedBackend extends Backend {
  /** The undecorated backend: writes through it leave no marks (engine, erase, delete-all). */
  readonly raw: Backend;
  /** Called after a transaction that wrote marks has committed, with the keys marked. */
  onDirty(fn: (keys: SyncKey[]) => void): () => void;
}

const SYNCED_SETTINGS: ReadonlySet<string> = new Set(SYNCED_SETTING_KEYS);

let nonceCounter = 0;
function nonce(): string {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(6));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  nonceCounter++;
  return `${Date.now().toString(36)}${nonceCounter.toString(36)}`;
}

/** `<kind>:<id>` for a written record or a deleted key, or null when it is not replicated. */
function markKey(store: StoreName, keyOrRecord: unknown, isKey: boolean): SyncKey | null {
  const kind = SYNCED_STORES[store];
  if (!kind) return null;
  const kp = STORE_DEFS[store].keyPath;
  let id: unknown;
  if (isKey) id = Array.isArray(keyOrRecord) ? keyOrRecord[0] : keyOrRecord;
  else {
    const rec = (keyOrRecord ?? {}) as Record<string, unknown>;
    id = rec[Array.isArray(kp) ? kp[0]! : kp];
  }
  if (typeof id !== 'string' || id === '') return null;
  if (store === 'settings' && !SYNCED_SETTINGS.has(id)) return null;
  return `${kind}:${id}`;
}

export function createTrackedBackend(inner: Backend): TrackedBackend {
  const listeners = new Set<(keys: SyncKey[]) => void>();

  const notify = (keys: SyncKey[]): void => {
    if (keys.length === 0) return;
    for (const l of [...listeners]) {
      try {
        l(keys);
      } catch {
        // a listener must not break a committed write
      }
    }
  };

  /** Wraps `w` so every put/delete is recorded; `flush` queues the marks on `w` itself. */
  function track(w: TxOps): { ops: TxOps; flush: () => SyncKey[] } {
    const keys = new Set<SyncKey>();
    return {
      ops: {
        put: (store, value) => {
          w.put(store, value);
          const k = markKey(store, value, false);
          if (k) keys.add(k);
        },
        delete: (store, key) => {
          w.delete(store, key);
          const k = markKey(store, key, true);
          if (k) keys.add(k);
        },
      },
      flush: () => {
        const last = Date.now();
        for (const key of keys) {
          const rec: SyncDirtyRecord = { key, last, n: nonce() };
          w.put('syncDirty', rec);
        }
        return [...keys];
      },
    };
  }

  const withDirty = (stores: StoreName[]): StoreName[] =>
    stores.includes('syncDirty') ? stores : [...stores, 'syncDirty'];
  const touchesSynced = (stores: StoreName[]): boolean => stores.some((s) => SYNCED_STORES[s]);

  return {
    kind: inner.kind,
    raw: inner,
    get: (s, k) => inner.get(s, k),
    getAll: (s, i, r) => inner.getAll(s, i, r),
    getAllKeys: (s, r) => inner.getAllKeys(s, r),
    async tx(stores, mode, fn) {
      if (mode === 'readonly' || !touchesSynced(stores)) return inner.tx(stores, mode, fn);
      let marked: SyncKey[] = [];
      await inner.tx(withDirty(stores), mode, (w) => {
        const t = track(w);
        fn(t.ops);
        marked = t.flush();
      });
      notify(marked);
    },
    async update(stores, fn) {
      if (!touchesSynced(stores)) return inner.update(stores, fn);
      let marked: SyncKey[] = [];
      await inner.update(withDirty(stores), async (r, w) => {
        const t = track(w);
        await fn(r, t.ops);
        marked = t.flush();
      });
      notify(marked);
    },
    onDirty(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

const RUN_STORES = [
  'runs',
  'runParts',
  'summaries',
  'checkpoints',
  'breakdowns',
  'samples',
] as const;

/**
 * Removes a run and its results from this device through the raw backend (no mark), so the run
 * becomes remote-only ("Remove download, keep in Drive"). Unlike `Repo.deleteRun` it keeps
 * `definitions.runIds` and group membership: the run still exists, just not here.
 */
export async function evictRunResults(raw: Backend, runId: string): Promise<void> {
  const partKeys = await raw.getAllKeys('runParts', boundRange([runId, 0], [runId, Infinity]));
  await raw.tx([...RUN_STORES], 'readwrite', (t) => {
    for (const k of partKeys) t.delete('runParts', k);
    for (const s of RUN_STORES) if (s !== 'runParts') t.delete(s, runId);
  });
}
