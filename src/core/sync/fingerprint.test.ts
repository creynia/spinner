import { describe, expect, it } from 'vitest';
import type { SyncEntry, SyncKind } from '../contracts/sync';
import { SYNC_KINDS } from '../contracts/sync';
import { definitionId } from '../experiment';
import { entryOf, fingerprintValue, SUPPORTED_V, verifyEntry } from './fingerprint';
import { deepFreeze, hlcOf } from './testkit';

const A = 'aaaaaaaaaa';
const hash = async (kind: SyncKind, id: string, value: unknown) =>
  (await entryOf(kind, id, value as never, hlcOf(1, A), undefined, A, 1)).hash;

const records = {
  def: {
    v: 1,
    id: 'd1',
    definition: { name: 'x' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
    origin: 'user',
    runIds: ['b', 'a'],
  },
  strategy: {
    v: 1,
    id: 's',
    strategy: { id: 's', name: 'S' },
    hash: 'h',
    createdAt: 'c',
    updatedAt: 'u',
    derivedFrom: 'p',
    'z-unknown': 1,
  },
  layout: {
    v: 1,
    id: 'l',
    layout: { id: 'l' },
    hash: 'h',
    createdAt: 'c',
    updatedAt: 'u',
    origin: 'user',
  },
  group: {
    v: 1,
    id: 'g',
    kind: 'compare',
    name: 'G',
    runIds: ['b', 'a'],
    createdAt: 'c',
    updatedAt: 'u',
  },
  setting: { key: 'framing', value: 'zoom' },
  run: {
    runId: 'r1',
    status: 'done',
    verdict: { meanNet: 1 },
    extra: {
      imported: {
        appVersion: '1',
        importedAt: 'T',
        fileSha256: 'f',
        trimmed: false,
        partial: false,
        trimInfo: { a: 1 },
      },
    },
  },
} as const;

// sha256 of the canonical JSON in the comment, computed outside this code base (python hashlib).
const PINNED: Record<string, string> = {
  def: '2238d525c551b23a148b2f7128146c1d3bd18983310db0db8082bb376a7ebdb5', // runIds sorted, no updatedAt
  strategy: 'c9bfc4e865e20e814b82b5a2df77941901e79b22b8951bf022a9143d14fb0d34',
  layout: '55843d422adc0aeac1f84ce0a7cd22e075bbdf21292a0a0f5dfd290d5f37b0b3',
  group: '30f9cba515e67206260d6994172a358d2507e9cc67dfbc067ee5c7f099a259b1', // runIds order kept
  setting: 'edb1da9b7d086190147fb2093cbc6e40aceca0c10cebb040be0a7da40769f6d7',
  run: 'db6a6e50fccb8f29cdf8576aca6d79c89b49ff4f2339538de9816b99e55a3834', // no verdict, importedAt
};
const idOf: Record<string, string> = {
  def: 'd1',
  strategy: 's',
  layout: 'l',
  group: 'g',
  setting: 'framing',
  run: 'r1',
};

describe('fingerprint (§7.2)', () => {
  it.each(SYNC_KINDS)('%s: pinned hash vector', async (kind) => {
    expect(await hash(kind, idOf[kind]!, records[kind])).toBe(PINNED[kind]);
  });

  it('a change to updatedAt only gives the same hash (def, strategy, layout, group)', async () => {
    for (const kind of ['def', 'strategy', 'layout', 'group'] as const) {
      const r = records[kind];
      const h1 = await hash(kind, idOf[kind]!, r);
      const h2 = await hash(kind, idOf[kind]!, { ...r, updatedAt: '2030-01-01T00:00:00.000Z' });
      expect(h2).toBe(h1);
    }
  });

  it('def: runIds are sorted; group: their order has meaning', async () => {
    const d = records.def;
    expect(await hash('def', 'd1', { ...d, runIds: ['a', 'b'] })).toBe(PINNED.def);
    const g = records.group;
    expect(await hash('group', 'g', { ...g, runIds: ['a', 'b'] })).not.toBe(PINNED.group);
  });

  it('unknown keys stay in the fingerprint', async () => {
    const s = records.strategy;
    expect(await hash('strategy', 's', { ...s, 'z-unknown': 2 })).not.toBe(PINNED.strategy);
    expect(await hash('strategy', 's', { ...s, extra: 1 })).not.toBe(PINNED.strategy);
  });

  it('run: verdict and extra.imported.importedAt are volatile; other imported keys are not', async () => {
    const r = records.run;
    const base = await hash('run', 'r1', r);
    expect(await hash('run', 'r1', { ...r, verdict: { meanNet: 99 } })).toBe(base);
    const imp = (over: object) => ({ ...r, extra: { imported: { ...r.extra.imported, ...over } } });
    expect(await hash('run', 'r1', imp({ importedAt: 'OTHER' }))).toBe(base);
    expect(await hash('run', 'r1', imp({ trimInfo: { a: 2 } }))).not.toBe(base);
    expect(await hash('run', 'r1', { ...r, status: 'error' })).not.toBe(base);
  });

  it('setting: only { key, value }', () => {
    expect(fingerprintValue('setting', { key: 'pace', value: 3, junk: 1 })).toEqual({
      key: 'pace',
      value: 3,
    });
  });

  it('does not mutate its input', () => {
    const r = deepFreeze(structuredClone(records.def));
    expect(() => fingerprintValue('def', r)).not.toThrow();
    expect(r.runIds).toEqual(['b', 'a']);
  });
});

describe('entryOf', () => {
  it('builds key, basis and vv from the parent; counter is the self component', async () => {
    const parent = { hlc: hlcOf(5, 'bbbbbbbbbb'), seen: { bbbbbbbbbb: 4, cccccccccc: 2, [A]: 1 } };
    const e = await entryOf('group', 'g', records.group as never, hlcOf(9, A), parent, A, 7);
    expect(e.key).toBe('group:g');
    expect(e.basis).toBe(parent.hlc);
    expect(e.vv).toEqual({ bbbbbbbbbb: 4, cccccccccc: 2, [A]: 7 });
    expect(e.v).toBe(1);
    expect(e.deleted).toBeUndefined();
    expect(parent.seen[A]).toBe(1); // untouched
  });

  it('a fresh entry has basis null and vv { self: counter }', async () => {
    const e = await entryOf(
      'setting',
      'framing',
      { key: 'framing', value: 1 },
      hlcOf(1, A),
      undefined,
      A,
      3,
    );
    expect(e.basis).toBeNull();
    expect(e.vv).toEqual({ [A]: 3 });
  });

  it('a tombstone: deleted, empty hash, null value', async () => {
    const e = await entryOf('layout', 'l', null, hlcOf(1, A), undefined, A, 1);
    expect(e).toMatchObject({ deleted: true, hash: '', value: null, key: 'layout:l' });
  });
});

describe('verifyEntry', () => {
  const good = async (): Promise<SyncEntry> => {
    const definition = { name: 'x' };
    const id = await definitionId(definition as never);
    return entryOf(
      'def',
      id,
      { ...records.def, id, definition } as never,
      hlcOf(1, A),
      undefined,
      A,
      1,
    );
  };
  const g = (): Promise<SyncEntry> =>
    entryOf('group', 'g', records.group as never, hlcOf(1, A), undefined, A, 1);

  it('ok for each kind of good entry and for tombstones', async () => {
    expect(await verifyEntry(await good())).toBe('ok');
    expect(await verifyEntry(await g())).toBe('ok');
    expect(
      await verifyEntry(
        await entryOf('setting', 'pace', { key: 'pace', value: 2 }, hlcOf(1, A), undefined, A, 1),
      ),
    ).toBe('ok');
    expect(
      await verifyEntry(await entryOf('layout', 'l', null, hlcOf(1, A), undefined, A, 1)),
    ).toBe('ok');
  });

  it('bad-hash: value changed, tombstone with a value, live without a value', async () => {
    const e = await g();
    expect(
      await verifyEntry({ ...e, value: { ...(e.value as object), name: 'tampered' } } as SyncEntry),
    ).toBe('bad-hash');
    expect(await verifyEntry({ ...e, deleted: true })).toBe('bad-hash');
    expect(await verifyEntry({ ...e, value: null })).toBe('bad-hash');
    expect(await verifyEntry({ ...e, hash: '' })).toBe('bad-hash');
  });

  it('bad-id: key mismatch, value id mismatch, a def whose id is not its hash, malformed hlc or vv', async () => {
    const e = await g();
    expect(await verifyEntry({ ...e, key: 'group:other' })).toBe('bad-id');
    expect(await verifyEntry({ ...e, id: 'other', key: 'group:other' })).toBe('bad-id');
    const d = await good();
    expect(await verifyEntry({ ...d, id: 'f'.repeat(64), key: `def:${'f'.repeat(64)}` })).toBe(
      'bad-id',
    );
    expect(await verifyEntry({ ...e, hlc: 'nope' })).toBe('bad-id');
    expect(await verifyEntry({ ...e, vv: { [A]: -1 } })).toBe('bad-id');
  });

  it('unknown-kind and newer', async () => {
    const e = await g();
    expect(
      await verifyEntry({ ...e, kind: 'widget', key: 'widget:g' } as unknown as SyncEntry),
    ).toBe('unknown-kind');
    expect(await verifyEntry({ ...e, v: SUPPORTED_V.group + 1 })).toBe('newer');
  });
});
