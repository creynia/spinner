// Pure helpers over trace windows (strategy.md §12): what was really placed, how each desired bet
// fared in reconcile, and a `RoundOutcome` rebuilt from the stored outcome for the game's glyph.
import type { Layout, RoundOutcome } from '../../contracts/game';
import type { TraceWindow } from '../../contracts/strategy-trace';

export type BetStatus =
  | { kind: 'placed' }
  | { kind: 'adjusted'; to: number; reason: string }
  | { kind: 'deferred'; reason: string }
  | { kind: 'rejected'; reason: string };

export interface DesiredRow {
  bet: string;
  amount: number;
  source: 'layout' | 'patch' | 'keep';
  parent?: string;
  status: BetStatus;
}

/** Each desired entry with its reconcile verdict. Rejected entries are never dropped. */
export function desiredRows(w: TraceWindow): DesiredRow[] {
  const rec = w.reconcile;
  return w.desired.map((d) => {
    const rej = rec?.rejected.find((x) => x.bet === d.bet);
    const def = rec?.deferred.find((x) => x.bet === d.bet);
    const adj = rec?.adjusted?.find((x) => x.bet === d.bet);
    const status: BetStatus = rej
      ? { kind: 'rejected', reason: rej.reason }
      : def
        ? { kind: 'deferred', reason: def.reason }
        : adj
          ? { kind: 'adjusted', to: adj.to, reason: adj.reason }
          : { kind: 'placed' };
    return { bet: d.bet, amount: d.amount, source: d.source, parent: d.parent, status };
  });
}

/** The layout that actually went on the table: desired minus rejected/deferred, amounts adjusted. */
export function placedLayout(w: TraceWindow): Layout {
  const out: { bet: string; amount: number }[] = [];
  for (const r of desiredRows(w)) {
    if (r.status.kind === 'rejected' || r.status.kind === 'deferred') continue;
    out.push({ bet: r.bet, amount: r.status.kind === 'adjusted' ? r.status.to : r.amount });
  }
  return out;
}

export function counts(w: TraceWindow): {
  rejected: number;
  deferred: number;
  adjusted: number;
} {
  const r = w.reconcile;
  return {
    rejected: r?.rejected.length ?? 0,
    deferred: r?.deferred.length ?? 0,
    adjusted: r?.adjusted?.length ?? 0,
  };
}

/** A `RoundOutcome` for the game's OutcomeGlyph / TableView, or null for a window with no spin. */
export function toRoundOutcome(w: TraceWindow): RoundOutcome | null {
  const o = w.outcome;
  if (!o) return null;
  const amountOf = new Map(w.desired.map((d) => [d.bet, d.amount]));
  return {
    net: o.net,
    wagered: 0,
    resolutions: o.resolutions.map((r) => ({
      bet: r.bet,
      amount: amountOf.get(r.bet) ?? 0,
      result: r.result as RoundOutcome['resolutions'][number]['result'],
      profit: r.profit,
    })),
    events: [],
    summary: o.summary,
  };
}

/** Equity series: the starting bankroll, then the equity after each window. */
export function equitySeries(trace: readonly TraceWindow[], bankroll: number): number[] {
  return [bankroll, ...trace.map((w) => w.equity)];
}
