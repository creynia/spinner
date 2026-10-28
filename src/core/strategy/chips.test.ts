/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { describe, expect, it } from 'vitest';
import type { LayoutSpot, StageChips } from '../contracts/layout';
import type { LayoutSpec, ProgressionSpec, Stage, StrategyDefinition } from '../contracts/strategy';
import { makeCtx } from './__fixtures__/stub-ctx';
import {
  adjustSpot,
  chipAmount,
  compileChips,
  isChipPath,
  liftRows,
  progressionBase,
  progressionTop,
  readStageChips,
  recompileStageChips,
  resolveChipValue,
  sameSpots,
  splitStageLayout,
  validateChipLayout,
  validateStageChips,
  withStageChips,
} from './chips';
import { normalizeStrategy } from './normalize';
import { validateStrategy } from './validate';

const spots = (...x: [string, number][]): LayoutSpot[] => x.map(([bet, chips]) => ({ bet, chips }));
const block = (over: Partial<StageChips> = {}): StageChips => ({
  v: 1,
  spots: spots(['a', 5], ['b', 1]),
  chip: 500,
  ...over,
});
const stageOf = (c: StageChips | null, ...manual: LayoutSpec[]): Stage =>
  withStageChips({ id: 's', layout: manual }, c);

describe('chipAmount (§3.3)', () => {
  it.each([
    [3, 500, 1500],
    [1, 100, 100],
    [3, { units: 1 }, { units: 3 }],
    [1, { units: 1 }, { units: 1 }],
    [1, { prog: 'm' }, { prog: 'm' }],
    [3, { prog: 'm' }, { times: [3, { prog: 'm' }] }],
  ] as const)('%s chips of %j', (n, chip, want) => {
    expect(chipAmount(n, chip as any)).toEqual(want);
  });
});

describe('compileChips', () => {
  it('writes one row per spot in spot order', () => {
    expect(compileChips(block())).toEqual([
      { bet: 'a', amount: 2500 },
      { bet: 'b', amount: 500 },
    ]);
    expect(compileChips(block({ chip: { prog: 'm' } }))).toEqual([
      { bet: 'a', amount: { times: [5, { prog: 'm' }] } },
      { bet: 'b', amount: { prog: 'm' } },
    ]);
  });
});

describe('readStageChips', () => {
  it('reads a valid block as a copy', () => {
    const b = block({ from: { id: 'x', hash: 'h', name: 'X', builtin: true } });
    const r = readStageChips({ id: 's', 'x-chips': b });
    expect(r).toEqual(b);
    expect(r).not.toBe(b);
  });
  it.each([
    ['absent', { id: 's' }],
    ['not an object', { 'x-chips': 5 }],
    ['wrong v', { 'x-chips': { ...block(), v: 2 } }],
    ['no spots', { 'x-chips': { ...block(), spots: [] } }],
    [
      '65 spots',
      {
        'x-chips': {
          ...block(),
          spots: Array.from({ length: 65 }, (_, i) => ({ bet: `b${i}`, chips: 1 })),
        },
      },
    ],
    ['0 chips', { 'x-chips': { ...block(), spots: spots(['a', 0]) } }],
    ['1001 chips', { 'x-chips': { ...block(), spots: spots(['a', 1001]) } }],
    ['fractional chips', { 'x-chips': { ...block(), spots: spots(['a', 1.5]) } }],
    ['bad chip 0', { 'x-chips': { ...block(), chip: 0 } }],
    ['bad chip units 2', { 'x-chips': { ...block(), chip: { units: 2 } } }],
    ['bad chip prog slug', { 'x-chips': { ...block(), chip: { prog: 'Bad Slug' } } }],
    ['bad from', { 'x-chips': { ...block(), from: { id: 'x' } } }],
    [
      'bad builtin',
      { 'x-chips': { ...block(), from: { id: 'x', hash: 'h', name: 'n', builtin: false } } },
    ],
  ])('%s gives null', (_n, stage) => {
    expect(readStageChips(stage)).toBeNull();
  });
  it('null for a non-object', () => {
    expect(readStageChips(null)).toBeNull();
    expect(readStageChips('x')).toBeNull();
  });
});

describe('splitStageLayout and withStageChips', () => {
  it('a stage without chips is all manual', () => {
    const rows: LayoutSpec[] = [{ bet: 'a', amount: 1 }];
    expect(splitStageLayout({ id: 's', layout: rows })).toEqual({
      chips: null,
      manual: rows,
      stale: false,
    });
    expect(splitStageLayout({ id: 's' })).toEqual({ chips: null, manual: [], stale: false });
  });
  it('splits the generated prefix from the manual rows', () => {
    const extra: LayoutSpec = { bet: 'c', amount: { units: 1 }, when: { always: true } };
    const st = stageOf(block(), extra);
    expect(st.layout).toHaveLength(3);
    const r = splitStageLayout(st);
    expect(r.stale).toBe(false);
    expect(r.manual).toEqual([extra]);
    expect(r.chips).toEqual(block());
  });
  it('detects a changed amount, a missing row and a reordered row as stale', () => {
    const st = stageOf(block());
    const edited: Stage = { ...st, layout: [{ bet: 'a', amount: 2501 }, (st.layout as any)[1]] };
    const short: Stage = { ...st, layout: [(st.layout as any)[0]] };
    const swapped: Stage = { ...st, layout: [(st.layout as any)[1], (st.layout as any)[0]] };
    for (const s of [edited, short, swapped]) {
      const r = splitStageLayout(s);
      expect(r.stale).toBe(true);
      expect(r.manual).toEqual(s.layout);
    }
  });
  it('is insensitive to key order in rows', () => {
    const st = stageOf(block());
    const rows = (st.layout as any[]).map((r) => ({ amount: r.amount, bet: r.bet }));
    expect(splitStageLayout({ ...st, layout: rows }).stale).toBe(false);
  });
  it('malformed x-chips is treated as plain rows', () => {
    const st = { id: 's', 'x-chips': { v: 9 }, layout: [{ bet: 'a', amount: 1 }] } as Stage;
    expect(splitStageLayout(st)).toEqual({ chips: null, manual: st.layout, stale: false });
  });
  it('withStageChips keeps manual rows, replaces the prefix, and does not mutate', () => {
    const extra: LayoutSpec = { bet: 'c', amount: 100 };
    const st = stageOf(block(), extra);
    const frozen = JSON.stringify(st);
    const next = withStageChips(st, block({ spots: spots(['z', 2]), chip: { units: 1 } }));
    expect(JSON.stringify(st)).toBe(frozen);
    expect(next.layout).toEqual([{ bet: 'z', amount: { units: 2 } }, extra]);
    expect((next as any)['x-chips'].chip).toEqual({ units: 1 });
    expect(next.id).toBe('s');
  });
  it('null removes the block and the generated rows, keeping manual ones', () => {
    const extra: LayoutSpec = { bet: 'c', amount: 100 };
    const next = withStageChips(stageOf(block(), extra), null);
    expect('x-chips' in next).toBe(false);
    expect(next.layout).toEqual([extra]);
  });
  it('null on a plain stage without layout adds nothing', () => {
    expect(withStageChips({ id: 's' }, null)).toEqual({ id: 's' });
  });
  it('lifts in place when the rows already are the generated prefix', () => {
    const rows: LayoutSpec[] = [
      { bet: 'a', amount: { units: 2 } },
      { bet: 'z', amount: 1, when: { always: true } },
    ];
    const chips = liftRows(rows) as StageChips;
    expect(chips.spots).toEqual(spots(['a', 2]));
    const next = withStageChips({ id: 's', layout: rows }, chips);
    expect(next.layout).toEqual(rows);
    expect(splitStageLayout(next)).toMatchObject({ stale: false, manual: [rows[1]] });
    // rows that do not match are kept as manual rows after the new prefix
    expect(withStageChips({ id: 's', layout: rows }, block()).layout).toHaveLength(4);
  });
  it('a stale stage keeps every row as manual when rebuilt, and keeps them on forget', () => {
    const stale: Stage = { ...stageOf(block()), layout: [{ bet: 'a', amount: 7 }] };
    const rebuilt = withStageChips(stale, block());
    expect(rebuilt.layout).toEqual([...compileChips(block()), { bet: 'a', amount: 7 }]);
    const forgot = withStageChips(stale, null);
    expect(forgot.layout).toEqual([{ bet: 'a', amount: 7 }]);
    expect('x-chips' in forgot).toBe(false);
  });
});

describe('liftRows', () => {
  const r = (bet: string, amount: any, extra: object = {}): LayoutSpec => ({
    bet,
    amount,
    ...extra,
  });
  it('lifts unit rows', () => {
    expect(liftRows([r('a', { units: 14 }), r('b', { units: 1 })])).toEqual({
      v: 1,
      spots: spots(['a', 14], ['b', 1]),
      chip: { units: 1 },
    });
  });
  it('lifts one progression, with and without times', () => {
    expect(liftRows([r('a', { prog: 'm' }), r('b', { times: [3, { prog: 'm' }] })])).toEqual({
      v: 1,
      spots: spots(['a', 1], ['b', 3]),
      chip: { prog: 'm' },
    });
  });
  it('lifts literals only with a numeric chip, keeping it', () => {
    const rows = [r('a', 1500), r('b', 500)];
    expect(liftRows(rows)).toBeNull();
    expect(liftRows(rows, 500)).toEqual({ v: 1, spots: spots(['a', 3], ['b', 1]), chip: 500 });
  });
  it('stops at the first row that does not fit', () => {
    const rows = [
      r('a', { units: 1 }),
      r('b', { units: 2 }),
      r('c', { prog: 'm' }), // another form
      r('d', { units: 1 }),
    ];
    expect(liftRows(rows)?.spots).toEqual(spots(['a', 1], ['b', 2]));
  });
  it.each([
    ['when', { when: { always: true } }],
    ['parent', { parent: 'z' }],
    ['working', { working: 'off' }],
    ['label', { label: 'x' }],
    ['x- key', { 'x-note': 1 }],
  ])('rejects a row with %s', (_n, extra) => {
    expect(liftRows([r('a', { units: 1 }, extra)])).toBeNull();
  });
  it.each([
    ['keepOr', { keepOr: { units: 1 } }],
    ['units 0', { units: 0 }],
    ['units 1.5', { units: 1.5 }],
    ['units 1001', { units: 1001 }],
    ['times 1', { times: [1, { prog: 'm' }] }],
    ['times of units', { times: [2, { units: 1 }] }],
    ['two prog', { add: [{ prog: 'm' }, 1] }],
    ['literal off the denomination', 501],
    ['zero literal', 0],
  ])('does not lift %s', (_n, amount) => {
    expect(liftRows([r('a', amount)], 500)).toBeNull();
  });
  it('stops at a duplicate bet and at 64 spots', () => {
    expect(liftRows([r('a', { units: 1 }), r('a', { units: 2 })])?.spots).toHaveLength(1);
    const many = Array.from({ length: 70 }, (_, i) => r(`b${i}`, { units: 1 }));
    expect(liftRows(many)?.spots).toHaveLength(64);
  });
  it('an empty or non-qualifying list gives null', () => {
    expect(liftRows([])).toBeNull();
    expect(liftRows([r('a', 'net' as any)])).toBeNull();
  });
  it('a different progression ends the prefix', () => {
    expect(liftRows([r('a', { prog: 'm' }), r('b', { prog: 'n' })])?.spots).toHaveLength(1);
  });
});

describe('lift and compile laws (500 random layouts)', () => {
  // mulberry32: deterministic, no dependency on the app RNG
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  it('compile ∘ lift = rows and lift ∘ compile = id', () => {
    const rand = rng(20261028);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let i = 0; i < 500; i++) {
      const n = int(1, 64);
      const sp = Array.from({ length: n }, (_, j) => ({
        bet: `bet${j}`,
        chips: rand() < 0.2 ? int(1, 1000) : int(1, 20),
      }));
      const chip: any = [int(1, 100000), { units: 1 }, { prog: 'm' }][int(0, 2)];
      const c: StageChips = { v: 1, spots: sp, chip };
      const rows = compileChips(c);
      const lifted = liftRows(rows, typeof chip === 'number' ? chip : undefined);
      expect(lifted).toEqual(c);
      expect(compileChips(lifted as StageChips)).toEqual(rows);
    }
  });
});

describe('adjustSpot', () => {
  it('adds a new spot at the end, then stacks', () => {
    let r = adjustSpot(spots(['a', 1]), 'b', 2);
    expect(r).toEqual({ spots: spots(['a', 1], ['b', 2]) });
    r = adjustSpot(r.spots, 'a', 3);
    expect(r.spots).toEqual(spots(['a', 4], ['b', 2]));
  });
  it('removes chips and drops the spot at zero', () => {
    expect(adjustSpot(spots(['a', 3], ['b', 1]), 'a', -1).spots).toEqual(spots(['a', 2], ['b', 1]));
    expect(adjustSpot(spots(['a', 1], ['b', 1]), 'a', -1).spots).toEqual(spots(['b', 1]));
    expect(adjustSpot(spots(['a', 2], ['b', 1]), 'a', -5).spots).toEqual(spots(['b', 1]));
  });
  it('removing from an absent spot is refused', () => {
    const input = spots(['a', 1]);
    const r = adjustSpot(input, 'z', -1);
    expect(r.refused).toBe('none-to-remove');
    expect(r.spots).toEqual(input);
  });
  it('refuses past the chip limit, new or existing', () => {
    expect(adjustSpot(spots(['a', 1000]), 'a', 1).refused).toBe('max-chips');
    expect(adjustSpot(spots(['a', 3]), 'a', 1, { maxChips: 3 }).refused).toBe('max-chips');
    expect(adjustSpot([], 'a', 9, { maxChips: 8 }).refused).toBe('max-chips');
    expect(adjustSpot(spots(['a', 3]), 'a', 1, { maxChips: 4 }).spots).toEqual(spots(['a', 4]));
  });
  it('refuses a 65th spot but still allows stacking on a full layout', () => {
    const full = Array.from({ length: 64 }, (_, i) => ({ bet: `b${i}`, chips: 1 }));
    const r = adjustSpot(full, 'new', 1);
    expect(r.refused).toBe('max-spots');
    expect(r.spots).toEqual(full);
    expect(adjustSpot(full, 'b0', 1).spots[0]).toEqual({ bet: 'b0', chips: 2 });
    expect(adjustSpot(spots(['a', 1]), 'b', 1, { maxSpots: 1 }).refused).toBe('max-spots');
  });
  it('never mutates its input and treats 0 or fractions as no-ops', () => {
    const input = spots(['a', 1]);
    const copy = JSON.stringify(input);
    adjustSpot(input, 'a', 2);
    adjustSpot(input, 'a', -1);
    expect(JSON.stringify(input)).toBe(copy);
    expect(adjustSpot(input, 'a', 0)).toEqual({ spots: input });
    expect(adjustSpot(input, 'a', 0.5)).toEqual({ spots: input });
  });
  it('call-bet steps: a tap of 9 chips on voisins', () => {
    const r = adjustSpot([], 'voisins', 9);
    expect(r.spots).toEqual(spots(['voisins', 9]));
    expect(adjustSpot(r.spots, 'voisins', -9).spots).toEqual([]);
  });
});

describe('sameSpots', () => {
  it('ignores order but not chips or bets', () => {
    expect(sameSpots(spots(['a', 1], ['b', 2]), spots(['b', 2], ['a', 1]))).toBe(true);
    expect(sameSpots(spots(['a', 1]), spots(['a', 2]))).toBe(false);
    expect(sameSpots(spots(['a', 1]), spots(['b', 1]))).toBe(false);
    expect(sameSpots(spots(['a', 1]), spots(['a', 1], ['b', 1]))).toBe(false);
    expect(sameSpots([], [])).toBe(true);
  });
});

describe('validateChipLayout', () => {
  const ctx = makeCtx();
  const good = () => ({
    schema: 1,
    id: 'my-layout',
    name: 'Mine',
    game: 'stub',
    variant: 'european',
    spots: spots(['a', 2], ['b', 1]),
  });
  const codes = (x: unknown, c: any = ctx) =>
    validateChipLayout(x, c).map((d) => `${d.code} ${d.path}`);

  it('accepts a good layout with and without a context', () => {
    expect(codes(good())).toEqual([]);
    expect(codes(good(), null)).toEqual([]);
  });
  it('E_LAYOUT_SCHEMA for a non-object, bad schema, newer schema, id, name, notes, tags, game, variant', () => {
    expect(codes(5)).toEqual(['E_LAYOUT_SCHEMA ']);
    expect(codes({ ...good(), schema: undefined })).toEqual(['E_LAYOUT_SCHEMA /schema']);
    const newer = validateChipLayout({ ...good(), schema: 2 }, ctx);
    expect(newer[0]?.message).toMatch(/newer version/);
    expect(codes({ ...good(), id: 'Bad Id' })).toEqual(['E_LAYOUT_SCHEMA /id']);
    expect(codes({ ...good(), name: '' })).toEqual(['E_LAYOUT_SCHEMA /name']);
    expect(codes({ ...good(), name: 'x'.repeat(81) })).toEqual(['E_LAYOUT_SCHEMA /name']);
    expect(codes({ ...good(), name: 'x'.repeat(80) })).toEqual([]);
    expect(codes({ ...good(), notes: 'x'.repeat(4001) })).toEqual(['E_LAYOUT_SCHEMA /notes']);
    expect(codes({ ...good(), tags: Array(17).fill('t') })).toEqual(['E_LAYOUT_SCHEMA /tags']);
    expect(codes({ ...good(), tags: ['Bad'] })).toEqual(['E_LAYOUT_SCHEMA /tags']);
    expect(codes({ ...good(), game: 'other' })).toEqual(['E_LAYOUT_SCHEMA /game']);
    expect(codes({ ...good(), game: 'other' }, null)).toEqual([]);
    expect(codes({ ...good(), variant: undefined })).toEqual(['E_LAYOUT_SCHEMA /variant']);
  });
  it('E_LAYOUT_SPOTS for none, too many, or not a list', () => {
    expect(codes({ ...good(), spots: [] })).toEqual(['E_LAYOUT_SPOTS /spots']);
    expect(codes({ ...good(), spots: 'x' })).toEqual(['E_LAYOUT_SPOTS /spots']);
    const many = Array.from({ length: 65 }, () => ({ bet: 'a', chips: 1 }));
    expect(codes({ ...good(), spots: many }, null)).toContain('E_LAYOUT_SPOTS /spots');
    const ok = Array.from({ length: 64 }, (_, i) => ({ bet: `b${i}`, chips: 1 }));
    expect(codes({ ...good(), spots: ok }, null)).toEqual([]);
  });
  it('E_LAYOUT_CHIPS for 0, 1001, fractions and non-numbers', () => {
    for (const chips of [0, 1001, 1.5, '3', null]) {
      expect(codes({ ...good(), spots: [{ bet: 'a', chips }] })).toEqual([
        'E_LAYOUT_CHIPS /spots/0/chips',
      ]);
    }
    expect(codes({ ...good(), spots: spots(['a', 1000]) })).toEqual([]);
  });
  it('E_LAYOUT_DUP_BET on the second occurrence, also through an alias', () => {
    expect(codes({ ...good(), spots: spots(['a', 1], ['b', 1], ['a', 2]) })).toEqual([
      'E_LAYOUT_DUP_BET /spots/2/bet',
    ]);
    const c = codes({ ...good(), spots: spots(['a', 1], ['A', 2]) });
    expect(c).toEqual(['W_LAYOUT_ALIAS /spots/1/bet', 'E_LAYOUT_DUP_BET /spots/1/bet']);
  });
  it('E_UNKNOWN_BET with the spot path', () => {
    expect(codes({ ...good(), spots: spots(['a', 1], ['zzz', 1]) })).toEqual([
      'E_UNKNOWN_BET /spots/1/bet',
    ]);
    expect(codes({ ...good(), spots: spots(['zzz', 1]) }, null)).toEqual([]);
  });
  it('E_BET_UNAVAILABLE when the parser accepts a bet the catalog lacks', () => {
    const c = makeCtx({ parseBet: (id) => (id === 'ghost' ? 'ghost' : id) });
    expect(codes({ ...good(), spots: spots(['a', 1], ['ghost', 1]) }, c)).toEqual([
      'E_BET_UNAVAILABLE /spots/1/bet',
    ]);
  });
  it('W_LAYOUT_ALIAS rewrites to canonical and warns', () => {
    const d = validateChipLayout({ ...good(), spots: spots(['A', 1]) }, ctx);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      code: 'W_LAYOUT_ALIAS',
      severity: 'warning',
      path: '/spots/0/bet',
      params: { value: 'A', canonical: 'a' },
    });
    expect(d[0]?.message).toContain('a');
  });
  it('does not report table minimums or maximums', () => {
    expect(codes({ ...good(), spots: spots(['in1', 1]) })).toEqual([]);
  });
  it('a non-object spot is a schema error at its path', () => {
    expect(codes({ ...good(), spots: [5] })).toEqual(['E_LAYOUT_SCHEMA /spots/0']);
    expect(codes({ ...good(), spots: [{ chips: 1 }] })).toEqual(['E_LAYOUT_SCHEMA /spots/0/bet']);
  });
});

describe('validateStageChips', () => {
  const def = (...stages: unknown[]): StrategyDefinition =>
    ({
      schema: 1,
      id: 'd',
      name: 'D',
      game: 'stub',
      unit: 2500,
      stages,
    }) as unknown as StrategyDefinition;
  it('is empty for plain stages and fresh chips', () => {
    expect(validateStageChips(def({ id: 'a', layout: [] }, stageOf(block())))).toEqual([]);
    expect(validateStageChips(def())).toEqual([]);
  });
  it('E_CHIPS_SHAPE for a malformed block', () => {
    const d = validateStageChips(def({ id: 'a' }, { id: 'b', 'x-chips': { v: 1 } }));
    expect(d.map((x) => `${x.code} ${x.path} ${x.severity}`)).toEqual([
      'E_CHIPS_SHAPE /stages/1/x-chips error',
    ]);
  });
  it('W_CHIPS_STALE when the prefix differs', () => {
    const st = { ...stageOf(block()), layout: [{ bet: 'a', amount: 1 }] };
    const d = validateStageChips(def(st));
    expect(d.map((x) => `${x.code} ${x.path} ${x.severity}`)).toEqual([
      'W_CHIPS_STALE /stages/0/x-chips warning',
    ]);
  });
  it('W_CHIPS_SHADOWED for a manual row on a chip spot, at its layout index', () => {
    const st = stageOf(block(), { bet: 'c', amount: 1 }, { bet: 'b', amount: 7 });
    const d = validateStageChips(def({ id: 'x' }, st));
    expect(d.map((x) => `${x.code} ${x.path}`)).toEqual(['W_CHIPS_SHADOWED /stages/1/layout/3']);
    expect(d[0]?.params).toEqual({ value: 'b' });
  });
  it('its output does not disturb the real validator', () => {
    const d = def(stageOf(block({ spots: spots(['a', 1]), chip: 2500 })));
    expect(validateStrategy(d, makeCtx()).filter((x) => x.severity === 'error')).toEqual([]);
  });
});

describe('progression top and base (§7.4, §7.7)', () => {
  const U = 2500;
  const top = (s: object) => progressionTop({ track: 'round', ...s } as ProgressionSpec, U);
  const base = (s: object) => progressionBase({ track: 'round', ...s } as ProgressionSpec, U);

  it.each([
    ['flat', { kind: 'flat' }, 1],
    ['martingale L=6', { kind: 'martingale', maxSteps: 6, onCap: 'reset' }, 32],
    ['martingale L=4 m=3', { kind: 'martingale', maxSteps: 4, multiplier: 3, onCap: 'reset' }, 27],
    ['grand-martingale L=6', { kind: 'grand-martingale', maxSteps: 6, onCap: 'reset' }, 63],
    ['fibonacci L=12', { kind: 'fibonacci', maxSteps: 12 }, 144],
    ['fibonacci default 20', { kind: 'fibonacci' }, 6765],
    ['fibonacci L=1', { kind: 'fibonacci', maxSteps: 1 }, 1],
    ['fibonacci L=2', { kind: 'fibonacci', maxSteps: 2 }, 1],
    ['fibonacci L=3', { kind: 'fibonacci', maxSteps: 3 }, 2],
    ['dalembert default 50', { kind: 'dalembert' }, 50],
    ['dalembert step 2 units, 5', { kind: 'dalembert', maxSteps: 5, step: { units: 2 } }, 9],
    ['paroli L=3', { kind: 'paroli', maxSteps: 3 }, 4],
    ['paroli m=3 L=4', { kind: 'paroli', maxSteps: 4, multiplier: 3 }, 27],
    ['1-3-2-6', { kind: '1-3-2-6' }, 6],
    ['oscars-grind default', { kind: 'oscars-grind' }, 20],
    ['oscars-grind 7', { kind: 'oscars-grind', maxSteps: 7 }, 7],
  ])('%s tops at %s units', (_n, spec, units) => {
    expect(top(spec)).toBe(units * U);
    expect(base(spec)).toBe(U);
  });
  it('sequence: max of constant amounts, base is the first', () => {
    const s = {
      kind: 'sequence',
      amounts: [{ units: 1 }, { units: 3 }, 100, { units: 2 }],
      onWin: 'reset',
      onLoss: 'advance',
    };
    expect(top(s)).toBe(7500);
    expect(base(s)).toBe(2500);
    expect(top({ ...s, amounts: [{ units: 1 }, { var: 'x' }] })).toBeNull();
    expect(base({ ...s, amounts: [{ var: 'x' }, 1] })).toBeNull();
  });
  it('labouchere has a base but no top', () => {
    const s = { kind: 'labouchere', line: [1, 2, 3, 4], base: 500 };
    expect(top(s)).toBeNull();
    expect(base(s)).toBe(500);
  });
  it('a literal, unit or expression base scales the top', () => {
    const m = { kind: 'martingale', maxSteps: 6, onCap: 'reset' };
    expect(top({ ...m, base: 500 })).toBe(16000);
    expect(top({ ...m, base: { units: 2 } })).toBe(32 * 5000);
    expect(top({ ...m, base: { times: [2, 500] } })).toBe(32000);
    expect(base({ ...m, base: { times: [2, 500] } })).toBe(1000);
  });
  it('formula bases give null', () => {
    const m = { kind: 'martingale', maxSteps: 6, onCap: 'reset', base: { pctOfBankroll: 2 } };
    expect(top(m)).toBeNull();
    expect(base(m)).toBeNull();
    expect(top({ kind: 'dalembert', step: { var: 'x' } })).toBeNull();
  });
  it('a malformed maxSteps gives null instead of throwing', () => {
    expect(top({ kind: 'martingale', maxSteps: 99, onCap: 'reset' })).toBeNull();
    expect(top({ kind: 'martingale', onCap: 'reset' })).toBeNull();
  });
  it('a constant maxAmount stops the top at the last level below it; level 0 always counts', () => {
    const m = { kind: 'martingale', maxSteps: 6, onCap: 'stay' };
    expect(top({ ...m, maxAmount: { units: 10 } })).toBe(8 * U);
    expect(top({ ...m, maxAmount: { units: 32 } })).toBe(32 * U);
    expect(top({ ...m, maxAmount: 1 })).toBe(U);
    expect(top({ ...m, maxAmount: { pctOfBankroll: 5 } })).toBeNull();
  });

  // The validator computes the same number for W_PROG_ABOVE_TABLE_MAX: the warning fires exactly
  // when progressionTop is above the table maximum (except flat, which the validator does not size).
  const specs: [string, ProgressionSpec][] = [
    ['martingale', { kind: 'martingale', maxSteps: 7, onCap: 'reset', track: 'a' }],
    [
      'martingale m=3',
      { kind: 'martingale', maxSteps: 5, multiplier: 3, onCap: 'stay', track: 'a' },
    ],
    ['grand', { kind: 'grand-martingale', maxSteps: 6, onCap: 'reset', track: 'a' }],
    ['fibonacci', { kind: 'fibonacci', maxSteps: 14, track: 'a' }],
    ['dalembert', { kind: 'dalembert', maxSteps: 30, step: { units: 2 }, track: 'a' }],
    ['paroli', { kind: 'paroli', maxSteps: 6, track: 'a' }],
    ['1-3-2-6', { kind: '1-3-2-6', track: 'a' }],
    ['oscars', { kind: 'oscars-grind', maxSteps: 12, track: 'a' }],
    [
      'sequence',
      {
        kind: 'sequence',
        amounts: [{ units: 1 }, { units: 9 }, 12345],
        onWin: 'reset',
        onLoss: 'advance',
        track: 'a',
      },
    ],
    ['literal base', { kind: 'martingale', maxSteps: 6, onCap: 'reset', base: 700, track: 'a' }],
  ];
  it.each(specs)('cross-check against the validator: %s', (_n, spec) => {
    const t = progressionTop(spec, U) as number;
    expect(t).toBeGreaterThan(0);
    const warnsAt = (max: number) => {
      const c = makeCtx({ limits: (b: string) => (b === 'a' ? { min: 100, max } : null) });
      const d = {
        schema: 1,
        id: 't',
        name: 'T',
        game: 'stub',
        unit: U,
        progressions: { p: spec },
        stages: [{ id: 's', layout: [{ bet: 'a', amount: { prog: 'p' } }] }],
      };
      return validateStrategy(d, c).some((x) => x.code === 'W_PROG_ABOVE_TABLE_MAX');
    };
    expect(warnsAt(t)).toBe(false);
    expect(warnsAt(t - 1)).toBe(true);
    expect(warnsAt(t + 1)).toBe(false);
  });
});

describe('resolveChipValue', () => {
  const progressions: Record<string, ProgressionSpec> = {
    m: { kind: 'martingale', maxSteps: 6, onCap: 'reset', track: 'round', base: 500 },
    l: { kind: 'labouchere', line: [1, 2], track: 'round', base: 300 },
    f: {
      kind: 'martingale',
      maxSteps: 3,
      onCap: 'reset',
      track: 'round',
      base: { pctOfBankroll: 2 },
    },
    u: { kind: 'flat' },
  };
  it('a literal', () =>
    expect(resolveChipValue(500, { unit: 2500 })).toEqual({ base: 500, top: 500 }));
  it('the unit', () =>
    expect(resolveChipValue({ units: 1 }, { unit: 2500 })).toEqual({ base: 2500, top: 2500 }));
  it('a progression', () => {
    expect(resolveChipValue({ prog: 'm' }, { unit: 2500, progressions })).toEqual({
      base: 500,
      top: 16000,
    });
    expect(resolveChipValue({ prog: 'u' }, { unit: 2500, progressions })).toEqual({
      base: 2500,
      top: 2500,
    });
  });
  it('labouchere has a base only', () => {
    expect(resolveChipValue({ prog: 'l' }, { unit: 2500, progressions })).toEqual({
      base: 300,
      top: null,
    });
  });
  it('a formula base, an unknown progression and an inherited key give nulls', () => {
    const nulls = { base: null, top: null };
    expect(resolveChipValue({ prog: 'f' }, { unit: 2500, progressions })).toEqual(nulls);
    expect(resolveChipValue({ prog: 'nope' }, { unit: 2500, progressions })).toEqual(nulls);
    expect(resolveChipValue({ prog: 'm' }, { unit: 2500 })).toEqual(nulls);
    expect(resolveChipValue({ prog: 'constructor' }, { unit: 2500, progressions })).toEqual(nulls);
  });
});

describe('isChipPath', () => {
  it('matches only the chip leaf of a stage', () => {
    expect(isChipPath('/strategy/stages/0/x-chips/chip')).toEqual({ stage: 0 });
    expect(isChipPath('/strategy/stages/12/x-chips/chip')).toEqual({ stage: 12 });
    for (const p of [
      '/strategy/stages/01/x-chips/chip',
      '/strategy/stages/-1/x-chips/chip',
      '/strategy/stages/0/x-chips/spots',
      '/strategy/stages/0/x-chips/chip/units',
      '/strategy/stages/0/x-chips',
      '/stages/0/x-chips/chip',
      '/strategy/stages/a/x-chips/chip',
      '',
    ])
      expect(isChipPath(p)).toBeNull();
  });
});

describe('recompileStageChips', () => {
  const def = (): StrategyDefinition =>
    ({
      schema: 1,
      id: 'd',
      name: 'D',
      game: 'stub',
      unit: 2500,
      stages: [
        { id: 'p', layout: [{ bet: 'z', amount: 1 }] },
        stageOf(block(), { bet: 'c', amount: 9, when: { always: true } }),
      ],
    }) as unknown as StrategyDefinition;
  it('regenerates the prefix after the chip value changed, keeping manual rows', () => {
    const d = def();
    (d.stages[1] as any)['x-chips'].chip = 1000;
    const frozen = JSON.stringify(d);
    const r = recompileStageChips(d, 1);
    expect(JSON.stringify(d)).toBe(frozen);
    expect(r.stages[1]?.layout).toEqual([
      { bet: 'a', amount: 5000 },
      { bet: 'b', amount: 1000 },
      { bet: 'c', amount: 9, when: { always: true } },
    ]);
    expect(r.stages[0]).toBe(d.stages[0]);
    expect(splitStageLayout(r.stages[1] as Stage).stale).toBe(false);
  });
  it('is the identity for stages without valid chips or out of range', () => {
    const d = def();
    expect(recompileStageChips(d, 0)).toBe(d);
    expect(recompileStageChips(d, 9)).toBe(d);
    (d.stages[1] as any)['x-chips'].chip = 0;
    expect(recompileStageChips(d, 1)).toBe(d);
  });
});

describe('normalizeStrategy keeps x-chips on a stage', () => {
  it('is preserved and still validates', () => {
    const st = stageOf(block({ spots: spots(['a', 1]), chip: { units: 1 } }));
    const d: StrategyDefinition = {
      schema: 1,
      id: 'd',
      name: 'D',
      game: 'stub',
      unit: 2500,
      stages: [st],
    };
    const n = normalizeStrategy(d);
    expect((n.stages[0] as any)['x-chips']).toEqual((st as any)['x-chips']);
    expect(splitStageLayout(n.stages[0] as Stage).stale).toBe(false);
  });
});
