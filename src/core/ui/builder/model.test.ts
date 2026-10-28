import { describe, expect, it } from 'vitest';
import type { StrategyDefinition } from '../../contracts/strategy';
import { normalizeStrategy } from '../../strategy';
import { fromJson, toJson } from './model';

describe('builder model', () => {
  it('keeps x- keys, empty optional arrays and odd conditions through the round trip', () => {
    const d = {
      schema: 1,
      id: 'x',
      name: 'x',
      game: 'roulette',
      unit: 2500,
      'x-note': { a: 1 },
      stages: [
        {
          id: 'a',
          layout: [],
          onEnter: [],
          'x-pos': 3,
          rules: [
            { when: { any: [] }, then: [{ stop: 'done' }], 'x-r': true },
            {
              when: {
                all: [{ all: [{ onTable: 'red' }, { everyN: 3 }] }, { not: { onTable: 'black' } }],
              },
              then: [{ skipRound: true }],
            },
          ],
        },
      ],
    } as unknown as StrategyDefinition;
    expect(toJson(fromJson(d))).toEqual(normalizeStrategy(d));
    const m = fromJson(d);
    expect(fromJson(toJson(m))).toEqual(m);
  });
});

// ---------------------------------------------------------------- chips (layouts.md §7.1)

import { compileChips, readStageChips, splitStageLayout } from '../../strategy';
import {
  emptyStrategy,
  forgetChips,
  generatedCount,
  liftCard,
  liftableChips,
  liftsAll,
  rebuildStale,
  setCardChips,
} from './model';
import type { StageChips } from '../../contracts/layout';

const BLOCK: StageChips = {
  v: 1,
  chip: 500,
  spots: [
    { bet: 'red', chips: 5 },
    { bet: 'corner:1-2-4-5', chips: 1 },
  ],
  from: { id: 'cr', hash: 'abc', name: 'Corners and red' },
};
const stageDoc = (stage: Record<string, unknown>, extra: Record<string, unknown>[] = []) =>
  ({
    schema: 1,
    id: 'x',
    name: 'x',
    game: 'roulette',
    unit: 2500,
    progressions: { m: { kind: 'martingale', track: 'round', base: 500, maxSteps: 4 } },
    stages: [{ id: 'play', ...stage }, ...extra],
  }) as unknown as StrategyDefinition;
const manual = { bet: 'dozen:3', amount: { units: 1 }, when: { cmp: ['net', '<', 0] } };
const withBlock = (layoutTail: unknown[] = []) =>
  stageDoc({ 'x-chips': BLOCK, layout: [...compileChips(BLOCK), ...layoutTail] });

describe('builder model with x-chips', () => {
  const laws = (d: StrategyDefinition) => {
    expect(toJson(fromJson(d))).toEqual(normalizeStrategy(d));
    const m = fromJson(d);
    expect(fromJson(toJson(m))).toEqual(m);
    return m;
  };

  it('holds the laws for a fresh stage: the prefix leaves the model, manual rows stay', () => {
    const m = laws(withBlock([manual]));
    const s = m.stages[0]!;
    expect(s.chips).toEqual(BLOCK);
    expect(s.chipsStale).toBe(false);
    expect(s.layout).toHaveLength(1);
    expect(s.layout[0]!.bet).toBe('dozen:3');
    expect(generatedCount(s)).toBe(2);
    expect('x-chips' in s.extra).toBe(false);
  });

  it('holds the laws for a stale stage and writes every row back verbatim', () => {
    const rows = [{ bet: 'red', amount: 9999 }, { bet: 'black', amount: 100 }, manual];
    const d = stageDoc({ 'x-chips': BLOCK, layout: rows });
    const m = laws(d);
    expect(m.stages[0]!.chipsStale).toBe(true);
    expect(m.stages[0]!.layout).toHaveLength(3);
    const out = toJson(m).stages[0]! as unknown as Record<string, unknown>;
    expect(out.layout).toEqual(normalizeStrategy(d).stages[0]!.layout);
    expect(out['x-chips']).toEqual(BLOCK);
  });

  it('does not swallow a manual row that equals a generated one (a shadowed duplicate)', () => {
    const dup = compileChips(BLOCK)[0]!;
    const d = withBlock([dup]);
    const m = laws(d);
    expect(m.stages[0]!.layout).toHaveLength(1);
    expect(toJson(m).stages[0]!.layout).toHaveLength(3);
  });

  it('holds the laws for extends, and for a malformed block (kept in extra)', () => {
    const d = stageDoc({ 'x-chips': BLOCK, layout: compileChips(BLOCK) }, [
      { id: 'child', extends: 'play', layout: [manual] },
    ]);
    laws(d);
    const bad = stageDoc({ 'x-chips': { v: 1, spots: [], chip: 500 }, layout: [manual] });
    const m = laws(bad);
    expect(m.stages[0]!.chips).toBeNull();
    expect('x-chips' in m.stages[0]!.extra).toBe(true);
  });

  it('keeps x-chips in extra and every row in layout when chips are off (the rows-only builder)', () => {
    const d = withBlock([manual]);
    const m = fromJson(d, { chips: false });
    expect(m.stages[0]!.chips).toBeNull();
    expect(m.stages[0]!.layout).toHaveLength(3);
    expect(m.stages[0]!.extra['x-chips']).toEqual(BLOCK);
    expect(toJson(m)).toEqual(normalizeStrategy(d));
  });

  it('lifts chip-shaped rows with layout unchanged, and refuses what does not lift', () => {
    const rows = [
      { bet: 'red', amount: { units: 2 } },
      { bet: 'black', amount: { units: 1 } },
    ];
    const d = stageDoc({ layout: rows });
    const m = fromJson(d);
    const card = m.stages[0]!;
    expect(liftsAll(card)).toBe(true);
    const lifted = liftCard(card);
    expect(lifted).toEqual({
      v: 1,
      chip: { units: 1 },
      spots: [
        { bet: 'red', chips: 2 },
        { bet: 'black', chips: 1 },
      ],
    });
    expect(card.layout).toHaveLength(0);
    const out = toJson(m).stages[0]!;
    expect(out.layout).toEqual(rows);
    expect(readStageChips(out)).toEqual(lifted);
    expect(splitStageLayout(out).stale).toBe(false);
    // a formula row or a `when` row does not lift
    const none = fromJson(stageDoc({ layout: [manual] })).stages[0]!;
    expect(liftableChips(none)).toBeNull();
    expect(liftCard(none)).toBeNull();
  });

  it('rebuilds a stale stage by dropping the rows the block shadows, keeping the others', () => {
    const rows = [{ bet: 'red', amount: 9999 }, manual];
    const m = fromJson(stageDoc({ 'x-chips': BLOCK, layout: rows }));
    const card = m.stages[0]!;
    rebuildStale(card);
    expect(card.chipsStale).toBe(false);
    const out = toJson(m).stages[0]!;
    expect(out.layout).toEqual([
      ...compileChips(BLOCK),
      normalizeStrategy(stageDoc({ layout: [manual] })).stages[0]!.layout![0],
    ]);
    expect(splitStageLayout(out)).toMatchObject({ stale: false });
  });

  it('forgets chips: stale keeps every row, fresh keeps or drops its generated rows', () => {
    const stale = fromJson(stageDoc({ 'x-chips': BLOCK, layout: [{ bet: 'red', amount: 7 }] }));
    forgetChips(stale.stages[0]!, true);
    expect(toJson(stale).stages[0]!).toEqual(
      normalizeStrategy(stageDoc({ layout: [{ bet: 'red', amount: 7 }] })).stages[0],
    );
    const keep = fromJson(withBlock([manual]));
    forgetChips(keep.stages[0]!, true);
    expect(
      (toJson(keep).stages[0]! as unknown as Record<string, unknown>)['x-chips'],
    ).toBeUndefined();
    expect(toJson(keep).stages[0]!.layout).toHaveLength(3);
    const drop = fromJson(withBlock([manual]));
    forgetChips(drop.stages[0]!, false);
    expect(toJson(drop).stages[0]!.layout).toHaveLength(1);
  });

  it('setCardChips regenerates the prefix in front of the manual rows', () => {
    const m = fromJson(stageDoc({ layout: [manual] }));
    setCardChips(m.stages[0]!, { v: 1, chip: 100, spots: [{ bet: 'red', chips: 3 }] });
    const out = toJson(m).stages[0]!;
    expect(out.layout![0]).toEqual({ bet: 'red', amount: 300 });
    expect(out.layout).toHaveLength(2);
  });

  it('leaves emptyStrategy output unchanged', () => {
    expect(emptyStrategy(2500)).toEqual({
      schema: 1,
      id: 'my-strategy',
      name: 'My strategy',
      game: 'roulette',
      unit: 2500,
      stages: [{ id: 'play', layout: [{ bet: 'red', amount: { units: 1 } }] }],
    });
    const m = laws(emptyStrategy(2500));
    expect(m.stages[0]!.chips).toBeNull();
  });
});
