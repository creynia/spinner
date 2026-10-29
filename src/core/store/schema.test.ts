import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  createMemoryBackend,
  createRepo,
  DB_VERSION,
  openStore,
  STORE_DEFS,
  STORE_NAMES,
  SYNCED_STORES,
  V1_STORE_NAMES,
  V2_STORE_NAMES,
} from './index';
import type { LayoutRecord } from '../contracts/layout';

function rec(id: string, updatedAt: string): LayoutRecord {
  return {
    v: 1,
    id,
    layout: {
      schema: 1,
      id,
      name: id,
      game: 'roulette',
      variant: 'european',
      spots: [{ bet: 'red', chips: 1 }],
    },
    hash: 'h',
    createdAt: updatedAt,
    updatedAt,
    origin: 'user',
  };
}

describe('schema v3', () => {
  it('has 10 frozen v1 stores, 11 at v2 and 14 in all', () => {
    expect(DB_VERSION).toBe(3);
    expect(V1_STORE_NAMES).toHaveLength(10);
    expect(V2_STORE_NAMES).toHaveLength(11);
    expect(STORE_NAMES).toHaveLength(14);
    expect(STORE_NAMES.slice(0, 10)).toEqual([...V1_STORE_NAMES]);
    expect(STORE_NAMES.slice(0, 11)).toEqual([...V2_STORE_NAMES]);
    expect(STORE_NAMES[10]).toBe('layouts');
    expect(STORE_NAMES.slice(11)).toEqual(['syncIndex', 'syncDirty', 'syncMeta']);
    expect(STORE_DEFS.layouts).toEqual({ keyPath: 'id', indexes: { byUpdated: 'updatedAt' } });
    expect(STORE_DEFS.syncIndex).toEqual({ keyPath: 'key', indexes: { byKind: 'kind' } });
    expect(STORE_DEFS.syncDirty).toEqual({ keyPath: 'key', indexes: {} });
    expect(STORE_DEFS.syncMeta).toEqual({ keyPath: 'k', indexes: {} });
  });

  it('SYNCED_STORES maps the replicated stores to their kinds', () => {
    expect(SYNCED_STORES).toEqual({
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
    });
  });

  it('a FRESH database opens at v3 as idb with all 14 stores and indexes', async () => {
    const r = await openStore('fresh', { factory: new IDBFactory() });
    expect(r.persistent).toBe(true);
    expect(r.backend.kind).toBe('idb');
    expect(r.reason).toBeUndefined();
    const db = r.db!;
    expect(db.version).toBe(3);
    expect([...db.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    const tx = db.transaction([...STORE_NAMES], 'readonly');
    for (const name of STORE_NAMES) {
      const os = tx.objectStore(name);
      const def = STORE_DEFS[name];
      expect(os.keyPath, name).toEqual(def.keyPath);
      expect([...os.indexNames].sort(), name).toEqual(Object.keys(def.indexes).sort());
      for (const [ix, path] of Object.entries(def.indexes)) {
        expect(os.index(ix).keyPath).toBe(path);
      }
    }
    db.close();
  });

  it('a seeded v1 database upgrades straight to v3 with no data loss', async () => {
    const factory = new IDBFactory();
    // build a v1 database exactly as the old build did
    const db1 = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('legacy', 1);
      req.onupgradeneeded = () => {
        for (const name of V1_STORE_NAMES) {
          const def = STORE_DEFS[name];
          const os = req.result.createObjectStore(name, { keyPath: def.keyPath });
          for (const [ix, path] of Object.entries(def.indexes)) os.createIndex(ix, path);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('open'));
    });
    const seed: Record<string, unknown> = {
      definitions: { id: 'd1', name: 'D', updatedAt: '2026-01-01' },
      strategies: { id: 's1', name: 'S', updatedAt: '2026-01-02' },
      runs: { runId: 'r1', definitionId: 'd1', createdAt: '2026-01-03', status: 'done' },
      runParts: { runId: 'r1', firstChunk: 0, n: 7 },
      settings: { key: 'theme', value: 'dark' },
    };
    await new Promise<void>((resolve, reject) => {
      const t = db1.transaction(Object.keys(seed), 'readwrite');
      for (const [st, v] of Object.entries(seed)) t.objectStore(st).put(v);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error('tx'));
    });
    db1.close();

    const r = await openStore('legacy', { factory });
    expect(r.persistent).toBe(true);
    expect(r.backend.kind).toBe('idb');
    expect(r.db?.version).toBe(3);
    expect([...r.db!.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    expect(await r.backend.get('definitions', 'd1')).toEqual(seed.definitions);
    expect(await r.backend.get('strategies', 's1')).toEqual(seed.strategies);
    expect(await r.backend.get('runs', 'r1')).toEqual(seed.runs);
    expect(await r.backend.get('runParts', ['r1', 0])).toEqual(seed.runParts);
    expect(await r.backend.get('settings', 'theme')).toEqual(seed.settings);
    expect(await r.backend.getAll('runs', 'byDefinition')).toHaveLength(1);
    expect(await r.backend.getAll('layouts')).toEqual([]);
    for (const s of ['syncIndex', 'syncDirty', 'syncMeta'] as const) {
      expect(await r.backend.getAll(s)).toEqual([]);
    }
    r.db?.close();
  });

  it('a seeded v2 database keeps all its data and gains the three sync stores', async () => {
    const factory = new IDBFactory();
    const db2 = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('v2db', 2);
      req.onupgradeneeded = () => {
        for (const name of V2_STORE_NAMES) {
          const def = STORE_DEFS[name];
          const os = req.result.createObjectStore(name, { keyPath: def.keyPath });
          for (const [ix, path] of Object.entries(def.indexes)) os.createIndex(ix, path);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('open'));
    });
    await new Promise<void>((resolve, reject) => {
      const t = db2.transaction(['layouts', 'settings', 'groups'], 'readwrite');
      t.objectStore('layouts').put(rec('keep', '2026-02-02'));
      t.objectStore('settings').put({ key: 'theme', value: 'dark' });
      t.objectStore('groups').put({ id: 'g', updatedAt: 'x', runIds: ['a', 'b'] });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error('tx'));
    });
    db2.close();
    const r = await openStore('v2db', { factory });
    expect(r.persistent).toBe(true);
    expect(r.db?.version).toBe(3);
    expect([...r.db!.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    expect((await r.backend.get<LayoutRecord>('layouts', 'keep'))?.id).toBe('keep');
    expect(await r.backend.get('settings', 'theme')).toEqual({ key: 'theme', value: 'dark' });
    expect(await r.backend.get('groups', 'g')).toEqual({
      id: 'g',
      updatedAt: 'x',
      runIds: ['a', 'b'],
    });
    const tx = r.db!.transaction('syncIndex', 'readonly');
    expect([...tx.objectStore('syncIndex').indexNames]).toEqual(['byKind']);
    r.db?.close();
  });

  it('reopening an already-v3 database keeps its data and stays idb', async () => {
    const factory = new IDBFactory();
    const a = await openStore('again', { factory });
    await a.backend.tx(['layouts'], 'readwrite', (t) => t.put('layouts', rec('k', '2026-01-01')));
    a.db?.close();
    const b = await openStore('again', { factory });
    expect(b.persistent).toBe(true);
    expect(b.backend.kind).toBe('idb');
    expect(b.db?.version).toBe(3);
    expect((await b.backend.get<LayoutRecord>('layouts', 'k'))?.id).toBe('k');
    b.db?.close();
  });

  it('the memory backend has all 14 stores', async () => {
    const b = createMemoryBackend();
    for (const s of STORE_NAMES) expect(await b.getAll(s)).toEqual([]);
  });
});

describe.each([
  ['memory', () => Promise.resolve(createMemoryBackend())],
  ['indexeddb', async () => (await openStore('crud', { factory: new IDBFactory() })).backend],
])('repo layouts: %s', (_n, make) => {
  it('does CRUD and lists newest first by byUpdated', async () => {
    const repo = createRepo(await make());
    await repo.putLayout(rec('a', '2026-01-01'));
    await repo.putLayout(rec('b', '2026-03-01'));
    await repo.putLayout(rec('c', '2026-02-01'));
    expect((await repo.listLayouts()).map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect((await repo.getLayout('c'))?.id).toBe('c');
    expect(await repo.getLayout('zzz')).toBeUndefined();
    await repo.putLayout({ ...rec('a', '2026-05-01'), hash: 'new' });
    expect((await repo.listLayouts()).map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect((await repo.getLayout('a'))?.hash).toBe('new');
    await repo.deleteLayout('b');
    expect((await repo.listLayouts()).map((l) => l.id)).toEqual(['a', 'c']);
  });
});
