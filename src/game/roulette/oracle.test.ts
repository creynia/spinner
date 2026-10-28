import { describe, expect, it } from 'vitest';
import { Xoshiro128ss } from '@core/rng';
import {
  CALL_BET_IDS,
  ROULETTE_PRESETS,
  fixedBetIds,
  limits,
  roulette,
  resolveRules,
} from './index';
import type { RouletteRules, WheelKind } from './index';
import {
  labelOf,
  oracle,
  oracleIds,
  oraclePieces,
  oraclePrison,
  pocketCount,
  type OracleRules,
} from './testing/oracle';

const BIG = 100_000_000;

function play(rules: RouletteRules, bet: string, amount: number, pockets: number[]) {
  const s = roulette.createState({ rules, rng: new Xoshiro128ss([1, 2, 3, 4]), bankroll: BIG });
  roulette.force!(s, pockets);
  const outcomes = [];
  for (const [i] of pockets.entries()) {
    if (i === 0) {
      const a = roulette.apply(s, { type: 'place', bet, amount });
      expect(a, `${bet} ${amount}`).toMatchObject({ ok: true });
    }
    const confirm = roulette.apply(s, { type: 'confirm' });
    expect(confirm.ok).toBe(true);
    const before = roulette.equity(s);
    const out = roulette.playRound(s).outcome;
    expect(roulette.equity(s) - before).toBe(out.net);
    outcomes.push(out);
  }
  return outcomes;
}

const FLAGS: [string, Partial<RouletteRules>, Partial<OracleRules>][] = [
  ['none', {}, {}],
  ['laPartage', { laPartage: true }, { laPartage: true }],
  ['enPrison(lose)', { enPrison: true }, { enPrison: true }],
  [
    'enPrison(reimprison)',
    { enPrison: true, enPrisonSecondZero: 'reimprison' },
    { enPrison: true, reimprison: true },
  ],
];

describe('exhaustive oracle: every bet x every pocket x every wheel', () => {
  it.each(['european', 'american', 'triple-zero'] as const)('%s', (wheel: WheelKind) => {
    const rules = ROULETTE_PRESETS[wheel];
    const ids = [...oracleIds(wheel)];
    expect(ids.slice().sort()).toEqual(fixedBetIds(wheel).slice().sort());
    if (wheel === 'european') {
      ids.push(...CALL_BET_IDS);
      for (let p = 0; p < 37; p++) for (let k = 1; k <= 9; k++) ids.push(`neighbours:${p}:${k}`);
    }
    let checked = 0;
    for (const id of ids) {
      const unit = oraclePieces(id) * 100;
      const lim = roulette.limits(id, rules)!;
      const low = Math.max(lim.min, Math.ceil(2500 / unit) * unit); // inside bets need $25 in total
      for (const amount of new Set([low, Math.min(lim.max, 3 * low), lim.max])) {
        for (let p = 0; p < pocketCount(wheel); p++) {
          const [out] = play(rules, id, amount, [p]);
          const exp = oracle(id, amount, p, { wheel });
          const got = out!.resolutions[0]!;
          if (got.profit !== exp.profit || got.result !== exp.result)
            expect(got, `${id} ${amount} on ${labelOf(p)}`).toMatchObject(exp);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it.each(FLAGS)('even-money bets under %s on the european wheel', (_n, flags, oflags) => {
    const rules = resolveRules({ preset: 'european', overrides: flags as never });
    const r: OracleRules = { wheel: 'european', ...oflags };
    for (const id of ['red', 'black', 'odd', 'even', 'low', 'high']) {
      for (const amount of [2500, 17_500, 500_000]) {
        for (let p = 0; p < 37; p++) {
          const [out] = play(rules, id, amount, [p]);
          expect(out!.resolutions[0], `${id} ${amount} ${p}`).toMatchObject(
            oracle(id, amount, p, r),
          );
          // the second spin of an imprisoned bet
          if (out!.resolutions[0]!.result === 'stays') {
            for (let q = 0; q < 37; q++) {
              const outs = play(rules, id, amount, [p, q]);
              expect(outs[1]!.resolutions[0], `${id} prison then ${q}`).toMatchObject({
                bet: `prison:${id}`,
                ...oraclePrison(id, amount, q, r),
              });
            }
          }
        }
      }
    }
  });
});
