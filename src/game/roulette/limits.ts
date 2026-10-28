// Table limits per bet or limit class (game.md §4; reconciliation G4).
import type { Cents } from '@core/contracts/game';
import { betDef, parseBet } from './bets';
import type { InsideSpot, RouletteRules, RouletteView } from './types';

/**
 * Per-bet or per-class limits, in cents. Classes: `outside` (per bet), `inside` (per chip: the
 * minimum chip up to the straight-up maximum) and `call` (per component chip, same range).
 * A call bet gives its total: `pieces x` the smallest legal piece up to the largest piece every
 * component allows (voisins $9-$6,750 on the default table). `null` when unknown or not on the wheel.
 */
export function limits(
  betOrClass: string,
  rules: RouletteRules,
  _view?: RouletteView,
): { min: Cents; max: Cents } | null {
  const l = rules.limits;
  if (betOrClass === 'outside') return { ...l.outside };
  if (betOrClass === 'inside' || betOrClass === 'call')
    return { min: l.inside.minChip, max: l.inside.max.straight };
  const id = parseBet(betOrClass);
  const def = id === null ? null : betDef(id, rules.wheel);
  if (!def) return null;
  if (def.limitClass === 'outside') return { ...l.outside };
  if (!def.components) {
    return { min: l.inside.minChip, max: l.inside.max[def.family as InsideSpot] };
  }
  let piece = Infinity;
  let minWeight = Infinity;
  for (const c of def.components) {
    const spot = betDef(c.spot, rules.wheel)!;
    piece = Math.min(piece, Math.floor(l.inside.max[spot.family as InsideSpot] / c.weight));
    minWeight = Math.min(minWeight, c.weight);
  }
  const unit = l.chipUnit;
  const maxPiece = Math.floor(piece / unit) * unit;
  const minPiece = Math.max(unit, Math.ceil(l.inside.minChip / minWeight / unit) * unit);
  return { min: def.pieces * minPiece, max: def.pieces * maxPiece };
}
