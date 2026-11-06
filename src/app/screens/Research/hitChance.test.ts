import { describe, expect, it } from 'vitest';
import {
  BET_COUNTS,
  WHEELS,
  hitChance,
  medianSpins,
  pct2,
  spinsFor,
  tableSpins,
  validCount,
} from './hitChance';

/** Independent check: multiply the miss chance spin by spin until the target is reached. */
function loopSpins(k: number, pockets: number, target: number): number {
  let miss = 1;
  for (let n = 1; n < 100000; n++) {
    miss *= (pockets - k) / pockets;
    if (1 - miss >= target) return n;
  }
  throw new Error('never reached');
}

describe('hitChance', () => {
  it('is k/N after one spin', () => {
    expect(hitChance(1, 37, 1)).toBeCloseTo(1 / 37, 12);
    expect(hitChance(18, 37, 1)).toBeCloseTo(18 / 37, 12);
    expect(hitChance(1, 38, 1)).toBeCloseTo(1 / 38, 12);
    expect(hitChance(6, 39, 1)).toBeCloseTo(6 / 39, 12);
  });

  it('matches 1 - (1 - k/N)^n', () => {
    expect(hitChance(1, 37, 37)).toBeCloseTo(1 - (36 / 37) ** 37, 12);
    expect(hitChance(12, 38, 5)).toBeCloseTo(1 - (26 / 38) ** 5, 12);
  });

  it('is 0 with no spins and never 100 % below full coverage', () => {
    expect(hitChance(5, 37, 0)).toBe(0);
    expect(hitChance(1, 37, 300)).toBeLessThan(1);
    expect(hitChance(36, 37, 5)).toBeLessThan(1);
  });

  it('grows with the spin count and with the count of numbers', () => {
    for (const w of WHEELS) {
      for (const k of BET_COUNTS) {
        for (let n = 1; n < 300; n++) {
          // strictly rising while the doubles can tell the values apart, never falling after
          const a = hitChance(k, w.pockets, n);
          const b = hitChance(k, w.pockets, n + 1);
          if (n < 30) expect(b).toBeGreaterThan(a);
          else expect(b).toBeGreaterThanOrEqual(a);
        }
      }
      for (let n = 1; n <= 40; n += 3) {
        for (let i = 1; i < BET_COUNTS.length; i++) {
          expect(hitChance(BET_COUNTS[i]!, w.pockets, n)).toBeGreaterThan(
            hitChance(BET_COUNTS[i - 1]!, w.pockets, n),
          );
        }
      }
    }
  });

  it('a bigger wheel is slower for the same count', () => {
    expect(hitChance(6, 38, 10)).toBeLessThan(hitChance(6, 37, 10));
    expect(hitChance(6, 39, 10)).toBeLessThan(hitChance(6, 38, 10));
  });
});

describe('spinsFor', () => {
  it('needs 26 spins for 50 % on one European number', () => {
    expect(medianSpins(1, 37)).toBe(26);
    expect(spinsFor(1, 37, 0.5)).toBe(Math.ceil(Math.log(0.5) / Math.log(36 / 37)));
  });

  it('agrees with a spin-by-spin loop for every wheel, count and target', () => {
    for (const w of WHEELS) {
      for (let k = 1; k <= 36; k++) {
        for (const t of [0.5, 0.9, 0.95, 0.99]) {
          expect(spinsFor(k, w.pockets, t), `${w.id} k=${k} t=${t}`).toBe(
            loopSpins(k, w.pockets, t),
          );
        }
      }
    }
  });

  it('is the first spin that reaches the target', () => {
    const n = spinsFor(1, 37, 0.95);
    expect(hitChance(1, 37, n)).toBeGreaterThanOrEqual(0.95);
    expect(hitChance(1, 37, n - 1)).toBeLessThan(0.95);
    expect(n).toBe(loopSpins(1, 37, 0.95));
  });

  it('is 1 when every pocket is covered', () => {
    expect(spinsFor(37, 37, 0.99)).toBe(1);
  });
});

describe('helpers', () => {
  it('formats with two decimals', () => {
    expect(pct2(1 / 37)).toBe('2.70%');
    expect(pct2(0.63212)).toBe('63.21%');
  });

  it('validates a custom count', () => {
    expect(validCount(1)).toBe(true);
    expect(validCount(36)).toBe(true);
    expect(validCount(0)).toBe(false);
    expect(validCount(37)).toBe(false);
    expect(validCount(2.5)).toBe(false);
    expect(validCount(NaN)).toBe(false);
  });

  it('lists table spins up to the maximum', () => {
    expect(tableSpins(50).at(-1)).toBe(50);
    expect(tableSpins(300).at(-1)).toBe(300);
  });
});
