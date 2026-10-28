// Experiment definitions over the `coin` game for core tests (a stand-in for normalized
// definitions until core-store's `normalizeDefinition` and the real roulette plugin land).
import type { NormalizedDefinition } from '../contracts/experiment';
import type { StrategyDefinition } from '../contracts/strategy';

/** $1 flat on heads every round. */
export const FLAT_COIN: StrategyDefinition = {
  schema: 1,
  id: 'flat-coin',
  name: 'Flat heads',
  game: 'coin',
  unit: 100,
  stages: [{ id: 'main', layout: [{ bet: 'heads', amount: { units: 1 } }] }],
};

/** Martingale on heads, 6 steps, reset on cap. */
export const MARTINGALE_COIN: StrategyDefinition = {
  schema: 1,
  id: 'martingale-coin',
  name: 'Martingale heads',
  game: 'coin',
  unit: 100,
  progressions: { m: { kind: 'martingale', track: 'heads', maxSteps: 6, onCap: 'reset' } },
  stages: [{ id: 'main', layout: [{ bet: 'heads', amount: { prog: 'm' } }] }],
};

/**
 * The perf-reference shape (harness doc §14.1) on `coin`: warm (flat, 20 rounds) -> mart
 * (Martingale; up 500 -> flat, down 1500 -> warm) -> flat (2 units, 50 rounds) -> warm. Exercises
 * stages, transitions, once-per-window `goto` and a strategy `stop`.
 */
export const STAGED_COIN: StrategyDefinition = {
  schema: 1,
  id: 'staged-coin',
  name: 'Staged heads',
  game: 'coin',
  unit: 100,
  progressions: { m: { kind: 'martingale', track: 'heads', maxSteps: 5, onCap: 'reset' } },
  stages: [
    {
      id: 'warm',
      layout: [{ bet: 'heads', amount: { units: 1 } }],
      rules: [{ when: { cmp: ['roundsInStage', '>=', 20] }, then: [{ goto: 'mart' }] }],
    },
    {
      id: 'mart',
      layout: [{ bet: 'heads', amount: { prog: 'm' } }],
      rules: [
        { when: { cmp: ['net', '>=', 500] }, then: [{ goto: 'flat' }] },
        { when: { cmp: ['net', '<=', -1500] }, then: [{ goto: 'warm' }] },
        { when: { cmp: ['net', '<=', -4000] }, then: [{ stop: 'walk-away' }] },
      ],
    },
    {
      id: 'flat',
      layout: [{ bet: 'heads', amount: { units: 2 } }],
      rules: [{ when: { cmp: ['roundsInStage', '>=', 50] }, then: [{ goto: 'warm' }] }],
    },
  ],
};

export interface CoinDefinitionOptions {
  strategy?: StrategyDefinition;
  sessions?: number;
  seed?: number;
  bankroll?: number;
  maxRounds?: number;
  stopWin?: number;
  stopLoss?: number;
  sampleSessions?: number;
  checkpointSchedule?: 'auto' | number[];
}

export function coinDefinition(o: CoinDefinitionOptions = {}): NormalizedDefinition {
  return {
    schema: 1,
    name: 'coin test',
    game: { id: 'coin', rules: { preset: 'standard', overrides: {} } },
    strategy: o.strategy ?? FLAT_COIN,
    session: {
      bankroll: o.bankroll ?? 10_000,
      maxRounds: o.maxRounds ?? 100,
      ...(o.stopWin !== undefined ? { stopWin: o.stopWin } : {}),
      ...(o.stopLoss !== undefined ? { stopLoss: o.stopLoss } : {}),
      roundsPerHour: 60,
    },
    run: {
      sessions: o.sessions ?? 200,
      seed: o.seed ?? 1,
      checkpointSchedule: o.checkpointSchedule ?? 'auto',
      sampleSessions: o.sampleSessions ?? 24,
    },
  };
}
