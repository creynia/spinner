// services/db.ts wraps the persistent backend in the tracker (sync.md D8, D19, §7.13).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncDirtyRecord } from '@core';
import {
  getBackend,
  getRawBackend,
  getRepo,
  getTrackedBackend,
  setRepoForTests,
} from '../../src/app/services/db';

const g = globalThis as { indexedDB?: IDBFactory };

beforeEach(() => {
  setRepoForTests(null);
  g.indexedDB = new IDBFactory();
});

const markKeys = async (): Promise<string[]> =>
  (await getRawBackend()!.getAll<SyncDirtyRecord>('syncDirty')).map((m) => m.key).sort();

describe('db.ts tracking', () => {
  it('wraps the IDB backend: repo writes leave marks, raw writes do not', async () => {
    const repo = await getRepo();
    expect(repo.kind).toBe('idb');
    expect(getRawBackend()).not.toBe(getBackend());
    expect(getTrackedBackend()?.raw).toBe(getRawBackend());
    await repo.setSetting('framing', 'x');
    await repo.setSetting('theme', 'dark');
    expect(await markKeys()).toEqual(['setting:framing']);
    await getRawBackend()!.tx(['strategies'], 'readwrite', (t) => t.put('strategies', { id: 's' }));
    expect(await markKeys()).toEqual(['setting:framing']);
    // the sink and other writers use getBackend(): tracked
    await getBackend()!.tx(['strategies'], 'readwrite', (t) => t.put('strategies', { id: 't' }));
    expect(await markKeys()).toEqual(['setting:framing', 'strategy:t']);
  });

  it('deleteAll writes raw: no marks, device id and vvCounter survive, sync state resets', async () => {
    const repo = await getRepo();
    const raw = getRawBackend()!;
    await repo.setSetting('framing', 'x');
    await raw.tx(['syncMeta', 'syncIndex'], 'readwrite', (t) => {
      t.put('syncMeta', { k: 'device', v: { id: 'abcdefghjk', createdAt: 'x' } });
      t.put('syncMeta', { k: 'vvCounter', v: 41 });
      t.put('syncMeta', { k: 'seen', v: { f: '1' } });
      t.put('syncMeta', { k: 'libSha', v: 'abc' });
      t.put('syncIndex', { key: 'setting:framing', kind: 'setting' });
    });
    await repo.deleteAll();
    expect(await raw.getAll('settings')).toEqual([]);
    expect(await raw.getAll('syncDirty')).toEqual([]);
    expect(await raw.getAll('syncIndex')).toEqual([]);
    expect((await raw.getAll<{ k: string }>('syncMeta')).map((r) => r.k).sort()).toEqual([
      'device',
      'vvCounter',
    ]);
    expect((await raw.get<{ v: number }>('syncMeta', 'vvCounter'))?.v).toBe(41);
  });

  it('does not wrap a memory backend: sync stays disabled', async () => {
    g.indexedDB = undefined;
    const repo = await getRepo();
    expect(repo.kind).toBe('memory');
    expect(getTrackedBackend()).toBeNull();
    expect(getBackend()).toBe(getRawBackend());
    await repo.setSetting('framing', 'x');
    expect(await getRawBackend()!.getAll('syncDirty')).toEqual([]);
  });
});
