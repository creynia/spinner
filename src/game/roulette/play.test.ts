// Play mode (src/core/play) driven by the real roulette plugin: table rules at spin time,
// call bets, imprisoned stakes carried between spins and a JSON round trip of the session.
import { describe, expect, it } from 'vitest';
import type { Rng } from '@core/contracts/game';
import {
  checkBets,
  createSession,
  equityOf,
  placeBet,
  spin,
  type PlayEnv,
  type PlayResult,
  type PlaySession,
} from '@core/play';
import { resolveRules, roulette, type RouletteRules, type RouletteState } from '.';

const envFor = (
  variant: string,
  rules = resolveRules(variant),
): PlayEnv<RouletteState, RouletteRules> => ({
  plugin: roulette,
  rules,
  restore: (snap, rng: Rng) => ({ ...roulette.deserialize(snap), rng }),
});
const ok = (r: PlayResult): PlaySession => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.session;
};

describe('play mode on the roulette table', () => {
  it('flags the outside minimum and spins once it is met', () => {
    const env = envFor('european');
    let s = createSession(env, {
      variant: 'european',
      bankroll: 100_000,
      rng: { kind: 'seeded', seed: 7 },
    });
    s = ok(placeBet(env, s, 'red', 500));
    expect(checkBets(env, s).map((p) => p.code)).toEqual(['below-min']);
    s = ok(placeBet(env, s, 'red', 2000));
    s = ok(placeBet(env, s, 'voisins', 4500));
    expect(checkBets(env, s)).toEqual([]);
    const r = spin(env, s);
    if (!r.ok) throw new Error(r.message);
    expect(r.spin.wagered).toBe(7000);
    expect(typeof r.spin.summary['pocket']).toBe('string');
    expect(r.session.bankroll).toBe(100_000 + r.spin.net);
  });

  it('carries imprisoned stakes in equity and replays from JSON', () => {
    const variant = 'european';
    const env = envFor(variant, resolveRules({ preset: variant, overrides: { enPrison: true } }));
    expect(env.rules.enPrison).toBe(true);
    let s = createSession(env, { variant, bankroll: 1_000_000, rng: { kind: 'seeded', seed: 3 } });
    let sawCarry = false;
    for (let i = 0; i < 300; i++) {
      s = ok(placeBet(env, s, 'red', 2500));
      const r = spin(env, s);
      if (!r.ok) throw new Error(r.message);
      s = JSON.parse(JSON.stringify(r.session)) as PlaySession;
      if (s.carried > 0) sawCarry = true;
      expect(equityOf(s)).toBe(r.spin.equity);
    }
    expect(sawCarry).toBe(true);
  });
});
