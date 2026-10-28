// WP-L4 (B2): `checkAtTable` with the real roulette plugin. Cases mirror game.md §8.1 rows 1-10,
// plus the base-level below-minimum signal (layouts.md §3.4, S2) and `defaultDenom`.
import { describe, expect, it } from 'vitest';
import type { GamePlugin } from '@core/contracts/game';
import { checkAtTable, defaultDenom } from '@core/ui';
import { ROULETTE_PRESETS, roulette } from '@game/roulette';

const plugin = roulette as unknown as GamePlugin<unknown, unknown, unknown, unknown>;
const EU = ROULETTE_PRESETS.european;
const dollars = (n: number) => Math.round(n * 100);
const check = (bankroll: number, ...rows: [string, number][]) =>
  checkAtTable(
    plugin,
    EU,
    rows.map(([bet, d]) => ({ bet, cents: dollars(d) })),
    dollars(bankroll),
  );

describe('checkAtTable on roulette (game.md §8.1)', () => {
  it('1: a plain bet is ok', () => {
    const c = check(1000, ['red', 25]);
    expect(c.perSpot).toEqual([{ bet: 'red', asked: 2500, placed: 2500, status: 'ok' }]);
    expect(c.total).toBe(2500);
    expect(c.affordable).toBe(true);
  });
  it('2: above the maximum is adjusted (clamped)', () => {
    const c = check(10_000, ['red', 6400]);
    expect(c.perSpot[0]).toMatchObject({ status: 'adjusted', code: 'clamped', placed: 500_000 });
    expect(c.total).toBe(500_000);
  });
  it('3: bet what is left is adjusted (reduced)', () => {
    const c = check(300, ['red', 800]);
    expect(c.perSpot[0]).toMatchObject({ status: 'adjusted', code: 'reduced', placed: 30_000 });
    expect(c.affordable).toBe(true);
  });
  it('4: below the minimum after the bankroll cut is rejected and unaffordable', () => {
    const c = check(10, ['red', 25]);
    expect(c.perSpot[0]).toMatchObject({ status: 'rejected', code: 'unaffordable', placed: 0 });
    expect(c.affordable).toBe(false);
  });
  it('5: a lone $5 straight is rejected for the inside total', () => {
    const c = check(1000, ['straight:17', 5]);
    expect(c.perSpot[0]).toMatchObject({ status: 'rejected', code: 'inside-min-total' });
    expect(c.total).toBe(0);
  });
  it('6: three inside rows reaching $25 are all placed', () => {
    const c = check(1000, ['straight:17', 5], ['split:17-20', 10], ['corner:17-18-20-21', 10]);
    expect(c.perSpot.map((p) => p.status)).toEqual(['ok', 'ok', 'ok']);
    expect(c.total).toBe(2500);
  });
  it('7: a fractional amount is rounded down', () => {
    const c = check(1000, ['red', 37.5]);
    expect(c.perSpot[0]).toMatchObject({ status: 'adjusted', code: 'rounded', placed: 3700 });
  });
  it('8: a call bet rounds to its unit', () => {
    const c = check(1000, ['voisins', 40]);
    expect(c.perSpot[0]).toMatchObject({ status: 'adjusted', code: 'rounded', placed: 3600 });
  });
  it('9: a call bet is clamped to the largest piece every component allows', () => {
    const c = check(10_000, ['orphelins', 3000]);
    expect(c.perSpot[0]).toMatchObject({ status: 'adjusted', code: 'clamped', placed: 250_000 });
  });
  it('10: neighbours share the spot maximum with a straight on that pocket', () => {
    const c = check(10_000, ['straight:17', 400], ['neighbours:17:2', 1500]);
    expect(c.perSpot[0]).toMatchObject({ bet: 'straight:17', status: 'ok' });
    expect(c.perSpot[1]).toMatchObject({ status: 'adjusted', code: 'clamped', placed: 50_000 });
    expect(c.total).toBe(90_000);
  });
});

describe('base-level warning (S2) and defaultDenom', () => {
  it('1 chip on Red at $5 is below the outside minimum and dropped', () => {
    const c = check(1000, ['red', 5]);
    expect(c.perSpot[0]).toMatchObject({ status: 'rejected', code: 'below-min' });
    expect(c.perSpot[0]!.reason).toMatch(/minimum/);
  });
  it('picks the smallest standard denomination that clears the minimums', () => {
    const denoms = [100, 500, 2500, 10_000, 50_000, 100_000];
    expect(defaultDenom(plugin, EU, [{ bet: 'red', chips: 1 }], denoms)).toEqual({
      denom: 2500,
      ok: true,
    });
    expect(
      defaultDenom(
        plugin,
        EU,
        [
          { bet: 'red', chips: 5 },
          { bet: 'straight:17', chips: 5 },
        ],
        denoms,
      ),
    ).toEqual({ denom: 500, ok: true });
  });
  it('flags a layout no standard denomination can satisfy', () => {
    const d = defaultDenom(plugin, EU, [{ bet: 'straight:17', chips: 1000 }], [100, 500]);
    expect(d).toEqual({ denom: 100, ok: false });
  });
});
