/**
 * `coin`: a tiny fake `GamePlugin` for core tests (architecture.md §5.1.3, §12.1.5).
 *
 * One bet, `heads`, at even money; each flip lands heads with p = 18/37, so the edge is exactly
 * -1/37 (the same as a european red bet, but with no zero rules and no call bets). Not persistent.
 * It implements the whole contract: exact `ev`, a small `reconcile` (merge, round down, clamp to
 * the table maximum, reduce to the bankroll, reject below the minimum), a two-fact schema, `limits`,
 * `pace`, `force`, and `serialize`/`deserialize`. One `rng.below(37)` per round, bets or not.
 */
import type {
  Adjustment,
  ApplyResult,
  BetCatalogEntry,
  Cents,
  Fraction,
  GameAct,
  GameEvent,
  GamePlugin,
  Json,
  Layout,
  LayoutEntry,
  Pace,
  Reconciliation,
  RoundOutcome,
  Rng,
  RulesRef,
  RulesSchema,
} from '../contracts/game';
import type { FactRef, FactSchema, FactValue } from '../contracts/facts';
import { frac, mul, sub, sum } from '../money';
import { Xoshiro128ss } from '../rng';

export const COIN_BET = 'heads';
/** The fake game's modulus: heads iff the draw is below COIN_HEADS (18/37). */
export const COIN_POCKETS = 37;
export const COIN_HEADS = 18;
export const COIN_P_HEADS: Fraction = { num: 18n, den: 37n };

export interface CoinRules {
  preset: 'standard';
  /** Table limits for `heads`, in cents. */
  min: Cents;
  max: Cents;
  roundsPerHour: number;
}

export type CoinAction = { type: 'place'; bet: string; amount: Cents } | { type: 'confirm' };

/** The read-only view strategy facts see (the state minus its RNG). */
export interface CoinView {
  readonly rules: CoinRules;
  readonly bankroll: Cents;
  readonly stake: Cents;
  readonly round: number;
  readonly lastHeads: boolean | null;
  readonly headsStreak: number;
}

export interface CoinState extends CoinView {
  rng: Rng;
  bankroll: Cents;
  stake: Cents;
  confirmed: boolean;
  round: number;
  lastHeads: boolean | null;
  headsStreak: number;
  forced: boolean[];
}

/** What `serialize` returns: the state with the RNG replaced by its word snapshot. */
interface CoinSnapshot extends Omit<CoinState, 'rng'> {
  rng: readonly number[];
}

const STANDARD: CoinRules = { preset: 'standard', min: 100, max: 100_000, roundsPerHour: 60 };

type CoinOverrides = Partial<Omit<CoinRules, 'preset'>>;

function resolveRules(p?: string | RulesRef): CoinRules {
  if (p === undefined) return { ...STANDARD };
  const ref: RulesRef = typeof p === 'string' ? { preset: p, overrides: {} } : p;
  if (ref.preset !== 'standard') throw new RangeError(`unknown coin preset: ${ref.preset}`);
  const o = ref.overrides as CoinOverrides;
  const rules = { ...STANDARD, ...o };
  if (!(rules.min >= 1 && rules.max >= rules.min)) throw new RangeError('rules/limits');
  if (!(rules.roundsPerHour >= 1 && rules.roundsPerHour <= 1000))
    throw new RangeError('rules/pace');
  return rules;
}

const rules: RulesSchema<CoinRules> = {
  presets: { standard: STANDARD },
  defaultPreset: 'standard',
  resolve: resolveRules,
  normalize(p) {
    const ref: RulesRef = typeof p === 'string' ? { preset: p, overrides: {} } : p;
    const resolved = resolveRules(ref);
    const overrides: Record<string, Json> = {};
    for (const key of Object.keys(ref.overrides).sort()) {
      const value = ref.overrides[key];
      if (value !== undefined && value !== (STANDARD as unknown as Record<string, Json>)[key]) {
        overrides[key] = value;
      }
    }
    void resolved; // resolving validates the overrides
    return { preset: ref.preset, overrides };
  },
  describe: (r) => [
    `Fair-ish coin, p(heads) 18/37 · $${r.min / 100}-$${r.max / 100} · ${r.roundsPerHour}/h`,
  ],
};

const CATALOG: BetCatalogEntry[] = [
  {
    id: COIN_BET,
    label: 'Heads',
    category: 'coin',
    limitClass: 'outside',
    description: 'Pays 1 to 1 when the coin lands heads (18/37).',
    persistent: false,
    contract: false,
  },
];

const facts: FactSchema = {
  facts: [
    {
      name: 'lastHeads',
      label: 'last flip was heads',
      doc: 'Whether the flip just resolved landed heads.',
      scope: 'round',
      nullable: true,
      value: { type: 'boolean' },
    },
    {
      name: 'headsStreak',
      label: 'heads streak',
      doc: 'Consecutive most-recent flips that landed heads (0 if the last was tails).',
      scope: 'state',
      nullable: false,
      value: { type: 'number', unit: 'count', integer: true, min: 0 },
    },
  ],
  events: [{ name: 'flip', label: 'a flip', doc: 'Raised after every round.' }],
};

function viewOf(s: CoinState): CoinView {
  return s;
}

function reconcile(
  state: CoinState,
  desired: Layout,
  _acts?: readonly GameAct[],
): Reconciliation<CoinAction> {
  const { min, max } = state.rules;
  const rejected: Reconciliation<CoinAction>['rejected'] = [];
  const adjusted: Adjustment[] = [];
  let want = 0;
  let first: LayoutEntry | undefined;
  let sawUnaffordable = false;
  for (const entry of desired) {
    if (entry.bet !== COIN_BET) {
      rejected.push({ entry, reason: 'unknown-bet' });
      continue;
    }
    if (!Number.isFinite(entry.amount) || entry.amount < 0) {
      rejected.push({ entry, reason: 'invalid-amount' });
      continue;
    }
    if (entry.amount === 0) {
      adjusted.push({ entry, to: 0, reason: 'skipped-zero' });
      continue;
    }
    if (first) adjusted.push({ entry, to: entry.amount, reason: 'merged' });
    else first = entry;
    want += entry.amount;
  }
  let amount = Math.floor(want);
  if (first && amount !== want) adjusted.push({ entry: first, to: amount, reason: 'rounded' });
  if (first && amount > max) {
    amount = max;
    adjusted.push({ entry: first, to: amount, reason: 'clamped' });
  }
  if (first && amount > state.bankroll) {
    sawUnaffordable = true;
    if (state.bankroll >= min) {
      amount = state.bankroll;
      adjusted.push({ entry: first, to: amount, reason: 'reduced' });
    } else {
      rejected.push({ entry: first, reason: 'unaffordable' });
      amount = 0;
    }
  } else if (first && amount < min) {
    rejected.push({ entry: first, reason: 'below-min' });
    amount = 0;
  }
  const actions: CoinAction[] = [];
  if (first && amount > 0) actions.push({ type: 'place', bet: COIN_BET, amount });
  actions.push({ type: 'confirm' });
  return {
    actions,
    deferred: [],
    rejected,
    adjusted,
    affordable: !(first && amount === 0 && sawUnaffordable),
  };
}

function apply(state: CoinState, action: CoinAction): ApplyResult<CoinState> {
  if (action.type === 'confirm') {
    state.confirmed = true;
    return { ok: true, state, events: [] };
  }
  const { min, max } = state.rules;
  if (action.bet !== COIN_BET) return { ok: false, code: 'unknown-bet', message: action.bet };
  if (state.confirmed) return { ok: false, code: 'after-confirm', message: 'bets are closed' };
  if (!Number.isSafeInteger(action.amount) || action.amount <= 0) {
    return { ok: false, code: 'bad-amount', message: String(action.amount) };
  }
  const total = state.stake + action.amount;
  if (total < min) return { ok: false, code: 'below-min', message: `minimum ${min}` };
  if (total > max) return { ok: false, code: 'over-max', message: `maximum ${max}` };
  if (action.amount > state.bankroll) {
    return { ok: false, code: 'unaffordable', message: `bankroll ${state.bankroll}` };
  }
  state.bankroll -= action.amount;
  state.stake = total;
  return { ok: true, state, events: [] };
}

function playRound(state: CoinState): { state: CoinState; outcome: RoundOutcome } {
  if (state.stake > 0 && !state.confirmed) throw new Error('coin: unconfirmed layout');
  // Exactly one draw per round, whether or not a bet is on the table (CRN, harness doc §1.1).
  const forced = state.forced.shift();
  const roll = forced === undefined ? state.rng.below(COIN_POCKETS) : forced ? 0 : COIN_HEADS;
  const heads = roll < COIN_HEADS;
  const stake = state.stake;
  const resolutions: RoundOutcome['resolutions'] = [];
  let net = 0;
  if (stake > 0) {
    const profit = heads ? stake : -stake;
    state.bankroll += heads ? 2 * stake : 0;
    net = profit;
    resolutions.push({ bet: COIN_BET, amount: stake, result: heads ? 'win' : 'lose', profit });
  }
  state.stake = 0;
  state.confirmed = false;
  state.round += 1;
  state.lastHeads = heads;
  state.headsStreak = heads ? state.headsStreak + 1 : 0;
  const events: GameEvent[] = [{ type: 'flip' }];
  return {
    state,
    outcome: { net, wagered: stake, resolutions, events, summary: { heads, roll } },
  };
}

function layoutMoments(layout: Layout): { ev: Fraction; variance: Fraction } {
  const stake = layout.reduce((acc, e) => (e.bet === COIN_BET ? acc + e.amount : acc), 0);
  const a = frac(stake);
  const lose = sub(frac(1), COIN_P_HEADS);
  const outcomes: [Fraction, Fraction][] = [
    [a, COIN_P_HEADS],
    [mul(a, frac(-1)), lose],
  ];
  const ev = sum(outcomes.map(([x, p]) => mul(x, p)));
  const ex2 = sum(outcomes.map(([x, p]) => mul(mul(x, x), p)));
  return { ev, variance: sub(ex2, mul(ev, ev)) };
}

export const coin: GamePlugin<CoinState, CoinAction, CoinRules, CoinView> = {
  id: 'coin',
  name: 'Coin',
  version: '0.1.0',
  rules,
  bets: {
    catalog: () => CATALOG,
    parse: (id) => (id.trim().toLowerCase() === COIN_BET ? COIN_BET : null),
    available: (id) => id === COIN_BET,
  },
  createState({ rules: r, rng, bankroll }) {
    return {
      rules: r,
      rng,
      bankroll,
      stake: 0,
      confirmed: false,
      round: 0,
      lastHeads: null,
      headsStreak: 0,
      forced: [],
    };
  },
  layoutOf: (s) => (s.stake > 0 ? [{ bet: COIN_BET, amount: s.stake }] : []),
  visible: viewOf,
  reconcile,
  apply,
  playRound,
  equity: (s) => s.bankroll + s.stake,
  limits(betOrClass, r) {
    return betOrClass === COIN_BET || betOrClass === 'outside' ? { min: r.min, max: r.max } : null;
  },
  pace: (r): Pace => ({ roundsPerHour: r.roundsPerHour, label: 'live' }),
  ev: {
    expectedLossPerRound: (v) => v.stake / COIN_POCKETS,
    variancePerRound: (v) => v.stake * v.stake * (1 - 1 / (COIN_POCKETS * COIN_POCKETS)),
    layoutMoments: (layout) => layoutMoments(layout),
    betEdge: (bet) => (bet === COIN_BET ? { edge: frac(-1, 37), perRound: frac(-1, 37) } : null),
  },
  facts,
  compileFact(ref: FactRef): (view: CoinView, last: RoundOutcome | null) => FactValue | null {
    if (ref === 'lastHeads') return (view) => view.lastHeads;
    if (ref === 'headsStreak') return (view) => view.headsStreak;
    throw new RangeError(`coin: unknown fact ${ref}`);
  },
  force(state, script) {
    state.forced.push(...script.map((x) => x === 'H' || x === 'heads' || x === 1));
    return state;
  },
  serialize: (s) => ({
    rules: s.rules,
    rng: s.rng.snapshot(),
    bankroll: s.bankroll,
    stake: s.stake,
    confirmed: s.confirmed,
    round: s.round,
    lastHeads: s.lastHeads,
    headsStreak: s.headsStreak,
    forced: s.forced,
  }),
  deserialize(x) {
    const o = x as CoinSnapshot;
    return { ...o, rng: new Xoshiro128ss(o.rng) };
  },
};
