import { describe, expect, it } from 'vitest';
import {
  finiteOr,
  integerTicks,
  plural,
  downsampleIndices,
  extent,
  formatAxisCount,
  formatAxisMoney,
  formatShare,
  linearScale,
  logScale,
  logTicks,
  nearestIndex,
  niceDomain,
  niceTicks,
  truncate,
} from './scale';
import {
  bandPath,
  barRects,
  fanPaths,
  histogramOutline,
  histogramRects,
  linePath,
  stepPath,
} from './shapes';
import {
  convergenceSummary,
  fanSummary,
  histogramSummary,
  shareBelow,
  survivalSummary,
} from './summary';
import {
  convergenceFixture,
  fanFixture,
  histogramFixture,
  survivalFixture,
} from '../__fixtures__/data';

describe('scales', () => {
  it('maps and inverts linearly, including a flipped range', () => {
    const s = linearScale(0, 10, 100, 0);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(0);
    expect(s(2.5)).toBe(75);
    expect(s.invert(75)).toBe(2.5);
  });
  it('centres a degenerate domain', () => {
    expect(linearScale(5, 5, 0, 100)(5)).toBe(50);
  });
  it('maps logarithmically', () => {
    const s = logScale(10, 10000, 0, 300);
    expect(s(10)).toBeCloseTo(0);
    expect(s(100)).toBeCloseTo(100);
    expect(s(10000)).toBeCloseTo(300);
    expect(s.invert(200)).toBeCloseTo(1000);
  });
});

describe('ticks', () => {
  it('uses 1-2-5 steps inside the range', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-30000, 18000, 5)).toEqual([-30000, -20000, -10000, 0, 10000]);
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
  it('avoids float noise and negative zero', () => {
    const t = niceTicks(-0.3, 0.3, 6);
    expect(t).toEqual([-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]);
    expect(Object.is(t[3], 0)).toBe(true);
  });
  it('handles degenerate input', () => {
    expect(niceTicks(3, 3)).toEqual([3]);
    expect(niceTicks(NaN, 1)).toEqual([]);
    expect(niceTicks(10, 0, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it('widens a domain to tick steps', () => {
    expect(niceDomain(-31234, 17001, 5)).toEqual([-40000, 20000]);
    expect(niceDomain(0, 0)).toEqual([-1, 1]);
  });
  it('gives decade ticks, with 2 and 5 on narrow ranges', () => {
    expect(logTicks(10, 10000)).toEqual([10, 100, 1000, 10000]);
    expect(logTicks(10, 100)).toEqual([10, 20, 50, 100]);
    expect(logTicks(0, 5)).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats compact money from cents', () => {
    expect(formatAxisMoney(0)).toBe('$0');
    expect(formatAxisMoney(-30000)).toBe('-$300');
    expect(formatAxisMoney(125000)).toBe('$1.3k');
    expect(formatAxisMoney(-1_200_000)).toBe('-$12k');
    expect(formatAxisMoney(250_000_000)).toBe('$2.5M');
    expect(formatAxisMoney(50)).toBe('$0.50');
  });
  it('formats counts and shares', () => {
    expect(formatAxisCount(950)).toBe('950');
    expect(formatAxisCount(1200)).toBe('1.2k');
    expect(formatAxisCount(25000)).toBe('25k');
    expect(formatShare(0.123)).toBe('12%');
    expect(formatShare(0.004)).toBe('0.4%');
    expect(formatShare(0)).toBe('0%');
  });
  it('truncates with an ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});

describe('index helpers', () => {
  it('downsamples evenly and keeps both ends', () => {
    expect(downsampleIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
    const d = downsampleIndices(101, 5);
    expect(d).toEqual([0, 25, 50, 75, 100]);
    expect(downsampleIndices(0, 5)).toEqual([]);
  });
  it('finds the nearest index', () => {
    expect(nearestIndex([0, 10, 20, 30], 12)).toBe(1);
    expect(nearestIndex([0, 10, 20, 30], 16)).toBe(2);
    expect(nearestIndex([0, 10, 20, 30], -50)).toBe(0);
    expect(nearestIndex([0, 10, 20, 30], 99)).toBe(3);
    expect(nearestIndex([], 1)).toBeNull();
  });
  it('takes extents ignoring non-finite values', () => {
    expect(extent([3, NaN, -2], Float64Array.of(10))).toEqual([-2, 10]);
    expect(extent([])).toBeNull();
  });
});

describe('shapes', () => {
  it('builds line paths and breaks at gaps', () => {
    expect(linePath([0, 1, 2], [5, 6, 7])).toBe('M0 5L1 6L2 7');
    expect(linePath([0, 1, 2], [5, NaN, 7])).toBe('M0 5M2 7');
  });
  it('builds a closed band and a step path', () => {
    expect(bandPath([0, 10], [20, 22], [5, 6])).toBe('M0 20L10 22L10 6L0 5Z');
    expect(bandPath([], [], [])).toBe('');
    expect(stepPath([0, 10, 20], [0, 5, 9])).toBe('M0 0H10V5H20V9');
  });
  it('makes one rect per non-empty histogram bin', () => {
    const h = { lo: 0, width: 10, counts: Uint32Array.of(2, 0, 4) };
    const x = linearScale(0, 30, 0, 300);
    const y = linearScale(0, 4, 100, 0);
    const rects = histogramRects(h, x, y);
    expect(rects).toEqual([
      { i: 0, x: 0, y: 50, w: 99, h: 50, value: 2 },
      { i: 2, x: 200, y: 0, w: 99, h: 100, value: 4 },
    ]);
    expect(histogramOutline(h, x, y)).toBe('M0 100V50H100V100H200V0H300V100');
  });
  it('builds all fan paths on the given checkpoints', () => {
    const fan = fanFixture(5, 100);
    const x = linearScale(0, 100, 0, 100);
    const y = linearScale(-50000, 50000, 100, 0);
    const p = fanPaths(fan, x, y);
    expect(p.xs).toEqual([0, 25, 50, 75, 100]);
    expect(p.median.startsWith('M0 50')).toBe(true);
    expect(p.outer.match(/L/g)).toHaveLength(9);
    expect(p.outer.endsWith('Z')).toBe(true);
    expect(fanPaths(fan, x, y, [0, 4]).xs).toEqual([0, 100]);
  });
  it('lays out horizontal and vertical bars around zero', () => {
    const s = linearScale(-100, 100, 0, 200);
    const h = barRects([50, -100], s, { orientation: 'horizontal', start: 0, size: 100, gap: 10 });
    expect(h).toEqual([
      { i: 0, x: 100, y: 5, w: 50, h: 40, value: 50 },
      { i: 1, x: 0, y: 55, w: 100, h: 40, value: -100 },
    ]);
    const v = barRects([50], linearScale(-100, 100, 200, 0), {
      orientation: 'vertical',
      start: 10,
      size: 100,
      gap: 20,
    });
    expect(v[0]).toEqual({ i: 0, x: 20, y: 50, w: 80, h: 50, value: 50 });
  });
});

describe('summaries', () => {
  it('describes a histogram', () => {
    const h = histogramFixture();
    const s = histogramSummary(h, (c) => `$${c / 100}`);
    expect(s).toMatch(/^10,00\d sessions in 24 bins/);
    expect(s).toContain('expected net line is at $-140');
    expect(s).toMatch(/About \d+% of sessions end below the zero line/);
    expect(histogramSummary({ ...h, counts: new Uint32Array(0) }, String)).toBe(
      'No sessions to show yet.',
    );
  });
  it('counts only bins entirely at or below a value', () => {
    expect(shareBelow({ lo: 0, width: 10, counts: Uint32Array.of(1, 1, 2) }, 20)).toBe(0.5);
  });
  it('describes a fan, a survival curve and a convergence run', () => {
    const f = fanSummary(fanFixture(), (c) => `$${Math.round(c / 100)}`);
    expect(f).toContain('After 500 rounds the median session is at $-140');
    expect(f).toContain('90% of sessions are between');
    const sv = survivalSummary(survivalFixture());
    expect(sv).toContain('Half of sessions have ended by round 372');
    expect(sv).toContain('bust');
    const cv = convergenceSummary(convergenceFixture(), 'mean', (c) => `$${Math.round(c / 100)}`);
    expect(cv).toContain('sessions the mean net is');
    expect(cv).toContain('20,000 sessions would reach');
    expect(convergenceSummary(convergenceFixture(), 'bust', String)).toContain('P(bust)');
  });
});

describe('review fixes', () => {
  it('splits a band at non-finite points into one polygon per finite run', () => {
    const d = bandPath([0, 1, 2, 3, 4], [5, 5, NaN, 5, 5], [1, 1, 1, 1, 1]);
    expect(d).toBe('M0 5L1 5L1 1L0 1ZM3 5L4 5L4 1L3 1Z');
    expect(bandPath([0, 1], [NaN, NaN], [1, 1])).toBe('');
    expect(bandPath([0, 1, 2], [5, 5, 5], [1, NaN, 1])).toBe('M0 5L0 1ZM2 5L2 1Z');
  });
  it('rounds before choosing the unit', () => {
    expect(formatAxisMoney(-100000)).toBe('-$1k');
    expect(formatAxisMoney(99_960_000)).toBe('$1M');
    expect(formatAxisMoney(-50)).toBe('-$0.50');
    expect(formatAxisMoney(2_500_000_000_00)).toBe('$2.5B');
    expect(formatAxisMoney(99_950)).toBe('$1k');
    expect(formatAxisMoney(NaN)).toBe('\u2013');
    expect(formatAxisCount(999_600)).toBe('1M');
    expect(formatAxisCount(-1000)).toBe('-1k');
  });
  it('formats tiny and missing shares', () => {
    expect(formatShare(0.0004)).toBe('<0.1%');
    expect(formatShare(NaN)).toBe('\u2013');
  });
  it('keeps count ticks whole and guards formatters', () => {
    expect(integerTicks(0, 1, 4)).toEqual([0, 1]);
    expect(finiteOr(String)(NaN)).toBe('\u2013');
    expect(plural(1, 'session')).toBe('1 session');
    expect(plural(2, 'session')).toBe('2 sessions');
  });
  it('does not print NaN when the interval is unavailable', () => {
    const c = convergenceFixture();
    const l = c.n.length - 1;
    c.lo[l] = NaN;
    c.hi[l] = NaN;
    const s = convergenceSummary(c, 'mean', (v) => `$${v}`);
    expect(s).toContain('not available below 30 sessions');
    expect(s).not.toContain('NaN');
  });
  it('says when a marker lies outside the bins', () => {
    const h = { ...histogramFixture(), markers: { zero: 90000, expected: -999999 } };
    const s = histogramSummary(h, String);
    expect(s).toContain('All sessions ended below the zero line');
    expect(s).toContain('outside the plotted range');
  });
});
