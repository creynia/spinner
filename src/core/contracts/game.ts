/**
 * The game plugin contract (PLAYBOOK §4 as amended by game.md §14, strategy.md §18 and
 * decisions.md "Reconciliation": G1-G14, E1, F1).
 *
 * FROZEN. Pure and framework-free: no UI types here (there is no `ui` field on the plugin; the app
 * composes `{ plugin, ui }`, architecture.md §3 and `core/ui/game-ui.ts`). Imports nothing outside
 * `contracts/` (architecture.md §4.2).
 */
import type { FactRef, FactSchema, FactValue } from './facts';
import type { HistoryPredicate } from './strategy';

/** Integer cents (PLAYBOOK §2). Never a float. */
export type Cents = number;

/** Game-defined, stable bet id, e.g. 'red', 'straight:17', 'split:17-20', 'place-6'. */
export type BetId = string;

/** JSON value space (harness-data-analysis.md §16.1). Re-exported by `contracts/experiment.ts`. */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * Seeded random source handed to the plugin by the harness (reconciliation G1, G2). Declared here
 * (contracts import nothing); `core/rng` implements it (`Xoshiro128ss`, harness-data-analysis.md
 * §1.2). A plugin must draw a fixed number of `below` calls per round whatever the bets (roulette:
 * exactly one `below(pockets)`), so strategies share spins (common random numbers, §1.1).
 */
export interface Rng {
  /** Next uint32. */
  next(): number;
  /** Uniform in [0, n), 1 <= n <= 2^32, by rejection (identical rule to the sibling apps). */
  below(n: number): number;
  /** Uniform double in [0, 1) with 53 random bits (two `next()` calls). */
  float53(): number;
  /** Copy of the generator state, for traces and tests. */
  snapshot(): readonly number[];
}

/**
 * Structural exact rational (reconciliation G2, G14): `{ num, den }`, `den > 0`. `core/money`
 * implements the arithmetic and keeps values normalized (gcd 1).
 */
export interface Fraction {
  num: bigint;
  den: bigint;
}

/**
 * Normalized game rules reference (reconciliation E1; harness-data-analysis.md §8.1.3). A preset id
 * plus the overrides that differ from that preset's resolved values.
 */
export interface RulesRef {
  preset: string;
  overrides: Record<string, Json>;
}

/** Limit class of a bet (reconciliation G6; game.md §3.1). The three named ones are roulette's. */
export type LimitClass = 'inside' | 'outside' | 'call' | (string & Record<never, never>);

/** One entry of the bet catalog (PLAYBOOK §4 with reconciliation G6). */
export interface BetCatalogEntry {
  id: BetId;
  label: string;
  /** The family: drives UI grouping and per-category breakdowns in the summary table. */
  category: string;
  /** Which table limits apply (renamed from the draft's `minClass`, G6). */
  limitClass: LimitClass;
  /** Payout in words, for the picker. */
  description: string;
  /** Stays up after a round it did not resolve in. */
  persistent: boolean;
  /** Cannot be removed or reduced once in force. */
  contract: boolean;
  /** E.g. odds need a line bet. */
  needsParent?: BetId[];
  /** Parameterised ids, e.g. `neighbours:<p>:<k>`. */
  parameters?: Record<string, 'number' | 'point' | 'dicePair'>;
}

/** Presets plus overrides (PLAYBOOK §4; game.md §1.1; reconciliation E1). */
export interface RulesSchema<R> {
  presets: Record<string, R>;
  defaultPreset: string;
  /** Throws a typed rules error (turned into a JSON-pointer error by the validator). */
  resolve(p?: string | RulesRef): R;
  /** Preset + overrides with overrides equal to the preset's resolved values pruned (E1). */
  normalize(p: string | RulesRef): RulesRef;
  describe(r: R): string[];
}

/** One bet on the table or in a desired layout. */
export interface LayoutEntry {
  bet: BetId;
  amount: Cents;
  parent?: BetId;
  working?: 'auto' | 'on' | 'off';
}
export type Layout = readonly LayoutEntry[];

/** An amount the reconciler changed without rejecting it (game.md §8, C2; reconciliation G7). */
export interface Adjustment {
  entry: LayoutEntry;
  /** The amount actually used. */
  to: Cents;
  /** Plugin code, e.g. roulette 'merged' | 'rounded' | 'clamped' | 'reduced' | 'skipped-zero'. */
  reason: string;
}

/**
 * The only path from a strategy to the engine (PLAYBOOK §4; game.md §8). It must never emit an
 * action `apply` rejects. Counted in the summary as `rejected`, `deferred` and `adjusted`.
 */
export interface Reconciliation<A> {
  /** Legal engine actions, in order. */
  actions: A[];
  /** E.g. wrong phase: retried next window. */
  deferred: { entry: LayoutEntry; reason: string }[];
  /** E.g. a contract bet cannot come down, unaffordable. */
  rejected: { entry: LayoutEntry; reason: string }[];
  /** Amounts clamped, reduced or rounded (G7): visible in the trace, not rejections. */
  adjusted: Adjustment[];
  /** False when nothing at all could be funded (bust test input). */
  affordable: boolean;
}

/**
 * A game event for the round just resolved. Arrives in `last.events` as `{ type: name, ...params }`
 * (strategy.md §8.3). `bet-won`/`bet-lost`/`bet-push` are NOT plugin events (F1).
 */
export interface GameEvent {
  type: string;
  bet?: BetId;
  [param: string]: string | number | boolean | undefined;
}

/** What a round produced (PLAYBOOK §4). */
export interface RoundOutcome {
  /** Net cash effect of the round; equals the equity change. */
  net: Cents;
  /** Sum of new stakes this round (stakes already on the table are not re-counted). */
  wagered: Cents;
  resolutions: {
    bet: BetId;
    amount: Cents;
    result: 'win' | 'lose' | 'push' | 'stays';
    profit: Cents;
  }[];
  events: readonly GameEvent[];
  /** Plugin-defined, JSON-safe. `null` is allowed (game.md §14 `sector: ... | null`). */
  summary: Record<string, number | string | boolean | null>;
}

/**
 * A compiled fact accessor (strategy.md §8.1): allocation-free, reads the plugin's view. Declared
 * with the method-bivariance trick so that a concrete plugin (`V` = its own view type) is
 * assignable to `GamePlugin<unknown, unknown, unknown, unknown>` (used by `NormalizeContext` and
 * the worker handler); a plain function type would make `V` contravariant and reject it.
 */
export type FactAccessor<V = unknown> = {
  bivarianceHack(view: V, last: RoundOutcome | null): FactValue | null;
}['bivarianceHack'];

/** A game decision handed to `reconcile` for the `act` effect (strategy.md §6.11, §18.6). */
export interface GameAct {
  act: string;
  args?: Record<string, string | number>;
}

/** Result of `apply` (PLAYBOOK §4). */
export type ApplyResult<S, E extends GameEvent = GameEvent> =
  { ok: true; state: S; events: E[] } | { ok: false; code: string; message: string };

/**
 * Pace of a game (reconciliation G9; decisions #4). `normalizeDefinition` sets
 * `session.roundsPerHour = plugin.pace(resolvedRules).roundsPerHour` when absent.
 */
export interface Pace {
  roundsPerHour: number;
  label: string;
}

/**
 * The plugin.
 *
 * Type parameters: `S` engine state, `A` engine action, `R` resolved rules, `V` the read-only view
 * of a state that strategy facts read (roulette: the state minus its RNG; reconciliation G3), `E`
 * the plugin's events. Members are declared with method syntax so that a concrete plugin is
 * assignable to `GamePlugin<unknown, unknown, unknown, unknown>` (used by `NormalizeContext`).
 */
export interface GamePlugin<S, A, R, V = unknown, E extends GameEvent = GameEvent> {
  id: string;
  name: string;
  /** Participates in run keys: bump when anything that feeds results changes (incl. draw schedule). */
  version: string;
  rules: RulesSchema<R>;
  bets: {
    catalog(rules: R): BetCatalogEntry[];
    /** Canonical id (aliases folded), wheel-independent; null when unparseable (game.md C6). */
    parse(id: string): BetId | null;
    available(id: BetId, state: S): boolean;
  };
  /**
   * The harness owns seeding and hands over a ready `Rng` (G1). Roulette draws exactly one
   * `rng.below(pockets)` per round, bets or not. Test forcing goes through `force`, not here.
   */
  createState(init: { rules: R; rng: Rng; bankroll: Cents }): S;
  layoutOf(state: S): Layout;
  /** Read-only view for strategy facts (G3); may be the state itself or a projection. */
  visible(state: S): V;
  /** `acts` is the optional third argument of strategy.md §18.6 (no-op for roulette). */
  reconcile(state: S, desired: Layout, acts?: readonly GameAct[]): Reconciliation<A>;
  /** May mutate and return the same state object (game.md C5). */
  apply(state: S, action: A): ApplyResult<S, E>;
  /** Consumes the engine RNG. May mutate and return the same state object. */
  playRound(state: S): { state: S; outcome: RoundOutcome };
  /** Bankroll + bets at face value. */
  equity(state: S): Cents;
  /**
   * Table limits for a bet id or a limit class (G4; strategy.md §18.3), `null` when the game has no
   * such limit. Used for `tableMin`/`tableMax`, `E_BELOW_MIN` and `P(maxExposure >= tableMax)`.
   */
  limits(betOrClass: string, rules: R, view?: V): { min: Cents; max: Cents } | null;
  /** Default pace for these rules (G9). */
  pace(rules: R): Pace;
  /**
   * Exact math (G8). SIGN: expected **loss** is positive, in cents (game.md C3); `edge` is the
   * expected value as a fraction of the stake, so it is negative for a house-edge bet.
   */
  ev: {
    /** Expected loss of the layout on the table in `view` (after reconcile, before the spin), cents. */
    expectedLossPerRound(view: V): number;
    /** Variance of the round's net, cents^2, joint over the layout. */
    variancePerRound(view: V): number;
    /** Exact mean (EV, negative when losing) and variance of the net of a layout, cents. */
    layoutMoments(layout: Layout, rules: R): { ev: Fraction; variance: Fraction };
    /** `edge`: EV per unit staked over the bet's resolution (negative); `perRound`: per round. */
    betEdge(bet: BetId, rules: R): { edge: Fraction; perRound: Fraction } | null;
  };
  /** Names, types, enums and docs of game facts and events. */
  facts: FactSchema;
  /**
   * Compiles one fact ref into an allocation-free accessor (G3; strategy.md §8.1). The plugin
   * registers whatever counters the ref needs, so parameterised facts cost nothing unless used.
   */
  compileFact(ref: FactRef, rules: R): FactAccessor<V>;
  /** Optional: reuse the plugin's indexed counters for a generic history predicate (strategy.md §8.4). */
  compileHistory?(predicate: HistoryPredicate, rules: R): FactAccessor<V> | null;
  /** Optional, for tests (G12): queue a script of outcomes consumed before the RNG. */
  force?(state: S, script: readonly (string | number)[]): S;
  serialize(state: S): unknown;
  deserialize(x: unknown): S;
}
