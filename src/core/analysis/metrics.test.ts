import { describe, expect, it } from 'vitest';
import { ENDED_BY } from '../contracts/run';
import { completedPrefix } from './domain';
import {
  convergence,
  convergenceGrid,
  fanChart,
  survival,
  suggestedForMean,
  suggestedForProbability,
} from './fan';
import { endedByLabel, representativeSessions, runMetrics } from './metrics';
import { makeRun, type FixtureSession } from './test-data';

const X = [-2500, -2500, 0, 2500, 7500, -10000, 5000, -5000, 2500, -2500];
const rowsX = (): FixtureSession[] =>
  X.map((net, i) => ({
    net,
    expectedLoss: 100,
    variance: 10000,
    wagered: 1000,
    roundsPlayed: 10,
    roundsWagered: 8,
    maxDrawdown: i === 5 ? 10000 : 1000,
    maxExposure: 500,
    endedBy: i === 5 ? ENDED_BY.bust : i === 4 ? ENDED_BY['stop-win'] : i === 7 ? 16 : 0,
  }));
const runX = () =>
  makeRun(rowsX(), { bankroll: 10000, maxRounds: 10, roundsPerHour: 40, reasons: ['quit'] });

describe('runMetrics on fixture X', () => {
  const m = runMetrics(runX(), { tableMax: 500 });
  it('distribution without intervals below 30 sessions', () => {
    expect(m.n).toBe(10);
    expect(m.net.mean.value).toBe(-500);
    expect(m.net.mean.se).toBeCloseTo(1615.893285805443, 9);
    expect(m.net.mean.ci).toBeUndefined();
    expect(m.net.medianCI).toBeUndefined();
    expect(m.net.sd).toBeCloseTo(5109.90323891863, 9);
    expect(m.net.skew).toBeCloseTo(-0.24982777265876538, 12);
    expect(m.net.q.p50).toBeCloseTo(-1250, 9);
    expect(m.net.q.p95).toBeCloseTo(6375, 9);
    expect(m.net.min).toBe(-10000);
    expect(m.net.max).toBe(7500);
    expect([...m.net.histogram.counts]).toEqual([1, 4, 3, 2]);
    expect(m.net.histogram.markers).toMatchObject({ zero: 0, expected: -100, mean: -500 });
  });
  it('probabilities with Wilson intervals', () => {
    const p = m.probabilities;
    expect([p.ahead.k, p.even.k, p.behind.k]).toEqual([4, 1, 5]);
    expect(p.bust.k).toBe(1);
    expect(p.stopWin.k).toBe(1);
    expect(p.cap.k).toBe(7);
    expect(p.strategy.quit!.k).toBe(1);
    expect(p.error.ci.lo).toBe(0);
    expect(p.error.ci.hi).toBeCloseTo(0.277533, 6);
    expect(p.bust.ci.level).toBe(0.95);
  });
  it('expected vs realized and luck', () => {
    expect(m.expected.meanExpectedLoss).toBe(100);
    expect(m.expected.meanRealizedLoss.value).toBe(500);
    expect(m.expected.expectedNetLine).toBe(-100);
    // Z = sum(x + E) / sqrt(sum V) = (-5000 + 1000) / sqrt(100000)
    expect(m.expected.luckZ).toBeCloseTo(-4000 / Math.sqrt(100000), 12);
    expect(m.expected.luckLabel).toBe('very-unusual');
    expect(m.expected.sessionZ!.counts.reduce((a, b) => a + b, 0)).toBe(10);
  });
  it('edge and cost of play', () => {
    const e = m.edge;
    expect(e.realized!.value).toBeCloseTo(5000 / 10000, 12); // sum L / sum W
    expect(e.realized!.se).toBeCloseTo(Math.sqrt(100000) / 10000, 12);
    expect(e.analytic).toBeCloseTo(0.1, 12);
    expect(e.expectedLossPerRound).toBe(10);
    expect(e.perWageredRound).toBeCloseTo(1000 / 80, 12);
    expect(e.per100).toBe(1000);
    expect(e.perHour).toBe(400);
    expect(e.costOfPlayPerHour).toBe(400);
    expect(e.perSession).toBe(100);
    expect(e.realizedLossPerHour!.value).toBeCloseTo((5000 / 100) * 40, 9);
  });
  it('volatility', () => {
    const v = m.volatility;
    expect(v.sdRoundAnalytic).toBeCloseTo(Math.sqrt(100000 / 100), 12);
    expect(v.sdHour).toBeCloseTo(Math.sqrt(1000) * Math.sqrt(40), 9);
    expect(v.sdPer100).toBeCloseTo(10 * Math.sqrt(1000), 9);
    expect(v.sdRoundEmpirical).toBeCloseTo(5109.90323891863 / Math.sqrt(10), 9);
    expect(v.signalRatio).toBeCloseTo(-500 / 5109.90323891863, 12);
    expect(v.spreadRatio).toBeCloseTo((5250 - -5500) / 100, 9);
  });
  it('drawdown, exposure, trough, length', () => {
    expect(m.drawdown.pHalfBankroll.k).toBe(1);
    expect(m.drawdown.pFullBankroll.k).toBe(1);
    expect(m.exposure.pAtTableMax!.k).toBe(10);
    expect(runMetrics(runX()).exposure.pAtTableMax).toBeNull();
    expect(m.length.satOutShare).toBeCloseTo(0.2, 12);
    expect(m.length.hours.value).toBeCloseTo(10 / 40, 12);
    expect(m.trough.min).toBe(-10000);
  });
  it('category net sums to total net exactly; stages', () => {
    const r = makeRun(
      rowsX().map((s, i) => ({ ...s, catWagered: [600, 400], catNet: [s.net + 7 * i, -7 * i] })),
      { categories: ['red', 'dozen'], maxRounds: 10, stages: ['a', 'b'] },
    );
    const b = runMetrics(r).breakdown;
    expect(b.categories.reduce((s, c) => s + c.net, 0)).toBe(X.reduce((s, x) => s + x, 0));
    expect(b.categories[0]!.wagered).toBe(6000);
    expect(b.categories[0]!.realizedEdge).toBeCloseTo(-b.categories[0]!.net / 6000, 12);
    expect(b.stages[0]!.rounds).toBe(100);
    expect(b.stages[0]!.entries).toBe(10);
    expect(b.stages[0]!.roundShare).toBe(1);
    expect(b.rejected.total).toBe(0);
  });
  it('representative sessions use rank floor((N-1)/2) with index ties', () => {
    expect(m.representative).toEqual({ best: 4, worst: 5, median: 9 });
    expect(representativeSessions(runX())).toEqual({ best: 4, worst: 5, median: 9 });
    const ties = makeRun([{ net: 5 }, { net: 5 }, { net: 1 }, { net: 1 }], {});
    expect(representativeSessions(ties)).toEqual({
      best: 0,
      worst: 2,
      median: 3,
    });
  });
});

describe('intervals shown from 30 sessions', () => {
  it('N = 40', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      net: (i % 5) * 100 - 200,
      expectedLoss: 10,
      variance: 100,
    }));
    const m = runMetrics(makeRun(rows, {}));
    expect(m.net.mean.ci).toBeDefined();
    expect(m.net.medianCI).toBeDefined();
    const half = 1.959963984540054 * m.net.mean.se!;
    expect(m.net.mean.ci!.hi - m.net.mean.value).toBeCloseTo(half, 9);
    expect(m.edge.realized!.ci).toBeDefined();
  });
});

describe('analysis domain of a stopped run', () => {
  it('uses only the completed chunk prefix', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ net: i * 100 }));
    const full = makeRun(rows, { chunkSize: 4 });
    const part = makeRun(rows, {
      chunkSize: 4,
      status: 'cancelled',
      bitmap: [0, 2],
      prefixSessions: 12,
    });
    expect(completedPrefix(full.meta)).toBe(12);
    expect(completedPrefix(part.meta)).toBe(4);
    const m = runMetrics(part);
    expect(m.n).toBe(4);
    expect(m.of).toBe(12);
    expect(m.net.mean.value).toBe(150);
    expect(survival(part).alive[0]).toBe(1);
  });
});

describe('endedByLabel', () => {
  it('decodes', () => {
    expect(endedByLabel(0, [])).toBe('rounds');
    expect(endedByLabel(3, [])).toBe('stop-loss');
    expect(endedByLabel(17, ['a', 'b'])).toBe('strategy:b');
    expect(() => endedByLabel(9, ['a'])).toThrow(RangeError);
  });
});

describe('survival (exact)', () => {
  const rows: FixtureSession[] = [
    { net: 0, roundsPlayed: 0, endedBy: ENDED_BY.error },
    { net: -1, roundsPlayed: 2, endedBy: ENDED_BY.bust },
    { net: -1, roundsPlayed: 2, endedBy: ENDED_BY.bust },
    { net: 5, roundsPlayed: 3, endedBy: ENDED_BY['stop-win'] },
    { net: 0, roundsPlayed: 4, endedBy: ENDED_BY.rounds },
    { net: 0, roundsPlayed: 4, endedBy: ENDED_BY.rounds },
    { net: 0, roundsPlayed: 4, endedBy: 16 },
    { net: 0, roundsPlayed: 4, endedBy: ENDED_BY['stop-loss'] },
  ];
  const s = survival(makeRun(rows, { maxRounds: 4, reasons: ['q'] }));
  it('S(r) is the share completing at least r rounds', () => {
    expect([...s.alive]).toEqual([1, 0.875, 0.875, 0.625, 0.5]);
    expect(s.medianRounds).toBe(4);
  });
  it('S(r+1) + sum F_k(r) = 1', () => {
    for (let r = 0; r < 4; r++) {
      let tot = s.alive[r + 1]!;
      for (const arr of Object.values(s.incidence)) tot += arr[r]!;
      expect(tot).toBeCloseTo(1, 12);
    }
    expect(s.incidence.bust![2]).toBe(0.25);
  });
  it('median is null when more than half reach the cap', () => {
    const r = makeRun([{ net: 0 }, { net: 0 }, { net: 0, roundsPlayed: 1, endedBy: 1 }], {
      maxRounds: 5,
    });
    expect(survival(r).medianRounds).toBeNull();
  });
});

describe('fan chart', () => {
  it('percentiles, mean, expected line and alive strip', () => {
    const rows = [
      { net: -100, roundsPlayed: 2, endedBy: 1, equity: [1000, 950, 900] },
      { net: 100, roundsPlayed: 4, equity: [1000, 1050, 1100] },
      { net: 0, roundsPlayed: 4, equity: [1000, 1000, 1000] },
    ].map((r) => ({ ...r, expectedLoss: 1 }));
    const run = makeRun(rows, {
      bankroll: 1000,
      maxRounds: 4,
      schedule: [0, 2, 4],
      expCum: [[0, 4, 6]],
    });
    const f = fanChart(run);
    expect([...f.rounds]).toEqual([0, 2, 4]);
    expect([...f.p50]).toEqual([0, 0, 0]);
    expect(f.p5[2]).toBeCloseTo(-90, 9);
    expect(f.p95[2]).toBeCloseTo(90, 9);
    expect(f.p25[1]).toBeCloseTo(-25, 9);
    expect(f.mean[1]).toBeCloseTo(0, 12);
    expect(f.mean[2]).toBeCloseTo(0, 12);
    expect(f.expected[1]).toBeCloseTo(-4 / 3, 12);
    expect(f.expected[2]).toBeCloseTo(-2, 12);
    expect(f.alive[0]).toBe(1);
    expect(f.alive[1]).toBeCloseTo(1 - 0 / 3, 12);
    expect(f.alive[2]).toBeCloseTo(2 / 3, 12);
  });
  it('live preview limits points to first, last and evenly spaced', () => {
    const schedule = Array.from({ length: 60 }, (_, i) => i);
    const run = makeRun([{ net: 0, equity: schedule.map(() => 10000) }], {
      maxRounds: 59,
      schedule,
    });
    const f = fanChart(run, { live: true });
    expect(f.rounds.length).toBe(24);
    expect(f.rounds[0]).toBe(0);
    expect(f.rounds[23]).toBe(59);
  });
});

describe('convergence', () => {
  it('grid is ceil(N^(j/199)) deduplicated with N last', () => {
    const g = convergenceGrid(10000);
    expect(g[0]).toBe(1);
    expect(g[g.length - 1]).toBe(10000);
    expect(new Set(g).size).toBe(g.length);
    expect(g.length).toBeLessThanOrEqual(200);
    expect(convergenceGrid(1)).toEqual([1]);
    expect(convergenceGrid(5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('suggested session count N* = 1052 for flat $25 red, 500 spins', () => {
    const s = 2500 * Math.sqrt(500) * Math.sqrt(1 - 1 / 37 ** 2);
    const meanE = (500 * 2500) / 37;
    expect(suggestedForMean(s, Math.max(100, 0.1 * meanE))).toBe(1052);
    expect(suggestedForProbability(0, 100, 0.01)).toBe(
      Math.ceil((1.959963984540054 ** 2 * 0.01 * 0.99) / 1e-4),
    );
    expect(suggestedForProbability(0.5, 100, 0.01)).toBe(9604);
  });
  it('running mean and bands', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      net: i % 2 ? 100 : -100,
      expectedLoss: 50,
    }));
    const c = convergence(makeRun(rows, {}));
    const last = c.n.length - 1;
    expect(c.n[last]).toBe(100);
    expect(c.mean[last]).toBeCloseTo(0, 9);
    expect(c.mean[0]).toBe(-100);
    expect(Number.isNaN(c.lo[0])).toBe(true);
    expect(c.lo[last]).toBeLessThan(0);
    expect(c.hi[last]).toBeGreaterThan(0);
    expect(c.pAhead[last]).toBe(0.5);
    expect(c.target.meanHalfWidth).toBe(100);
    expect(c.suggested.forMean).toBe(
      Math.ceil(((1.959963984540054 * 100.5037815259212) / 100) ** 2),
    );
  });
});

describe("gambler's ruin oracle", () => {
  it('closed form', () => {
    const p = 18 / 37;
    const q = 1 - p;
    const r = q / p;
    const ruin = (a: number, n: number) => (r ** a - r ** n) / (1 - r ** n);
    expect(ruin(40, 80)).toBeCloseTo(0.8968485629704275, 12);
    const D = (a: number, n: number) => a / (q - p) - (n / (q - p)) * ((1 - r ** a) / (1 - r ** n));
    expect(D(40, 80)).toBeGreaterThan(0);
    // Direct simulation of the walk with a tiny LCG agrees with the formula within 4 SE.
    let seed = 12345;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let bust = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      let e = 40;
      while (e > 0 && e < 80) e += rnd() < 18 / 37 ? 1 : -1;
      if (e === 0) bust++;
    }
    const pHat = bust / N;
    expect(Math.abs(pHat - ruin(40, 80))).toBeLessThan(4 * Math.sqrt((pHat * (1 - pHat)) / N));
  });
});
