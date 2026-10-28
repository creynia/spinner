// Engine: state, actions, rounds (game.md §7). Throwing stubs (game WP).
import type { ApplyResult, Cents, Layout, Rng, RoundOutcome } from '@core/contracts/game';
import type {
  RouletteEvent,
  RouletteAction,
  RouletteRules,
  RouletteState,
  RouletteView,
} from './types';

/** The harness hands over a ready `Rng`; exactly one `rng.below(pockets)` is drawn per round. */
export function createState(_init: {
  rules: RouletteRules;
  rng: Rng;
  bankroll: Cents;
}): RouletteState {
  throw new Error('TODO(game)');
}

export function layoutOf(_state: RouletteState): Layout {
  throw new Error('TODO(game)');
}

export function visible(_state: RouletteState): RouletteView {
  throw new Error('TODO(game)');
}

export function available(_id: string, _state: RouletteState): boolean {
  throw new Error('TODO(game)');
}

export function apply(
  _state: RouletteState,
  _action: RouletteAction,
): ApplyResult<RouletteState, RouletteEvent> {
  throw new Error('TODO(game)');
}

export function playRound(_state: RouletteState): { state: RouletteState; outcome: RoundOutcome } {
  throw new Error('TODO(game)');
}

export function equity(_state: RouletteState): Cents {
  throw new Error('TODO(game)');
}

/** Queue pocket labels consumed before the RNG (tests; reconciliation G12). */
export function force(_state: RouletteState, _script: readonly (string | number)[]): RouletteState {
  throw new Error('TODO(game)');
}

export function serialize(_state: RouletteState): unknown {
  throw new Error('TODO(game)');
}

export function deserialize(_x: unknown): RouletteState {
  throw new Error('TODO(game)');
}

/** Fills the per-pocket net (cents) of the layout on the table; the same function settles the spin. */
export function netVector(_state: RouletteState, _out: Float64Array): void {
  throw new Error('TODO(game)');
}
