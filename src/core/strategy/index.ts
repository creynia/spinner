// core/strategy: schema, validate, compile, interpret, progressions, trace (owner: core-strategy).
// WP0 ships throwing stubs with the frozen signatures of strategy.md §2, plus small real data.
import type {
  CompileContext,
  Diagnostic,
  Observation,
  StepOutput,
  StrategyDefinition,
  StrategyMemory,
  StrategyRuntime,
} from '../contracts/strategy';
import type { TraceWindow } from '../contracts/strategy-trace';

/** Thrown by `compileStrategy` when `validateStrategy` reports any error (strategy.md §2). */
export class StrategyCompileError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super(`strategy has ${diagnostics.length} diagnostic(s)`);
    this.name = 'StrategyCompileError';
  }
}

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

/** Throws `StrategyCompileError` if `validateStrategy` reports any error. */
export function compileStrategy(_def: StrategyDefinition, _ctx: CompileContext): StrategyRuntime {
  throw new Error('TODO(core-strategy)');
}

/** Clones memory first; for tests (strategy.md §11.3). */
export function stepPure(
  _rt: StrategyRuntime,
  _mem: StrategyMemory,
  _obs: Observation,
): { mem: StrategyMemory; out: StepOutput; trace: TraceWindow | null } {
  throw new Error('TODO(core-strategy)');
}

/** Canonical form used by the builder round trip (strategy.md §13.4). */
export function normalizeStrategy(_def: StrategyDefinition): StrategyDefinition {
  throw new Error('TODO(core-strategy)');
}
