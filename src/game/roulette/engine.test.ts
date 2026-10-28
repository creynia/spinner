import { describe, expect, it } from 'vitest';
import type { Rng } from '@core/contracts/game';
import { Xoshiro128ss } from '@core/rng';
import { ROULETTE_PRESETS, resolveRules, roulette } from './index';
import type { RouletteAction, RouletteRules, RouletteState, WheelKind } from './index';

const BANK = 1_000_000;
const mk = (rules: RouletteRules = ROULETTE_PRESETS.european, bankroll = BANK, rng?: Rng) =>
  roulette.createState({ rules, rng: rng ?? new Xoshiro128ss([42, 1, 2, 3]), bankroll });
const eu = (o: Record<string, unknown>) =>
  resolveRules({ preset: 'european', overrides: o as never });
const place = (s: RouletteState, bet: string, amount: number) => {
  const r = roulette.apply(s, { type: 'place', bet, amount });
  expect(r, `${bet} ${amount}`).toMatchObject({ ok: true });
};
const confirm = (s: RouletteState) => expect(roulette.apply(s, { type: 'confirm' }).ok).toBe(true);
const spin = (s: RouletteState, pocket: string | number) => {
  roulette.force!(s, [pocket]);
  confirm(s);
  return roulette.playRound(s).outcome;
};
const code = (s: RouletteState, a: RouletteAction) => {
  const r = roulette.apply(s, a);
  return r.ok ? 'ok' : r.code;
};

describe('engine flows (forced pockets)', () => {
  it('a straight hit pays 35 to 1 and returns the stake', () => {
    const s = mk();
    place(s, 'straight:17', 2500);
    expect(s.bankroll).toBe(BANK - 2500);
    const out = spin(s, 17);
    expect(out).toMatchObject({ net: 87_500, wagered: 2500 });
    expect(out.resolutions).toEqual([
      { bet: 'straight:17', amount: 2500, result: 'win', profit: 87_500 },
    ]);
    expect(s.bankroll).toBe(BANK + 87_500);
    expect(out.summary).toMatchObject({
      pocket: '17',
      color: 'black',
      parity: 'odd',
      half: 'low',
      dozen: 2,
      column: 2,
      sector: 'orphelins',
    });
    expect(out.events).toEqual([{ type: 'spin' }]);
  });
  it('a loss costs the stake and a push returns it', () => {
    const s = mk();
    place(s, 'red', 2500);
    expect(spin(s, 2).net).toBe(-2500);
    expect(s.bankroll).toBe(BANK - 2500);
  });
  it('la partage on 0: half back, exactly -$12.50 on $25', () => {
    const s = mk(eu({ laPartage: true }));
    place(s, 'red', 2500);
    const out = spin(s, 0);
    expect(out.resolutions[0]).toMatchObject({ result: 'lose', profit: -1250 });
    expect(out.events).toEqual([
      { type: 'spin' },
      { type: 'zero' },
      { type: 'partage', bet: 'red' },
    ]);
    expect(s.bankroll).toBe(BANK - 1250);
    // dozens and straights are not even money
    place(s, 'dozen:1', 2500);
    expect(spin(s, 0).resolutions[0]!.profit).toBe(-2500);
  });
  describe('en prison', () => {
    it('0 then red: the bet is released with no winnings', () => {
      const s = mk(eu({ enPrison: true }));
      place(s, 'red', 2500);
      const a = spin(s, 0);
      expect(a.resolutions).toEqual([{ bet: 'red', amount: 2500, result: 'stays', profit: 0 }]);
      expect(a.events).toEqual([
        { type: 'spin' },
        { type: 'zero' },
        { type: 'imprisoned', bet: 'red' },
      ]);
      expect(roulette.equity(s)).toBe(BANK);
      expect(s.bankroll).toBe(BANK - 2500);
      expect(roulette.layoutOf(s)).toEqual([{ bet: 'prison:red', amount: 2500 }]);
      const b = spin(s, 1);
      expect(b.resolutions).toEqual([
        { bet: 'prison:red', amount: 2500, result: 'push', profit: 0 },
      ]);
      expect(b.events).toEqual([{ type: 'spin' }, { type: 'released', bet: 'red' }]);
      expect(b).toMatchObject({ net: 0, wagered: 0 });
      expect(s.bankroll).toBe(BANK);
      expect(s.prison).toEqual([]);
    });
    it('0 then black: the bet is lost', () => {
      const s = mk(eu({ enPrison: true }));
      place(s, 'red', 2500);
      spin(s, 0);
      const b = spin(s, 2);
      expect(b.resolutions[0]).toMatchObject({ result: 'lose', profit: -2500 });
      expect(b.events).toEqual([{ type: 'spin' }, { type: 'prison-lost', bet: 'red' }]);
      expect(s.bankroll).toBe(BANK - 2500);
      expect(roulette.equity(s)).toBe(BANK - 2500);
    });
    it('0 then 0: lost by default, re-imprisoned in the variant', () => {
      const lose = mk(eu({ enPrison: true }));
      place(lose, 'red', 2500);
      spin(lose, 0);
      const l = spin(lose, 0);
      expect(l.resolutions[0]).toMatchObject({ result: 'lose', profit: -2500 });
      expect(l.events).toContainEqual({ type: 'prison-lost', bet: 'red' });
      const stay = mk(eu({ enPrison: true, enPrisonSecondZero: 'reimprison' }));
      place(stay, 'red', 2500);
      spin(stay, 0);
      const t = spin(stay, 0);
      expect(t.resolutions[0]).toMatchObject({ bet: 'prison:red', result: 'stays', profit: 0 });
      expect(t.events).toContainEqual({ type: 'imprisoned', bet: 'red' });
      expect(stay.prison).toHaveLength(1);
      expect(spin(stay, 2).resolutions[0]!.result).toBe('lose');
    });
    it('a new red bet in the prison round is an independent entry; prison resolves first', () => {
      const s = mk(eu({ enPrison: true }));
      place(s, 'red', 2500);
      spin(s, 0);
      place(s, 'red', 5000);
      const out = spin(s, 1);
      expect(out.resolutions.map((r) => [r.bet, r.result, r.profit])).toEqual([
        ['prison:red', 'push', 0],
        ['red', 'win', 5000],
      ]);
      expect(out).toMatchObject({ net: 5000, wagered: 5000 });
    });
    it('a round with only an imprisoned bet still spins', () => {
      const s = mk(eu({ enPrison: true }));
      place(s, 'black', 2500);
      spin(s, 0);
      const round = s.round;
      roulette.force!(s, [5]);
      roulette.playRound(s); // no confirm needed: nothing placed
      expect(s.round).toBe(round + 1);
      expect(s.prison).toEqual([]);
    });
    it('does not apply to other bets, nor on the american wheel (flags are forbidden there)', () => {
      const s = mk(eu({ enPrison: true }));
      place(s, 'dozen:1', 2500);
      expect(spin(s, 0).resolutions[0]!.result).toBe('lose');
      expect(() => resolveRules({ preset: 'american', overrides: { enPrison: true } })).toThrow();
    });
  });
  it('call bets resolve as one entry', () => {
    const s = mk();
    place(s, 'voisins', 2700);
    expect(s.layout[0]!.chips).toEqual([
      { spot: 'trio:0-2-3', amount: 600 },
      { spot: 'split:4-7', amount: 300 },
      { spot: 'split:12-15', amount: 300 },
      { spot: 'split:18-21', amount: 300 },
      { spot: 'split:19-22', amount: 300 },
      { spot: 'split:32-35', amount: 300 },
      { spot: 'corner:25-26-28-29', amount: 600 },
    ]);
    const out = spin(s, 0);
    expect(out.resolutions).toEqual([
      { bet: 'voisins', amount: 2700, result: 'win', profit: 4500 },
    ]);
  });
  it('placing the same id twice adds to the entry and remove credits it back', () => {
    const s = mk();
    place(s, 'red', 2500);
    place(s, 'red', 2500);
    expect(s.layout).toHaveLength(1);
    expect(s.layout[0]!.amount).toBe(5000);
    expect(code(s, { type: 'remove', bet: 'rouge' })).toBe('ok');
    expect(s.bankroll).toBe(BANK);
    expect(s.layout).toHaveLength(0);
  });
});

describe('apply codes (game.md §7.2), one test each', () => {
  const eur = () => mk();
  it.each<[string, (s: RouletteState) => string, string]>([
    ['unknown-bet', (s) => code(s, { type: 'place', bet: 'nope', amount: 2500 }), 'unknown-bet'],
    [
      'not-on-wheel',
      (s) => code(s, { type: 'place', bet: 'straight:00', amount: 2500 }),
      'not-on-wheel',
    ],
    [
      'not-on-wheel (call bet on american)',
      (s) =>
        code(mk(ROULETTE_PRESETS.american), { type: 'place', bet: 'voisins', amount: 900 }) +
        s.round,
      'not-on-wheel0',
    ],
    [
      'not-placeable',
      (s) => code(s, { type: 'place', bet: 'prison:red', amount: 2500 }),
      'not-placeable',
    ],
    [
      'bad-amount (fraction)',
      (s) => code(s, { type: 'place', bet: 'red', amount: 2550 }),
      'bad-amount',
    ],
    ['bad-amount (zero)', (s) => code(s, { type: 'place', bet: 'red', amount: 0 }), 'bad-amount'],
    [
      'bad-amount (call unit)',
      (s) => code(s, { type: 'place', bet: 'voisins', amount: 3600 + 100 }),
      'bad-amount',
    ],
    [
      'below-min (outside)',
      (s) => code(s, { type: 'place', bet: 'red', amount: 2400 }),
      'below-min',
    ],
    [
      'over-max (outside)',
      (s) => code(s, { type: 'place', bet: 'red', amount: 500_100 }),
      'over-max',
    ],
    [
      'over-max (straight)',
      (s) => code(s, { type: 'place', bet: 'straight:17', amount: 50_100 }),
      'over-max',
    ],
    [
      'over-max (shared spot)',
      (s) => {
        place(s, 'straight:17', 40_000);
        return code(s, { type: 'place', bet: 'neighbours:17:2', amount: 5 * 20_000 });
      },
      'over-max',
    ],
    [
      'unaffordable',
      (s) =>
        code(mk(ROULETTE_PRESETS.european, 2000), {
          type: 'place',
          bet: 'straight:1',
          amount: 2100,
        }) + s.round,
      'unaffordable0',
    ],
    [
      'inside-min-total',
      (s) => {
        place(s, 'straight:17', 500);
        return code(s, { type: 'confirm' });
      },
      'inside-min-total',
    ],
    [
      'table-max',
      (s) => {
        s.rules = { ...s.rules, limits: { ...s.rules.limits, maxTotalPerSpin: 5000 } };
        place(s, 'red', 2500);
        place(s, 'black', 2500);
        place(s, 'odd', 2500);
        return code(s, { type: 'confirm' });
      },
      'table-max',
    ],
    ['not-placed', (s) => code(s, { type: 'remove', bet: 'red' }), 'not-placed'],
    [
      'after-confirm (place)',
      (s) => {
        confirm(s);
        return code(s, { type: 'place', bet: 'red', amount: 2500 });
      },
      'after-confirm',
    ],
    [
      'after-confirm (remove)',
      (s) => {
        place(s, 'red', 2500);
        confirm(s);
        return code(s, { type: 'remove', bet: 'red' });
      },
      'after-confirm',
    ],
  ])('%s', (_n, run, expected) => {
    expect(run(eur())).toBe(expected);
  });
  it('a rejected action changes nothing', () => {
    const s = eur();
    place(s, 'red', 2500);
    const before = JSON.stringify(roulette.serialize(s));
    code(s, { type: 'place', bet: 'black', amount: 999_999_900 });
    expect(JSON.stringify(roulette.serialize(s))).toBe(before);
  });
  it('playRound throws on an unconfirmed layout; an empty confirm is legal', () => {
    const s = eur();
    place(s, 'red', 2500);
    expect(() => roulette.playRound(s)).toThrow(/unconfirmed/);
    expect(code(eur(), { type: 'confirm' })).toBe('ok');
  });
});

describe('RNG discipline', () => {
  const counting = (inner: Xoshiro128ss) => {
    const calls: number[] = [];
    const rng: Rng = {
      next: () => inner.next(),
      below: (n) => {
        calls.push(n);
        return inner.below(n);
      },
      float53: () => inner.float53(),
      snapshot: () => inner.snapshot(),
    };
    return { rng, calls };
  };
  it.each<[WheelKind, number]>([
    ['european', 37],
    ['american', 38],
    ['triple-zero', 39],
  ])('draws exactly one below(%s) per round, with or without bets', (wheel, n) => {
    const { rng, calls } = counting(new Xoshiro128ss([42, 1, 2, 3]));
    const s = mk(ROULETTE_PRESETS[wheel], BANK, rng);
    for (let i = 0; i < 10; i++) {
      if (i % 2) place(s, 'red', 2500);
      confirm(s);
      roulette.playRound(s);
    }
    expect(calls).toEqual(Array(10).fill(n));
  });
  it('the pocket sequence is identical for an empty and a busy strategy', () => {
    const seq = (bets: boolean) => {
      const s = mk(ROULETTE_PRESETS.european, BANK, new Xoshiro128ss([9, 9, 9, 9]));
      const out: string[] = [];
      for (let i = 0; i < 200; i++) {
        if (bets) {
          for (const a of roulette.reconcile(s, [
            { bet: 'red', amount: 2500 },
            { bet: 'straight:5', amount: 2500 },
          ]).actions)
            roulette.apply(s, a);
        } else confirm(s);
        out.push(String(roulette.playRound(s).outcome.summary.pocket));
      }
      return out;
    };
    expect(seq(true)).toEqual(seq(false));
  });
  it('rejection limits (game.md §7.3)', () => {
    const limit = (n: number) => 2 ** 32 - (2 ** 32 % n);
    expect([limit(37), limit(38), limit(39)]).toEqual([4294967289, 4294967290, 4294967274]);
  });
  it('golden pocket sequences for seed [42,1,2,3]', () => {
    const run = (wheel: WheelKind) => {
      const s = mk(ROULETTE_PRESETS[wheel]);
      return Array.from({ length: 12 }, () =>
        String(roulette.playRound(s).outcome.summary.pocket),
      ).join(' ');
    };
    expect(run('european')).toBe(GOLDEN.european);
    expect(run('american')).toBe(GOLDEN.american);
    expect(run('triple-zero')).toBe(GOLDEN['triple-zero']);
  });
  it.each<[WheelKind, number]>([
    ['european', 69.35],
    ['american', 70.71],
    ['triple-zero', 72.06],
  ])('chi-square uniformity over 370,000 spins on %s (p > 0.001)', (wheel, critical) => {
    const s = mk(ROULETTE_PRESETS[wheel], 0, new Xoshiro128ss([2026, 10, 28, 1]));
    const n = s.wheel.n;
    const counts = new Array<number>(n).fill(0);
    const total = 370_000;
    for (let i = 0; i < total; i++)
      counts[roulette.playRound(s).outcome.summary.index as number]!++;
    const expected = total / n;
    const chi = counts.reduce((a, c) => a + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(critical);
  });
});

describe('conservation and persistence', () => {
  it('money is conserved over 3,000 random rounds on every rule set', () => {
    const sets = [
      ROULETTE_PRESETS.european,
      eu({ laPartage: true }),
      eu({ enPrison: true }),
      eu({ enPrison: true, enPrisonSecondZero: 'reimprison' }),
      ROULETTE_PRESETS.american,
      ROULETTE_PRESETS['triple-zero'],
    ];
    for (const rules of sets) {
      const rng = new Xoshiro128ss([5, 6, 7, 8]);
      const s = mk(rules, 5_000_000, new Xoshiro128ss([1, 1, 2, 3]));
      const ids = roulette.bets
        .catalog(rules)
        .map((e) => e.id)
        .filter((id) => !id.includes('<'));
      let wagered = 0;
      let net = 0;
      for (let i = 0; i < 500; i++) {
        const desired = Array.from({ length: rng.below(4) }, () => ({
          bet: ids[rng.below(ids.length)]!,
          amount: 100 * (1 + rng.below(500)),
        }));
        for (const a of roulette.reconcile(s, desired).actions)
          expect(roulette.apply(s, a).ok).toBe(true);
        const before = roulette.equity(s);
        const out = roulette.playRound(s).outcome;
        expect(roulette.equity(s) - before).toBe(out.net);
        wagered += out.wagered;
        net += out.net;
      }
      expect(roulette.equity(s)).toBe(5_000_000 + net);
      expect(wagered).toBeGreaterThan(0);
    }
  });
  it('serialize/deserialize continues the same game, history included', () => {
    const rules = eu({ enPrison: true });
    const a = mk(rules, BANK, new Xoshiro128ss([3, 1, 4, 1]));
    const count = roulette.compileFact('count:7:red', rules);
    for (let i = 0; i < 30; i++) {
      for (const act of roulette.reconcile(a, [{ bet: 'red', amount: 2500 }]).actions)
        roulette.apply(a, act);
      roulette.playRound(a);
      count(roulette.visible(a), null);
    }
    const b = roulette.deserialize(JSON.parse(JSON.stringify(roulette.serialize(a))));
    const countB = roulette.compileFact('count:7:red', rules);
    for (let i = 0; i < 30; i++) {
      for (const s of [a, b]) {
        for (const act of roulette.reconcile(s, [{ bet: 'black', amount: 2500 }]).actions)
          roulette.apply(s, act);
      }
      const x = roulette.playRound(a).outcome;
      const y = roulette.playRound(b).outcome;
      expect(y).toEqual(x);
      expect(countB(roulette.visible(b), null)).toBe(count(roulette.visible(a), null));
    }
    expect(roulette.serialize(b)).toEqual(roulette.serialize(a));
  });
  it('force rejects pockets the wheel does not have', () => {
    const s = mk();
    expect(() => roulette.force!(s, ['00'])).toThrow(RangeError);
    expect(() => roulette.force!(s, [37])).toThrow(RangeError);
    roulette.force!(s, ['0', 5, '36']);
    expect(s.forced).toEqual([0, 5, 36]);
  });
});

const GOLDEN: Record<WheelKind, string> = {
  european: '25 26 24 9 13 19 2 2 34 14 9 2',
  american: '22 28 6 2 7 13 27 24 2 29 26 27',
  'triple-zero': '27 15 33 36 10 000 32 16 16 6 2 25',
};
