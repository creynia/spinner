// The hand-written survivors equal the e6-full spec; betsAtLevel, capLoss and the parser.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { betsAtLevel, capLoss, ladderFromStrategy, SURVIVORS } from './survivors';

interface Spec {
  experiments: { id: string; strategy: unknown }[];
}
const spec = JSON.parse(
  readFileSync(resolve(process.cwd(), 'scripts/research/specs/e6-full.json'), 'utf8'),
) as Spec;
const byId = (id: string): { id: string; strategy: unknown } => {
  const found = spec.experiments.find((e) => e.id === id);
  if (!found) throw new Error(`no experiment ${id}`);
  return found;
};

const [c9, b3, a1] = SURVIVORS;

describe('SURVIVORS', () => {
  it('lists c9, b3 and a1 with the e6-full row ids', () => {
    expect(SURVIVORS.map((s) => s.id)).toEqual(['c9', 'b3', 'a1']);
    expect(SURVIVORS.map((s) => s.rowId)).toEqual([
      'c9-streets-to12-stack',
      'b3-two-streets-l29',
      'a1-streets-w27',
    ]);
  });

  for (const s of SURVIVORS) {
    it(`${s.id}: amounts and bets equal the e6-full spec`, () => {
      const parsed = ladderFromStrategy(byId(s.rowId).strategy);
      expect(parsed.amounts).toEqual(s.amounts);
      expect(parsed.bets).toEqual(s.bets);
    });
  }
});

describe('betsAtLevel', () => {
  it('c9: one street at level 0, four at level 3, capped at level 16', () => {
    const l0 = betsAtLevel(c9!, 0);
    const l3 = betsAtLevel(c9!, 3);
    expect(l0).toEqual([{ numbers: [1, 2, 3], amount: 100 }]);
    expect(l3).toHaveLength(4);
    expect((l3 as { amount: number }[]).every((b) => b.amount === 300)).toBe(true);
    expect(betsAtLevel(c9!, 15)).toHaveLength(4);
    expect(betsAtLevel(c9!, 16)).toBe('capped');
  });

  it('b3 keeps two streets at every level and a1 adds one street per level', () => {
    expect(betsAtLevel(b3!, 0)).toHaveLength(2);
    expect(betsAtLevel(b3!, 28)).toHaveLength(2);
    expect(betsAtLevel(b3!, 29)).toBe('capped');
    expect(betsAtLevel(a1!, 8)).toHaveLength(9);
    expect(betsAtLevel(a1!, 9)).toBe('capped');
    expect(betsAtLevel(a1!, -1)).toBe('capped');
  });
});

describe('capLoss', () => {
  it('is the whole ladder: a1 $3,444, b3 $4,574, c9 $4,919', () => {
    expect(capLoss(a1!)).toBe(344400);
    expect(capLoss(b3!)).toBe(457400);
    expect(capLoss(c9!)).toBe(491900);
  });
});

describe('ladderFromStrategy', () => {
  it('rejects documents that are not a sequence strategy', () => {
    expect(() => ladderFromStrategy(null)).toThrow();
    expect(() => ladderFromStrategy({ progressions: {}, stages: [{ layout: [] }] })).toThrow();
  });
});
