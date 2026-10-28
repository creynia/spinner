import { describe, expect, it } from 'vitest';
import type { GameEvent, Layout, RoundOutcome } from '../contracts/game';
import { frac, mul, toNumber } from '../money';
import { sessionRng } from '../rng';
import { COIN_BET, COIN_P_HEADS, coin, type CoinState } from './index';

const rules = coin.rules.resolve('standard');
const fresh = (bankroll = 100_000, index = 0): CoinState =>
  coin.createState({ rules, rng: sessionRng(1, index, 'engine'), bankroll });

/** Reconcile, apply every action (never rejected), play one round. */
function round(s: CoinState, desired: Layout): RoundOutcome {
  const rec = coin.reconcile(s, desired);
  for (const a of rec.actions) {
    const r = coin.apply(s, a);
    if (!r.ok) throw new Error(`apply rejected a reconciled action: ${r.code}`);
  }
  return coin.playRound(s).outcome;
}

describe('coin plugin', () => {
  it('has a one-bet catalog and the contract identity', () => {
    expect(coin.id).toBe('coin');
    expect(coin.bets.catalog(rules).map((b) => b.id)).toEqual([COIN_BET]);
    expect(coin.bets.parse(' HEADS ')).toBe('heads');
    expect(coin.bets.parse('tails')).toBeNull();
    expect(coin.facts.facts.map((f) => f.name)).toEqual(['lastHeads', 'headsStreak']);
    expect(coin.pace(rules)).toEqual({ roundsPerHour: 60, label: 'live' });
    expect(coin.limits('heads', rules)).toEqual({ min: 100, max: 100_000 });
    expect(coin.limits('outside', rules)).toEqual({ min: 100, max: 100_000 });
    expect(coin.limits('inside', rules)).toBeNull();
  });

  it('keeps equity change equal to outcome.net over 2,000 rounds', () => {
    const s = fresh();
    let heads = 0;
    for (let i = 0; i < 2000; i++) {
      const before = coin.equity(s);
      const out = round(s, [{ bet: COIN_BET, amount: 100 + (i % 7) * 100 }]);
      expect(coin.equity(s) - before).toBe(out.net);
      if (out.summary.heads) heads++;
      expect(out.events as readonly GameEvent[]).toEqual([{ type: 'flip' }]);
    }
    // 2,000 flips at p = 18/37: 973 expected, SD 22; 6 SD is generous.
    expect(Math.abs(heads - (2000 * 18) / 37)).toBeLessThan(140);
  });

  it('draws exactly once per round, with or without a bet', () => {
    const a = fresh(1000, 3);
    const b = fresh(1000, 3);
    round(a, []);
    round(b, [{ bet: COIN_BET, amount: 100 }]);
    expect(a.rng.snapshot()).toEqual(b.rng.snapshot());
    expect(a.lastHeads).toBe(b.lastHeads);
  });

  it('exact ev agrees with brute force over both outcomes', () => {
    const layout: Layout = [{ bet: COIN_BET, amount: 3700 }];
    const m = coin.ev.layoutMoments(layout, rules);
    expect(m.ev).toEqual(frac(-3700, 37));
    expect(m.variance).toEqual(frac(3700 * 3700 * 1368, 1369));
    // expected LOSS is positive, in cents (decisions G8)
    const view = { ...fresh(), stake: 3700 };
    expect(coin.ev.expectedLossPerRound(view)).toBeCloseTo(-toNumber(m.ev), 9);
    expect(coin.ev.variancePerRound(view)).toBeCloseTo(toNumber(m.variance), 3);
    expect(coin.ev.betEdge(COIN_BET, rules)).toEqual({
      edge: frac(-1, 37),
      perRound: frac(-1, 37),
    });
    expect(mul(COIN_P_HEADS, frac(2))).toEqual(frac(36, 37));
  });

  it('reconcile: merge, round down, clamp, reduce, reject', () => {
    const s = fresh(5000);
    const merged = coin.reconcile(s, [
      { bet: COIN_BET, amount: 300.9 },
      { bet: COIN_BET, amount: 200 },
    ]);
    expect(merged.actions[0]).toEqual({ type: 'place', bet: COIN_BET, amount: 500 });
    expect(merged.adjusted.map((a) => a.reason)).toEqual(['merged', 'rounded']);

    expect(coin.reconcile(s, [{ bet: COIN_BET, amount: 10 ** 6 }]).actions[0]).toEqual({
      type: 'place',
      bet: COIN_BET,
      amount: 5000, // clamp to max 100,000 then reduce to bankroll 5,000
    });
    const poor = fresh(50);
    const rec = coin.reconcile(poor, [{ bet: COIN_BET, amount: 100 }]);
    expect(rec.rejected.map((r) => r.reason)).toEqual(['unaffordable']);
    expect(rec.affordable).toBe(false);
    expect(rec.actions).toEqual([{ type: 'confirm' }]);

    expect(coin.reconcile(s, [{ bet: 'tails', amount: 100 }]).rejected[0]?.reason).toBe(
      'unknown-bet',
    );
    expect(coin.reconcile(s, [{ bet: COIN_BET, amount: 50 }]).rejected[0]?.reason).toBe(
      'below-min',
    );
    expect(coin.reconcile(s, []).affordable).toBe(true);
  });

  it('apply rejects bad actions without changing state', () => {
    const s = fresh(1000);
    expect(coin.apply(s, { type: 'place', bet: 'tails', amount: 100 })).toMatchObject({
      ok: false,
      code: 'unknown-bet',
    });
    expect(coin.apply(s, { type: 'place', bet: COIN_BET, amount: 1.5 })).toMatchObject({
      ok: false,
      code: 'bad-amount',
    });
    expect(coin.apply(s, { type: 'place', bet: COIN_BET, amount: 50 })).toMatchObject({
      ok: false,
      code: 'below-min',
    });
    expect(coin.apply(s, { type: 'place', bet: COIN_BET, amount: 2000 })).toMatchObject({
      ok: false,
      code: 'unaffordable',
    });
    expect(s.bankroll).toBe(1000);
    coin.apply(s, { type: 'confirm' });
    expect(coin.apply(s, { type: 'place', bet: COIN_BET, amount: 100 })).toMatchObject({
      ok: false,
      code: 'after-confirm',
    });
  });

  it('facts read the view; force and serialize round-trip', () => {
    const s = fresh(1000);
    const lastHeads = coin.compileFact('lastHeads', rules);
    const streak = coin.compileFact('headsStreak', rules);
    expect(lastHeads(coin.visible(s), null)).toBeNull();
    coin.force?.(s, ['H', 'H', 'T']);
    round(s, []);
    round(s, []);
    expect([lastHeads(coin.visible(s), null), streak(coin.visible(s), null)]).toEqual([true, 2]);
    round(s, []);
    expect([lastHeads(coin.visible(s), null), streak(coin.visible(s), null)]).toEqual([false, 0]);
    expect(() => coin.compileFact('nope', rules)).toThrow(RangeError);

    const copy = coin.deserialize(JSON.parse(JSON.stringify(coin.serialize(s))));
    expect(round(copy, [])).toEqual(round(s, []));
  });

  it('rules: resolve, normalize and describe', () => {
    expect(coin.rules.resolve({ preset: 'standard', overrides: { max: 5000 } }).max).toBe(5000);
    expect(
      coin.rules.normalize({ preset: 'standard', overrides: { max: 100_000, min: 200 } }),
    ).toEqual({
      preset: 'standard',
      overrides: { min: 200 },
    });
    expect(() => coin.rules.resolve('nope')).toThrow(RangeError);
    expect(() => coin.rules.resolve({ preset: 'standard', overrides: { min: 0 } })).toThrow(
      RangeError,
    );
    expect(coin.rules.describe(rules)[0]).toContain('18/37');
  });
});
