// Layout entries -> chips on table spots. Call bets and neighbours are expanded into their
// component chips (game.md §3.3); chips on the same spot are summed.
import type { Layout } from '@core/contracts/game';
import { betDef } from '../bets';
import type { WheelKind } from '../types';
import type { Chip } from './board';

const strip = (bet: string): string => (bet.startsWith('prison:') ? bet.slice(7) : bet);

export function chipsOf(layout: Layout, pending: Layout, wheel: WheelKind): Chip[] {
  const sums = new Map<string, Chip>();
  const add = (spot: string, cents: number, isPending: boolean) => {
    const key = `${isPending ? 'p' : 'b'}:${spot}`;
    const had = sums.get(key);
    if (had) had.cents += cents;
    else sums.set(key, { key, spot, cents, pending: isPending });
  };
  const walk = (entries: Layout, isPending: boolean) => {
    for (const e of entries) {
      const bet = strip(e.bet);
      const def = betDef(bet, wheel);
      if (!def) continue; // not on this wheel: listed below the table, no chip
      if (def.components) {
        for (const c of def.components) add(c.spot, (e.amount * c.weight) / def.pieces, isPending);
      } else add(bet, e.amount, isPending);
    }
  };
  walk(layout, false);
  walk(pending, true);
  return [...sums.values()];
}

/** Chips one tap adds or removes: a call bet's or neighbours' pieces, otherwise 1 (layouts.md §4.3). */
export function stepOf(bet: string): number {
  return betDef(bet, 'european')?.pieces ?? 1;
}
