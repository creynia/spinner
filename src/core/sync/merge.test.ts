import { describe, expect, it } from 'vitest';
import type { DefinitionRecord } from '../contracts/experiment';
import type { SyncEntry, SyncIndexRecord } from '../contracts/sync';
import { entryOf } from './fingerprint';
import { copyOf, equivalent, foldEntries, joinDef, resolve } from './merge';
import { bare, DEVICES, deepFreeze, foldSig, hlcOf, perms, rng } from './testkit';
import { concurrent, descends } from './vv';

const [A, B, C, D] = DEVICES;
const none = new Set<string>();
const g = (dev: string, wall: number, vv: Record<string, number>, content: string | null) =>
  bare('group', 'k', dev, wall, vv, content);

describe('vv', () => {
  it('descends is pointwise >=; equal vectors descend from each other', () => {
    const a = g(A, 1, { [A]: 2, [B]: 1 }, 'x');
    const b = g(B, 2, { [A]: 1 }, 'y');
    expect(descends(a, b)).toBe(true);
    expect(descends(b, a)).toBe(false);
    expect(descends(a, a)).toBe(true);
    const twin = g(C, 3, { [A]: 2, [B]: 1 }, 'z');
    expect(descends(a, twin) && descends(twin, a)).toBe(true);
    expect(concurrent(a, twin)).toBe(false);
  });
  it('concurrent: neither descends', () => {
    const a = g(A, 1, { [A]: 1 }, 'x');
    const b = g(B, 2, { [B]: 1 }, 'y');
    expect(concurrent(a, b)).toBe(true);
    expect(concurrent(a, g(B, 3, { [A]: 1, [B]: 1 }, 'z'))).toBe(false);
  });
  it('a missing component counts as 0', () => {
    expect(descends(g(A, 1, {}, 'x'), g(B, 1, { [B]: 0 }, 'y'))).toBe(true);
  });
});

describe('foldEntries', () => {
  it('rejects an empty set', () => {
    expect(() => foldEntries([], none)).toThrow();
  });

  it('three concurrent live entries: the higher HLC wins, the others are losers by HLC', () => {
    const x = g(A, 5, { [A]: 2 }, 'x');
    const y = g(B, 7, { [A]: 1, [B]: 1 }, 'y');
    const z = g(C, 6, { [A]: 1, [C]: 1 }, 'z');
    const f = foldEntries([x, y, z], none);
    expect(f.winner.hash).toBe('y');
    expect(f.losers.map((l) => l.hash)).toEqual(['x', 'z']);
    expect(f.seen).toEqual({ [A]: 2, [B]: 1, [C]: 1 });
  });

  it('a transitive descendant is not a conflict (A -> C -> D)', () => {
    const e1 = g(A, 1, { [A]: 1 }, 'e1');
    const e2 = g(B, 2, { [A]: 1, [B]: 1 }, 'e2');
    const e3 = g(C, 3, { [A]: 1, [B]: 1, [C]: 1 }, 'e3');
    const f = foldEntries([e1, e3, e2], none);
    expect(f.winner.hash).toBe('e3');
    expect(f.losers).toEqual([]);
  });

  it('an edit beats a concurrent delete, whatever the HLC; a later descendant delete wins', () => {
    const base = g(A, 1, { [A]: 1 }, 'v0');
    const edit = g(B, 5, { [A]: 1, [B]: 1 }, 'edit');
    const del = g(C, 9, { [A]: 1, [C]: 1 }, null);
    const f = foldEntries([base, edit, del], none);
    expect(f.winner.hash).toBe('edit');
    expect(f.losers).toEqual([]); // a delete is never copied
    const del2 = g(C, 10, { [A]: 1, [B]: 1, [C]: 2 }, null); // saw the edit
    expect(foldEntries([base, edit, del2], none).winner.deleted).toBe(true);
  });

  it('N3: equivalent entries collapse into the lowest HLC with their vvs joined, no loser', () => {
    const a = g(A, 5, { [A]: 1 }, 'same');
    const b = g(B, 6, { [B]: 1 }, 'same');
    const c = g(C, 4, { [C]: 1 }, 'other');
    const f = foldEntries([a, b, c], none);
    expect(f.winner.hash).toBe('same');
    expect(f.winner.hlc).toBe(a.hlc);
    expect(f.winner.vv).toEqual({ [A]: 1, [B]: 1 });
    expect(f.losers.map((l) => l.hash)).toEqual(['other']);
    // two equal copies and nothing else: one winner, no loser
    const only = foldEntries([a, b], none);
    expect(only.losers).toEqual([]);
  });

  it('settings and runs are plain LWW with no losers', () => {
    const s1 = bare('setting', 'framing', A, 1, { [A]: 1 }, 'p');
    const s2 = bare('setting', 'framing', B, 2, { [B]: 1 }, 'q');
    const f = foldEntries([s1, s2], none);
    expect(f.winner.hash).toBe('q');
    expect(f.losers).toEqual([]);
    const r1 = bare('run', 'r', A, 1, { [A]: 1 }, 'p');
    const r2 = bare('run', 'r', B, 2, { [B]: 1 }, null);
    expect(foldEntries([r1, r2], none).winner.hash).toBe('p');
  });

  it('never mutates an input entry (deep-frozen inputs)', () => {
    const set = deepFreeze([
      g(A, 5, { [A]: 1 }, 'same'),
      g(B, 6, { [B]: 1 }, 'same'),
      g(C, 4, { [C]: 1 }, 'other'),
    ]);
    expect(() => foldEntries(set, none)).not.toThrow();
  });

  it('N2: every permutation of sets of up to 5 entries gives an identical result', () => {
    const e = (dev: string, w: number, vv: Record<string, number>, c: string | null) =>
      g(dev, w, vv, c);
    const sets: SyncEntry[][] = [
      [
        e(A, 5, { [A]: 2 }, 'x'),
        e(B, 7, { [A]: 1, [B]: 1 }, 'y'),
        e(C, 6, { [A]: 1, [C]: 1 }, 'z'),
      ],
      [
        e(A, 5, { [A]: 2 }, 'x'),
        e(B, 7, { [A]: 1, [B]: 1 }, null),
        e(C, 9, { [A]: 2, [C]: 1 }, 'z'),
        e(D, 3, { [A]: 1 }, 'w'),
      ],
      [e(A, 5, { [A]: 1 }, 'same'), e(B, 6, { [B]: 1 }, 'same'), e(C, 4, { [C]: 1 }, 'other')],
      [
        e(A, 1, { [A]: 1 }, 'same'),
        e(B, 2, { [B]: 1 }, 'same'),
        e(C, 3, { [C]: 1 }, 'same'),
        e(D, 4, { [D]: 1 }, null),
        e(A, 9, { [A]: 2, [B]: 1 }, 'later'),
      ],
    ];
    for (const set of sets) {
      expect(new Set(perms(set).map((p) => foldSig(foldEntries(p, none)))).size).toBe(1);
    }
  });

  it('1000 seeded random sets: order independent and idempotent', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const rnd = rng(seed);
      const n = 1 + rnd(7);
      const set: SyncEntry[] = [];
      for (let i = 0; i < n; i++) {
        const vv: Record<string, number> = {};
        for (const d of [A, B, C]) if (rnd(2)) vv[d] = 1 + rnd(3);
        const dev = [A, B, C, D][rnd(4)]!;
        vv[dev] = (vv[dev] ?? 0) + 1;
        const content = rnd(5) === 0 ? null : `c${rnd(3)}`;
        const kind = (['group', 'strategy', 'setting'] as const)[rnd(3)]!;
        set.push(bare(kind, 'k', dev, 1 + rnd(20), vv, content));
      }
      // one kind per key
      const uni = set.map((e): SyncEntry => ({
        ...e,
        kind: set[0]!.kind,
        key: `${set[0]!.kind}:k`,
      }));
      const frozen = deepFreeze(structuredClone(uni));
      const f = foldEntries(frozen, none);
      const sig = foldSig(f);
      for (let k = 0; k < 6; k++) {
        const shuffled = [...frozen].sort(() => rnd(3) - 1);
        expect(foldSig(foldEntries(shuffled, none)), `seed ${seed}`).toBe(sig);
      }
      // idempotent: duplicates change nothing; refolding winner + losers gives the same winner
      expect(foldSig(foldEntries([...frozen, ...frozen], none)), `seed ${seed}`).toBe(sig);
      expect(foldSig(foldEntries([...frozen, f.winner], none)), `seed ${seed}`).toBe(sig);
      const again = foldEntries([f.winner, ...f.losers], none);
      expect(again.winner, `seed ${seed}`).toEqual(f.winner);
      expect(again.losers, `seed ${seed}`).toEqual(f.losers);
      // the winner is maximal: nothing in the set strictly dominates it
      for (const e of frozen)
        expect(descends(e, f.winner) && !descends(f.winner, e), `seed ${seed}`).toBe(false);
    }
  });
});

// ------------------------------------------------------------------ definitions

const defRec = (over: Partial<DefinitionRecord> & Record<string, unknown> = {}) =>
  ({
    v: 1,
    id: 'd',
    definition: { name: 'n' },
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    origin: 'user',
    runIds: [],
    ...over,
  }) as DefinitionRecord;
const defE = (
  dev: string,
  wall: number,
  vv: Record<string, number>,
  rec: DefinitionRecord | null,
  hash = rec ? JSON.stringify(rec) : null,
): SyncEntry<'def'> =>
  ({ ...bare('def', 'd', dev, wall, vv, hash, rec), value: rec }) as SyncEntry<'def'>;

describe('joinDef', () => {
  it('runIds: sorted union minus deleted runs', () => {
    const a = defE(A, 1, { [A]: 1 }, defRec({ runIds: ['r3', 'r1'] }));
    const b = defE(B, 2, { [B]: 1 }, defRec({ runIds: ['r2', 'r1', 'r9'] }));
    const j = joinDef([a, b], new Set(['r9']));
    expect(j.value!.runIds).toEqual(['r1', 'r2', 'r3']);
    expect(joinDef([b, a], new Set(['r9']))).toEqual(j);
  });

  it('hlc is the highest, vv the join, no new mint; createdAt min, updatedAt max', () => {
    const a = defE(
      A,
      1,
      { [A]: 3 },
      defRec({ createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' }),
    );
    const b = defE(
      B,
      9,
      { [B]: 2 },
      defRec({ createdAt: '2026-01-07T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }),
    );
    const j = joinDef([a, b], none);
    expect(j.hlc).toBe(b.hlc);
    expect(j.vv).toEqual({ [A]: 3, [B]: 2 });
    expect(j.value!.createdAt).toBe('2026-01-05T00:00:00.000Z');
    expect(j.value!.updatedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(j.kind).toBe('def');
  });

  it('displayName: the later displayNameAt wins; ties go to the higher entry HLC', () => {
    const a = defE(
      A,
      1,
      { [A]: 1 },
      defRec({ displayName: 'Old', displayNameAt: '2026-02-01T00:00:00.000Z' }),
    );
    const b = defE(
      B,
      2,
      { [B]: 1 },
      defRec({ displayName: 'New', displayNameAt: '2026-03-01T00:00:00.000Z' }),
    );
    expect(joinDef([a, b], none).value!.displayName).toBe('New');
    const t1 = defE(
      A,
      1,
      { [A]: 1 },
      defRec({ displayName: 'T1', displayNameAt: '2026-03-01T00:00:00.000Z' }),
    );
    const t2 = defE(
      B,
      2,
      { [B]: 1 },
      defRec({ displayName: 'T2', displayNameAt: '2026-03-01T00:00:00.000Z' }),
    );
    expect(joinDef([t1, t2], none).value!.displayName).toBe('T2');
    expect(joinDef([t2, t1], none).value!.displayName).toBe('T2');
  });

  it('a rename-back (no displayName, later displayNameAt) clears the name', () => {
    const named = defE(
      A,
      1,
      { [A]: 1 },
      defRec({ displayName: 'X', displayNameAt: '2026-02-01T00:00:00.000Z' }),
    );
    const back = defE(B, 2, { [B]: 1 }, defRec({ displayNameAt: '2026-04-01T00:00:00.000Z' }));
    const j = joinDef([named, back], none);
    expect(j.value!.displayName).toBeUndefined();
    expect('displayName' in j.value!).toBe(false);
    expect(j.value!.displayNameAt).toBe('2026-04-01T00:00:00.000Z');
    // with and without displayNameAt on either side
    const plain = defE(C, 3, { [C]: 1 }, defRec());
    expect(joinDef([named, plain], none).value!.displayName).toBe('X'); // at '' < named's
  });

  it('origin and derivedFrom come from the earlier createdAt', () => {
    const early = defE(
      A,
      1,
      { [A]: 1 },
      defRec({ createdAt: '2026-01-01T00:00:00.000Z', origin: 'preset' }),
    );
    const late = defE(
      B,
      2,
      { [B]: 1 },
      defRec({ createdAt: '2026-01-09T00:00:00.000Z', origin: 'user', derivedFrom: 'zz' }),
    );
    const j = joinDef([late, early], none);
    expect(j.value!.origin).toBe('preset');
    expect(j.value!.derivedFrom).toBeUndefined();
  });

  it('unknown keys are kept as a union; the winner-by-HLC wins a clash', () => {
    const a = defE(A, 1, { [A]: 1 }, defRec({ 'x-a': 1, shared: 'from-a' }));
    const b = defE(B, 2, { [B]: 1 }, defRec({ 'x-b': 2, shared: 'from-b' }));
    const v = joinDef([b, a], none).value as unknown as Record<string, unknown>;
    expect(v).toMatchObject({ 'x-a': 1, 'x-b': 2, shared: 'from-b' });
  });

  it('live beats deleted: the join of live and deleted is the live record', () => {
    const live = defE(A, 1, { [A]: 1 }, defRec({ runIds: ['r1'] }));
    const del = defE(B, 9, { [B]: 1 }, null);
    const j = joinDef([del, live], none);
    expect(j.deleted).toBeUndefined();
    expect(j.value!.runIds).toEqual(['r1']);
    expect(j.hlc).toBe(live.hlc);
    expect(j.vv).toEqual({ [A]: 1, [B]: 1 });
    expect(joinDef([del], none).deleted).toBe(true);
  });

  it('is a pure function of the set: every permutation, deep-frozen inputs', () => {
    const set = deepFreeze([
      defE(
        A,
        1,
        { [A]: 1 },
        defRec({
          runIds: ['r2'],
          displayName: 'a',
          displayNameAt: '2026-01-02T00:00:00.000Z',
          'x-u': 1,
        }),
      ),
      defE(
        B,
        2,
        { [B]: 1 },
        defRec({
          runIds: ['r1', 'r2'],
          displayNameAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        }),
      ),
      defE(
        C,
        3,
        { [C]: 1 },
        defRec({
          runIds: ['r5'],
          displayName: 'c',
          displayNameAt: '2026-01-03T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
      defE(D, 4, { [D]: 1 }, null),
    ]);
    const sigs = new Set(perms(set).map((p) => JSON.stringify(joinDef(p, new Set(['r5'])))));
    expect(sigs.size).toBe(1);
    const foldSigs = new Set(perms(set).map((p) => foldSig(foldEntries(p, new Set(['r5'])))));
    expect(foldSigs.size).toBe(1);
    const f = foldEntries(set, new Set(['r5']));
    expect(f.losers).toEqual([]);
    expect((f.winner.value as DefinitionRecord).runIds).toEqual(['r1', 'r2']);
  });

  it('the join hash is the fingerprint of the joined value (updatedAt does not count)', async () => {
    const a = defE(A, 1, { [A]: 1 }, defRec({ runIds: ['r1'] }));
    const b = defE(B, 2, { [B]: 1 }, defRec({ runIds: ['r2'] }));
    const j = joinDef([a, b], none);
    const direct = await entryOf('def', 'd', j.value, j.hlc, undefined, A, 1);
    expect(j.hash).toBe(direct.hash);
  });

  it('a later delete that descends from everything still wins in the fold', () => {
    const a = defE(A, 1, { [A]: 1 }, defRec({ runIds: ['r1'] }));
    const b = defE(B, 2, { [B]: 1 }, defRec({ runIds: ['r2'] }));
    const del = defE(C, 3, { [A]: 1, [B]: 1, [C]: 1 }, null);
    expect(foldEntries([a, b, del], none).winner.deleted).toBe(true);
  });

  it('a def entry of a newer schema is not joined', () => {
    const a = defE(A, 1, { [A]: 1 }, defRec({ runIds: ['r1'] }));
    const b = { ...defE(B, 2, { [B]: 1 }, defRec({ runIds: ['r2'] })), v: 2 } as SyncEntry<'def'>;
    const f = foldEntries([a, b], none);
    expect(f.winner.hash).toBe(b.hash);
  });
});

// ------------------------------------------------------------------ copyOf

describe('copyOf', () => {
  const mk = async (
    kind: 'strategy' | 'layout' | 'group',
    dev: string,
    name: string,
    extra = {},
  ) => {
    const value =
      kind === 'group'
        ? {
            v: 1,
            id: 'big',
            kind: 'compare',
            name,
            runIds: ['r1'],
            createdAt: 'c',
            updatedAt: 'u',
            ...extra,
          }
        : kind === 'layout'
          ? {
              v: 1,
              id: 'big',
              layout: { id: 'big', name, spots: [] },
              hash: 'lh',
              createdAt: 'c',
              updatedAt: 'u',
              origin: 'user',
              ...extra,
            }
          : {
              v: 1,
              id: 'big',
              strategy: { id: 'big', name, unit: 1 },
              hash: 'sh',
              createdAt: 'c',
              updatedAt: 'u',
              ...extra,
            };
    return entryOf(kind, 'big', value as never, hlcOf(5, dev), undefined, dev, 1);
  };
  const mint = (dev: string, n: number) => ({ hlc: hlcOf(50, dev), self: dev, counter: n });

  it('id and name are a pure function of the loser fingerprint (S-A), a fresh entry from the mint', async () => {
    const loser = await mk('group', A, 'Big Martingale');
    const c1 = (await copyOf(loser, none, mint(B, 4)))!;
    const c2 = (await copyOf(loser, none, mint(C, 9)))!;
    const hex6 = loser.hash.slice(0, 6);
    expect(c1.id).toBe(`big-${hex6}`);
    expect(c1.key).toBe(`group:big-${hex6}`);
    expect((c1.value as { name: string }).name).toBe(`Big Martingale (conflict ${hex6})`);
    expect(c1.hash).toBe(c2.hash); // equivalent across devices: they collapse (N3)
    expect(equivalent(c1, c2)).toBe(true);
    expect(c1.basis).toBeNull();
    expect(c1.hlc).toBe(hlcOf(50, B));
    expect(c1.vv).toEqual({ [B]: 4 });
    expect(c2.vv).toEqual({ [C]: 9 });
  });

  it('class representatives that differ only in updatedAt give the same copy', async () => {
    const a = await mk('group', A, 'N');
    const b = await mk('group', B, 'N', { updatedAt: 'later' });
    expect(a.hash).toBe(b.hash);
    const ca = (await copyOf(a, none, mint(C, 1)))!;
    const cb = (await copyOf(b, none, mint(C, 1)))!;
    expect(ca.id).toBe(cb.id);
    expect(ca.hash).toBe(cb.hash);
  });

  it('strategy copy re-keys strategy.id and recomputes hash; layout copy keeps its layout hash', async () => {
    const s = await mk('strategy', A, 'Strat');
    const cs = (await copyOf(s, none, mint(B, 1)))!;
    const sv = cs.value as { id: string; hash: string; strategy: { id: string; name: string } };
    expect(sv.strategy.id).toBe(cs.id);
    expect(sv.id).toBe(cs.id);
    expect(sv.strategy.name).toBe(`Strat (conflict ${s.hash.slice(0, 6)})`);
    expect(sv.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sv.hash).not.toBe('sh');
    const l = await mk('layout', A, 'Lay');
    const cl = (await copyOf(l, none, mint(B, 1)))!;
    const lv = cl.value as { id: string; hash: string; layout: { id: string; name: string } };
    expect(lv.hash).toBe('lh');
    expect(lv.layout.id).toBe(cl.id);
    expect(lv.layout.name).toBe(`Lay (conflict ${l.hash.slice(0, 6)})`);
  });

  it('the name is trimmed so the whole name fits in 80 characters', async () => {
    const loser = await mk('group', A, 'x'.repeat(80));
    const c = (await copyOf(loser, none, mint(B, 1)))!;
    const name = (c.value as { name: string }).name;
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name).toMatch(/ \(conflict [0-9a-f]{6}\)$/);
  });

  it('the id base is at most 33 characters', async () => {
    const loser = await entryOf(
      'group',
      'g'.repeat(60),
      {
        v: 1,
        id: 'g'.repeat(60),
        kind: 'compare',
        name: 'n',
        runIds: [],
        createdAt: 'c',
        updatedAt: 'u',
      },
      hlcOf(1, A),
      undefined,
      A,
      1,
    );
    const c = (await copyOf(loser, none, mint(B, 1)))!;
    expect(c.id).toBe(`${'g'.repeat(33)}-${loser.hash.slice(0, 6)}`);
  });

  it('null when the copy id is taken (live or tombstoned); never for def, setting, run or a tombstone', async () => {
    const loser = await mk('group', A, 'N');
    const id = `big-${loser.hash.slice(0, 6)}`;
    expect(await copyOf(loser, new Set([id]), mint(B, 1))).toBeNull();
    expect(await copyOf(loser, new Set(['other']), mint(B, 1))).not.toBeNull();
    for (const e of [
      defE(A, 1, { [A]: 1 }, defRec()),
      bare('setting', 'framing', A, 1, { [A]: 1 }, 'p'),
      bare('run', 'r', A, 1, { [A]: 1 }, 'p'),
      bare('group', 'big', A, 1, { [A]: 1 }, null),
    ])
      expect(await copyOf(e, none, mint(B, 1))).toBeNull();
  });
});

// ------------------------------------------------------------------ resolve

describe('resolve', () => {
  const rec = (e: SyncEntry, seen?: Record<string, number>): SyncIndexRecord => ({
    key: e.key,
    kind: e.kind,
    entry: e,
    seen: seen ?? e.vv,
    local: 1,
  });

  it('winner is the base entry and there is no candidate: skip-older; seen is joined', () => {
    const base = g(A, 5, { [A]: 3 }, 'v3');
    const old = g(B, 1, { [B]: 1 }, 'old');
    const r = resolve([old, base], rec(base, { [A]: 3, [C]: 7 }), undefined, none);
    expect(r.res.do).toBe('skip-older');
    expect(r.seen).toEqual({ [A]: 3, [B]: 1, [C]: 7 });
  });

  it('a remote descendant of the base: apply, no losers', () => {
    const base = g(A, 5, { [A]: 3 }, 'v3');
    const next = g(B, 6, { [A]: 3, [B]: 1 }, 'next');
    const r = resolve([base, next], rec(base), undefined, none);
    expect(r.res).toMatchObject({ do: 'apply', entry: { hash: 'next' } });
    expect(r.losers).toEqual([]);
  });

  it('no base, no candidate: the remote winner is applied', () => {
    const r = resolve([g(B, 6, { [B]: 1 }, 'x')], undefined, undefined, none);
    expect(r.res.do).toBe('apply');
  });

  it('candidate dominates everything (descends the base): keep-local', () => {
    const base = g(A, 5, { [A]: 3 }, 'v3');
    const remoteOld = g(B, 6, { [A]: 3, [B]: 1 }, 'r');
    const cand = g(A, 9, { [A]: 4, [B]: 1 }, 'mine');
    const r = resolve([remoteOld], rec(base, { [A]: 3, [B]: 1 }), cand, none);
    expect(r.res.do).toBe('keep-local');
    expect(r.losers).toEqual([]);
  });

  it('candidate wins among the maximal: keep-local, the published concurrent entry is a loser', () => {
    const base = g(A, 5, { [A]: 3 }, 'v3');
    const theirs = g(B, 6, { [A]: 3, [B]: 1 }, 'theirs');
    const cand = g(A, 9, { [A]: 4 }, 'mine'); // candidate minted from a stale seen
    const r = resolve([theirs], rec(base, { [A]: 3 }), cand, none);
    expect(r.res.do).toBe('keep-local');
    expect(r.losers.map((l) => l.hash)).toEqual(['theirs']);
  });

  it('candidate loses on HLC: apply the winner; the candidate is a loser (a copy)', () => {
    const base = g(A, 5, { [A]: 3 }, 'v3');
    const theirs = g(B, 20, { [A]: 3, [B]: 1 }, 'theirs');
    const cand = g(A, 9, { [A]: 4 }, 'mine');
    const r = resolve([theirs], rec(base, { [A]: 3 }), cand, none);
    expect(r.res).toMatchObject({ do: 'apply', entry: { hash: 'theirs' } });
    expect(r.losers.map((l) => l.hash)).toEqual(['mine']);
  });

  it('winner equivalent to the candidate and also published: apply the published entry (our edit exists)', () => {
    const base = g(A, 5, { [A]: 3 }, 'v3');
    const pub = g(B, 6, { [A]: 3, [B]: 1 }, 'same');
    const cand = g(A, 9, { [A]: 4 }, 'same');
    const r = resolve([pub], rec(base, { [A]: 3 }), cand, none);
    expect(r.res.do).toBe('apply');
    if (r.res.do === 'apply') {
      expect(r.res.entry.hlc).toBe(pub.hlc);
      expect(r.res.entry.vv).toEqual(pub.vv); // the candidate's counter is not absorbed
    }
  });

  it('an edit survives a concurrent delete (candidate live, remote tombstone)', () => {
    const base = g(A, 5, { [A]: 3 }, 'v3');
    const del = g(B, 99, { [A]: 3, [B]: 1 }, null);
    const cand = g(A, 6, { [A]: 4 }, 'edit');
    const r = resolve([del], rec(base, { [A]: 3 }), cand, none);
    expect(r.res.do).toBe('keep-local');
    expect(r.losers).toEqual([]);
  });

  it('a remote delete that descends the base: apply the tombstone', () => {
    const base = g(A, 5, { [A]: 3 }, 'v3');
    const del = g(B, 6, { [A]: 3, [B]: 1 }, null);
    const r = resolve([del], rec(base), undefined, none);
    expect(r.res).toMatchObject({ do: 'apply', entry: { deleted: true } });
  });

  it('def: concurrent edits join (never a copy)', () => {
    const a = defE(A, 1, { [A]: 1 }, defRec({ runIds: ['r1'] }));
    const b = defE(B, 2, { [B]: 1 }, defRec({ runIds: ['r2'] }));
    const r = resolve([b], rec(a), undefined, none);
    expect(r.res.do).toBe('join');
    expect(r.losers).toEqual([]);
    if (r.res.do === 'join')
      expect((r.res.entry.value as DefinitionRecord).runIds).toEqual(['r1', 'r2']);
  });

  it('def: a local candidate joins with the remote one', () => {
    const base = defE(A, 1, { [A]: 1 }, defRec({ runIds: [] }));
    const theirs = defE(B, 2, { [A]: 1, [B]: 1 }, defRec({ runIds: ['r2'] }));
    const cand = defE(A, 3, { [A]: 2 }, defRec({ runIds: ['r1'] }));
    const r = resolve([theirs], rec(base, { [A]: 1 }), cand, none);
    expect(r.res.do).toBe('join');
    expect(r.losers).toEqual([]);
  });

  it('opaque: a winner with a newer record schema or an unknown kind', () => {
    const base = g(A, 5, { [A]: 3 }, 'v3');
    const newer = { ...g(B, 6, { [A]: 3, [B]: 1 }, 'n'), v: 2 } as SyncEntry;
    const r = resolve([newer], rec(base), undefined, none);
    expect(r.res.do).toBe('opaque');
    const alien = {
      ...g(B, 6, { [B]: 1 }, 'n'),
      kind: 'widget',
      key: 'widget:k',
    } as unknown as SyncEntry;
    expect(resolve([alien], undefined, undefined, none).res.do).toBe('opaque');
  });

  it('a concurrent newer-schema loser is never copied', () => {
    const win = g(B, 9, { [B]: 1 }, 'win');
    const newer = { ...g(A, 1, { [A]: 1 }, 'n'), v: 2 } as SyncEntry;
    const r = resolve([win, newer], undefined, undefined, none);
    expect(r.res.do).toBe('apply');
    expect(r.losers).toEqual([]);
  });

  it('empty input: skip-older', () => {
    expect(resolve([], undefined, undefined, none).res.do).toBe('skip-older');
  });

  it('is independent of the order of the remote entries', () => {
    const base = g(A, 5, { [A]: 3 }, 'v3');
    const rs = [
      g(B, 6, { [A]: 3, [B]: 1 }, 'b'),
      g(C, 7, { [A]: 3, [C]: 1 }, 'c'),
      g(D, 8, { [A]: 3, [D]: 1 }, 'same'),
    ];
    const cand = g(A, 9, { [A]: 4 }, 'same');
    const sigs = new Set(
      perms(rs).map((p) => JSON.stringify(resolve(p, rec(base, { [A]: 3 }), cand, none))),
    );
    expect(sigs.size).toBe(1);
  });
});
