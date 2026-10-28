import { describe, expect, it, vi } from 'vitest';
import type { Fraction } from '@core/contracts/game';
import { frac, mul, toNumber, toRatio } from '@core/money';
import { Xoshiro128ss } from '@core/rng';
import { betDef, resolveRules, roulette, ROULETTE_PRESETS } from './index';
import type { WheelKind } from './index';
import { betEdge, betMoments, betOutcomes, layoutMoments, vectorMoments } from './ev';

vi.setConfig({ testTimeout: 120_000 });

const R = (preset: WheelKind, overrides: Record<string, unknown> = {}) =>
  resolveRules({ preset, overrides: overrides as never });
const unit = (f: Fraction, k: number): Fraction => mul(f, frac(1, k));
const r = (f: Fraction | undefined): string => toRatio(f!);

describe('per-bet moments (game.md §6.1)', () => {
  const table: Record<WheelKind, [string, string][]> = {
    european: [
      ['straight:17', '46656/1369'],
      ['split:17-20', '22680/1369'],
      ['street:16-17-18', '14688/1369'],
      ['trio:0-1-2', '14688/1369'],
      ['corner:17-18-20-21', '10692/1369'],
      ['basket', '10692/1369'],
      ['sixline:13-14-15-16-17-18', '6696/1369'],
      ['dozen:2', '2700/1369'],
      ['column:1', '2700/1369'],
      ['red', '1368/1369'],
      ['high', '1368/1369'],
    ],
    american: [
      ['straight:00', '11988/361'],
      ['split:17-20', '5832/361'],
      ['street:16-17-18', '3780/361'],
      ['trio:0-00-2', '3780/361'],
      ['corner:17-18-20-21', '2754/361'],
      ['basket', '8085/1444'],
      ['sixline:13-14-15-16-17-18', '1728/361'],
      ['dozen:2', '702/361'],
      ['red', '360/361'],
    ],
    'triple-zero': [
      ['straight:000', '5472/169'],
      ['split:17-20', '2664/169'],
      ['street:16-17-18', '1728/169'],
      ['corner:17-18-20-21', '1260/169'],
      ['sixline:13-14-15-16-17-18', '792/169'],
      ['basket', '792/169'],
      ['dozen:2', '324/169'],
      ['red', '168/169'],
    ],
  };
  const edge: Record<WheelKind, string> = {
    european: '-1/37',
    american: '-1/19',
    'triple-zero': '-1/13',
  };
  for (const wheel of Object.keys(table) as WheelKind[])
    it.each(table[wheel])(`${wheel} %s has variance %s`, (id, variance) => {
      const m = betMoments(id, R(wheel))!;
      expect(r(m.variance)).toBe(variance);
      expect(r(m.mean)).toBe(id === 'basket' && wheel === 'american' ? '-3/38' : edge[wheel]);
      expect(r(betEdge(id, R(wheel))!.edge)).toBe(r(m.mean));
    });
  it('closed form EV = (k(X+1) - N)/N for every fixed bet', () => {
    for (const wheel of Object.keys(table) as WheelKind[]) {
      const N = { european: 37, american: 38, 'triple-zero': 39 }[wheel];
      for (const id of [
        'straight:1',
        'split:1-2',
        'street:1-2-3',
        'corner:1-2-4-5',
        'red',
        'dozen:1',
      ]) {
        const d = betDef(id, wheel)!;
        const k = d.pockets.length;
        const expected = frac(k * (d.pays + 1) - N, N);
        expect(r(betMoments(id, R(wheel))!.mean)).toBe(r(expected));
        const ex2 = frac(k * d.pays * d.pays + (N - k), N);
        const mean = expected;
        const variance = frac(
          ex2.num * mean.den * mean.den - mean.num * mean.num * ex2.den,
          ex2.den * mean.den * mean.den,
        );
        expect(r(betMoments(id, R(wheel))!.variance)).toBe(r(variance));
      }
    }
  });
  it('edge is negative for every catalog bet; the only exception to -1/N is the american basket', () => {
    for (const wheel of Object.keys(table) as WheelKind[]) {
      for (const e of roulette.bets.catalog(ROULETTE_PRESETS[wheel])) {
        if (e.id.includes('<')) continue;
        const b = betEdge(e.id, ROULETTE_PRESETS[wheel])!;
        expect(b.edge.num < 0n, e.id).toBe(true);
      }
    }
  });
  it('returns null for a bet the wheel does not have', () => {
    expect(betEdge('voisins', ROULETTE_PRESETS.american)).toBeNull();
    expect(betEdge('nonsense', ROULETTE_PRESETS.european)).toBeNull();
    expect(betOutcomes('straight:00', ROULETTE_PRESETS.european)).toBeNull();
  });
});

describe('even money under the zero rules (game.md §6.2)', () => {
  it.each([
    ['none', {}, '-1/37', '1368/1369', '-1/37'],
    ['la partage', { laPartage: true }, '-1/74', '1341/1369', '-1/74'],
    ['en prison, zero loses', { enPrison: true }, '-19/1369', '1849158/1874161', '0'],
    [
      'en prison, re-imprison',
      { enPrison: true, enPrisonSecondZero: 'reimprison' },
      '-1/74',
      '5401/5476',
      '0',
    ],
  ])('%s', (_n, o, mean, variance, perRound) => {
    const rules = R('european', o);
    const m = betMoments('red', rules)!;
    expect(r(m.mean)).toBe(mean);
    expect(r(m.variance)).toBe(variance);
    const e = betEdge('red', rules)!;
    expect(r(e.edge)).toBe(mean);
    expect(r(e.perRound)).toBe(perRound === '0' ? '0' : mean);
    // outcome probabilities add to one
    const total = betOutcomes('red', rules)!.reduce(
      (a, x) => a + Number(x.p.num) / Number(x.p.den),
      0,
    );
    expect(total).toBeCloseTo(1, 12);
  });
  it('per-round accounting of an imprisoned bet (face value)', () => {
    const lose = layoutMoments(
      [{ bet: 'prison:red', amount: 100 }],
      R('european', { enPrison: true }),
    );
    expect(r(unit(lose.ev, 100))).toBe('-19/37');
    expect(r(unit(lose.variance, 10_000))).toBe('342/1369');
    const stay = layoutMoments(
      [{ bet: 'prison:red', amount: 100 }],
      R('european', { enPrison: true, enPrisonSecondZero: 'reimprison' }),
    );
    expect(r(unit(stay.ev, 100))).toBe('-18/37');
    // a fresh bet in its own round: EV 0, variance 36/37
    const fresh = layoutMoments([{ bet: 'red', amount: 100 }], R('european', { enPrison: true }));
    expect(r(fresh.ev)).toBe('0');
    expect(r(unit(fresh.variance, 10_000))).toBe('36/37');
    // 0 + (1/37)(-19/37) = -19/1369
    expect(r(frac(0))).toBe('0');
  });
});

describe('call and neighbour bets (game.md §6.3)', () => {
  const rows: [string, string][] = [
    ['voisins', '4696/4107'],
    ['tiers', '2700/1369'],
    ['orphelins', '135432/34225'],
    ['jeu-zero', '12393/2738'],
    ['neighbours:17:1', '14688/1369'],
    ['neighbours:17:2', '41472/6845'],
    ['neighbours:17:3', '38880/9583'],
    ['neighbours:17:4', '4032/1369'],
    ['neighbours:17:5', '33696/15059'],
    ['neighbours:17:6', '31104/17797'],
    ['neighbours:17:7', '9504/6845'],
    ['neighbours:17:8', '25920/23273'],
    ['neighbours:17:9', '23328/26011'],
  ];
  it.each(rows)('%s variance %s, EV -1/37', (id, variance) => {
    const m = betMoments(id, ROULETTE_PRESETS.european)!;
    expect(r(m.variance)).toBe(variance);
    expect(r(m.mean)).toBe('-1/37');
  });
  it('the neighbour pocket does not matter (wheel symmetry of the maths)', () => {
    for (const p of [0, 5, 26, 36])
      expect(r(betMoments(`neighbours:${p}:3`, ROULETTE_PRESETS.european)!.variance)).toBe(
        '38880/9583',
      );
  });
});

describe('joint variance per round (game.md §6.4)', () => {
  const rows: [string, WheelKind, Record<string, unknown>, [string, number][], string, string][] = [
    [
      'red+black',
      'european',
      {},
      [
        ['red', 1],
        ['black', 1],
      ],
      '-2/37',
      '144/1369',
    ],
    [
      'red+black partage',
      'european',
      { laPartage: true },
      [
        ['red', 1],
        ['black', 1],
      ],
      '-1/37',
      '36/1369',
    ],
    [
      'red+black am',
      'american',
      {},
      [
        ['red', 1],
        ['black', 1],
      ],
      '-2/19',
      '72/361',
    ],
    [
      'dozens eu',
      'european',
      {},
      [
        ['dozen:1', 1],
        ['dozen:2', 1],
      ],
      '-2/37',
      '2808/1369',
    ],
    [
      'dozens am',
      'american',
      {},
      [
        ['dozen:1', 1],
        ['dozen:2', 1],
      ],
      '-2/19',
      '756/361',
    ],
    [
      'red+zero',
      'european',
      {},
      [
        ['red', 1],
        ['straight:0', 1],
      ],
      '-2/37',
      '45432/1369',
    ],
    [
      'red+column2',
      'european',
      {},
      [
        ['red', 1],
        ['column:2', 1],
      ],
      '-2/37',
      '3252/1369',
    ],
    [
      'red+odd',
      'european',
      {},
      [
        ['red', 1],
        ['odd', 1],
      ],
      '-2/37',
      '3104/1369',
    ],
    [
      'red+even',
      'european',
      {},
      [
        ['red', 1],
        ['even', 1],
      ],
      '-2/37',
      '2512/1369',
    ],
    [
      'james bond',
      'european',
      {},
      [
        ['high', 14],
        ['sixline:13-14-15-16-17-18', 5],
        ['straight:0', 1],
      ],
      '-20/37',
      '251496/1369',
    ],
    [
      'all straights',
      'european',
      {},
      Array.from({ length: 37 }, (_, i): [string, number] => [`straight:${i}`, 1]),
      '-1',
      '0',
    ],
  ];
  it.each(rows)('%s', (_n, wheel, o, layout, ev, variance) => {
    const m = layoutMoments(
      layout.map(([bet, u]) => ({ bet, amount: 100 * u })),
      R(wheel, o),
    );
    expect(r(unit(m.ev, 100))).toBe(ev);
    expect(r(unit(m.variance, 10_000))).toBe(variance);
  });
  it('flat red at $25: -67.57 cents a spin', () => {
    const m = layoutMoments([{ bet: 'red', amount: 2500 }], ROULETTE_PRESETS.european);
    expect(toNumber(m.ev)).toBeCloseTo(-2500 / 37, 12);
  });
});

describe('engine moments equal the exact moments', () => {
  it('expectedLossPerRound / variancePerRound match layoutMoments on 1,000 random layouts', () => {
    const rng = new Xoshiro128ss([7, 8, 9, 10]);
    const wheels: WheelKind[] = ['european', 'american', 'triple-zero'];
    const flagged = [{}, { laPartage: true }, { enPrison: true }];
    for (let i = 0; i < 1000; i++) {
      const wheel = wheels[rng.below(3)]!;
      const rules = R(wheel, wheel === 'european' ? flagged[rng.below(3)]! : {});
      const s = roulette.createState({ rules, rng: new Xoshiro128ss([i, 1, 2, 3]), bankroll: 1e9 });
      const ids = roulette.bets
        .catalog(rules)
        .map((e) => e.id)
        .filter((id) => !id.includes('<'));
      const desired = Array.from({ length: 1 + rng.below(6) }, () => ({
        bet: ids[rng.below(ids.length)]!,
        amount: 100 * (1 + rng.below(80)) * (wheel === 'european' && rng.below(4) === 0 ? 9 : 1),
      }));
      for (const a of roulette.reconcile(s, desired).actions) roulette.apply(s, a);
      if (rules.enPrison && rng.below(2)) {
        roulette.force!(s, [0]);
        roulette.playRound(s);
        const again = roulette.reconcile(s, desired);
        for (const a of again.actions) roulette.apply(s, a);
      }
      const view = roulette.visible(s);
      const m = roulette.ev.layoutMoments(roulette.layoutOf(s), rules);
      const loss = roulette.ev.expectedLossPerRound(view);
      expect(Math.abs(loss + toNumber(m.ev))).toBeLessThanOrEqual(
        1e-9 * Math.max(1, Math.abs(loss)),
      );
      const v = roulette.ev.variancePerRound(view);
      expect(Math.abs(v - toNumber(m.variance))).toBeLessThanOrEqual(1e-9 * Math.max(1, v));
    }
  });
  it('the float path and the BigInt fallback agree', () => {
    const small = new Float64Array([3, -2, 7, 0, -5]);
    const a = vectorMoments(small, 5);
    expect(a.loss).toBe(-3 / 5);
    expect(a.variance).toBeCloseTo((5 * 87 - 9) / 25, 12);
    const big = new Float64Array(37).map((_, i) => (i % 2 ? 4e9 : -4e9 - i));
    const b = vectorMoments(big, 37);
    let s = 0n;
    let q = 0n;
    for (const x of big) {
      s += BigInt(x);
      q += BigInt(x) * BigInt(x);
    }
    expect(b.sum).toBe(s);
    expect(b.sumSq).toBe(q);
    expect(b.variance).toBeCloseTo(Number(37n * q - s * s) / 1369, -3);
  });
});
