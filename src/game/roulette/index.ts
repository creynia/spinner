// The roulette plugin (pure). WP0: every engine entry point throws `TODO(game)`; the data the UI
// needs on day one (presets, bet catalog, fact schema, wheel data, strategy preset ids) is real.
import type { GamePlugin } from '@core/contracts/game';
import {
  available,
  apply,
  createState,
  deserialize,
  equity,
  force,
  layoutOf,
  playRound,
  serialize,
  visible,
} from './engine';
import { betEdge, expectedLossPerRound, layoutMoments, variancePerRound } from './ev';
import { compileFact, rouletteFacts } from './facts';
import { catalog, parseBet } from './bets';
import { limits } from './limits';
import { pace } from './pace';
import { reconcile } from './reconcile';
import { rouletteRules } from './rules';
import type {
  RouletteAction,
  RouletteEvent,
  RouletteRules,
  RouletteState,
  RouletteView,
} from './types';

export const roulette: GamePlugin<
  RouletteState,
  RouletteAction,
  RouletteRules,
  RouletteView,
  RouletteEvent
> = {
  id: 'roulette',
  name: 'Roulette',
  version: '0.1.0',
  rules: rouletteRules,
  bets: { catalog, parse: parseBet, available },
  createState,
  layoutOf,
  visible,
  reconcile,
  apply,
  playRound,
  equity,
  limits,
  pace,
  ev: { expectedLossPerRound, variancePerRound, layoutMoments, betEdge },
  facts: rouletteFacts,
  compileFact,
  force,
  serialize,
  deserialize,
};

export * from './types';
export {
  BET_FAMILIES,
  CALL_BET_IDS,
  EVEN_MONEY_IDS,
  EXTRA_TARGETS,
  OUTSIDE_BET_IDS,
  PRISON_BET_IDS,
  betDef,
  catalog,
  familyOf,
  fixedBetIds,
  parseBet,
  payout,
} from './bets';
export {
  PACE_PRESETS,
  RULE_PRESET_IDS,
  DEFAULT_RULE_PRESET,
  ROULETTE_PRESETS,
  RulesError,
  resolveRules,
} from './rules';
export { RED_NUMBERS, SECTORS, WHEEL_ORDER, pocketLabels, wheelSpec } from './pockets';
export { rouletteFacts } from './facts';
export { STRATEGY_PRESETS, STRATEGY_PRESET_IDS, type StrategyPresetId } from './presets';
export { netVector } from './engine';
