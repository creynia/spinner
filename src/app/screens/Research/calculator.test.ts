// The calculator reproduces the ladderMath pins, the chapter 3 and 4 horizons and the cash-out
// numbers of the cash-out chapter.
import { describe, expect, it } from 'vitest';
import { CALC_DEFAULTS, CALC_PRESETS, calculate, cashOut, validate } from './calculator';
import { ladder, type LadderResult } from './ladderMath';

const preset = (id: string) => CALC_PRESETS.find((p) => p.id === id)!.input;

describe('calculate', () => {
  it('Martingale red, 8 levels: q 0.0048, n½ 295', () => {
    const r = calculate({
      c: 18,
      base: 2500,
      unit: 2500,
      betMax: 500000,
      bankroll: 2500 * 255,
      spins: 500,
      w: 0,
    }).ladder;
    expect(r.L).toBe(8);
    expect(r.q).toBeCloseTo(0.0048, 4);
    expect(Math.abs(r.nHalf - 295)).toBeLessThan(3);
    expect(r.firstDeficitLevel).toBeNull();
  });

  it('red $5 doubling: 10 levels, n½ within 3 of 1,117', () => {
    const r = calculate(preset('red-5'));
    expect(r.ladder.L).toBe(10);
    expect(Math.abs(r.ladder.nHalf - 1117)).toBeLessThan(3);
    expect(r.ladder.amounts.slice(0, 3)).toEqual([500, 1000, 2000]);
    expect(r.ladder.amounts.at(-1)).toBe(256000);
    expect(r.typical).toBeGreaterThan(0);
  });

  it('red $25 doubling from the default bankroll: 7 levels', () => {
    expect(calculate(preset('red-25')).ladder.L).toBe(7);
  });

  it('dozen x1.5 from $25: 11 levels, n½ within 3 of 159', () => {
    const r = calculate(preset('dozen-15'));
    expect(r.ladder.L).toBe(11);
    expect(Math.abs(r.ladder.nHalf - 159)).toBeLessThan(3);
  });

  it('agrees with ladder() when there is no cash-out', () => {
    const i = { ...CALC_DEFAULTS, bankroll: 511500, base: 500, unit: 500 };
    const direct = ladder({ c: 18, base: 500, unit: 500, betMax: 500000, bankroll: 511500 });
    const r = calculate(i);
    expect(r.pWin).toBeCloseTo(direct.pNoCap, 12);
    expect(r.typical).toBe(direct.predictedMedian);
    expect(r.capLoss).toBe(direct.totalStake);
  });

  it('flags slow growth through the ladder result', () => {
    const l = ladder({ c: 18, g: 1.5, base: 1000, unit: 100, betMax: 1e6, maxLevels: 5 });
    expect(l.firstDeficitLevel).toBe(2);
  });
});

describe('cashOut', () => {
  // c9: q = 0.00356, p = 0.2227 (design section 7, plan 7.11)
  const c9 = { q: 0.00356, p: 0.2227, profitPerCycle: 1400 } as LadderResult;

  it('W20 ≈ 0.931 and W100 ≈ 0.70', () => {
    expect(cashOut(c9, 20, 500).pWin).toBeCloseTo(0.931, 3);
    expect(cashOut(c9, 100, 500).pWin).toBeCloseTo(0.7, 2);
  });

  it('the typical session is the target while more than half end ahead', () => {
    expect(cashOut(c9, 20, 500).typical).toBe(20 * 1400);
    expect(cashOut(c9, 100, 500).typical).toBe(100 * 1400);
  });

  it('a target beyond the cycles a session plays counts only the cycles it plays', () => {
    const r = cashOut(c9, 1000, 500);
    expect(r.pWin).toBeCloseTo(Math.exp(-0.00356 * 0.2227 * 500), 12);
  });

  it('goes negative once fewer than half end ahead', () => {
    const r = { q: 0.05, p: 0.5, profitPerCycle: 100 } as LadderResult;
    expect(cashOut(r, 0, 500).typical).toBe('negative');
  });
});

describe('validate', () => {
  it('accepts the defaults and every preset', () => {
    expect(validate(CALC_DEFAULTS)).toEqual({});
    for (const p of CALC_PRESETS) expect(validate(p.input), p.id).toEqual({});
  });

  it('reports each bad field with the design text', () => {
    expect(validate({ ...CALC_DEFAULTS, c: 40 }).c).toBe('Pick 1 to 35 numbers.');
    expect(validate({ ...CALC_DEFAULTS, base: 600000 }).base).toBe(
      'The first bet must fit under the bet maximum.',
    );
    expect(validate({ ...CALC_DEFAULTS, bankroll: 1000 }).bankroll).toBe(
      'The bankroll must cover the first bet.',
    );
    expect(validate({ ...CALC_DEFAULTS, spins: 0 }).spins).toBe('Spins: 1 to 100,000.');
    expect(validate({ ...CALC_DEFAULTS, spins: 100001 }).spins).toBe('Spins: 1 to 100,000.');
    expect(validate({ ...CALC_DEFAULTS, w: 1001 }).w).toBe('0 to 1,000 cycle wins.');
  });
});
