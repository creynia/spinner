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
  // Rows that name the same bet (aliases included, via the plugin's own `parse`) are folded into
  // the first one before `reconcile`, as the engine would merge them: the first row carries the
  // result, later ones are reported `adjusted` with code `merged` and nothing placed.
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const canon = plugin.bets.parse(r.bet) ?? r.bet;
    const g = groups.get(canon);
    if (g) g.push(i);
    else groups.set(canon, [i]);
  });
  const firsts = [...groups.values()].map((g) => g[0]!);
  const entries: LayoutEntry[] = firsts.map((i) => ({
    bet: rows[i]!.bet,
    amount: [...groups.values()].find((g) => g[0] === i)!.reduce((n, k) => n + rows[k]!.cents, 0),
  }));
  const rec = plugin.reconcile(state, entries);
  const perSpot: TableCheckSpot[] = rows.map((r) => ({
    bet: r.bet,
    asked: r.cents,
    placed: r.cents,
    status: 'ok',
  }));
  const index = new Map<LayoutEntry, number>(entries.map((e, k) => [e, firsts[k]!]));
  const at = (e: LayoutEntry): number => {
    const i = index.get(e);
    if (i !== undefined) return i;
    // A plugin that returns copies of the entries: match by bet.
    return rows.findIndex((r) => r.bet === e.bet);
  };
  for (const g of groups.values())
    perSpot[g[0]!]!.placed = g.reduce((n, k) => n + rows[k]!.cents, 0);
  const mark = (i: number, status: 'adjusted' | 'rejected', placed: number, code: string) => {
    const p = perSpot[i];
    if (!p) return;
    p.status = status;
    p.placed = placed;
    p.code = code;
    p.reason = explain(code);
  };
  for (const a of rec.adjusted) {
    const i = at(a.entry);
    if (perSpot[i]?.status !== 'rejected') mark(i, 'adjusted', a.to, a.reason);
  }
  for (const x of [...rec.rejected, ...rec.deferred]) mark(at(x.entry), 'rejected', 0, x.reason);
  for (const g of groups.values()) {
    const head = perSpot[g[0]!]!;
    for (const k of g.slice(1)) {
      if (head.status === 'rejected') mark(k, 'rejected', 0, head.code ?? 'rejected');
      else mark(k, 'adjusted', 0, 'merged');
    }
  }
  return {
    total: perSpot.reduce((n, p) => n + p.placed, 0),
    perSpot,
    affordable: rec.affordable,
  };
}
