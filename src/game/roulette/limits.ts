// Table limits per bet or limit class (game.md §4; reconciliation G4). Stub (game WP).
import type { Cents } from '@core/contracts/game';
import type { RouletteRules, RouletteView } from './types';

export function limits(
  _betOrClass: string,
  _rules: RouletteRules,
  _view?: RouletteView,
): { min: Cents; max: Cents } | null {
  throw new Error('TODO(game)');
}
