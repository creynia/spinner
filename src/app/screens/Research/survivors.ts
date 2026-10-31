// The three ladders that passed every test (research report, chapter 6), written out by hand because
// a1 is not a candidate and so its strategy is not in data.json. survivors.test.ts checks these against
// scripts/research/specs/e6-full.json through `ladderFromStrategy`.
import type { BoardBet } from './Board';

export interface SurvivorLadder {
  id: 'c9' | 'b3' | 'a1';
  label: string;
  /** the row id in the e6-full results, e.g. 'c9-streets-to12-stack' */
  rowId: string;
  /** cents per bet at each level (level = losses in a row) */
  amounts: number[];
  /** a bet is on the table once the level is at least `fromLevel` */
  bets: { numbers: number[]; fromLevel: number }[];
}

const street = (k: number, fromLevel: number): { numbers: number[]; fromLevel: number } => ({
  numbers: [3 * k - 2, 3 * k - 1, 3 * k],
  fromLevel,
});

export const SURVIVORS: readonly SurvivorLadder[] = [
  {
    id: 'c9',
    label: 'c9, hybrid',
    rowId: 'c9-streets-to12-stack',
    amounts: [
      100, 200, 200, 300, 500, 700, 1100, 1600, 2400, 3600, 5400, 8100, 12200, 18300, 27400, 41100,
    ],
    bets: [street(1, 0), street(2, 1), street(3, 2), street(4, 3)],
  },
  {
    id: 'b3',
    label: 'b3, stack',
    rowId: 'b3-two-streets-l29',
    amounts: [
      200, 300, 300, 400, 500, 600, 700, 800, 1000, 1200, 1400, 1700, 2100, 2500, 3000, 3600, 4300,
      5200, 6200, 7400, 8900, 10700, 12800, 15400, 18500, 22200, 26600, 31900, 38300,
    ],
    bets: [street(1, 0), street(6, 0)],
  },
  {
    id: 'a1',
    label: 'a1, widen',
    rowId: 'a1-streets-w27',
    amounts: [100, 200, 200, 300, 500, 1000, 2400, 7200, 28800],
    bets: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => street(k, k - 1)),
  },
];

/** The bets on the table at `level` losses in a row, or 'capped' once the ladder has run out. */
export function betsAtLevel(l: SurvivorLadder, level: number): BoardBet[] | 'capped' {
  if (!Number.isInteger(level) || level < 0 || level >= l.amounts.length) return 'capped';
  const amount = l.amounts[level]!;
  return l.bets.filter((b) => b.fromLevel <= level).map((b) => ({ numbers: b.numbers, amount }));
}

/** What the ladder puts on the table in one go if every level is lost: the loss when it runs out. */
export function capLoss(l: SurvivorLadder): number {
  let total = 0;
  l.amounts.forEach((amount, k) => {
    total += amount * l.bets.filter((b) => b.fromLevel <= k).length;
  });
  return total;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** "street:4-5-6" to [4, 5, 6]; throws on anything that is not a list of numbers. */
function numbersOf(bet: unknown): number[] {
  const text = typeof bet === 'string' ? bet : '';
  const nums = text
    .slice(text.indexOf(':') + 1)
    .split('-')
    .map(Number);
  if (!text.includes(':') || nums.some((n) => !Number.isInteger(n))) {
    throw new Error(`ladderFromStrategy: unsupported bet "${text}"`);
  }
  return nums;
}

/** The level from which a layout entry is on: `when: progStep >= n`, or 0 with no condition. */
function fromLevelOf(when: unknown): number {
  if (when === undefined) return 0;
  const cmp = isObj(when) ? when.cmp : undefined;
  if (Array.isArray(cmp) && cmp[1] === '>=' && typeof cmp[2] === 'number') return cmp[2];
  throw new Error('ladderFromStrategy: unsupported condition');
}

/** Reads the amounts and bets of a one-progression, one-stage strategy document (the e6 shapes). */
export function ladderFromStrategy(s: unknown): Pick<SurvivorLadder, 'amounts' | 'bets'> {
  if (!isObj(s) || !isObj(s.progressions) || !Array.isArray(s.stages)) {
    throw new Error('ladderFromStrategy: not a strategy');
  }
  const stage: unknown = s.stages[0];
  const layout: unknown[] = isObj(stage) && Array.isArray(stage.layout) ? stage.layout : [];
  const bets = layout.map((entry) => {
    if (!isObj(entry)) throw new Error('ladderFromStrategy: bad layout entry');
    return { numbers: numbersOf(entry.bet), fromLevel: fromLevelOf(entry.when) };
  });
  const first = layout[0];
  const amount = isObj(first) && isObj(first.amount) ? first.amount : undefined;
  const prog = typeof amount?.prog === 'string' ? s.progressions[amount.prog] : undefined;
  if (!bets.length || !isObj(prog) || !Array.isArray(prog.amounts)) {
    throw new Error('ladderFromStrategy: no sequence progression');
  }
  return { amounts: prog.amounts.map(Number), bets };
}
