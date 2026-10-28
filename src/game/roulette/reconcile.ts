// reconcile (game.md §8): the only path from a strategy to the engine. Stub (game WP).
import type { GameAct, Layout, Reconciliation } from '@core/contracts/game';
import type { RouletteAction, RouletteState } from './types';

export function reconcile(
  _state: RouletteState,
  _desired: Layout,
  _acts?: readonly GameAct[],
): Reconciliation<RouletteAction> {
  throw new Error('TODO(game)');
}
