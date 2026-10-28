import { describe, expect, it } from 'vitest';
import { coin, COIN_BET } from '../../testing';
import { checkAtTable, minimumHint } from './check';
import { defaultDenom } from './denoms';

const rules = coin.rules.resolve();
const lim = coin.limits(COIN_BET, rules)!;

describe('checkAtTable (coin plugin)', () => {
  it('maps an accepted row to ok', () => {
    const c = checkAtTable(coin, rules, [{ bet: COIN_BET, cents: lim.min }], 1_000_000);
    expect(c.perSpot).toEqual([{ bet: COIN_BET, asked: lim.min, placed: lim.min, status: 'ok' }]);
    expect(c.total).toBe(lim.min);
    expect(c.affordable).toBe(true);
  });

  it('maps a rejected row (below the minimum) with the plugin code', () => {
    const c = checkAtTable(coin, rules, [{ bet: COIN_BET, cents: lim.min - 1 }], 1_000_000);
    const p = c.perSpot[0]!;
    expect(p.status).toBe('rejected');
    expect(p.placed).toBe(0);
    expect(p.code).toBeTruthy();
    expect(p.reason).toBeTruthy();
    expect(c.total).toBe(0);
  });

  it('maps an adjusted row and reports the placed amount', () => {
    const c = checkAtTable(coin, rules, [{ bet: COIN_BET, cents: lim.max * 2 }], lim.max * 4);
    const p = c.perSpot[0]!;
    expect(p.status).toBe('adjusted');
    expect(p.placed).toBeLessThan(p.asked);
    expect(c.total).toBe(p.placed);
  });

  it('reports unaffordable when the bankroll is below the minimum', () => {
    const c = checkAtTable(coin, rules, [{ bet: COIN_BET, cents: lim.min }], 1);
    expect(c.perSpot[0]!.status).toBe('rejected');
    expect(c.affordable).toBe(false);
  });

  it('keeps one entry per row, in input order', () => {
    const c = checkAtTable(
      coin,
      rules,
      [
        { bet: 'nope', cents: 100 },
        { bet: COIN_BET, cents: lim.min },
      ],
      1_000_000,
    );
    expect(c.perSpot.map((p) => p.bet)).toEqual(['nope', COIN_BET]);
  });
});

describe('defaultDenom (coin plugin)', () => {
  it('picks the smallest denomination that passes', () => {
    const d = defaultDenom(
      coin,
      rules,
      [{ bet: COIN_BET, chips: 1 }],
      [lim.min * 4, lim.min, lim.min * 2],
    );
    expect(d).toEqual({ denom: lim.min, ok: true });
  });
  it('skips denominations that are too small', () => {
    const d = defaultDenom(coin, rules, [{ bet: COIN_BET, chips: 1 }], [1, lim.min]);
    expect(d).toEqual({ denom: lim.min, ok: true });
  });
  it('returns the smallest, flagged, when none qualifies', () => {
    const d = defaultDenom(coin, rules, [{ bet: COIN_BET, chips: 1 }], [1, 2]);
    expect(d).toEqual({ denom: 1, ok: false });
  });
});

describe('minimumHint', () => {
  const hint = (rows: { bet: string; cents: number }[], bankroll = 1_000_000) =>
    minimumHint(coin, rules, rows, checkAtTable(coin, rules, rows, bankroll), bankroll, (b) => b);

  it('says how much to add when only a minimum is short', () => {
    expect(hint([{ bet: COIN_BET, cents: lim.min - 1 }])).toBe(
      `Add $1 more on ${COIN_BET} to reach the table minimum`,
    );
  });

  it('is null when everything is placed', () => {
    expect(hint([{ bet: COIN_BET, cents: lim.min }])).toBeNull();
  });

  it('is null when anything besides a minimum is wrong', () => {
    expect(hint([{ bet: 'nope', cents: lim.min }])).toBeNull();
    expect(hint([{ bet: COIN_BET, cents: lim.max * 2 }], lim.max * 4)).toBeNull();
    expect(hint([{ bet: COIN_BET, cents: lim.min }], 1)).toBeNull();
  });

  it('falls back to a generic line when no addition would help', () => {
    expect(hint([{ bet: COIN_BET, cents: 1 }], 50)).toBe(
      'Add more chips to reach the table minimum',
    );
  });
});
