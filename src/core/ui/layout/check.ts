// The table check (layouts.md §3.4): the plugin's real `reconcile` on a fresh state, mapped
// generically. Rows are already resolved to cents at one chip level.
import type { Cents, GamePlugin, LayoutEntry } from '../../contracts/game';
import { sessionRng } from '../../rng';
import type { CheckRow, TableCheck, TableCheckSpot } from './types';

const MESSAGES: Record<string, string> = {
  'below-min': 'below the table minimum',
  'inside-min-total': "inside bets together are below the table's inside minimum",
  'over-max': 'above the table maximum',
  clamped: 'cut to the table maximum',
  reduced: 'cut to what the bankroll can pay',
  rounded: 'rounded down to a whole chip unit',
  unaffordable: 'not affordable with the bankroll',
  'table-max': "cut to the table's maximum per spin",
  'not-on-wheel': 'not on this wheel',
  'unknown-bet': 'not a bet at this table',
  'not-placeable': 'cannot be placed',
  'invalid-amount': 'not a valid amount',
  'skipped-zero': 'nothing to place',
  merged: 'merged with another spot',
};

/** English message for a plugin reconcile code; an unknown code is shown verbatim. */
export function explain(code: string): string {
  return MESSAGES[code] ?? code;
}

export function checkAtTable<S, A, R, V>(
  plugin: GamePlugin<S, A, R, V>,
  rules: R,
  rows: readonly CheckRow[],
  bankroll: Cents,
): TableCheck {
  const state = plugin.createState({ rules, rng: sessionRng(1, 0, 'engine'), bankroll });
  const entries: LayoutEntry[] = rows.map((r) => ({ bet: r.bet, amount: r.cents }));
  const rec = plugin.reconcile(state, entries);
  const perSpot: TableCheckSpot[] = rows.map((r) => ({
    bet: r.bet,
    asked: r.cents,
    placed: r.cents,
    status: 'ok',
  }));
  const index = new Map<LayoutEntry, number>(entries.map((e, i) => [e, i]));
  const at = (e: LayoutEntry): number => {
    const i = index.get(e);
    if (i !== undefined) return i;
    // A plugin that returns copies: match the first untouched row of that bet.
    return rows.findIndex((r) => r.bet === e.bet);
  };
  for (const a of rec.adjusted) {
    const i = at(a.entry);
    const p = perSpot[i];
    if (!p) continue;
    p.status = p.status === 'rejected' ? 'rejected' : 'adjusted';
    p.placed = a.to;
    p.code = a.reason;
    p.reason = explain(a.reason);
  }
  for (const x of [...rec.rejected, ...rec.deferred]) {
    const i = at(x.entry);
    const p = perSpot[i];
    if (!p) continue;
    p.status = 'rejected';
    p.placed = 0;
    p.code = x.reason;
    p.reason = explain(x.reason);
  }
  return {
    total: perSpot.reduce((n, p) => n + p.placed, 0),
    perSpot,
    affordable: rec.affordable,
  };
}
