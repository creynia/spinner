import { describe, expect, it } from 'vitest';
import {
  ONE,
  ZERO,
  add,
  assertCents,
  compare,
  div,
  dollars,
  floorToUnit,
  formatDollarsExact,
  formatMoney,
  formatPct,
  frac,
  isCents,
  mul,
  neg,
  partageLoss,
  partageRefund,
  round,
  scale,
  sub,
  sum,
  toFixed,
  toNumber,
  toRatio,
  type Fraction,
} from './index';

/** Exact mean and variance of a finite outcome list `[net, probability]`. */
function moments(outcomes: [Fraction, Fraction][]): { ev: Fraction; variance: Fraction } {
  const ev = sum(outcomes.map(([x, p]) => mul(x, p)));
  const ex2 = sum(outcomes.map(([x, p]) => mul(mul(x, x), p)));
  return { ev, variance: sub(ex2, mul(ev, ev)) };
}
const n = (x: number): Fraction => frac(x);

describe('Fraction', () => {
  it('normalizes sign and gcd', () => {
    expect(frac(2, -4)).toEqual({ num: -1n, den: 2n });
    expect(frac(0, 7)).toEqual({ num: 0n, den: 1n });
    expect(frac(18n, 36n)).toEqual({ num: 1n, den: 2n });
  });
  it('rejects a zero denominator', () => {
    expect(() => frac(1, 0)).toThrow(RangeError);
    expect(() => div(ONE, ZERO)).toThrow(RangeError);
  });
  it('adds, subtracts, multiplies, divides exactly', () => {
    expect(add(frac(1, 3), frac(1, 6))).toEqual(frac(1, 2));
    expect(sub(frac(1, 3), frac(1, 2))).toEqual(frac(-1, 6));
    expect(mul(frac(2, 3), frac(9, 4))).toEqual(frac(3, 2));
    expect(div(frac(1, 37), frac(1, 74))).toEqual(frac(2));
    expect(neg(frac(1, 37))).toEqual(frac(-1, 37));
    expect(scale(frac(1, 37), 1850)).toEqual(frac(50));
  });
  it('compares without floats', () => {
    expect(compare(frac(1, 3), frac(2, 6))).toBe(0);
    expect(compare(frac(1, 37), frac(1, 38))).toBe(1);
    expect(compare(frac(-1, 37), frac(-1, 38))).toBe(-1);
  });
  it('converts for display', () => {
    expect(toNumber(frac(1, 37))).toBe(1 / 37);
    expect(toNumber(frac(-1368, 1369))).toBe(-1368 / 1369);
    expect(toNumber(frac(1, 3n ** 40n))).toBeCloseTo(1 / 3 ** 40, 40);
    expect(toNumber(frac(10n ** 30n, 3))).toBeCloseTo(1e30 / 3, -15);
    expect(toFixed(frac(-1, 37), 4)).toBe('-0.0270');
    expect(toFixed(frac(1, 2), 0)).toBe('1');
    expect(toRatio(frac(-23, 90))).toBe('-23/90');
    expect(toRatio(frac(5))).toBe('5');
    expect(round(frac(5, 2))).toBe(3);
    expect(round(frac(-5, 2))).toBe(-3);
  });
});

describe('exact roulette moments (game.md §6 reference values)', () => {
  const N = 37;
  const p = (k: number): Fraction => frac(k, N);
  // net per unit staked for a bet covering k of 37 pockets, paying X to 1
  const bet = (k: number, X: number) =>
    moments([
      [n(X), p(k)],
      [n(-1), p(N - k)],
    ]);

  it.each([
    ['straight', 1, 35, frac(46656, 1369)],
    ['split', 2, 17, frac(22680, 1369)],
    ['street', 3, 11, frac(14688, 1369)],
    ['corner', 4, 8, frac(10692, 1369)],
    ['sixline', 6, 5, frac(6696, 1369)],
    ['dozen', 12, 2, frac(2700, 1369)],
    ['even money', 18, 1, frac(1368, 1369)],
  ])('european %s: EV -1/37, variance %s', (_name, k, X, variance) => {
    const m = bet(k, X);
    expect(m.ev).toEqual(frac(-1, 37));
    expect(m.variance).toEqual(variance);
  });

  it('american top line (5 pockets, 6:1) is the -3/38 outlier', () => {
    const m = moments([
      [n(6), frac(5, 38)],
      [n(-1), frac(33, 38)],
    ]);
    expect(m.ev).toEqual(frac(-3, 38));
    expect(m.variance).toEqual(frac(8085, 1444));
  });

  it('la partage halves the even-money edge', () => {
    const m = moments([
      [n(1), p(18)],
      [n(-1), p(18)],
      [frac(-1, 2), p(1)],
    ]);
    expect(m.ev).toEqual(frac(-1, 74));
    expect(m.variance).toEqual(frac(1341, 1369));
  });

  it('en prison, second zero loses: lifetime edge -19/1369', () => {
    // per-round accounting at face value: fresh bet EV 0; imprisoned bet round EV -19/37.
    const fresh = moments([
      [n(1), p(18)],
      [n(-1), p(18)],
      [n(0), p(1)],
    ]);
    const prisoned = moments([
      [n(0), p(18)],
      [n(-1), p(18)],
      [n(-1), p(1)],
    ]);
    expect(fresh.ev).toEqual(ZERO);
    expect(prisoned.ev).toEqual(frac(-19, 37));
    expect(add(fresh.ev, mul(p(1), prisoned.ev))).toEqual(frac(-19, 1369));
  });
});

describe('cents helpers and the rounding policy (game.md §5, §8)', () => {
  it('validates integer cents', () => {
    expect(isCents(2500)).toBe(true);
    expect(isCents(25.5)).toBe(false);
    expect(isCents(Number.NaN)).toBe(false);
    expect(() => assertCents(0.5)).toThrow(RangeError);
    expect(dollars(25)).toBe(2500);
  });
  it('rounds down to the bet unit and never up', () => {
    expect(floorToUnit(3750, 100)).toBe(3700); // red $37.50 -> $37 (example 7)
    expect(floorToUnit(4000, 900)).toBe(3600); // voisins $40, piece $9 -> $36 (example 8)
    expect(floorToUnit(2499, 100)).toBe(2400);
    expect(floorToUnit(99, 100)).toBe(0);
    expect(() => floorToUnit(100, 0)).toThrow(RangeError);
  });
  it('la partage refunds floor(amount / 2)', () => {
    expect(partageRefund(2500)).toBe(1250);
    expect(partageLoss(2500)).toBe(1250);
    expect(partageRefund(2501)).toBe(1250);
    expect(partageLoss(2501)).toBe(1251);
  });
});

describe('formatting', () => {
  it('formatMoney: ASCII minus, grouping, cents only when needed', () => {
    expect(formatMoney(-14)).toBe('-$0.14');
    expect(formatMoney(3900, { sign: true })).toBe('+$39');
    expect(formatMoney(125000)).toBe('$1,250');
    expect(formatMoney(-1250)).toBe('-$12.50');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(0, { sign: true })).toBe('$0.00');
  });
  it('formatDollarsExact: CSV money (harness-data-analysis.md §17)', () => {
    expect(formatDollarsExact(-1)).toBe('-0.01');
    expect(formatDollarsExact(-1250)).toBe('-12.50');
    expect(formatDollarsExact(123456789)).toBe('1234567.89');
    expect(formatDollarsExact(0)).toBe('0.00');
  });
  it('formatPct is exact', () => {
    expect(formatPct(frac(-1, 37))).toBe('-2.70%');
    expect(formatPct(frac(-1, 74))).toBe('-1.35%');
    expect(formatPct(frac(-19, 1369))).toBe('-1.39%');
    expect(formatPct(frac(1, 2), 0)).toBe('50%');
  });
});
