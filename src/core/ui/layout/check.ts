// The table check (layouts.md §3.4): the plugin's real `reconcile` on a fresh state, mapped
// generically. Rows are already resolved to cents at one chip level.
import type { Cents, GamePlugin, LayoutEntry } from '../../contracts/game';
import { sessionRng } from '../../rng';
import { money } from './adjust';
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

/** Reconcile codes that only mean "not enough yet": the layout is simply still being built. */
const MINIMUM_CODES = ['below-min', 'inside-min-total'];

/**
 * A neutral hint when the ONLY problems at the table are minimums (`below-min`, `inside-min-total`),
 * as on the first tap of an empty layout; otherwise null (a real problem stays a failure). Where
 * the plugin allows it, the hint says how much to add, found by asking `reconcile` itself how much
 * more the first short spot needs (game-agnostic: no knowledge of the table's limits here).
 */
export function minimumHint<S, A, R, V>(
  plugin: GamePlugin<S, A, R, V>,
  rules: R,
  rows: readonly CheckRow[],
  check: TableCheck,
  bankroll: Cents,
  label: (bet: string) => string,
): string | null {
  const problems = check.perSpot.filter((p) => p.status !== 'ok');
  if (problems.length === 0) return null;
  if (!problems.every((p) => p.status === 'rejected' && MINIMUM_CODES.includes(p.code ?? '')))
    return null;
  const first = problems[0]!;
  const at = rows.findIndex((r) => r.bet === first.bet);
  const generic = 'Add more chips to reach the table minimum';
  if (at < 0) return generic;
  const clears = (extra: number): boolean => {
    const next = rows.map((r, i) => (i === at ? { ...r, cents: r.cents + extra } : r));
    return checkAtTable(plugin, rules, next, bankroll).perSpot.every((p) => p.status === 'ok');
  };
  // Smallest whole-dollar addition that clears everything (doubling, then bisection).
  let hi = 100;
  while (!clears(hi)) {
    hi *= 2;
    if (hi > bankroll || hi > 100_000_000) return generic;
  }
  let lo = 0;
  while (hi - lo > 100) {
    const mid = lo + Math.ceil((hi - lo) / 200) * 100;
    if (clears(mid)) hi = mid;
    else lo = mid;
  }
  const inside = rows.reduce(
    (n, r, i) => (check.perSpot[i]?.status === 'rejected' ? n + r.cents : n),
    0,
  );
  const total = inside + hi;
  return first.code === 'inside-min-total'
    ? `Add ${money(hi)} more inside to reach the ${money(total)} table minimum`
    : `Add ${money(hi)} more on ${label(first.bet)} to reach the table minimum`;
}
