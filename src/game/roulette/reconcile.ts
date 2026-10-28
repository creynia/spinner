// reconcile (game.md §8): the only path from a strategy to the engine. Pure and deterministic,
// processes entries in the desired order, never raises an amount and never emits an action
// `apply` rejects. Policies: open-questions #1 (clamp above the maximum, visible as `adjusted`)
// and #4 (bet what is left if it meets the minimum, otherwise reject `unaffordable`).
import type {
  Adjustment,
  Cents,
  GameAct,
  Layout,
  LayoutEntry,
  Reconciliation,
} from '@core/contracts/game';
import { floorToUnit } from '@core/money';
import { betDef, familyOf, parseBet } from './bets';
import { insideTotal, spotUsage } from './engine';
import type { AdjustCode, InsideSpot, ReconcileCode, RouletteAction, RouletteState } from './types';

interface Work {
  /** The first desired entry with this id (what traces and diagnostics point at). */
  entry: LayoutEntry;
  id: string;
  wanted: number;
  pieces: number;
  outside: boolean;
  /** Smallest component weight (min chip check), and the components as [spot, weight]. */
  comps: readonly (readonly [string, number])[];
  amount: Cents;
  adjusted: Adjustment[];
  reducedByBankroll: boolean;
}

export function reconcile(
  state: RouletteState,
  desired: Layout,
  _acts?: readonly GameAct[],
): Reconciliation<RouletteAction> {
  const rules = state.rules;
  const lim = rules.limits;
  const unit = lim.chipUnit;
  const rejected: Reconciliation<RouletteAction>['rejected'] = [];
  const adjusted: Adjustment[] = [];
  if (state.confirmed) {
    return {
      actions: [],
      deferred: desired.map((entry) => ({ entry, reason: 'after-confirm' })),
      rejected,
      adjusted,
      affordable: true,
    };
  }
  const reject = (entry: LayoutEntry, reason: ReconcileCode): void => {
    rejected.push({ entry, reason });
  };

  // Steps 1-2: normalise, sanity-check amounts, merge duplicates.
  const works = new Map<string, Work>();
  for (const entry of desired) {
    const id = parseBet(entry.bet);
    if (id === null) {
      reject(entry, 'unknown-bet');
      continue;
    }
    if (id.startsWith('prison:')) {
      reject(entry, 'not-placeable');
      continue;
    }
    const def = betDef(id, rules.wheel);
    if (!def) {
      reject(entry, 'not-on-wheel');
      continue;
    }
    if (!Number.isFinite(entry.amount) || entry.amount < 0) {
      reject(entry, 'invalid-amount');
      continue;
    }
    if (entry.amount === 0) {
      adjusted.push({ entry, to: 0, reason: 'skipped-zero' });
      continue;
    }
    const prior = works.get(id);
    if (prior) {
      prior.wanted += entry.amount;
      prior.adjusted.push({ entry: prior.entry, to: prior.wanted, reason: 'merged' });
      continue;
    }
    const comps = def.components
      ? def.components.map((c) => [c.spot, c.weight] as const)
      : ([[id, 1]] as const);
    works.set(id, {
      entry,
      id,
      wanted: entry.amount,
      pieces: def.pieces,
      outside: def.limitClass === 'outside',
      comps,
      amount: 0,
      adjusted: [],
      reducedByBankroll: false,
    });
  }

  const survivors: Work[] = [];
  const used = spotUsage(state.layout);
  let available = state.bankroll;
  const note = (w: Work, to: Cents, reason: AdjustCode): void => {
    w.adjusted.push({ entry: w.entry, to, reason });
  };
  const minWeight = (w: Work): number => Math.min(...w.comps.map((c) => c[1]));
  const meetsMin = (w: Work, a: Cents): boolean =>
    w.outside ? a >= lim.outside.min : (a / w.pieces) * minWeight(w) >= lim.inside.minChip;

  for (const w of works.values()) {
    const u = w.pieces * unit;
    // Step 3: round down to the bet unit.
    let a = floorToUnit(w.wanted, u);
    if (a !== w.wanted) note(w, a, 'rounded');
    if (a === 0) {
      reject(w.entry, 'below-min');
      continue;
    }
    // Step 4: minimum.
    if (!meetsMin(w, a)) {
      reject(w.entry, 'below-min');
      continue;
    }
    // Step 5: maximum per spot.
    let cap: number;
    if (w.outside) {
      // amounts already on this id in the window count against the maximum (as inside spots do)
      cap = lim.outside.max - (state.layout.find((b) => b.bet === w.id)?.amount ?? 0);
    } else {
      let piece = Infinity;
      for (const [spot, weight] of w.comps) {
        const max = lim.inside.max[familyOf(spot) as InsideSpot];
        piece = Math.min(piece, Math.floor((max - (used.get(spot) ?? 0)) / weight));
      }
      cap = w.pieces * Math.floor(Math.max(piece, 0) / unit) * unit;
    }
    if (a > cap) {
      const clamped = w.outside ? floorToUnit(cap, u) : cap;
      if (rules.reconcile.overMax === 'reject' || clamped <= 0 || !meetsMin(w, clamped)) {
        reject(w.entry, 'over-max');
        continue;
      }
      a = clamped;
      note(w, a, 'clamped');
    }
    // Step 6: affordability.
    if (a > available) {
      const reduced = floorToUnit(available, u);
      if (rules.reconcile.shortfall === 'reject' || reduced <= 0 || !meetsMin(w, reduced)) {
        reject(w.entry, 'unaffordable');
        continue;
      }
      a = reduced;
      w.reducedByBankroll = true;
      note(w, a, 'reduced');
    }
    w.amount = a;
    available -= a;
    const piece = a / w.pieces;
    for (const [spot, weight] of w.comps) used.set(spot, (used.get(spot) ?? 0) + weight * piece);
    survivors.push(w);
  }

  // Steps 7-8-7: inside minimum total, table maximum, inside minimum again (8 may shrink inside).
  const dropInside = (): void => {
    const total = insideTotal(state.layout) + sum(survivors.filter((w) => !w.outside));
    if (total > 0 && total < lim.inside.minTotal) {
      for (let i = survivors.length - 1; i >= 0; i--) {
        const w = survivors[i]!;
        if (w.outside) continue;
        reject(w.entry, w.reducedByBankroll ? 'unaffordable' : 'inside-min-total');
        survivors.splice(i, 1);
      }
    }
  };
  dropInside();
  if (lim.maxTotalPerSpin !== null) {
    const base = state.layout.reduce((t, b) => t + b.amount, 0);
    let excess = base + sum(survivors) - lim.maxTotalPerSpin;
    for (let i = survivors.length - 1; i >= 0 && excess > 0; i--) {
      const w = survivors[i]!;
      const u = w.pieces * unit;
      const cut = Math.min(w.amount, Math.ceil(excess / u) * u);
      const to = w.amount - cut;
      if (rules.reconcile.overMax === 'reject' || to <= 0 || !meetsMin(w, to)) {
        excess -= w.amount;
        reject(w.entry, 'table-max');
        survivors.splice(i, 1);
      } else {
        excess -= cut;
        w.amount = to;
        note(w, to, 'clamped');
      }
    }
    dropInside();
  }

  // Step 9: actions. Only surviving entries keep their adjustments.
  const actions: RouletteAction[] = [];
  for (const w of survivors) {
    actions.push({ type: 'place', bet: w.id, amount: w.amount });
    adjusted.push(...w.adjusted);
  }
  actions.push({ type: 'confirm' });
  // Step 10.
  const sawUnaffordable = rejected.some((r) => r.reason === 'unaffordable');
  const affordable = !(desired.length > 0 && survivors.length === 0 && sawUnaffordable);
  return { actions, deferred: [], rejected, adjusted, affordable };
}

const sum = (ws: readonly Work[]): Cents => ws.reduce((t, w) => t + w.amount, 0);
