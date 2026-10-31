import { describe, expect, it } from 'vitest';
import { ladder } from './ladderMath';

describe('ladderMath', () => {
  it('Martingale red, L = 8: q ≈ 0.0048, n½ ≈ 295', () => {
    const r = ladder({ c: 18, g: 2, base: 2500, unit: 2500, betMax: 500000, bankroll: 1e9 });
    expect(r.L).toBe(8);
    expect(r.q).toBeCloseTo(0.0048, 4);
    expect(Math.abs(r.nHalf - 295)).toBeLessThan(3);
    expect(r.firstDeficitLevel).toBeNull();
  });

  it('dozen doubling, L = 8: q ≈ 0.043, n½ ≈ 50', () => {
    const r = ladder({
      c: 12,
      g: 2,
      base: 2500,
      unit: 2500,
      betMax: 500000,
      bankroll: 1e9,
      maxLevels: 8,
    });
    expect(r.L).toBe(8);
    expect(Math.abs(r.q - 0.043)).toBeLessThan(0.001);
    expect(Math.abs(r.nHalf - 50)).toBeLessThan(2);
  });

  it('bankroll limits the ladder to 10 levels', () => {
    const r = ladder({ c: 18, base: 500, unit: 500, betMax: 500000, bankroll: 511500, spins: 500 });
    expect(r.L).toBe(10);
    expect(Math.abs(r.nHalf - 1117)).toBeLessThan(3);
    expect(r.predictedMedian).toBeGreaterThan(0);
  });

  it('flags a deficit when growth is too slow, and rejects bad input', () => {
    const r = ladder({ c: 18, g: 1.5, base: 1000, unit: 100, betMax: 1e6, maxLevels: 5 });
    expect(r.firstDeficitLevel).toBe(2);
    expect(r.levelNet[2]).toBeLessThan(0);
    expect(() => ladder({ c: 0, base: 100, unit: 100, betMax: 1000 })).toThrow();
  });
});
