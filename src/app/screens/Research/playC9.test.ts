// The c9 table how-to (chapter 10): the level table derived from the candidate document, the loss
// limit's trip level, the cycle-model numbers, and the chapter text that quotes them.
import { describe, expect, it } from 'vitest';
import { formatMoney } from '@core';
import { CHAPTERS } from './content';
import { candidate, row } from './data';
import { money } from './kit';
import {
  C9_CANDIDATE,
  C9_ROW,
  LEVEL_HEAD,
  levelRows,
  PLAY_C9,
  playPlan,
  streetsLabel,
} from './playC9';
import { capLoss, SURVIVORS } from './survivors';

const dollars = (c: number): string => formatMoney(c);
const plan = PLAY_C9;

describe('playPlan (c9 cash-out)', () => {
  it('reads the ladder and the stops from the candidate document', () => {
    expect(plan.levels).toHaveLength(16);
    expect(plan.chip).toBe(100);
    expect(plan.target).toBe(28000);
    expect(plan.lossLimit).toBe(245950);
    // the same ladder as chapter 6's c9 survivor
    const c9 = SURVIVORS.find((s) => s.id === 'c9')!;
    expect(plan.ladder.amounts).toEqual(c9.amounts);
    expect(plan.ladder.bets).toEqual(c9.bets);
    expect(plan.capLoss).toBe(capLoss(c9));
    expect(plan.capLoss).toBe(491900);
    for (const l of plan.levels) expect(l.perStreet % plan.chip).toBe(0);
  });

  it('pins the level table', () => {
    const rows = levelRows(plan, { money, dollars });
    expect(rows).toHaveLength(16);
    expect(rows[0]).toHaveLength(LEVEL_HEAD.length);
    // level, streets, chips per street, on the table, down if it misses, a hit nets
    expect(rows[0]).toEqual(['0', '1 (1–3)', '1', '$1', money(-100), money(1100)]);
    expect(rows[1]).toEqual(['1', '2 (1–6)', '2', '$4', money(-500), money(1900)]);
    expect(rows[2]).toEqual(['2', '3 (1–9)', '2', '$6', money(-1100), money(1300)]);
    expect(rows[3]).toEqual(['3', '4 (1–12)', '3', '$12', money(-2300), money(1300)]);
    expect(rows[13]).toEqual(['13', '4 (1–12)', '183', '$732', money(-217900), money(1700)]);
    expect(rows[14]).toEqual(['14', '4 (1–12)', '274', '$1,096', money(-327500), money(1300)]);
    expect(rows[15]).toEqual(['15', '4 (1–12)', '411', '$1,644', money(-491900), money(1300)]);
  });

  it('keeps every level consistent: the running loss adds up, every hit is a profit', () => {
    let down = 0;
    for (const l of plan.levels) {
      expect(l.carried).toBe(down);
      expect(l.onTable).toBe(l.perStreet * l.streets.length);
      down += l.onTable;
      expect(l.downIfMiss).toBe(down);
      // a street pays 11 to 1: twelve stakes back on the street that hits
      expect(l.hitNets).toBe(12 * l.perStreet - l.onTable - l.carried);
      expect(l.hitNets).toBeGreaterThanOrEqual(1100);
      expect(l.pHit).toBeCloseTo((3 * l.streets.length) / 37, 12);
    }
    expect(plan.minHit).toBe(1100);
    expect(streetsLabel(plan.levels[15]!)).toBe('4 (1–12)');
  });

  it('finds where the loss limit trips, from any start of a run', () => {
    expect(plan.tripLevel).toBe(14);
    expect(plan.maxBet).toBe(27400);
    expect(plan.stopLoss).toEqual({ most: 327500, least: 299600 });
    // the ledger's worst 5 % sit inside that range
    expect(-plan.stopLoss.most).toBeLessThanOrEqual(row(C9_ROW).cvar5);
    expect(-plan.stopLoss.least).toBeGreaterThanOrEqual(row(C9_ROW).cvar5);
  });

  it('predicts the chance of ending ahead and the session length (cycle model)', () => {
    expect(plan.qStop).toBeCloseTo(0.005275, 5);
    // all 16 levels: the experiment's q
    expect(plan.qStop * (1 - plan.levels[15]!.pHit)).toBeCloseTo(row(C9_ROW).meta!.q!, 5);
    expect(plan.avgHit / 100).toBeCloseTo(14.52, 2);
    expect(plan.runsNeeded).toBeCloseTo(19.28, 2);
    expect(plan.pWinPredicted).toBeCloseTo(0.903, 3);
    expect(Math.abs(plan.pWinPredicted - row(C9_ROW).pWin)).toBeLessThan(0.006);
    expect(plan.spinsPerRun).toBeCloseTo(4.47, 2);
    expect(Math.round(plan.spinsPredicted)).toBe(86);
  });

  it('rejects a document without the two stops', () => {
    const s = structuredClone(candidate(C9_CANDIDATE).strategy) as {
      stages: { rules: unknown[] }[];
    };
    s.stages[0]!.rules = [];
    expect(() => playPlan(s)).toThrow(/no "cash-out" rule/);
  });
});

describe('chapter play-c9 text', () => {
  const c = CHAPTERS.find((x) => x.id === 'play-c9')!;
  const text = [c.lead, ...c.body, ...c.takeaways, ...c.math.text, ...c.math.formulas].join(' ');

  it('is chapter 10, right after Try it', () => {
    expect(CHAPTERS.indexOf(c)).toBe(10);
    expect(CHAPTERS[9]!.id).toBe('try');
  });

  it('quotes the derived ladder numbers', () => {
    for (const s of [
      dollars(plan.capLoss), // $4,919
      dollars(plan.stopLoss.least), // $2,996
      dollars(plan.stopLoss.most), // $3,275
      dollars(plan.levels[13]!.downIfMiss), // $2,179
      dollars(plan.minHit), // $11
      dollars(plan.levels[15]!.perStreet), // $411
      dollars(plan.target), // $280
      dollars(plan.lossLimit), // $2,459.50
      dollars(plan.target - plan.chip), // $279
      `${plan.levels.length} levels`,
      `level ${plan.tripLevel}`,
      `D(${plan.levels.length}) = ${dollars(plan.capLoss)}`,
    ])
      expect(text).toContain(s);
  });

  it('quotes the cycle model and the ledger row', () => {
    const r = row(C9_ROW);
    for (const s of [
      `q = ${plan.qStop.toFixed(5)}`,
      `$${(plan.avgHit / 100).toFixed(2)}`,
      `${plan.runsNeeded.toFixed(1)} runs`,
      `= ${plan.pWinPredicted.toFixed(3)}`,
      `${plan.spinsPerRun.toFixed(2)} spins`,
      `about ${Math.round(plan.spinsPredicted)}`,
      `measured ${r.roundsMean.toFixed(1)}`,
      dollars(r.wagerMean),
      `${(r.pWin * 100).toFixed(1)} %`,
      dollars(-r.mean),
    ])
      expect(text).toContain(s);
  });
});
