// Backend.update: the atomic read-modify-write (sync.md §4.2, review B2), on both backends.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createMemoryBackend, openStore, type Backend } from './index';

async function idbBackend(): Promise<Backend> {
  const r = await openStore('spinner-update-test', { factory: new IDBFactory() });
  expect(r.persistent).toBe(true);
  return r.backend;
}

const backends: [string, () => Promise<Backend>][] = [
  ['memory', () => Promise.resolve(createMemoryBackend())],
  ['indexeddb', idbBackend],
];

interface Setting {
  key: string;
  value: number;
}

describe.each(backends)('Backend.update: %s', (_name, make) => {
  it('reads, then writes, in one transaction', async () => {
    const b = await make();
    await b.tx(['settings'], 'readwrite', (t) => t.put('settings', { key: 'n', value: 1 }));
    await b.update(['settings'], async (r, w) => {
      const cur = await r.get<Setting>('settings', 'n');
      w.put('settings', { key: 'n', value: (cur?.value ?? 0) + 1 });
      w.put('settings', { key: 'm', value: 7 });
    });
    expect(await b.get('settings', 'n')).toEqual({ key: 'n', value: 2 });
    expect(await b.get('settings', 'm')).toEqual({ key: 'm', value: 7 });
  });

  it('applies nothing when fn rejects, and rejects with its error', async () => {
    const b = await make();
    await b.tx(['settings'], 'readwrite', (t) => t.put('settings', { key: 'a', value: 1 }));
    await expect(
      b.update(['settings'], async (r, w) => {
        await r.get('settings', 'a');
        w.put('settings', { key: 'a', value: 2 });
        w.put('settings', { key: 'b', value: 3 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await b.get('settings', 'a')).toEqual({ key: 'a', value: 1 });
    expect(await b.get('settings', 'b')).toBeUndefined();
  });

  it('rejects a put with no key and applies nothing', async () => {
    const b = await make();
    await expect(
      b.update(['settings'], (_r, w) => {
        w.put('settings', { key: 'ok', value: 1 });
        w.put('settings', { value: 2 });
        return Promise.resolve();
      }),
    ).rejects.toBeDefined();
    expect(await b.get('settings', 'ok')).toBeUndefined();
  });

  it('is atomic against concurrent increments (no lost update)', async () => {
    const b = await make();
    await b.tx(['settings'], 'readwrite', (t) => t.put('settings', { key: 'c', value: 0 }));
    const bump = () =>
      b.update(['settings'], async (r, w) => {
        const cur = await r.get<Setting>('settings', 'c');
        w.put('settings', { key: 'c', value: (cur?.value ?? 0) + 1 });
      });
    await Promise.all(Array.from({ length: 10 }, bump));
    expect(await b.get('settings', 'c')).toEqual({ key: 'c', value: 10 });
  });

  it('deletes, and works across several stores', async () => {
    const b = await make();
    await b.tx(['settings', 'groups'], 'readwrite', (t) => {
      t.put('settings', { key: 'x', value: 1 });
      t.put('groups', { id: 'g', name: 'G', runIds: [] });
    });
    await b.update(['settings', 'groups'], async (r, w) => {
      expect(await r.get('groups', 'g')).toBeDefined();
      w.delete('settings', 'x');
      w.put('groups', { id: 'g', name: 'G2', runIds: [] });
    });
    expect(await b.get('settings', 'x')).toBeUndefined();
    expect((await b.get<{ name: string }>('groups', 'g'))?.name).toBe('G2');
  });

  it('rejects a write to a store outside the transaction', async () => {
    const b = await make();
    await expect(
      b.update(['settings'], (_r, w) => {
        w.put('groups', { id: 'g' });
        return Promise.resolve();
      }),
    ).rejects.toBeDefined();
    expect(await b.get('groups', 'g')).toBeUndefined();
  });

  it('a failing update does not block the next one', async () => {
    const b = await make();
    await expect(b.update(['settings'], () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await b.update(['settings'], (_r, w) => {
      w.put('settings', { key: 'after', value: 1 });
      return Promise.resolve();
    });
    expect(await b.get('settings', 'after')).toBeDefined();
  });
});

describe('Backend.update: memory only', () => {
  it('reads see the writes queued so far, and stored values are clones', async () => {
    const b = createMemoryBackend();
    await b.update(['settings'], async (r, w) => {
      const v = { key: 'k', value: 1 };
      w.put('settings', v);
      v.value = 99; // mutating after put must not leak in
      expect(await r.get('settings', 'k')).toEqual({ key: 'k', value: 1 });
      w.delete('settings', 'k');
      expect(await r.get('settings', 'k')).toBeUndefined();
    });
    expect(await b.get('settings', 'k')).toBeUndefined();
  });
  it('a readwrite tx waits for an update in flight', async () => {
    const b = createMemoryBackend();
    await b.tx(['settings'], 'readwrite', (t) => t.put('settings', { key: 'v', value: 1 }));
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const upd = b.update(['settings'], async (r, w) => {
      const cur = await r.get<Setting>('settings', 'v');
      await gate;
      w.put('settings', { key: 'v', value: (cur?.value ?? 0) + 10 });
    });
    const other = b.tx(['settings'], 'readwrite', (t) => t.put('settings', { key: 'v', value: 5 }));
    release();
    await Promise.all([upd, other]);
    expect(await b.get('settings', 'v')).toEqual({ key: 'v', value: 5 }); // tx ran after update
  });
});

describe('Backend.update: IndexedDB fn must settle inside the transaction', () => {
  it('rejects when fn awaits a timer and then puts (the transaction already committed)', async () => {
    const b = await idbBackend();
    await expect(
      b.update(['settings'], async (_r, w) => {
        await new Promise((res) => setTimeout(res, 20));
        w.put('settings', { key: 'late', value: 1 });
      }),
    ).rejects.toThrow('transaction committed before update fn settled');
    expect(await b.get('settings', 'late')).toBeUndefined();
  });
  it('rejects with the error of fn, not a commit error, when fn throws after a read', async () => {
    const b = await idbBackend();
    await expect(
      b.update(['settings'], async (r) => {
        await r.get('settings', 'x');
        throw new Error('mine');
      }),
    ).rejects.toThrow('mine');
  });
  it('does not resolve before fn has queued its writes after several reads', async () => {
    const b = await idbBackend();
    await b.update(['settings'], async (r, w) => {
      for (let i = 0; i < 5; i++) await r.get('settings', `k${i}`);
      w.put('settings', { key: 'end', value: 1 });
    });
    expect(await b.get('settings', 'end')).toEqual({ key: 'end', value: 1 });
  });
});
