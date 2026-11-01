import { describe, expect, it } from 'vitest';
import {
  RED,
  cycleStats,
  fibonacciStakes,
  geometricStakes,
  labouchereCycle,
  labouchereMc,
  noCapExact,
  predict,
  sessionDp,
  singleBet,
  type LevelLadder,
} from './slowLadder.ts';

/** Every win/loss path of a cycle up to `depth` spins, by depth-first search. */
function bruteCycle(lad: LevelLadder, depth: number) {
  const L = lad.levels.length;
  const acc = { done: 0, cap: 0, rDone: 0, rCap: 0, tDone: 0, wager: 0 };
  const go = (k: number, t: number, prob: number, r: number, w: number): void => {
    if (t === depth) return;
    const { stake, p, win } = lad.levels[k]!;
    const j = lad.back === Infinity ? 0 : Math.max(0, k - lad.back);
    const pw = prob * p;
    if (j === 0) {
      acc.done += pw;
      acc.rDone += pw * (r + win);
      acc.tDone += pw * (t + 1);
      acc.wager += pw * (w + stake);
    } else go(j, t + 1, pw, r + win, w + stake);
    const pl = prob * (1 - p);
    if (k + 1 === L) {
      acc.cap += pl;
      acc.rCap += pl * (r - stake);
      acc.wager += pl * (w + stake);
    } else go(k + 1, t + 1, pl, r - stake, w + stake);
  };
  go(0, 0, 1, 0, 0);
  return acc;
}

/** Every outcome sequence of a short session, with the harness's rules (reduce, bust, cap stop). */
function bruteSession(lad: LevelLadder, bankroll: number, spins: number, min: number) {
  const L = lad.levels.length;
  const dist = new Map<number, number>();
  let cap = 0;
  let bust = 0;
  const go = (t: number, k: number, e: number, prob: number): void => {
    if (t === spins) {
      dist.set(e, (dist.get(e) ?? 0) + prob);
      return;
    }
    const { stake, p, win } = lad.levels[k]!;
    const b = Math.min(stake, e);
    if (b < min) {
      bust += prob;
      dist.set(e, (dist.get(e) ?? 0) + prob);
      return;
    }
    const j = lad.back === Infinity ? 0 : Math.max(0, k - lad.back);
    go(t + 1, j, e + (b * win) / stake, prob * p);
    const pl = prob * (1 - p);
    if (k + 1 === L && t + 1 < spins) {
      cap += pl;
      dist.set(e - b, (dist.get(e - b) ?? 0) + pl);
    } else go(t + 1, k + 1 === L ? 0 : k + 1, e - b, pl);
  };
  go(0, 0, bankroll, 1);
  let mean = 0;
  let win = 0;
  for (const [e, m] of dist) {
    mean += m * (e - bankroll);
    if (e > bankroll) win += m;
  }
  return { mean, win, cap, bust };
}

describe('cycle chain', () => {
  it('Martingale red, 8 levels at $25: q 0.0048, n½ 295', () => {
    const lad = singleBet(geometricStakes(2500, 2, 8), Infinity);
    const cs = cycleStats(lad);
    expect(cs.q).toBeCloseTo((19 / 37) ** 8, 10);
    expect(cs.q).toBeCloseTo(0.0048, 4);
    expect(cs.tau).toBeCloseTo(2500, 6);
    expect(cs.capLoss).toBeCloseTo(637500, 4);
    // Closed form ln2·E[T]/q = ln2·(1 - q)/(q·p) = 293.3; ln2/(q·p) = 294.7; the exact share of
    // sessions without a seen cap first drops below 1/2 at spin 295.
    expect(Math.abs(predict(cs, 500).nHalf - 295)).toBeLessThan(3);
    expect(noCapExact(lad, 500).crossing).toBe(295);
  });

  it('Fibonacci red, 6 levels, back 1 and 2: matches brute-force enumeration', () => {
    for (const back of [1, 2]) {
      const lad = singleBet(fibonacciStakes(100, 6), back);
      const depth = 22;
      const b = bruteCycle(lad, depth);
      const cs = cycleStats(lad, depth);
      expect(cs.q).toBeCloseTo(b.cap, 12);
      expect(1 - cs.q - cs.residual).toBeCloseTo(b.done, 12);
      expect(cs.tau).toBeCloseTo(b.rDone / b.done, 9);
      expect(cs.capLoss).toBeCloseTo(-b.rCap / b.cap, 9);
      expect(cs.ETdone).toBeCloseTo(b.tDone / b.done, 9);
      expect(cs.wager).toBeCloseTo(b.wager, 9);
    }
    // back 2 keeps the deficit a function of the level: every cap loses the whole ladder
    const cs2 = cycleStats(singleBet(fibonacciStakes(100, 6), 2));
    expect(cs2.capLoss).toBeCloseTo(100 * (1 + 1 + 2 + 3 + 5 + 8), 6);
  });

  it('every ladder pays the edge: E[R] / turnover = -1/37', () => {
    for (const lad of [
      singleBet(fibonacciStakes(500, 14), 3),
      singleBet(geometricStakes(500, 1.4, 17), 1),
      singleBet(geometricStakes(500, 1.36, 19), 4, 12 / 37, 2),
    ])
      expect(predict(cycleStats(lad), 500).edge).toBeCloseTo(-1 / 37, 9);
  });
});

describe('session DP', () => {
  it('matches enumeration of every 2^12 outcome sequence (Fibonacci back 2, small bankroll)', () => {
    const lad = singleBet(fibonacciStakes(100, 6), 2);
    for (const bankroll of [2000, 900]) {
      const b = bruteSession(lad, bankroll, 12, 100);
      const s = sessionDp(lad, { bankroll, spins: 12, onCap: 'stop', tableMin: 100, ceiling: 3 });
      expect(s.mean).toBeCloseTo(b.mean, 8);
      expect(s.pWin).toBeCloseTo(b.win, 12);
      expect(s.pCap).toBeCloseTo(b.cap, 12);
      expect(s.pBust).toBeCloseTo(b.bust, 12);
    }
  });

  it('reproduces the Martingale-red-$5-L10 ledger row (median $1,185, P(win) 73.4 %)', () => {
    const s = sessionDp(singleBet(geometricStakes(500, 2, 10), Infinity), {
      bankroll: 500000,
      spins: 500,
      onCap: 'reset',
      tableMin: 500,
    });
    expect(s.median).toBe(118500);
    expect(Math.abs(s.pWin - 0.734)).toBeLessThan(0.01);
    expect(s.mean / s.wager).toBeCloseTo(-1 / 37, 9);
  });
});

describe('Labouchere', () => {
  it('the sampler agrees with the exact line chain at maxLength 6', () => {
    const inp = { line: [1, 2, 3], unit: 500, maxLength: 6, p: RED };
    const ex = labouchereCycle({ ...inp, prune: 1e-11 });
    const mc = labouchereMc(inp, 400_000);
    const se = Math.sqrt((ex.q * (1 - ex.q)) / 400_000);
    expect(Math.abs(mc.q - ex.q)).toBeLessThan(4 * se);
    expect(ex.tau).toBeCloseTo(3000, 4);
    expect(ex.ER / ex.wager).toBeCloseTo(-1 / 37, 3);
  });
});
