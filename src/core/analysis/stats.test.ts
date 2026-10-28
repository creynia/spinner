import { describe, expect, it } from 'vitest';
import {
  histogramFD,
  meanSd,
  newcombe,
  quantile7,
  quantileCI,
  quantileRanks,
  skewness,
  wilson,
} from './stats';

const X = [-2500, -2500, 0, 2500, 7500, -10000, 5000, -5000, 2500, -2500];
const sortedX = Float64Array.from(X).sort();

describe('quantile7', () => {
  it('matches the doc vector for X', () => {
    const exp: [number, number][] = [
      [0, -10000],
      [0.05, -7750],
      [0.1, -5500],
      [0.25, -2500],
      [0.5, -1250],
      [0.75, 2500],
      [0.9, 5250],
      [0.95, 6375],
      [1, 7500],
    ];
    for (const [p, v] of exp) expect(quantile7(sortedX, p)).toBeCloseTo(v, 9);
  });
  it('handles one element and the top edge', () => {
    expect(quantile7([7], 0.3)).toBe(7);
    expect(quantile7([1, 2], 1)).toBe(2);
  });
});

describe('quantile CI ranks', () => {
  it('matches the doc vectors', () => {
    expect(quantileRanks(10000, 0.5)).toEqual({ l: 4902, u: 5099 });
    expect(quantileRanks(100, 0.5)).toEqual({ l: 40, u: 61 });
    expect(quantileRanks(10000, 0.05)).toEqual({ l: 457, u: 544 });
  });
  it('indexes the sorted values 0-based', () => {
    const s = Float64Array.from({ length: 100 }, (_, i) => i * 10);
    expect(quantileCI(s, 0.5)).toEqual({ lo: 390, hi: 600, level: 0.95 });
  });
});

describe('mean, SD, skew (fixture X)', () => {
  const m = meanSd(X);
  it('mean, sd, se', () => {
    expect(m.mean).toBe(-500);
    expect(m.sd).toBeCloseTo(5109.90323891863, 9);
    expect(m.sd / Math.sqrt(10)).toBeCloseTo(1615.893285805443, 9);
  });
  it('adjusted Fisher-Pearson skew', () => {
    expect(skewness(X)).toBeCloseTo(-0.24982777265876538, 12);
  });
  it('undefined cases', () => {
    expect(skewness([1, 2])).toBeNull();
    expect(skewness([3, 3, 3])).toBeNull();
    expect(meanSd([5]).sd).toBe(0);
  });
});

describe('wilson', () => {
  const cases: [number, number, number, number][] = [
    [0, 10, 0, 0.277533],
    [5, 10, 0.236593, 0.763407],
    [10, 10, 0.722467, 1],
    [38, 100, 0.290976, 0.477902],
    [200, 10000, 0.017435, 0.022934],
    [3725, 10000, 0.363075, 0.382023],
  ];
  it.each(cases)('(%i, %i)', (k, n, lo, hi) => {
    const w = wilson(k, n);
    expect(w.lo).toBeCloseTo(lo, 6);
    expect(w.hi).toBeCloseTo(hi, 6);
  });
});

describe('newcombe', () => {
  it('56/70 vs 48/80', () => {
    const c = newcombe(56, 70, 48, 80);
    expect(c.lo).toBeCloseTo(0.052431, 6);
    expect(c.hi).toBeCloseTo(0.333873, 6);
  });
});

describe('histogramFD', () => {
  it('fixture X: width 5000, zero is an edge', () => {
    const h = histogramFD(X, { markers: { zero: 0 } });
    expect(h.lo).toBe(-10000);
    expect(h.width).toBe(5000);
    expect([...h.counts]).toEqual([1, 4, 3, 2]);
    expect(h.zeroBin).toBe(2);
    expect(h.markers.zero).toBe(0);
  });
  it('conserves counts and snaps to a nice width with 0 as an edge', () => {
    const v = Array.from({ length: 5000 }, (_, i) => ((i * 7919) % 20011) * 100 - 700000);
    const h = histogramFD(v);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(v.length);
    expect(h.counts.length).toBeLessThanOrEqual(120);
    expect(h.lo % h.width).toBeCloseTo(0, 6);
    expect(h.zeroBin).not.toBeNull();
    expect(h.lo + h.zeroBin! * h.width).toBe(0);
  });
  it('constant data gives one bin; zero data has zeroBin 0', () => {
    const h = histogramFD([5, 5, 5]);
    expect(h.counts.length).toBe(1);
    expect(h.counts[0]).toBe(3);
    expect(histogramFD([0, 0]).zeroBin).toBe(0);
  });
  it('floats skip the gcd and may use fractional widths', () => {
    const v = Array.from({ length: 1000 }, (_, i) => Math.sin(i) * 1.5);
    const h = histogramFD(v, { integer: false });
    expect(h.width).toBeLessThan(1);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(h.zeroBin).not.toBeNull();
  });
  it('caps at 120 bins', () => {
    const v = Array.from({ length: 300 }, (_, i) => i * i * i);
    expect(histogramFD(v).counts.length).toBeLessThanOrEqual(120);
  });
});

describe('histogramFD coarse widths', () => {
  it('refines when the snapped width is far above h0 (2 bins otherwise)', () => {
    const v = [
      ...Array.from({ length: 26 }, () => -8771),
      ...Array.from({ length: 50 }, (_, i) => -5000 + Math.round((i * 8500) / 49)),
      ...Array.from({ length: 25 }, (_, i) => 3600 + Math.round((i * 6355) / 24)),
    ];
    expect(v.length).toBe(101);
    const h = histogramFD(v);
    expect(h.counts.length).toBeGreaterThanOrEqual(5);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(101);
    expect(h.zeroBin).not.toBeNull();
  });
});
