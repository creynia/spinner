// Pace for these rules (game.md §10; reconciliation G9).
import type { Pace } from '@core/contracts/game';
import type { RouletteRules } from './types';

export function pace(rules: RouletteRules): Pace {
  return { roundsPerHour: rules.pace.roundsPerHour, label: rules.pace.label };
}
