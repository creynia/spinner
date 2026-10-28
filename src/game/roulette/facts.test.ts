import { describe, expect, it, vi } from 'vitest';
import { Xoshiro128ss } from '@core/rng';
import { ROULETTE_PRESETS, betDef, resolveRules, roulette, rouletteFacts } from './index';
import type { RouletteRules, WheelKind } from './index';
import { compileHistory, historyTarget } from './facts';

vi.setConfig({ testTimeout: 120_000 });

const mk = (rules: RouletteRules) =>
  roulette.createState({ rules, rng: new Xoshiro128ss([11, 12, 13, 14]), bankroll: 0 });
const spinTo = (s: ReturnType<typeof mk>, pockets: (string | number)[]) => {
  for (const p of pockets) {
    roulette.force!(s, [p]);
    roulette.playRound(s);
  }
};

describe('facts against naive recomputation (game.md §13.8)', () => {
  it.each(['european', 'american', 'triple-zero'] as const)(
    '%s: 5,000 random spins, 50 random targets, ring wrap and n = 1000',
    (wheel: WheelKind) => {
      const rules = ROULETTE_PRESETS[wheel];
      const rng = new Xoshiro128ss([wheel.length, 5, 6, 7]);
      const ids = roulette.bets
        .catalog(rules)
        .map((c) => c.id)
        .filter((id) => !id.includes('<'));
      const targets: string[] = ['zero', 'green'];
      while (targets.length < 50) {
        const pick = rng.below(8);
        targets.push(
          pick === 0 && wheel === 'european'
            ? `neighbours:${rng.below(37)}:${1 + rng.below(9)}`
            : ids[rng.below(ids.length)]!,
        );
      }
      const windows = [1, 7, 50, 1000];
      const compiled = targets.map((t) => ({
        t,
        since: roulette.compileFact(`spinsSince:${t}`, rules),
        streak: roulette.compileFact(`streak:${t}`, rules),
        hits: roulette.compileFact(`hits:${t}`, rules),
        counts: windows.map((n) => roulette.compileFact(`count:${n}:${t}`, rules)),
      }));
      const mask = (t: string): Set<number> =>
        t === 'zero' || t === 'green'
          ? new Set(wheel === 'european' ? [0] : wheel === 'american' ? [0, 37] : [0, 37, 38])
          : new Set(betDef(t, wheel)!.pockets);
      const masks = targets.map(mask);
      const s = mk(rules);
      const view = roulette.visible(s);
      const hist: number[] = [];
      const n = s.wheel.n;
      const lateStart = 2300; // windows registered mid-session must backfill exactly
      const late = roulette.compileFact('count:1000:red', rules);
      for (let spin = 1; spin <= 5000; spin++) {
        const p = rng.below(n);
        spinTo(s, [p]);
        hist.push(p);
        if (spin % 13 !== 0 && spin < 4990 && spin !== 1) continue;
        compiled.forEach((c, i) => {
          const m = masks[i]!;
          let since = hist.length;
          for (let k = hist.length - 1; k >= 0; k--)
            if (m.has(hist[k]!)) {
              since = hist.length - 1 - k;
              break;
            }
          let streak = 0;
          while (streak < hist.length && m.has(hist[hist.length - 1 - streak]!)) streak++;
          expect(c.since(view, null), `${c.t} since @${spin}`).toBe(since);
          expect(c.streak(view, null), `${c.t} streak @${spin}`).toBe(streak);
          expect(c.hits(view, null), `${c.t} hits @${spin}`).toBe(
            hist.filter((x) => m.has(x)).length,
          );
          windows.forEach((w, j) => {
            const tail = hist.slice(-w);
            expect(c.counts[j]!(view, null), `${c.t} count:${w} @${spin}`).toBe(
              tail.filter((x) => m.has(x)).length,
            );
          });
        });
        if (spin >= lateStart) {
          const red = mask('red');
          expect(late(view, null)).toBe(hist.slice(-1000).filter((x) => red.has(x)).length);
        }
      }
    },
  );
  it('colorStreak, zeroCount and the last* facts', () => {
    const rules = ROULETTE_PRESETS.american;
    const s = mk(rules);
    const f = (name: string) => roulette.compileFact(name, rules);
    const v = roulette.visible(s);
    for (const n of [
      'lastNumber',
      'lastColor',
      'lastParity',
      'lastHalf',
      'lastDozen',
      'lastColumn',
      'lastSector',
      'lastZero',
    ])
      expect(f(n)(v, null), n).toBeNull();
    expect(f('colorStreak')(v, null)).toBe(0);
    spinTo(s, [1, 3, 5]);
    expect(f('colorStreak')(v, null)).toBe(3);
    expect(f('lastNumber')(v, null)).toBe('5');
    expect(f('lastColor')(v, null)).toBe('red');
    spinTo(s, ['0', '00']);
    expect(f('colorStreak')(v, null)).toBe(2); // a zero run counts as green
    expect(f('lastNumber')(v, null)).toBe('00');
    expect(f('lastColor')(v, null)).toBe('green');
    expect(f('lastParity')(v, null)).toBe('zero');
    expect(f('lastHalf')(v, null)).toBe('zero');
    expect(f('lastDozen')(v, null)).toBe(0);
    expect(f('lastColumn')(v, null)).toBe(0);
    expect(f('lastZero')(v, null)).toBe(true);
    expect(f('lastSector')(v, null)).toBeNull(); // european only
    expect(f('zeroCount')(v, null)).toBe(2);
    spinTo(s, [17]);
    expect([
      f('lastParity')(v, null),
      f('lastHalf')(v, null),
      f('lastDozen')(v, null),
      f('lastColumn')(v, null),
    ]).toEqual(['odd', 'low', 2, 2]);
    expect(f('colorStreak')(v, null)).toBe(1);
    const eu = ROULETTE_PRESETS.european;
    const e = mk(eu);
    spinTo(e, [17]);
    expect(roulette.compileFact('lastSector', eu)(roulette.visible(e), null)).toBe('orphelins');
  });
  it('imprisoned:<bet> reads the amount in prison', () => {
    const rules = resolveRules({ preset: 'european', overrides: { enPrison: true } });
    const s = roulette.createState({
      rules,
      rng: new Xoshiro128ss([1, 2, 3, 4]),
      bankroll: 100_000,
    });
    roulette.apply(s, { type: 'place', bet: 'red', amount: 2500 });
    roulette.apply(s, { type: 'confirm' });
    roulette.force!(s, [0]);
    roulette.playRound(s);
    const v = roulette.visible(s);
    expect(roulette.compileFact('imprisoned:red', rules)(v, null)).toBe(2500);
    expect(roulette.compileFact('imprisoned:rouge', rules)(v, null)).toBe(2500);
    expect(roulette.compileFact('imprisoned:black', rules)(v, null)).toBe(0);
  });
  it('rejects malformed refs (the validator maps these to E_FACT_ARGS)', () => {
    const rules = ROULETTE_PRESETS.european;
    for (const bad of [
      'spinsSince',
      'spinsSince:nope',
      'count:red',
      'count:red:10',
      'count:0:red',
      'count:1001:red',
      'count:5:voisins:x',
      'hits:straight:00',
      'streak:prison:red',
      'lastColor:red',
      'nothing',
      'imprisoned:dozen:1',
    ])
      expect(() => roulette.compileFact(bad, rules), bad).toThrow(RangeError);
    expect(() =>
      roulette.compileFact('streak:straight:00', ROULETTE_PRESETS.american),
    ).not.toThrow();
  });
  it('accepts every target form: aliases, green, zero, call bets', () => {
    const rules = ROULETTE_PRESETS.european;
    const s = mk(rules);
    spinTo(s, [0, 32, 5]);
    const v = roulette.visible(s);
    expect(roulette.compileFact('hits:green', rules)(v, null)).toBe(1);
    expect(roulette.compileFact('hits:rouge', rules)(v, null)).toBe(2);
    expect(roulette.compileFact('hits:voisins', rules)(v, null)).toBe(2);
    expect(roulette.compileFact('hits:split:20-17', rules)(v, null)).toBe(0);
    expect(roulette.compileFact('count:3:neighbours:0:2', rules)(v, null)).toBe(2);
    expect(roulette.compileFact('spinsSince:zero', rules)(v, null)).toBe(2);
  });
  it('declares facts in the schema for every name compileFact accepts', () => {
    const names = new Set(rouletteFacts.facts.map((f) => f.name));
    for (const n of [
      'spinsSince',
      'streak',
      'count',
      'hits',
      'zeroCount',
      'colorStreak',
      'imprisoned',
      'lastZero',
    ])
      expect(names.has(n)).toBe(true);
  });
});

describe('generic history predicates (strategy.md §8.4)', () => {
  it('maps predicates to targets', () => {
    expect(historyTarget({ fact: 'lastColor', equals: 'red' })).toBe('red');
    expect(historyTarget({ fact: 'lastColor', equals: 'green' })).toBe('zero');
    expect(historyTarget({ fact: 'lastDozen', equals: 2 })).toBe('dozen:2');
    expect(historyTarget({ fact: 'lastNumber', equals: '17' })).toBe('straight:17');
    expect(historyTarget({ event: 'zero' })).toBe('zero');
    expect(historyTarget({ fact: 'lastColor', equals: ['black', 'green'] })).toBeNull();
    expect(historyTarget({ fact: 'bankroll', equals: 3 })).toBeNull();
  });
  it('the plugin counter agrees with a naive tracker over random spins', () => {
    const rules = ROULETTE_PRESETS.european;
    const s = mk(rules);
    const acc = compileHistory({ fact: 'lastColor', equals: 'red' }, rules)!;
    expect(compileHistory({ fact: 'lastColor', equals: ['red', 'black'] }, rules)).toBeNull();
    const rng = new Xoshiro128ss([4, 4, 4, 4]);
    const v = roulette.visible(s);
    let since = 0;
    for (let i = 0; i < 2000; i++) {
      const p = rng.below(37);
      spinTo(s, [p]);
      const isRed = betDef('red', 'european')!.pockets.includes(p);
      since = isRed ? 0 : since + 1;
      expect(acc(v, null)).toBe(since);
    }
  });
});
