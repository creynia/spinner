// Engine: state, actions, rounds (game.md §7). Money is integer cents; exactly one
// `rng.below(pockets)` is drawn per round, bets or not (common random numbers).
import type {
  ApplyResult,
  Cents,
  GameEvent,
  Layout,
  Rng,
  RoundOutcome,
} from '@core/contracts/game';
import { Xoshiro128ss } from '@core/rng';
import { betDef, familyOf, parseBet } from './bets';
import { placedOf } from './ev';
import { RING, createHistory, recordSpin, resolveTarget } from './facts';
import { netVectorOf, settle } from './netvector';
import { columnOf, dozenOf, pocketIndexOf, sectorOf, wheelSpec } from './pockets';
import type {
  ApplyCode,
  InsideSpot,
  PlacedBet,
  RouletteAction,
  RouletteEvent,
  RouletteRules,
  RouletteState,
  RouletteView,
  SpinSummary,
} from './types';

/** The harness hands over a ready `Rng`; exactly one `rng.below(pockets)` is drawn per round. */
export function createState(init: {
  rules: RouletteRules;
  rng: Rng;
  bankroll: Cents;
}): RouletteState {
  const wheel = wheelSpec(init.rules.wheel);
  return {
    rules: init.rules,
    wheel,
    rng: init.rng,
    forced: [],
    bankroll: init.bankroll,
    layout: [],
    prison: [],
    confirmed: false,
    round: 0,
    history: createHistory(wheel.n),
  };
}

export function layoutOf(state: RouletteState): Layout {
  return [...state.prison, ...state.layout].map((b) => ({ bet: b.bet, amount: b.amount }));
}

export function visible(state: RouletteState): RouletteView {
  return state;
}

/** Whether the current wheel has this bet and it can be placed (not `prison:*`). */
export function available(id: string, state: RouletteState): boolean {
  const canonical = parseBet(id);
  return (
    canonical !== null &&
    !canonical.startsWith('prison:') &&
    betDef(canonical, state.rules.wheel) !== null
  );
}

const fail = (
  code: ApplyCode,
  message: string,
): { ok: false; code: ApplyCode; message: string } => ({
  ok: false,
  code,
  message,
});

/** An inside (or call-component) chip: anything that is not an outside spot. */
function isInsideSpot(spot: string): boolean {
  const f = familyOf(spot);
  return f !== null && f !== 'even-money' && f !== 'dozen' && f !== 'column';
}

/** Cents on each spot across the layout entries. */
export function spotUsage(layout: readonly PlacedBet[]): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const b of layout) for (const c of b.chips) m.set(c.spot, (m.get(c.spot) ?? 0) + c.amount);
  return m;
}

export function insideTotal(layout: readonly PlacedBet[]): Cents {
  let t = 0;
  for (const b of layout) for (const c of b.chips) if (isInsideSpot(c.spot)) t += c.amount;
  return t;
}

export function apply(
  state: RouletteState,
  action: RouletteAction,
): ApplyResult<RouletteState, RouletteEvent> {
  const { limits: lim } = state.rules;
  const ok = { ok: true as const, state, events: [] as RouletteEvent[] };
  if (action.type === 'confirm') {
    const inside = insideTotal(state.layout);
    if (inside > 0 && inside < lim.inside.minTotal)
      return fail('inside-min-total', `inside bets total ${inside} < ${lim.inside.minTotal}`);
    if (lim.maxTotalPerSpin !== null) {
      const total = state.layout.reduce((t, b) => t + b.amount, 0);
      if (total > lim.maxTotalPerSpin)
        return fail('table-max', `${total} exceeds the table maximum ${lim.maxTotalPerSpin}`);
    }
    state.confirmed = true;
    return ok;
  }
  if (state.confirmed) return fail('after-confirm', 'bets are closed for this spin');
  const id = parseBet(action.bet);
  if (id === null) return fail('unknown-bet', action.bet);
  if (id.startsWith('prison:')) return fail('not-placeable', id);
  const def = betDef(id, state.rules.wheel);
  if (!def) return fail('not-on-wheel', id);
  if (action.type === 'remove') {
    const i = state.layout.findIndex((b) => b.bet === id);
    if (i < 0) return fail('not-placed', id);
    state.bankroll += state.layout[i]!.amount;
    state.layout.splice(i, 1);
    return ok;
  }
  const amount = action.amount;
  const unit = def.pieces * lim.chipUnit;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount % unit !== 0)
    return fail('bad-amount', `${amount} is not a positive multiple of ${unit}`);
  const placed = placedOf(state.rules, id, amount)!;
  const existing = state.layout.find((b) => b.bet === id);
  const total = (existing?.amount ?? 0) + amount;
  if (def.limitClass === 'outside') {
    if (total < lim.outside.min) return fail('below-min', `minimum ${lim.outside.min}`);
    if (total > lim.outside.max) return fail('over-max', `maximum ${lim.outside.max}`);
  } else {
    for (const c of placed.chips)
      if (c.amount < lim.inside.minChip)
        return fail('below-min', `inside chip minimum ${lim.inside.minChip}`);
    const used = spotUsage(state.layout);
    for (const c of placed.chips) {
      const max = lim.inside.max[familyOf(c.spot) as InsideSpot];
      if ((used.get(c.spot) ?? 0) + c.amount > max)
        return fail('over-max', `${c.spot} maximum ${max}`);
    }
  }
  if (amount > state.bankroll) return fail('unaffordable', `bankroll ${state.bankroll}`);
  state.bankroll -= amount;
  if (existing) {
    existing.amount = total;
    const merged = spotUsage([existing, placed]);
    existing.chips = [...merged].map(([spot, a]) => ({ spot, amount: a }));
  } else state.layout.push(placed);
  return ok;
}

function summaryOf(state: RouletteState, pocket: number): RoundOutcome['summary'] {
  const label = state.wheel.labels[pocket]!;
  const zero = pocket < 1 || pocket > 36;
  const s: SpinSummary = {
    pocket: label,
    index: pocket,
    color: (['green', 'red', 'black'] as const)[state.wheel.color[pocket]!]!,
    parity: zero ? 'zero' : pocket % 2 === 1 ? 'odd' : 'even',
    half: zero ? 'zero' : pocket <= 18 ? 'low' : 'high',
    dozen: dozenOf(pocket),
    column: columnOf(pocket),
    sector: state.rules.wheel === 'european' ? sectorOf(pocket) : null,
  };
  return s as unknown as RoundOutcome['summary'];
}

export function playRound(state: RouletteState): { state: RouletteState; outcome: RoundOutcome } {
  if (state.layout.length > 0 && !state.confirmed)
    throw new Error('roulette: playRound with an unconfirmed layout');
  // Exactly one draw, bets or not.
  const pocket = state.forced.length > 0 ? state.forced.shift()! : state.rng.below(state.wheel.n);
  const rules = state.rules;
  const resolutions: RoundOutcome['resolutions'] = [];
  const events: GameEvent[] = [{ type: 'spin' }];
  if (state.wheel.color[pocket] === 0) events.push({ type: 'zero' });
  const nextPrison: PlacedBet[] = [];
  let net = 0;
  let wagered = 0;
  const run = (b: PlacedBet, isPrison: boolean): void => {
    const { profit, kind } = settle(rules, b, pocket);
    const base = isPrison ? b.bet.slice(7) : b.bet;
    net += profit;
    let result: 'win' | 'lose' | 'push' | 'stays';
    if (kind === 'imprison' || kind === 'reimprison') {
      result = 'stays';
      nextPrison.push(isPrison ? b : { bet: `prison:${b.bet}`, amount: b.amount, chips: b.chips });
      events.push({ type: 'imprisoned', bet: base });
    } else {
      result = profit > 0 ? 'win' : profit < 0 ? 'lose' : 'push';
      state.bankroll += b.amount + profit;
      if (kind === 'partage') events.push({ type: 'partage', bet: base });
      else if (kind === 'release') events.push({ type: 'released', bet: base });
      else if (kind === 'prison-lost') events.push({ type: 'prison-lost', bet: base });
    }
    resolutions.push({ bet: b.bet, amount: b.amount, result, profit });
  };
  for (const b of state.prison) run(b, true);
  for (const b of state.layout) {
    wagered += b.amount;
    run(b, false);
  }
  state.prison = nextPrison;
  state.layout = [];
  state.confirmed = false;
  recordSpin(state.history, state.wheel, pocket);
  state.round += 1;
  return {
    state,
    outcome: { net, wagered, resolutions, events, summary: summaryOf(state, pocket) },
  };
}

export function equity(state: RouletteState): Cents {
  let t = state.bankroll;
  for (const b of state.layout) t += b.amount;
  for (const b of state.prison) t += b.amount;
  return t;
}

/**
 * Queue pockets consumed before the RNG (tests; reconciliation G12): labels (`'0'`, `'00'`,
 * `'17'`) or numbers, which are pocket indices (0..36 the numbers, 37 is 00, 38 is 000).
 */
export function force(state: RouletteState, script: readonly (string | number)[]): RouletteState {
  for (const x of script) {
    const p = typeof x === 'number' ? x : pocketIndexOf(String(x));
    if (!Number.isInteger(p) || p < 0 || p >= state.wheel.n)
      throw new RangeError(`roulette: cannot force pocket ${String(x)} on ${state.rules.wheel}`);
    state.forced.push(p);
  }
  return state;
}

interface Snapshot {
  rules: RouletteRules;
  rng: number[];
  forced: number[];
  bankroll: Cents;
  layout: PlacedBet[];
  prison: PlacedBet[];
  confirmed: boolean;
  round: number;
  history: {
    len: number;
    ring: number[];
    hitsByPocket: number[];
    lastSeen: number[];
    colorRun: number;
    lastColor: number;
    windows: { target: string; n: number }[];
  };
}

/** JSON-safe snapshot: the RNG as its word snapshot, the history as its last 1024 spins. */
export function serialize(state: RouletteState): Snapshot {
  const h = state.history;
  const tail = Math.min(h.len, RING);
  const ring: number[] = [];
  for (let s = h.len - tail; s < h.len; s++) ring.push(h.ring[s % RING]!);
  return {
    rules: structuredClone(state.rules),
    rng: [...state.rng.snapshot()],
    forced: [...state.forced],
    bankroll: state.bankroll,
    layout: structuredClone(state.layout),
    prison: structuredClone(state.prison),
    confirmed: state.confirmed,
    round: state.round,
    history: {
      len: h.len,
      ring,
      hitsByPocket: [...h.hitsByPocket],
      lastSeen: [...h.lastSeen],
      colorRun: h.colorRun,
      lastColor: h.lastColor,
      windows: h.windows.map((w) => ({ target: w.target, n: w.n })),
    },
  };
}

export function deserialize(x: unknown): RouletteState {
  const j = structuredClone(x) as Snapshot;
  const rules = j.rules;
  const wheel = wheelSpec(rules.wheel);
  const hist = createHistory(wheel.n);
  const hj = j.history;
  const tail = hj.ring;
  for (let i = 0; i < tail.length; i++) hist.ring[(hj.len - tail.length + i) % RING] = tail[i]!;
  hist.len = hj.len;
  hist.hitsByPocket.set(hj.hitsByPocket);
  hist.lastSeen.set(hj.lastSeen);
  hist.colorRun = hj.colorRun;
  hist.lastColor = hj.lastColor;
  for (const w of hj.windows) {
    const { mask } = resolveTarget(w.target, rules);
    let count = 0;
    for (let i = Math.max(0, hist.len - w.n); i < hist.len; i++)
      count += mask[hist.ring[i % RING]!]!;
    hist.windows.push({ target: w.target, n: w.n, mask, count });
  }
  return {
    rules,
    wheel,
    rng: new Xoshiro128ss(j.rng),
    forced: j.forced,
    bankroll: j.bankroll,
    layout: j.layout,
    prison: j.prison,
    confirmed: j.confirmed,
    round: j.round,
    history: hist,
  };
}

/** Fills the per-pocket net (cents) of the layout on the table; the same function settles the spin. */
export function netVector(state: RouletteState, out: Float64Array): void {
  netVectorOf(state.rules, state.prison, state.layout, out);
}
