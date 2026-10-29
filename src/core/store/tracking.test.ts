// Change tracking (sync.md §4.3, §11.1): a mark per tracked write, in the same transaction.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { SyncDirtyRecord, SyncKey } from '../contracts/sync';
import { createMemoryBackend, openStore, type Backend } from './backend';
import { createRepo } from './repo';
import { createTrackedBackend, evictRunResults } from './tracking';

const backends: [string, () => Promise<Backend>][] = [
  ['memory', () => Promise.resolve(createMemoryBackend())],
  ['indexeddb', async () => (await openStore('trk', { factory: new IDBFactory() })).backend],
];

const marks = async (b: Backend): Promise<string[]> =>
  (await b.getAll<SyncDirtyRecord>('syncDirty')).map((m) => m.key).sort();

const def = (id: string) => ({ id, updatedAt: 'x', runIds: [] as string[] });

describe.each(backends)('tracked backend on %s', (_n, make) => {
  it('marks every writer path in the same transaction', async () => {
    const raw = await make();
    const b = createTrackedBackend(raw);
    const repo = createRepo(b);
    await b.tx(['definitions'], 'readwrite', (t) => t.put('definitions', def('d1')));
    await b.tx(['strategies'], 'readwrite', (t) => t.put('strategies', { id: 's1' }));
    await b.tx(['layouts'], 'readwrite', (t) => t.put('layouts', { id: 'l1' }));
    await b.tx(['groups'], 'readwrite', (t) => t.put('groups', { id: 'g1' }));
    await repo.setSetting('framing', 'x');
    await b.tx(['runs', 'runParts'], 'readwrite', (t) => {
      t.put('runs', { runId: 'r1' });
      t.put('runParts', { runId: 'r1', firstChunk: 0 });
      t.put('runParts', { runId: 'r1', firstChunk: 1 });
    });
    await b.tx(['summaries', 'checkpoints', 'breakdowns', 'samples'], 'readwrite', (t) => {
      t.put('summaries', { runId: 'r2' });
      t.put('checkpoints', { runId: 'r3' });
      t.put('breakdowns', { runId: 'r4' });
      t.put('samples', { runId: 'r5' });
    });
    expect(await marks(raw)).toEqual([
      'def:d1',
      'group:g1',
      'layout:l1',
      'run:r1',
      'run:r2',
      'run:r3',
      'run:r4',
      'run:r5',
      'setting:framing',
      'strategy:s1',
    ]);
    const m = await raw.get<SyncDirtyRecord>('syncDirty', 'run:r1');
    expect(typeof m?.last).toBe('number');
    expect(m?.n).toMatch(/\S/);
  });

  it('marks deletes, including a runParts array key', async () => {
    const raw = await make();
    await raw.tx(['strategies', 'runParts'], 'readwrite', (t) => {
      t.put('strategies', { id: 's1' });
      t.put('runParts', { runId: 'r9', firstChunk: 0 });
    });
    const b = createTrackedBackend(raw);
    await b.tx(['strategies', 'runParts'], 'readwrite', (t) => {
      t.delete('strategies', 's1');
      t.delete('runParts', ['r9', 0]);
    });
    expect(await marks(raw)).toEqual(['run:r9', 'strategy:s1']);
  });

  it('marks nothing for unsynced settings, readonly work or unsynced stores; theme none, framing yes', async () => {
    const raw = await make();
    const b = createTrackedBackend(raw);
    await b.tx(['settings'], 'readwrite', (t) => t.put('settings', { key: 'theme', value: 'd' }));
    expect(await marks(raw)).toEqual([]);
    await b.tx(['settings'], 'readwrite', (t) => t.put('settings', { key: 'framing', value: 1 }));
    await b.tx(['settings'], 'readwrite', (t) => t.put('settings', { key: 'pace', value: 1 }));
    await b.tx(['syncMeta'], 'readwrite', (t) => t.put('syncMeta', { k: 'x', v: 1 }));
    await b.tx(['settings'], 'readonly', () => undefined);
    expect(await marks(raw)).toEqual(['setting:framing', 'setting:pace']);
  });

  it('leaves no mark for a raw write', async () => {
    const raw = await make();
    const b = createTrackedBackend(raw);
    await b.raw.tx(['definitions'], 'readwrite', (t) => t.put('definitions', def('d')));
    expect(await marks(raw)).toEqual([]);
    expect(b.raw).toBe(raw);
  });

  it('leaves no mark and writes nothing when the transaction fails', async () => {
    const raw = await make();
    const b = createTrackedBackend(raw);
    const heard = vi.fn();
    b.onDirty(heard);
    await expect(
      b.tx(['definitions'], 'readwrite', (t) => {
        t.put('definitions', def('d'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(
      b.update(['definitions'], (_r, w) => {
        w.put('definitions', def('d'));
        return Promise.reject(new Error('boom2'));
      }),
    ).rejects.toThrow('boom2');
    expect(await marks(raw)).toEqual([]);
    expect(await raw.getAll('definitions')).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
  });

  it('update() marks in the same transaction after its reads', async () => {
    const raw = await make();
    const b = createTrackedBackend(raw);
    await b.tx(['groups'], 'readwrite', (t) => t.put('groups', { id: 'g', runIds: ['a'] }));
    await b.update(['groups'], async (r, w) => {
      const g = await r.get<{ id: string; runIds: string[] }>('groups', 'g');
      w.put('groups', { ...g, runIds: [...(g?.runIds ?? []), 'b'] });
    });
    expect(await raw.get('groups', 'g')).toEqual({ id: 'g', runIds: ['a', 'b'] });
    expect(await marks(raw)).toEqual(['group:g']);
  });

  it('keeps the latest edit time and a fresh nonce per write, one mark per key', async () => {
    const raw = await make();
    const b = createTrackedBackend(raw);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1000);
      await b.tx(['strategies'], 'readwrite', (t) => t.put('strategies', { id: 's' }));
      const first = await raw.get<SyncDirtyRecord>('syncDirty', 'strategy:s');
      vi.setSystemTime(5000);
      await b.tx(['strategies'], 'readwrite', (t) => {
        t.put('strategies', { id: 's' });
        t.put('strategies', { id: 's' });
      });
      const second = await raw.get<SyncDirtyRecord>('syncDirty', 'strategy:s');
      expect(first?.last).toBe(1000);
      expect(second?.last).toBe(5000);
      expect(second?.n).not.toBe(first?.n);
      expect(await marks(raw)).toEqual(['strategy:s']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a dry-run definition still gets a mark (snapshot decides later)', async () => {
    const raw = await make();
    const b = createTrackedBackend(raw);
    await b.tx(['definitions'], 'readwrite', (t) =>
      t.put('definitions', { ...def('dry'), definition: { tags: ['dry-run'] } }),
    );
    expect(await marks(raw)).toEqual(['def:dry']);
  });

  it('onDirty reports committed keys, can unsubscribe, and survives a throwing listener', async () => {
    const raw = await make();
    const b = createTrackedBackend(raw);
    const seen: SyncKey[][] = [];
    b.onDirty(() => {
      throw new Error('listener');
    });
    const off = b.onDirty((k) => seen.push(k));
    await b.tx(['strategies', 'layouts'], 'readwrite', (t) => {
      t.put('strategies', { id: 's' });
      t.put('layouts', { id: 'l' });
    });
    expect(seen).toEqual([['strategy:s', 'layout:l']]);
    off();
    await b.tx(['strategies'], 'readwrite', (t) => t.put('strategies', { id: 't' }));
    expect(seen).toHaveLength(1);
    await b.tx(['settings'], 'readwrite', (t) => t.put('settings', { key: 'theme', value: 1 }));
    expect(seen).toHaveLength(1);
  });

  it('reads pass through', async () => {
    const raw = await make();
    const b = createTrackedBackend(raw);
    await b.tx(['strategies'], 'readwrite', (t) => t.put('strategies', { id: 's' }));
    expect(b.kind).toBe(raw.kind);
    expect(await b.get('strategies', 's')).toEqual({ id: 's' });
    expect(await b.getAll('strategies')).toHaveLength(1);
    expect(await b.getAllKeys('strategies')).toEqual(['s']);
  });

  it('evictRunResults removes the run and its results, keeps definitions and leaves no mark', async () => {
    const raw = await make();
    const b = createTrackedBackend(raw);
    await raw.tx(['definitions'], 'readwrite', (t) =>
      t.put('definitions', { ...def('d'), runIds: ['r1', 'r2'] }),
    );
    await raw.tx(
      ['runs', 'runParts', 'summaries', 'checkpoints', 'breakdowns', 'samples'],
      'readwrite',
      (t) => {
        for (const id of ['r1', 'r2']) {
          t.put('runs', { runId: id });
          t.put('runParts', { runId: id, firstChunk: 0 });
          t.put('runParts', { runId: id, firstChunk: 1 });
          t.put('summaries', { runId: id });
          t.put('checkpoints', { runId: id });
          t.put('breakdowns', { runId: id });
          t.put('samples', { runId: id });
        }
      },
    );
    await evictRunResults(b.raw, 'r1');
    for (const s of ['runs', 'summaries', 'checkpoints', 'breakdowns', 'samples'] as const) {
      expect(await raw.getAllKeys(s), s).toEqual(['r2']);
    }
    expect(await raw.getAllKeys('runParts')).toEqual([
      ['r2', 0],
      ['r2', 1],
    ]);
    expect((await raw.get<{ runIds: string[] }>('definitions', 'd'))?.runIds).toEqual(['r1', 'r2']);
    expect(await marks(raw)).toEqual([]);
  });
});

describe('tracked backend on IndexedDB: atomicity with the mark', () => {
  it('a tx aborted by a failing put leaves neither record nor mark', async () => {
    const r = await openStore('abort', { factory: new IDBFactory() });
    const b = createTrackedBackend(r.backend);
    await expect(
      b.tx(['definitions', 'strategies'], 'readwrite', (t) => {
        t.put('definitions', def('ok'));
        t.put('strategies', { noId: true }); // violates the keyPath: the whole tx aborts
      }),
    ).rejects.toBeDefined();
    expect(await r.backend.getAll('definitions')).toEqual([]);
    expect(await marks(r.backend)).toEqual([]);
    r.db?.close();
  });
});
