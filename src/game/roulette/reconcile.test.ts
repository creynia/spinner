import { describe, expect, it, vi } from 'vitest';
import type { LayoutEntry } from '@core/contracts/game';
import { Xoshiro128ss } from '@core/rng';
import { ROULETTE_PRESETS, resolveRules, roulette } from './index';
import type { RouletteAction, RouletteRules } from './index';

vi.setConfig({ testTimeout: 120_000 });

const mk = (rules: RouletteRules, bankroll: number) =>
  roulette.createState({ rules, rng: new Xoshiro128ss([1, 2, 3, 4]), bankroll });
const EU = ROULETTE_PRESETS.european;
const confirm: RouletteAction = { type: 'confirm' };
const place = (bet: string, amount: number): RouletteAction => ({ type: 'place', bet, amount });
const e = (bet: string, amount: number): LayoutEntry => ({ bet, amount });

describe('reconcile examples (game.md §8.1)', () => {
  it('1: a plain bet', () => {
    const r = roulette.reconcile(mk(EU, 100_000), [e('red', 2500)]);
    expect(r).toEqual({
      actions: [place('red', 2500), confirm],
      deferred: [],
      rejected: [],
      adjusted: [],
      affordable: true,
    });
  });
  it('2: above the maximum is clamped and visible', () => {
    const entry = e('red', 640_000);
    const r = roulette.reconcile(mk(EU, 1_000_000), [entry]);
    expect(r.actions).toEqual([place('red', 500_000), confirm]);
    expect(r.adjusted).toEqual([{ entry, to: 500_000, reason: 'clamped' }]);
  });
  it('2b: the reject policy rejects instead', () => {
    const rules = resolveRules({
      preset: 'european',
      overrides: { reconcile: { overMax: 'reject' } },
    });
    const r = roulette.reconcile(mk(rules, 1_000_000), [e('red', 640_000)]);
    expect(r.actions).toEqual([confirm]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['over-max']);
  });
  it('3: bet what is left', () => {
    const entry = e('red', 80_000);
    const r = roulette.reconcile(mk(EU, 30_000), [entry]);
    expect(r.actions).toEqual([place('red', 30_000), confirm]);
    expect(r.adjusted).toEqual([{ entry, to: 30_000, reason: 'reduced' }]);
    expect(r.affordable).toBe(true);
  });
  it('4: below the minimum after the bankroll cut is unaffordable and busts', () => {
    const entry = e('red', 2500);
    const r = roulette.reconcile(mk(EU, 1000), [entry]);
    expect(r.actions).toEqual([confirm]);
    expect(r.rejected).toEqual([{ entry, reason: 'unaffordable' }]);
    expect(r.affordable).toBe(false);
  });
  it('4b: the reject shortfall policy rejects a partly affordable bet', () => {
    const rules = resolveRules({
      preset: 'european',
      overrides: { reconcile: { shortfall: 'reject' } },
    });
    const r = roulette.reconcile(mk(rules, 30_000), [e('red', 80_000)]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['unaffordable']);
    expect(r.affordable).toBe(false);
  });
  it('5: an inside bet below the $25 inside total', () => {
    const entry = e('straight:17', 500);
    const r = roulette.reconcile(mk(EU, 100_000), [entry]);
    expect(r.actions).toEqual([confirm]);
    expect(r.rejected).toEqual([{ entry, reason: 'inside-min-total' }]);
    expect(r.adjusted).toEqual([]);
    expect(r.affordable).toBe(true);
  });
  it('6: three inside bets that total $25', () => {
    const r = roulette.reconcile(mk(EU, 100_000), [
      e('straight:17', 500),
      e('split:17-20', 1000),
      e('corner:17-18-20-21', 1000),
    ]);
    expect(r.actions).toEqual([
      place('straight:17', 500),
      place('split:17-20', 1000),
      place('corner:17-18-20-21', 1000),
      confirm,
    ]);
    expect(r.rejected).toEqual([]);
  });
  it('7: a fractional amount rounds down', () => {
    const entry = e('red', 3750);
    const r = roulette.reconcile(mk(EU, 100_000), [entry]);
    expect(r.actions[0]).toEqual(place('red', 3700));
    expect(r.adjusted).toEqual([{ entry, to: 3700, reason: 'rounded' }]);
  });
  it('8: a call bet rounds down to its unit ($9 for voisins)', () => {
    const entry = e('voisins', 4000);
    const r = roulette.reconcile(mk(EU, 100_000), [entry]);
    expect(r.actions).toEqual([place('voisins', 3600), confirm]);
    expect(r.adjusted).toEqual([{ entry, to: 3600, reason: 'rounded' }]);
  });
  it('9: a call bet is clamped to the largest piece every component allows', () => {
    const entry = e('orphelins', 300_000);
    const r = roulette.reconcile(mk(EU, 1_000_000), [entry]);
    expect(r.actions).toEqual([place('orphelins', 250_000), confirm]);
    expect(r.adjusted).toEqual([{ entry, to: 250_000, reason: 'clamped' }]);
  });
  it('10: spots are shared between a straight and a neighbours bet', () => {
    const nb = e('neighbours:17:2', 150_000);
    const r = roulette.reconcile(mk(EU, 1_000_000), [e('straight:17', 40_000), nb]);
    expect(r.actions).toEqual([
      place('straight:17', 40_000),
      place('neighbours:17:2', 50_000),
      confirm,
    ]);
    expect(r.adjusted).toEqual([{ entry: nb, to: 50_000, reason: 'clamped' }]);
  });
  it('11: a call bet on the american wheel is rejected', () => {
    const entry = e('voisins', 4000);
    const r = roulette.reconcile(mk(ROULETTE_PRESETS.american, 100_000), [entry]);
    expect(r.rejected).toEqual([{ entry, reason: 'not-on-wheel' }]);
  });
  it('12: duplicates are merged into the first occurrence', () => {
    const first = e('red', 2500);
    const r = roulette.reconcile(mk(EU, 100_000), [first, e('Rouge', 2500)]);
    expect(r.actions).toEqual([place('red', 5000), confirm]);
    expect(r.adjusted).toEqual([{ entry: first, to: 5000, reason: 'merged' }]);
  });
  it('13: an imprisoned bet is untouched and the bankroll excludes it', () => {
    const rules = resolveRules({ preset: 'european', overrides: { enPrison: true } });
    const s = mk(rules, 7500);
    roulette.apply(s, place('red', 2500));
    roulette.force!(s, [0]);
    roulette.apply(s, confirm);
    roulette.playRound(s); // 5000 cash, 2500 in prison
    const black = e('black', 5000);
    const r = roulette.reconcile(s, [e('red', 2500), black]);
    expect(r.actions).toEqual([place('red', 2500), place('black', 2500), confirm]);
    expect(r.adjusted).toEqual([{ entry: black, to: 2500, reason: 'reduced' }]);
    for (const a of r.actions) expect(roulette.apply(s, a).ok).toBe(true);
    expect(roulette.layoutOf(s).map((x) => x.bet)).toEqual(['prison:red', 'red', 'black']);
  });
  it('a pre-filled window counts against the outside maximum', () => {
    const s = mk(EU, 2_000_000);
    roulette.apply(s, place('red', 400_000));
    const r = roulette.reconcile(s, [e('red', 500_000)]);
    expect(r.actions).toEqual([place('red', 100_000), confirm]);
    expect(r.adjusted.map((x) => x.reason)).toEqual(['clamped']);
    for (const a of r.actions) expect(roulette.apply(s, a).ok).toBe(true);
  });
  it('rejects unknown, prison and invalid entries; zero is skipped', () => {
    const bad = [e('nope', 2500), e('prison:red', 2500), e('red', Number.NaN), e('black', -1)];
    const zero = e('odd', 0);
    const r = roulette.reconcile(mk(EU, 100_000), [...bad, zero]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'unknown-bet',
      'not-placeable',
      'invalid-amount',
      'invalid-amount',
    ]);
    expect(r.adjusted).toEqual([{ entry: zero, to: 0, reason: 'skipped-zero' }]);
    expect(r.actions).toEqual([confirm]);
    expect(r.affordable).toBe(true);
  });
  it('an inside bet cut by the bankroll below the inside minimum counts as unaffordable', () => {
    const r = roulette.reconcile(mk(EU, 2000), [e('straight:17', 5000)]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['unaffordable']);
    expect(r.affordable).toBe(false);
  });
  it('defers everything once bets are closed', () => {
    const s = mk(EU, 100_000);
    roulette.apply(s, confirm);
    const r = roulette.reconcile(s, [e('red', 2500)]);
    expect(r.actions).toEqual([]);
    expect(r.deferred).toHaveLength(1);
  });
});

const idCache = new Map<RouletteRules, string[]>();
const idsOf = (rules: RouletteRules): string[] => {
  let ids = idCache.get(rules);
  if (!ids) {
    ids = roulette.bets
      .catalog(rules)
      .map((c) => c.id)
      .filter((id) => !id.includes('<'));
    idCache.set(rules, ids);
  }
  return ids;
};

describe('reconcile property: never emits an action apply rejects', () => {
  it('10,000 random desired layouts x bankrolls x wheels x policies', () => {
    const rng = new Xoshiro128ss([2026, 10, 28, 7]);
    const rulesets: RouletteRules[] = [];
    for (const preset of ['european', 'american', 'triple-zero'] as const)
      for (const overMax of ['clamp', 'reject'] as const)
        for (const shortfall of ['reduce', 'reject'] as const)
          for (const cap of [null, 600_000, 20_000])
            rulesets.push(
              resolveRules({
                preset,
                overrides: { reconcile: { overMax, shortfall }, limits: { maxTotalPerSpin: cap } },
              }),
            );
    const junk = ['nope', 'prison:red', 'split:17-21', 'voisins', 'neighbours:5:3', 'straight:00'];
    for (let iter = 0; iter < 10_000; iter++) {
      const rules = rulesets[rng.below(rulesets.length)]!;
      const ids = idsOf(rules);
      const bankroll = [0, 500, 2500, 10_000, 100_000, 3_000_000][rng.below(6)]!;
      const desired: LayoutEntry[] = Array.from({ length: rng.below(7) }, () => {
        const pick = rng.below(20);
        const bet =
          pick === 0
            ? junk[rng.below(junk.length)]!
            : pick < 4 && rules.wheel === 'european'
              ? `neighbours:${rng.below(37)}:${1 + rng.below(9)}`
              : ids[rng.below(ids.length)]!;
        const kind = rng.below(10);
        const amount =
          kind === 0
            ? rng.float53() * 100_000
            : kind === 1
              ? rng.below(3_000_000)
              : kind === 2
                ? [0, -5, Number.POSITIVE_INFINITY][rng.below(3)]!
                : 100 * (1 + rng.below(1000));
        return { bet, amount };
      });
      const s = mk(rules, bankroll);
      let prefilled = 0;
      if (rng.below(4) === 0) {
        // a pre-filled window: some legal entries are already placed
        for (const pre of roulette.reconcile(s, desired.slice(0, 2)).actions) {
          if (pre.type === 'place' && rng.below(2)) {
            roulette.apply(s, pre);
            prefilled += pre.amount;
          }
        }
      }
      const r = roulette.reconcile(s, desired);
      // placed amounts never exceed what was asked for that id (duplicates add up)
      const asked = new Map<string, number>();
      for (const d of desired) {
        const id = roulette.bets.parse(d.bet);
        if (id !== null && Number.isFinite(d.amount) && d.amount > 0)
          asked.set(id, (asked.get(id) ?? 0) + d.amount);
      }
      let spent = 0;
      for (const a of r.actions) {
        const res = roulette.apply(s, a);
        expect(res.ok, JSON.stringify([a, res, desired])).toBe(true);
        if (a.type === 'place') {
          expect(a.amount).toBeLessThanOrEqual(asked.get(a.bet)!);
          expect(Number.isInteger(a.amount) && a.amount % 100 === 0).toBe(true);
          spent += a.amount;
        }
      }
      expect(s.confirmed).toBe(true);
      expect(s.bankroll).toBe(bankroll - spent - prefilled);
      if (prefilled > 0) continue; // idempotence is about a fresh window
      // idempotent on its own output
      const again = roulette.reconcile(
        mk(rules, bankroll),
        r.actions
          .filter((a) => a.type === 'place')
          .map((a) => e((a as { bet: string }).bet, (a as { amount: number }).amount)),
      );
      expect(again.actions).toEqual(r.actions);
      expect(again.adjusted).toEqual([]);
      expect(again.rejected).toEqual([]);
    }
  });
});
