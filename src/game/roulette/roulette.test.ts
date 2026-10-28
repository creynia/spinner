import { describe, expect, it } from 'vitest';
import {
  BET_FAMILIES,
  CALL_BET_IDS,
  OUTSIDE_BET_IDS,
  RED_NUMBERS,
  ROULETTE_PRESETS,
  RULE_PRESET_IDS,
  SECTORS,
  STRATEGY_PRESET_IDS,
  WHEEL_ORDER,
  catalog,
  familyOf,
  fixedBetIds,
  pocketLabels,
  roulette,
  rouletteFacts,
} from './index';

const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const BET_ID =
  /^(straight|split|street|trio|corner|sixline):(00?0?|[1-9]\d?)(-(00?0?|[1-9]\d?))*$|^basket$/;

describe('roulette plugin identity and stubs', () => {
  it('declares the plugin and no ui field', () => {
    expect(roulette.id).toBe('roulette');
    expect(roulette.rules.defaultPreset).toBe('european');
    expect(Object.keys(roulette.rules.presets)).toEqual([...RULE_PRESET_IDS]);
    expect('ui' in roulette).toBe(false);
  });
  it('throws TODO(game) from the engine until the game WP lands', () => {
    expect(() =>
      roulette.createState({ rules: ROULETTE_PRESETS.european, rng: null as never, bankroll: 0 }),
    ).toThrow('TODO(game)');
    expect(() => roulette.bets.parse('red')).toThrow('TODO(game)');
  });
  it('pace follows the rules (reconciliation G9)', () => {
    expect(roulette.pace(ROULETTE_PRESETS.european)).toEqual({ roundsPerHour: 40, label: 'live' });
  });
});

describe('rules presets (game.md §1.1, §4)', () => {
  it('european is the default high-limit table', () => {
    const r = ROULETTE_PRESETS.european;
    expect(r).toMatchObject({ wheel: 'european', laPartage: false, enPrison: false });
    expect(r.limits.outside).toEqual({ min: 2500, max: 500_000 });
    expect(r.limits.inside.minTotal).toBe(2500);
    expect(r.limits.inside.max.straight).toBe(50_000);
    // maximum payout stays at or under 35 x $500 = $17,500 for every spot (decisions #3)
    const pays = {
      straight: 35,
      split: 17,
      street: 11,
      trio: 11,
      corner: 8,
      basket: 8,
      sixline: 5,
    };
    for (const [spot, max] of Object.entries(r.limits.inside.max)) {
      expect(max * pays[spot as keyof typeof pays]).toBeLessThanOrEqual(1_750_000);
    }
  });
  it('the basket maximum depends on the wheel', () => {
    expect(ROULETTE_PRESETS.european.limits.inside.max.basket).toBe(200_000);
    expect(ROULETTE_PRESETS.american.limits.inside.max.basket).toBe(250_000);
    expect(ROULETTE_PRESETS['triple-zero'].limits.inside.max.basket).toBe(300_000);
  });
});

describe('bet catalog (game.md §3.1 sizes)', () => {
  it.each([
    ['european', 157],
    ['american', 161],
    ['triple-zero', 160],
  ] as const)('%s has %i fixed ids, all unique and well formed', (wheel, n) => {
    const ids = fixedBetIds(wheel);
    expect(ids).toHaveLength(n);
    expect(new Set(ids).size).toBe(n);
    for (const id of ids) {
      expect(BET_ID.test(id) || (OUTSIDE_BET_IDS as readonly string[]).includes(id), id).toBe(true);
      expect(familyOf(id), id).not.toBeNull();
    }
  });
  it('lists the family counts of the european wheel', () => {
    const count = (f: string) => fixedBetIds('european').filter((id) => familyOf(id) === f).length;
    expect([
      count('straight'),
      count('split'),
      count('street'),
      count('trio'),
      count('corner'),
    ]).toEqual([37, 60, 12, 2, 22]);
    expect([
      count('basket'),
      count('sixline'),
      count('even-money'),
      count('dozen'),
      count('column'),
    ]).toEqual([1, 11, 6, 3, 3]);
  });
  it('catalog() adds the call bets and one parameterised neighbours entry on the european wheel', () => {
    const eu = catalog(ROULETTE_PRESETS.european);
    expect(eu).toHaveLength(157 + 4 + 1);
    expect(eu.filter((b) => b.limitClass === 'call').map((b) => b.id)).toEqual([
      ...CALL_BET_IDS,
      'neighbours:<p>:<k>',
    ]);
    expect(eu.find((b) => b.id === 'neighbours:<p>:<k>')?.parameters).toEqual({
      p: 'number',
      k: 'number',
    });
    expect(catalog(ROULETTE_PRESETS.american)).toHaveLength(161);
    expect(new Set(eu.map((b) => b.category))).toEqual(new Set(BET_FAMILIES));
    expect(eu.find((b) => b.id === 'red')).toMatchObject({
      category: 'even-money',
      limitClass: 'outside',
    });
    expect(eu.find((b) => b.id === 'straight:17')).toMatchObject({
      category: 'straight',
      limitClass: 'inside',
    });
  });
  it('zero-row ids are in canonical pocket order', () => {
    const am = fixedBetIds('american');
    for (const id of ['split:0-00', 'split:00-2', 'trio:0-00-2', 'trio:00-2-3'])
      expect(am).toContain(id);
    expect(fixedBetIds('triple-zero')).toContain('trio:0-00-000');
  });
});

describe('wheel data (game.md §2)', () => {
  it('has 18 reds', () => {
    expect(RED_NUMBERS).toHaveLength(18);
  });
  it('wheel orders are permutations of the pockets', () => {
    for (const wheel of ['european', 'american'] as const) {
      expect([...WHEEL_ORDER[wheel]].sort()).toEqual([...pocketLabels(wheel)].sort());
    }
  });
  it('colours alternate around the european wheel (zero excepted)', () => {
    const order = WHEEL_ORDER.european.map(Number);
    const red = new Set(RED_NUMBERS);
    for (let i = 1; i < order.length - 1; i++) {
      expect(red.has(order[i]!), `pocket ${order[i]}`).not.toBe(red.has(order[i + 1]!));
    }
  });
  it('voisins, tiers and orphelins partition the european wheel', () => {
    const all = [...SECTORS.voisins, ...SECTORS.tiers, ...SECTORS.orphelins];
    expect(all).toHaveLength(37);
    expect([...all].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    expect([
      SECTORS.voisins.length,
      SECTORS.tiers.length,
      SECTORS.orphelins.length,
      SECTORS['jeu-zero'].length,
    ]).toEqual([17, 12, 8, 7]);
    for (const p of SECTORS['jeu-zero']) expect(SECTORS.voisins).toContain(p);
  });
});

describe('fact schema (game.md §9; reconciliation F1, F2)', () => {
  const names = rouletteFacts.facts.map((f) => f.name);
  it('has unique fact names and exactly the six plugin events', () => {
    expect(new Set(names).size).toBe(names.length);
    expect(rouletteFacts.events.map((e) => e.name)).toEqual([
      'spin',
      'zero',
      'partage',
      'imprisoned',
      'released',
      'prison-lost',
    ]);
  });
  it('puts the greedy target parameter last: count:<n>:<target>', () => {
    const count = rouletteFacts.facts.find((f) => f.name === 'count');
    expect(count?.params?.map((p) => [p.name, p.type])).toEqual([
      ['n', 'number'],
      ['target', 'target'],
    ]);
    for (const f of rouletteFacts.facts) {
      const targets = (f.params ?? [])
        .map((p) => p.type)
        .filter((t) => t === 'target' || t === 'bet');
      if (targets.length) expect(['target', 'bet']).toContain(f.params!.at(-1)!.type);
    }
  });
  it('every last* fact is round-scoped and nullable', () => {
    for (const f of rouletteFacts.facts.filter((x) => x.name.startsWith('last'))) {
      expect(f).toMatchObject({ scope: 'round', nullable: true });
    }
  });
});

describe('strategy presets (decisions #10; reconciliation S1)', () => {
  it('lists the twelve day-one ids, all valid slugs', () => {
    expect(STRATEGY_PRESET_IDS).toHaveLength(12);
    expect(new Set(STRATEGY_PRESET_IDS).size).toBe(12);
    for (const id of STRATEGY_PRESET_IDS) expect(id).toMatch(SLUG);
    expect(STRATEGY_PRESET_IDS).toContain('one-three-two-six-red');
    expect(STRATEGY_PRESET_IDS).toContain('red-mart-then-flat');
  });
});
