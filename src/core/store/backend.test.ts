import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
  boundRange,
  createMemoryBackend,
  openStore,
  STORE_NAMES,
  V1_STORE_NAMES,
  type Backend,
  isQuotaError,
} from './index';

async function idbBackend(): Promise<Backend> {
  const r = await openStore('spinner-test', { factory: new IDBFactory() });
  expect(r.persistent).toBe(true);
  return r.backend;
}

const backends: [string, () => Promise<Backend>][] = [
  ['memory', () => Promise.resolve(createMemoryBackend())],
  ['indexeddb', idbBackend],
];

describe.each(backends)('backend suite: %s', (_name, make) => {
  it('puts, gets and lists with indexes in order', async () => {
    const b = await make();
    await b.tx(['runs'], 'readwrite', (t) => {
      t.put('runs', { runId: 'r2', definitionId: 'd1', createdAt: '2026-02', status: 'done' });
      t.put('runs', { runId: 'r1', definitionId: 'd1', createdAt: '2026-03', status: 'paused' });
      t.put('runs', { runId: 'r3', definitionId: 'd2', createdAt: '2026-01', status: 'done' });
      t.put('runs', { runId: 'r4', createdAt: '2026-04', status: 'done' });
    });
    expect((await b.get<{ runId: string }>('runs', 'r1'))?.runId).toBe('r1');
    expect(await b.get('runs', 'missing')).toBeUndefined();
    const byCreated = await b.getAll<{ runId: string }>('runs', 'byCreated');
    expect(byCreated.map((r) => r.runId)).toEqual(['r3', 'r2', 'r1', 'r4']);
    const byDef = await b.getAll<{ runId: string }>('runs', 'byDefinition');
    expect(byDef.map((r) => r.runId)).toEqual(['r1', 'r2', 'r3']); // r4 has no definitionId
    expect((await b.getAll('runs')).length).toBe(4);
  });

  it('is atomic: a throw inside the transaction applies nothing', async () => {
    const b = await make();
    await b.tx(['settings'], 'readwrite', (t) => t.put('settings', { key: 'a', value: 1 }));
    await expect(
      b.tx(['settings'], 'readwrite', (t) => {
        t.put('settings', { key: 'a', value: 2 });
        t.put('settings', { key: 'b', value: 3 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await b.get('settings', 'a')).toEqual({ key: 'a', value: 1 });
    expect(await b.get('settings', 'b')).toBeUndefined();
  });

  it('deletes, and ranges over compound keys', async () => {
    const b = await make();
    await b.tx(['runParts'], 'readwrite', (t) => {
      for (const run of ['a', 'b'])
        for (const c of [0, 1, 2, 10]) t.put('runParts', { runId: run, firstChunk: c, n: c });
    });
    const keys = await b.getAllKeys('runParts', boundRange(['a', 0], ['a', Infinity]));
    expect(keys).toEqual([
      ['a', 0],
      ['a', 1],
      ['a', 2],
      ['a', 10],
    ]);
    const rows = await b.getAll<{ n: number }>(
      'runParts',
      undefined,
      boundRange(['b', 0], ['b', 2]),
    );
    expect(rows.map((r) => r.n)).toEqual([0, 1, 2]);
    await b.tx(['runParts'], 'readwrite', (t) => t.delete('runParts', ['a', 1]));
    expect((await b.getAllKeys('runParts')).length).toBe(7);
  });

  it('stores typed arrays natively and never aliases', async () => {
    const b = await make();
    const equity = Int32Array.from([1, 2, 3]);
    const rec = { runId: 'r', schedule: Int32Array.from([0, 5]), equity };
    await b.tx(['checkpoints'], 'readwrite', (t) => t.put('checkpoints', rec));
    equity[0] = 99;
    const got = await b.get<typeof rec>('checkpoints', 'r');
    expect(got?.equity).toBeInstanceOf(Int32Array);
    expect(Array.from(got?.equity ?? [])).toEqual([1, 2, 3]);
    if (got) got.equity[1] = 77;
    expect(Array.from((await b.get<typeof rec>('checkpoints', 'r'))?.equity ?? [])).toEqual([
      1, 2, 3,
    ]);
  });

  it('refuses writes in a readonly transaction and unknown stores', async () => {
    const b = await make();
    await expect(
      b.tx(['settings'], 'readonly', (t) => t.put('settings', { key: 'x', value: 1 })),
    ).rejects.toBeDefined();
    await expect(
      b.tx(['settings'], 'readwrite', (t) => t.put('groups', { id: 'g', updatedAt: 'x' })),
    ).rejects.toBeDefined();
  });

  it('has all eleven stores', async () => {
    const b = await make();
    expect(STORE_NAMES).toHaveLength(11);
    expect(V1_STORE_NAMES).toHaveLength(10);
    for (const s of STORE_NAMES) expect(await b.getAll(s)).toEqual([]);
  });
});

describe('openStore', () => {
  it('uses the memory backend when indexedDB is missing', async () => {
    const r = await openStore('x', { factory: undefined });
    expect(r.persistent).toBe(false);
    expect(r.backend.kind).toBe('memory');
    expect(r.reason).toBe('unavailable');
  });

  it('opens IndexedDB and creates the eleven stores', async () => {
    const r = await openStore('x', { factory: new IDBFactory() });
    expect(r.persistent).toBe(true);
    expect(r.backend.kind).toBe('idb');
    expect(Array.from(r.db?.objectStoreNames ?? []).sort()).toEqual([...STORE_NAMES].sort());
    r.db?.close();
  });

  it('persists across opens of the same factory', async () => {
    const factory = new IDBFactory();
    const a = await openStore('x', { factory });
    await a.backend.tx(['settings'], 'readwrite', (t) =>
      t.put('settings', { key: 'k', value: 'v' }),
    );
    a.db?.close();
    const b = await openStore('x', { factory });
    expect(await b.backend.get('settings', 'k')).toEqual({ key: 'k', value: 'v' });
    b.db?.close();
  });

  it('falls back to memory on a VersionError and leaves the newer database alone', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('x', 7);
      req.onupgradeneeded = () => req.result.createObjectStore('future');
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(new Error('setup'));
    });
    const r = await openStore('x', { factory });
    expect(r.persistent).toBe(false);
    expect(r.reason).toBe('version');
    const check = await new Promise<number>((resolve) => {
      const req = factory.open('x');
      req.onsuccess = () => {
        const v = req.result.version;
        req.result.close();
        resolve(v);
      };
    });
    expect(check).toBe(7);
  });

  it('falls back on a SecurityError thrown by open', async () => {
    const factory = {
      open() {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const r = await openStore('x', { factory });
    expect(r).toMatchObject({ persistent: false, reason: 'security' });
  });

  it('falls back on an error event', async () => {
    const factory = {
      open() {
        const req = {} as { error?: DOMException; onerror?: (e: Event) => void };
        queueMicrotask(() => {
          Object.defineProperty(req, 'error', {
            value: new DOMException('x', 'InvalidStateError'),
          });
          req.onerror?.(new Event('error'));
        });
        return req;
      },
    } as unknown as IDBFactory;
    expect(await openStore('x', { factory })).toMatchObject({ persistent: false, reason: 'error' });
  });

  it('times out after 4 s by default', async () => {
    vi.useFakeTimers();
    try {
      const factory = { open: () => ({}) } as unknown as IDBFactory;
      const p = openStore('x', { factory });
      await vi.advanceTimersByTimeAsync(3999);
      let settled = false;
      void p.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await p).toMatchObject({ persistent: false, reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes its connection and reports a version change from another tab', async () => {
    const factory = new IDBFactory();
    const onVersionChange = vi.fn();
    await openStore('x', { factory, onVersionChange });
    // another "tab" asks for a newer version: our connection is told to close and the upgrade runs
    await new Promise<void>((resolve, reject) => {
      const other = factory.open('x', 3);
      other.onsuccess = () => {
        other.result.close();
        resolve();
      };
      other.onerror = () => reject(new Error('upgrade failed'));
    });
    expect(onVersionChange).toHaveBeenCalled();
  });

  it('never throws, whatever the factory does', async () => {
    const factory = {
      open: () => ({
        get onerror() {
          throw new Error('x');
        },
      }),
    } as unknown as IDBFactory;
    const r = await openStore('x', { factory });
    expect(r.persistent).toBe(false);
  });
});

describe('isQuotaError', () => {
  it('recognizes the DOM and legacy forms', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new Error('x'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe('closed connection', () => {
  it('rejects reads instead of throwing synchronously', async () => {
    const r = await openStore('x', { factory: new IDBFactory() });
    r.db?.close();
    await expect(r.backend.get('settings', 'k')).rejects.toBeDefined();
    await expect(r.backend.getAll('settings')).rejects.toBeDefined();
    await expect(r.backend.getAllKeys('settings')).rejects.toBeDefined();
    await expect(r.backend.tx(['settings'], 'readonly', () => undefined)).rejects.toBeDefined();
  });

  it('calls onBlocked when an older connection stays open during an upgrade', async () => {
    const factory = new IDBFactory();
    const onBlocked = vi.fn();
    const first = await openStore('x', { factory });
    // ignore the versionchange so the connection stays open and blocks the newer open
    if (first.db) first.db.onversionchange = null;
    const req = factory.open('x', 3);
    req.onblocked = onBlocked;
    req.onupgradeneeded = () => undefined;
    await new Promise((res) => setTimeout(res, 30));
    expect(onBlocked).toHaveBeenCalled();
    first.db?.close();
    await new Promise<void>((res) => {
      req.onsuccess = () => {
        req.result.close();
        res();
      };
    });
  });
});
