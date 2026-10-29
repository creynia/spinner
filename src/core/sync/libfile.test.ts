import { describe, expect, it } from 'vitest';
import type { LibFileV1, SyncEntry } from '../contracts/sync';
import { canonicalJson, compressBytes, utf8Encode } from '../experiment';
import { entryOf } from './fingerprint';
import { decodeLib, encodeLib, LIB_NAME, LibFileError, ROOT_NAME, runBundleName } from './libfile';
import { hlcOf } from './testkit';

const A = 'aaaaaaaaaa';

const lib = async (): Promise<LibFileV1> => {
  const mk = (id: string) =>
    entryOf(
      'group',
      id,
      { v: 1, id, kind: 'compare', name: id, runIds: [], createdAt: 'c', updatedAt: 'u' },
      hlcOf(1, A),
      undefined,
      A,
      1,
    );
  const entries: SyncEntry[] = [await mk('zeta'), await mk('alpha'), await mk('mid')];
  return {
    format: 'spinner-sync-lib',
    version: 1,
    device: { id: A, name: 'Laptop', appVersion: '1', coreVersion: '1' },
    hlc: hlcOf(1, A),
    writtenAt: '2026-01-01T00:00:00.000Z',
    entries,
  };
};
const gz = (o: unknown) => compressBytes(utf8Encode(JSON.stringify(o)), 'gzip');
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(LibFileError);
    return (e as LibFileError).code;
  }
  return 'resolved';
};

describe('libfile', () => {
  it('names', () => {
    expect(LIB_NAME(A)).toBe(`lib.${A}.json.gz`);
    expect(ROOT_NAME).toBe('spinner-sync.json');
    expect(runBundleName('run1', 'abcdef0123456789ffff')).toBe(
      'run.run1.abcdef0123456789.spinner.json.gz',
    );
  });

  it('round trip: gzip of canonical JSON, entries sorted by key', async () => {
    const f = await lib();
    const bytes = await encodeLib(f);
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
    const back = await decodeLib(bytes);
    expect(back.entries.map((e) => e.key)).toEqual(['group:alpha', 'group:mid', 'group:zeta']);
    expect(canonicalJson(back as never)).toBe(
      canonicalJson({
        ...f,
        entries: [...f.entries].sort((a, b) => (a.key < b.key ? -1 : 1)),
      } as never),
    );
    // encoding is deterministic and does not reorder the caller's array
    expect(f.entries[0]!.key).toBe('group:zeta');
    const again = await encodeLib({ ...f, entries: [...f.entries].reverse() });
    expect(again.length).toBe(bytes.length);
  });

  it('refuses a file that is not gzip', async () => {
    expect(await code(decodeLib(new Uint8Array([1, 2, 3])))).toBe('not-gzip');
    expect(await code(decodeLib(new Uint8Array()))).toBe('not-gzip');
  });

  it('refuses a corrupt gzip stream', async () => {
    const bytes = await encodeLib(await lib());
    expect(await code(decodeLib(bytes.slice(0, 20)))).toBe('bad-json');
  });

  it('refuses text that is not JSON', async () => {
    expect(await code(decodeLib(await compressBytes(utf8Encode('{nope'), 'gzip')))).toBe(
      'bad-json',
    );
  });

  it('refuses another format and a newer version', async () => {
    const f = await lib();
    expect(await code(decodeLib(await gz({ ...f, format: 'other' })))).toBe('bad-format');
    expect(await code(decodeLib(await gz([1])))).toBe('bad-format');
    expect(await code(decodeLib(await gz({ ...f, version: 2 })))).toBe('newer-version');
  });

  it('refuses a wrong shape', async () => {
    const f = await lib();
    for (const bad of [
      { ...f, version: 0 },
      { ...f, device: { ...f.device, id: 'NOT-AN-ID' } },
      { ...f, device: null },
      { ...f, hlc: 'nope' },
      { ...f, writtenAt: 5 },
      { ...f, entries: {} },
      { ...f, entries: [{ kind: 'group' }] },
      { ...f, entries: [null] },
    ])
      expect(await code(decodeLib(await gz(bad)))).toBe('bad-shape');
  });

  it('refuses an inflated size above the cap (decompression bomb)', async () => {
    const big = new Uint8Array(130 * 1024 * 1024); // zeros compress to a few hundred kB
    const bytes = await compressBytes(big, 'gzip');
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
    expect(await code(decodeLib(bytes))).toBe('too-large');
  });

  it('keeps entries it does not understand (forward compatibility)', async () => {
    const f = await lib();
    const alien = { ...f.entries[0]!, kind: 'widget', key: 'widget:x', v: 9, extra: { a: 1 } };
    const back = await decodeLib(
      await encodeLib({ ...f, entries: [...f.entries, alien as never] }),
    );
    expect(back.entries.find((e) => (e.key as string) === 'widget:x')).toMatchObject({
      v: 9,
      extra: { a: 1 },
    });
  });
});
