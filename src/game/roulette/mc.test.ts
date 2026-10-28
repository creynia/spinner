// Monte-Carlo cross-checks (game.md §13.9). Small in CI; `FULL=1` runs the large version.
import { describe, expect, it, vi } from 'vitest';
import { toNumber } from '@core/money';
import { Xoshiro128ss } from '@core/rng';
import { ROULETTE_PRESETS, resolveRules, roulette } from './index';
import type { RouletteRules, RouletteState, WheelKind } from './index';
import { betMoments, placedOf } from './ev';

vi.setConfig({ testTimeout: 120_000 });

const FULL = process.env.FULL === '1';
const N = FULL ? 1_000_000 : 20_000;

const REPRESENTATIVE: Record<WheelKind, string[]> = {
  european: [
    'straight:17',
    'split:17-20',
    'street:16-17-18',
    'trio:0-1-2',
    'corner:17-18-20-21',
    'basket',
    'sixline:13-14-15-16-17-18',
    'dozen:2',
    'column:3',
    'red',
    'odd',
    'low',
    'voisins',
    'tiers',
    'orphelins',
    'jeu-zero',
    'neighbours:17:3',
  ],
  american: [
    'straight:00',
    'split:00-3',
    'trio:0-00-2',
    'corner:17-18-20-21',
    'basket',
    'sixline:1-2-3-4-5-6',
    'dozen:1',
    'red',
    'high',
  ],
  'triple-zero': [
    'straight:000',
    'split:00-000',
    'trio:0-00-000',
    'basket',
    'street:34-35-36',
    'column:1',
    'black',
  ],
};

/** Puts `bet` on the table directly (limits are irrelevant to the maths) and spins once. */
function oneBet(s: RouletteState, bet: string, amount: number): number {
  s.layout = [placedOf(s.rules, bet, amount)!];
  s.bankroll -= amount;
  s.confirmed = true;
  return roulette.playRound(s).outcome.net;
}

describe(`realized edge per bet is within 4 sigma of the exact EV (${N} unit bets)`, () => {
  for (const wheel of Object.keys(REPRESENTATIVE) as WheelKind[])
    it.each(REPRESENTATIVE[wheel])(`${wheel} %s`, (bet) => {
      const rules = ROULETTE_PRESETS[wheel];
      const m = betMoments(bet, rules)!;
      const stake = roulette.limits(bet, rules)!.min;
      const s = roulette.createState({
        rules,
        rng: new Xoshiro128ss([7, wheel.length, bet.length, 99]),
        bankroll: 0,
      });
      let sum = 0;
      for (let i = 0; i < N; i++) sum += oneBet(s, bet, stake);
      const mean = sum / N / stake;
      const sigma = Math.sqrt(toNumber(m.variance));
      expect(Math.abs(mean - toNumber(m.mean))).toBeLessThan((4 * sigma) / Math.sqrt(N));
    });
});

describe('zero rules, lifetime edge through the engine', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['la partage', { laPartage: true }],
    ['en prison (zero loses)', { enPrison: true }],
    ['en prison (re-imprison)', { enPrison: true, enPrisonSecondZero: 'reimprison' }],
  ];
  it.each(cases)('%s', (_n, o) => {
    const rules = resolveRules({ preset: 'european', overrides: o as never });
    const m = betMoments('red', rules)!;
    const s = roulette.createState({ rules, rng: new Xoshiro128ss([3, 1, 4, 1]), bankroll: 0 });
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += oneBet(s, 'red', 10_000);
      while (s.prison.length > 0) {
        s.confirmed = true;
        sum += roulette.playRound(s).outcome.net; // sum across rounds of the same bet
      }
    }
    const sigma = Math.sqrt(toNumber(m.variance));
    expect(Math.abs(sum / N / 10_000 - toNumber(m.mean))).toBeLessThan((4 * sigma) / Math.sqrt(N));
  });
});

describe('realized net vs summed per-round expectation (PLAYBOOK §12)', () => {
  const sessions = FULL ? 2000 : 120;
  const spins = 500;
  type Strategy = (
    s: RouletteState,
    memory: { step: number },
    last: number | null,
  ) => { bet: string; amount: number }[];
  const strategies: Record<string, Strategy> = {
    'flat red': () => [{ bet: 'red', amount: 2500 }],
    'martingale red': (_s, mem, last) => {
      mem.step = last === null || last > 0 ? 0 : Math.min(mem.step + 1, 7);
      return [{ bet: 'red', amount: 2500 * 2 ** mem.step }];
    },
    'james bond': () => [
      { bet: 'high', amount: 35_000 },
      { bet: 'sixline:13-14-15-16-17-18', amount: 12_500 },
      { bet: 'straight:0', amount: 2500 },
    ],
    'two dozens': (_s, mem, last) => {
      mem.step = last === null || last > 0 ? 0 : Math.min(mem.step + 1, 4);
      const a = 2500 * 3 ** mem.step;
      return [
        { bet: 'dozen:1', amount: a },
        { bet: 'dozen:2', amount: a },
      ];
    },
    'voisins + neighbours': () => [
      { bet: 'voisins', amount: 4500 },
      { bet: 'neighbours:17:2', amount: 2500 },
      { bet: 'straight:17', amount: 500 },
    ],
  };
  const sets: [string, RouletteRules][] = [
    ['european', ROULETTE_PRESETS.european],
    ['american', ROULETTE_PRESETS.american],
    ['la partage', resolveRules({ preset: 'european', overrides: { laPartage: true } })],
    ['en prison', resolveRules({ preset: 'european', overrides: { enPrison: true } })],
  ];
  for (const [rname, rules] of sets)
    for (const [name, strat] of Object.entries(strategies)) {
      if (rules.wheel !== 'european' && name.startsWith('voisins')) continue;
      it(`${name} on ${rname}`, () => {
        const rng = new Xoshiro128ss([20_261_028, rname.length, name.length, 1]);
        let realized = 0;
        let expectedLoss = 0;
        let variance = 0;
        for (let k = 0; k < sessions; k++) {
          const s = roulette.createState({ rules, rng, bankroll: 1e9 });
          const mem = { step: 0 };
          let last: number | null = null;
          for (let i = 0; i < spins; i++) {
            for (const a of roulette.reconcile(s, strat(s, mem, last)).actions)
              roulette.apply(s, a);
            const v = roulette.visible(s);
            expectedLoss += roulette.ev.expectedLossPerRound(v);
            variance += roulette.ev.variancePerRound(v);
            last = roulette.playRound(s).outcome.net;
            realized += last;
          }
        }
        const z = (realized + expectedLoss) / Math.sqrt(variance);
        expect(expectedLoss).toBeGreaterThan(0);
        expect(Math.abs(z)).toBeLessThan(3);
      });
    }
});
