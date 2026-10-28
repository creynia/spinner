// Exact EV and variance (game.md §6). Stubs (game WP). Sign convention: expected LOSS is positive.
import type { BetId, Fraction, Layout } from '@core/contracts/game';
import type { RouletteRules, RouletteView } from './types';

export function expectedLossPerRound(_view: RouletteView): number {
  throw new Error('TODO(game)');
}

export function variancePerRound(_view: RouletteView): number {
  throw new Error('TODO(game)');
}

export function layoutMoments(
  _layout: Layout,
  _rules: RouletteRules,
): { ev: Fraction; variance: Fraction } {
  throw new Error('TODO(game)');
}

export function betEdge(
  _bet: BetId,
  _rules: RouletteRules,
): { edge: Fraction; perRound: Fraction } | null {
  throw new Error('TODO(game)');
}
