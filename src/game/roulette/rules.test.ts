import { describe, expect, it } from 'vitest';
import { RulesError, ROULETTE_PRESETS, resolveRules, roulette } from './index';
import { normalizeRules } from './rules';

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof RulesError ? e.code : `other:${String(e)}`;
  }
  return 'none';
};
const eu = (overrides: Record<string, unknown>) => ({
  preset: 'european',
  overrides: overrides as never,
});

describe('rules.resolve (game.md §1.1)', () => {
  it('resolves presets by id and defaults to european', () => {
    expect(resolveRules()).toEqual(ROULETTE_PRESETS.european);
    expect(resolveRules('american').wheel).toBe('american');
    expect(resolveRules('triple-zero').limits.inside.max.basket).toBe(300_000);
    expect(resolveRules()).not.toBe(ROULETTE_PRESETS.european);
  });
  it('deep-merges limits, reconcile and pace', () => {
    const r = resolveRules(
      eu({
        limits: { outside: { min: 500 }, inside: { max: { straight: 10_000 } } },
        pace: 'electronic',
      }),
    );
    expect(r.limits.outside).toEqual({ min: 500, max: 500_000 });
    expect(r.limits.inside.max.straight).toBe(10_000);
    expect(r.limits.inside.max.split).toBe(100_000);
    expect(r.pace).toEqual({ roundsPerHour: 100, label: 'electronic' });
    expect(resolveRules(eu({ pace: { roundsPerHour: 60 } })).pace).toEqual({
      roundsPerHour: 60,
      label: 'custom',
    });
    expect(resolveRules(eu({ laPartage: true })).laPartage).toBe(true);
  });
  it.each<[string, unknown, string]>([
    ['flags exclusive', eu({ laPartage: true, enPrison: true }), 'rules/flags-exclusive'],
    [
      'partage needs single zero',
      { preset: 'american', overrides: { laPartage: true } },
      'rules/flag-needs-single-zero',
    ],
    [
      'prison needs single zero',
      { preset: 'triple-zero', overrides: { enPrison: true } },
      'rules/flag-needs-single-zero',
    ],
    ['min above max', eu({ limits: { outside: { min: 600_000 } } }), 'rules/limits'],
    ['not a multiple of the unit', eu({ limits: { outside: { min: 2550 } } }), 'rules/limits'],
    ['non-positive max', eu({ limits: { inside: { max: { split: 0 } } } }), 'rules/limits'],
    ['pace zero', eu({ pace: { roundsPerHour: 0 } }), 'rules/pace'],
    ['pace too high', eu({ pace: { roundsPerHour: 1001 } }), 'rules/pace'],
    ['unknown preset', 'nope', 'rules/preset'],
    ['unknown key', eu({ colour: 'red' }), 'rules/unknown-key'],
    ['pace named like a prototype key', eu({ pace: 'constructor' }), 'rules/pace'],
    ['wrong type', eu({ laPartage: 'yes' }), 'rules/type'],
  ])('rejects: %s', (_n, ref, expected) => {
    expect(code(() => resolveRules(ref as never))).toBe(expected);
  });
  it('normalize prunes overrides equal to the preset', () => {
    expect(normalizeRules('european')).toEqual({ preset: 'european', overrides: {} });
    expect(normalizeRules(eu({ laPartage: false, pace: { roundsPerHour: 40 } }))).toEqual({
      preset: 'european',
      overrides: {},
    });
    expect(
      normalizeRules(eu({ laPartage: true, limits: { outside: { min: 2500, max: 100_000 } } })),
    ).toEqual({
      preset: 'european',
      overrides: { laPartage: true, limits: { outside: { max: 100_000 } } },
    });
    expect(roulette.rules.normalize('american')).toEqual({ preset: 'american', overrides: {} });
    const n = normalizeRules(eu({ enPrison: true, pace: 'electronic' }));
    expect(resolveRules(n)).toEqual(resolveRules(eu({ enPrison: true, pace: 'electronic' })));
  });
  it('describe', () => {
    expect(roulette.rules.describe(ROULETTE_PRESETS.european)).toEqual([
      'European single zero · $25–$5,000 · 40 spins/h',
    ]);
    expect(roulette.rules.describe(resolveRules(eu({ laPartage: true })))[0]).toBe(
      'European single zero · La partage · $25–$5,000 · 40 spins/h',
    );
  });
});

describe('limits and pace', () => {
  const L = (bet: string, p: 'european' | 'american' | 'triple-zero' = 'european') =>
    roulette.limits(bet, ROULETTE_PRESETS[p]);
  it('classes (decisions #3)', () => {
    expect(L('outside')).toEqual({ min: 2500, max: 500_000 });
    expect(L('inside')).toEqual({ min: 100, max: 50_000 });
    expect(L('call')).toEqual({ min: 100, max: 50_000 });
  });
  it('per bet', () => {
    expect(L('red')).toEqual({ min: 2500, max: 500_000 });
    expect(L('dozen:3')).toEqual({ min: 2500, max: 500_000 });
    expect(L('straight:5')).toEqual({ min: 100, max: 50_000 });
    expect(L('split:5-8')).toEqual({ min: 100, max: 100_000 });
    expect(L('street:1-2-3')).toEqual({ min: 100, max: 150_000 });
    expect(L('trio:0-1-2')).toEqual({ min: 100, max: 150_000 });
    expect(L('corner:1-2-4-5')).toEqual({ min: 100, max: 200_000 });
    expect(L('sixline:1-2-3-4-5-6')).toEqual({ min: 100, max: 300_000 });
    expect(L('basket')?.max).toBe(200_000);
    expect(L('basket', 'american')?.max).toBe(250_000);
    expect(L('basket', 'triple-zero')?.max).toBe(300_000);
    expect(L('Rouge')).toEqual(L('red'));
  });
  it('call bets give totals (game.md §4)', () => {
    expect(L('voisins')).toEqual({ min: 900, max: 675_000 });
    expect(L('tiers')).toEqual({ min: 600, max: 600_000 });
    expect(L('orphelins')).toEqual({ min: 500, max: 250_000 });
    expect(L('jeu-zero')).toEqual({ min: 400, max: 200_000 });
    expect(L('neighbours:17:2')).toEqual({ min: 500, max: 250_000 });
    expect(L('neighbours:17:9')).toEqual({ min: 1900, max: 950_000 });
  });
  it('null for unknown or unavailable bets', () => {
    expect(L('nope')).toBeNull();
    expect(L('voisins', 'american')).toBeNull();
    expect(L('prison:red')).toBeNull();
  });
  it('maximum payouts stay within 35 x $500 (inside bets)', () => {
    const pays: Record<string, number> = {
      'straight:1': 35,
      'split:1-2': 17,
      'street:1-2-3': 11,
      'corner:1-2-4-5': 8,
      'sixline:1-2-3-4-5-6': 5,
    };
    for (const [id, p] of Object.entries(pays))
      expect(L(id)!.max * p).toBeLessThanOrEqual(1_750_000);
  });
  it('pace 40 live, 100 electronic', () => {
    expect(roulette.pace(ROULETTE_PRESETS.european)).toEqual({ roundsPerHour: 40, label: 'live' });
    expect(roulette.pace(resolveRules(eu({ pace: 'electronic' })))).toEqual({
      roundsPerHour: 100,
      label: 'electronic',
    });
  });
});
