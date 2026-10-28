// core/strategy: schema, validate, compile, interpret, progressions, trace (owner: core-strategy).
// WP0 ships throwing stubs with the frozen signatures of strategy.md §2, plus small real data.
/** Progression kinds of the library (strategy.md §7.4), for pickers. */
export const PROGRESSION_KINDS = [
  'flat',
  'martingale',
  'grand-martingale',
  'fibonacci',
  'dalembert',
  'paroli',
  '1-3-2-6',
  'oscars-grind',
  'labouchere',
  'sequence',
] as const;

/** Session and strategy facts every game gets (strategy.md §8.2). */
export const SESSION_FACT_NAMES = [
  'start',
  'bankroll',
  'equity',
  'net',
  'peak',
  'drawdown',
  'exposure',
  'wagered',
  'round',
  'roundsInStage',
  'roundsWagered',
  'lastNet',
  'lastResult',
  'winStreak',
  'lossStreak',
  'stage',
] as const;

/** Events the core itself raises (strategy.md §8.3). */
export const CORE_EVENT_NAMES = [
  'bet-won',
  'bet-lost',
  'bet-push',
  'prog-cap',
  'prog-done',
] as const;

export { validateStrategy, noExitWarning, type ValidationContext } from './validate';
export { compileStrategy, stepPure, strategyAnomalies } from './compile';
export { normalizeStrategy } from './normalize';
export { StrategyCompileError } from './errors';
