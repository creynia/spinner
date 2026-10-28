// The preselected chip value (layouts.md §3.4).
import type { Cents, GamePlugin } from '../../contracts/game';
import type { LayoutSpot } from '../../contracts/layout';
import { makeRows } from './adjust';
import { checkAtTable } from './check';
import type { DefaultDenom } from './types';

/** A bankroll large enough that affordability never decides the answer ($10 million). */
export const LARGE_BANKROLL: Cents = 1_000_000_000;

export function defaultDenom<S, A, R, V>(
  plugin: GamePlugin<S, A, R, V>,
  rules: R,
  spots: readonly LayoutSpot[],
  denominations: readonly Cents[],
  bankroll: Cents = LARGE_BANKROLL,
): DefaultDenom {
  const ascending = [...denominations].sort((a, b) => a - b);
  if (ascending.length === 0) return { denom: 100, ok: false };
  for (const denom of ascending) {
    const check = checkAtTable(plugin, rules, makeRows(spots, denom), bankroll);
    if (check.perSpot.every((p) => p.status === 'ok')) return { denom, ok: true };
  }
  return { denom: ascending[0]!, ok: false };
}
