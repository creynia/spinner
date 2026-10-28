import { describe, expect, it } from 'vitest';
import { ENDED_BY } from '../contracts/run';
import { compareRuns, diffMeans, isPaired, pairDiff, sweepResult } from './compare';
import { makeRun, type FixtureSession } from './test-data';

const Z = 1.959963984540054;
const A = [0, 100, 200, 300];
const B = [10, 130, 190, 350];
const rows = (xs: number[], extra: Partial<FixtureSession> = {}): FixtureSession[] =>
  xs.map((net) => ({ net, expectedLoss: 10, variance: 400, wagered: 1000, ...extra }));

describe('paired comparison', () => {
  const a = makeRun(rows(A), { runId: 'A', seed: 7 });
  const b = makeRun(rows(B), { runId: 'B', seed: 7 });
  const d = pairDiff(a, b);
  it('pairs on equal seed and versions', () => {
    expect(isPaired(a, b)).toBe(true);
    expect(d.method).toBe('paired');
    expect(d.baseline).toBe('A');
    expect(d.other).toBe('B');
    expect(d.n).toBe(4);
  });
  it('mean difference B - A with SE of the paired differences', () => {
    const sd = Math.sqrt(2000 / 3);
    expect(d.meanNet.value).toBe(20);
    expect(d.meanNet.se).toBeCloseTo(sd / 2, 12);
    expect(d.meanNet.ci.lo).toBeCloseTo(20 - (Z * sd) / 2, 12);
    expect(d.meanNet.df).toBe(3);
    expect(d.meanExpectedLoss.value).toBe(0);
  });
  it('CRN correlation and variance reduction', () => {
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    const v = (xs: number[]) => xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1);
    const cov = A.reduce((s, x, i) => s + (x - mean(A)) * (B[i]! - mean(B)), 0) / 3;
    expect(d.crn!.rho).toBeCloseTo(cov / Math.sqrt(v(A) * v(B)), 12);
    expect(d.crn!.varianceReduction).toBeCloseTo(1 - 2000 / 3 / (v(A) + v(B)), 12);
  });
  it('indicator differences with discordant counts', () => {
    // ahead: A = 0,1,1,1 ; B = 1,1,1,1  ->  b = 1 (B only), c = 0
    expect(d.probabilities.ahead.value).toBeCloseTo(0.25, 12);
    expect(d.probabilities.ahead.discordant).toEqual([1, 0]);
    expect(d.notes).toContain('few discordant pairs');
  });
  it('uses the common prefix and notes differing session configs', () => {
    const b2 = makeRun(rows([10, 130]), { runId: 'B', seed: 7, bankroll: 5000 });
    const d2 = pairDiff(a, b2);
    expect(d2.n).toBe(2);
    expect(d2.notes).toContain('session configs differ');
  });
});

describe('unpaired comparison', () => {
  it('Welch when the seed differs, with Satterthwaite df', () => {
    const a = makeRun(rows([0, 10, 20, 30, 40]), { runId: 'A', seed: 1 });
    const b = makeRun(rows([5, 25, 45]), { runId: 'B', seed: 2 });
    const d = pairDiff(a, b);
    expect(d.method).toBe('welch');
    expect(d.crn).toBeUndefined();
    const pa = 250 / 5;
    const pb = 400 / 3;
    expect(d.meanNet.value).toBe(25 - 20);
    expect(d.meanNet.se).toBeCloseTo(Math.sqrt(pa + pb), 12);
    expect(d.meanNet.df).toBeCloseTo((pa + pb) ** 2 / (pa ** 2 / 4 + pb ** 2 / 2), 12);
  });
  it('differing game or core version also unpairs', () => {
    const a = makeRun(rows(A), { seed: 7 });
    expect(pairDiff(a, makeRun(rows(B), { seed: 7, coreVersion: '2' })).method).toBe('welch');
    expect(pairDiff(a, makeRun(rows(B), { seed: 7, gameVersion: '2' })).method).toBe('welch');
  });
  it('rates use Newcombe: 56/70 vs 48/80', () => {
    const ahead = (k: number, n: number) =>
      Array.from({ length: n }, (_, i) => (i < k ? 100 : -100));
    const a = makeRun(rows(ahead(48, 80)), { runId: 'A', seed: 1 });
    const b = makeRun(rows(ahead(56, 70)), { runId: 'B', seed: 2 });
    const p = pairDiff(a, b).probabilities.ahead;
    expect(p.value).toBeCloseTo(0.2, 12);
    expect(p.ci.lo).toBeCloseTo(0.052431, 6);
    expect(p.ci.hi).toBeCloseTo(0.333873, 6);
    expect(p.discordant).toBeUndefined();
  });
  it('diffMeans welch helper', () => {
    expect(diffMeans([1, 2, 3], [2, 3, 4], 'welch').value).toBe(1);
  });
});

describe('compareRuns', () => {
  const mk = (id: string, xs: number[], seed = 7) => makeRun(rows(xs), { runId: id, seed });
  it('takes 2 to 6 runs of one game', () => {
    expect(() => compareRuns([mk('a', A)])).toThrow(RangeError);
    expect(() => compareRuns(Array.from({ length: 7 }, (_, i) => mk(String(i), A)))).toThrow(
      RangeError,
    );
    const other = mk('x', A);
    other.meta.gameId = 'baccarat';
    expect(() => compareRuns([mk('a', A), other])).toThrow();
  });
  it('differences are against the baseline; shared histogram conserves counts', () => {
    const r = compareRuns([mk('a', A), mk('b', B), mk('c', [1, 2, 3, 4])]);
    expect(r.runIds).toEqual(['a', 'b', 'c']);
    expect(r.metrics).toHaveLength(3);
    expect(r.diffs.map((d) => d.other)).toEqual(['b', 'c']);
    expect(r.diffs.every((d) => d.baseline === 'a')).toBe(true);
    const h = r.sharedHistogram;
    expect(h.counts).toHaveLength(3);
    for (const c of h.counts) {
      expect(c.length).toBe(h.counts[0]!.length);
      expect(c.reduce((s, v) => s + v, 0)).toBe(4);
    }
    expect(h.lo % h.width).toBeCloseTo(0, 9);
  });
  it('realized edge difference (paired residual SE)', () => {
    const a = makeRun(rows([-10, -20, -30, -40]), { runId: 'a', seed: 3 });
    const b = makeRun(rows([-10, -20, -30, -40].map((x) => x * 2)), { runId: 'b', seed: 3 });
    const d = pairDiff(a, b);
    expect(d.realizedEdge!.value).toBeCloseTo(100 / 4000, 12);
    expect(d.realizedEdge!.se).toBeGreaterThanOrEqual(0);
    const none = makeRun(
      rows([1, 2]).map((r) => ({ ...r, wagered: 0 })),
      { seed: 3 },
    );
    expect(pairDiff(a, none).realizedEdge).toBeNull();
  });
  it('stop probabilities differences', () => {
    const a = makeRun(
      rows(A).map((r) => ({ ...r, endedBy: ENDED_BY.bust })),
      { seed: 3 },
    );
    const b = makeRun(rows(A), { seed: 3 });
    expect(pairDiff(a, b).probabilities.bust.value).toBe(-1);
  });
});

describe('sweepResult', () => {
  const mk = (id: string, xs: number[]) => makeRun(rows(xs), { runId: id, seed: 5 });
  const runs = [mk('r1', A), mk('r2', B), mk('r3', [0, 0, 0, 0])];
  it('points, adjacent diffs and scales', () => {
    const s = sweepResult('/strategy/unit', [1, 2, 3], runs);
    expect(s.points.map((p) => p.runId)).toEqual(['r1', 'r2', 'r3']);
    expect(s.adjacent.map((d) => [d.baseline, d.other])).toEqual([
      ['r1', 'r2'],
      ['r2', 'r3'],
    ]);
    expect(s.adjacent[0]!.method).toBe('paired');
    expect(s.xScale).toBe('linear');
    expect(sweepResult('/p', [1, 10, 100], runs).xScale).toBe('log');
    expect(sweepResult('/p', ['a', 'b', 'c'], runs).xScale).toBe('categorical');
    expect(() => sweepResult('/p', [1, 2], runs)).toThrow(RangeError);
  });
});
