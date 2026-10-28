/**
 * The strategy language contract (strategy.md §2) with decisions.md reconciliation applied
 * (S3, S4, S7, S8, G3, G4). FROZEN. Imports nothing outside `contracts/`.
 *
 * Renames: the draft's `ValidationIssue` is `Diagnostic` (S4). Section numbers below refer to
 * docs/design/strategy.md.
 */
import type { BetCatalogEntry, BetId, Cents, Layout, RoundOutcome } from './game';
import type { FactRef, FactValue, FactSchema } from './facts'; // FactRef = string ('lastColor', 'spinsSince:red')
import type { TraceWindow } from './strategy-trace';

export const STRATEGY_SCHEMA = 1 as const;

/**
 * Stop reasons a strategy may not use, because they are the session-level `endedBy` values
 * (reconciliation S8): using one is `E_RESERVED_REASON`.
 */
export const RESERVED_STOP_REASONS = ['stop-win', 'stop-loss', 'bust', 'rounds', 'error'] as const;

/** At most this many distinct stop reasons per strategy (`E_LIMIT`; reconciliation S7). */
export const MAX_STOP_REASONS = 200;

/** Stage ids, progression names, rule ids, stop reasons: /^[a-z][a-z0-9-]{0,39}$/ */
export type Slug = string;
/** Var names: /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/ */
export type VarName = string;

// ---------------------------------------------------------------- definition

/** A rule-based strategy (v1). A code strategy (§16) is a separate, deferred kind. */
export interface StrategyDefinition {
  schema: 1;
  kind?: 'rules'; // default 'rules'; 'code' is reserved (§16)
  id: Slug;
  name: string; // 1..80 chars
  game: string; // plugin id, e.g. 'roulette'
  notes?: string; // ≤ 4000 chars
  tags?: string[]; // ≤ 16, each a Slug
  unit: Cents; // integer ≥ 1; { units: n } = n × unit
  vars?: Record<VarName, number>; // initial values (finite numbers)
  progressions?: Record<Slug, ProgressionSpec>;
  stages: Stage[]; // ≥ 1; stages[0] is the entry stage
  /** Keys starting with 'x-' anywhere in the document are ignored by the interpreter (UI metadata). */
  [ext: `x-${string}`]: unknown;
}

export interface Stage {
  id: Slug;
  label?: string;
  extends?: Slug; // inherit layout and rules (§3.6)
  layout?: LayoutSpec[]; // desired layout every window while in this stage
  onEnter?: Effect[]; // not inherited; may not contain goto
  onExit?: Effect[]; // not inherited; may not contain goto
  rules?: Rule[]; // default []; evaluated in order every window
}

export interface LayoutSpec {
  bet: BetId;
  amount: AmountExpr;
  when?: Condition; // default: always
  parent?: BetId; // odds and other parented bets
  working?: 'auto' | 'on' | 'off'; // passed through to reconcile
  label?: string;
}

/** An amount: an expression, or "keep what is on the table, else place this". */
export type AmountExpr = Expr | { keepOr: Expr };

export interface Rule {
  id?: Slug; // unique within the strategy when present
  label?: string;
  enabled?: boolean; // default true; false = skipped (builder toggle)
  when: Condition;
  then: Effect[]; // 1..16
  once?: boolean | 'stage'; // true: once per session; 'stage': once per stage entry
  cooldown?: number; // integer ≥ 1: skipped for this many windows after firing
}

// ---------------------------------------------------------------- expressions (§4)

export type Expr =
  | number // literal (cents when used as money)
  | string // a numeric fact: 'net', 'round', 'spinsSince:straight:17'
  | { units: number } // n × unit
  | { fact: FactRef } // same as the bare string (explicit form)
  | { var: VarName }
  | { prog: Slug } // current amount of a progression (cents)
  | { progStep: Slug } // current level (kind-specific, §7)
  | { progCaps: Slug } // times the progression has capped this session
  | { stageEntries: Slug }
  | { amountOn: BetId } // on the table now (before this window's reconcile)
  | { lastAmount: BetId } // staked on the bet in the round just resolved
  | { lastProfit: BetId } // profit of the bet in the round just resolved
  | { pctOfBankroll: number } // percent (5 = 5%) of bankroll (cash)
  | { tableMin: BetId | string } // a bet id or a limits class ('outside', 'inside')
  | { tableMax: BetId | string }
  | { streakLen: HistoryPredicate }
  | { countInLast: HistoryPredicate & { n: number } }
  | { roundsSince: HistoryPredicate }
  | { add: Expr[] }
  | { times: Expr[] }
  | { max: Expr[] }
  | { min: Expr[] } // 2..8 operands
  | { sub: [Expr, Expr] }
  | { div: [Expr, Expr] }
  | { floorTo: [Expr, Expr] }
  | { abs: Expr }
  | { if: [Condition, Expr, Expr] };

// ---------------------------------------------------------------- conditions (§5)

export type CmpOp = '<' | '<=' | '==' | '!=' | '>=' | '>';
export type FactOp = CmpOp | 'in' | 'notIn';

export type Condition =
  | { always: true }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { cmp: [Expr, CmpOp, Expr] }
  | { fact: [FactRef, FactOp, FactValue | FactValue[]] }
  | { event: string; bet?: BetId; prog?: Slug; args?: Record<string, string | number> }
  | { onTable: BetId }
  | { streak: HistoryPredicate & { atLeast: number } }
  | {
      countInLast: HistoryPredicate & {
        n: number;
        atLeast?: number;
        atMost?: number;
        partial?: boolean;
      };
    }
  | { since: HistoryPredicate & { atLeast?: number; atMost?: number } }
  | { everyN: number; offset?: number; of?: 'round' | 'stage' }
  | { chance: number }; // reserved: E_DEFERRED in v1

/** A per-round predicate tracked over history (§8.4). Exactly one of the two forms. */
export type HistoryPredicate =
  | { fact: FactRef; equals: FactValue | FactValue[] }
  | { event: string; bet?: BetId; args?: Record<string, string | number> };

// ---------------------------------------------------------------- effects (§6)

export type Effect =
  | { bet: BetId; amount: Expr; parent?: BetId; working?: 'auto' | 'on' | 'off' }
  | { remove: BetId }
  | { clear: true }
  | { press: BetId; by: Expr; cap?: Expr }
  | { set: VarName; to: Expr }
  | { inc: VarName; by?: Expr } // by default 1; may be negative
  | { goto: Slug; reenter?: boolean } // goto to the current stage is a no-op unless reenter
  | { prog: Slug; do: 'win' | 'loss' | 'push' | 'reset' | 'advance' | 'back' }
  | { stop: Slug }
  | { skipRound: true }
  | { act: string; args?: Record<string, string | number> }; // game decision (fold, ...), §6.11

// ---------------------------------------------------------------- progressions (§7)

export type CapPolicy = 'reset' | 'stay' | 'stop';
export type Track = 'round' | 'manual' | BetId | { bets: BetId[] }; // 1..16 bets
export type SeqStep = 'advance' | 'back' | 'reset' | 'stay';

interface ProgCommon {
  track: Track;
  feed?: 'sized' | 'always'; // default 'sized' (§7.2)
  base?: Expr; // default { units: 1 }; latched at cycle start (§7.3)
  maxAmount?: Expr; // a transition to an amount above this is a cap
  onCap?: CapPolicy; // kind-specific default (§7.5)
}
export type ProgressionSpec =
  | ({ kind: 'flat' } & Partial<ProgCommon>)
  | ({ kind: 'martingale'; maxSteps: number; onCap: CapPolicy; multiplier?: number } & ProgCommon)
  | ({ kind: 'grand-martingale'; maxSteps: number; onCap: CapPolicy } & ProgCommon)
  | ({ kind: 'fibonacci'; maxSteps?: number; back?: number } & ProgCommon)
  | ({ kind: 'dalembert'; maxSteps?: number; step?: Expr } & ProgCommon)
  | ({ kind: 'paroli'; maxSteps?: number; multiplier?: number } & ProgCommon)
  | ({ kind: '1-3-2-6' } & ProgCommon)
  | ({ kind: 'oscars-grind'; maxSteps?: number } & ProgCommon)
  | ({
      kind: 'labouchere';
      line: number[];
      onEmpty?: 'reset' | 'stop';
      maxLength?: number;
    } & ProgCommon)
  | ({
      kind: 'sequence';
      amounts: Expr[];
      onWin: SeqStep;
      onLoss: SeqStep;
      onPush?: SeqStep;
    } & Omit<ProgCommon, 'base'>);

// ---------------------------------------------------------------- diagnostics (§9)

export type Severity = 'error' | 'warning';
export interface Diagnostic {
  code: string; // e.g. 'E_UNKNOWN_BET'
  severity: Severity;
  path: string; // RFC 6901 JSON pointer into the strategy, '' = root
  message: string; // English, generated from code + params
  params?: Record<string, string | number>;
}

// ---------------------------------------------------------------- runtime (§11)

export type ProgResult = 'win' | 'loss' | 'push' | 'none';

/** What the harness gives the interpreter at each decision window. Objects are reused, never reallocated. */
export interface Observation<V = unknown> {
  window: number; // = rounds already played in this session (0-based)
  session: SessionFacts;
  table: Layout; // layoutOf(state) before this window's reconcile
  last: RoundOutcome | null; // null at window 0
  state: V; // the plugin's `visible(state)` view, read only, for compiled fact accessors (G3)
}
export interface SessionFacts {
  start: Cents;
  bankroll: Cents;
  equity: Cents;
  net: Cents;
  peak: Cents;
  drawdown: Cents;
  wagered: Cents;
  roundsWagered: number;
  lastNet: Cents;
  exposure: Cents;
}

export interface StepOutput {
  stage: number; // index into StrategyRuntime.stageIds after this window
  desired: Layout; // a view over a reused buffer: copy before keeping
  acts: readonly { act: string; args?: Record<string, string | number> }[];
  stop: string | null; // strategy stop reason → endedBy 'strategy:<reason>'
  error: { code: string; message: string; path?: string } | null; // → endedBy 'error'
}

export interface CompileContext<R = unknown, V = unknown> {
  catalog: readonly BetCatalogEntry[];
  parseBet(id: string): BetId | null;
  facts: FactSchema;
  rules: R; // resolved game rules (limits, availability)
  limits(betOrClass: string, rules: R, view?: V): { min: Cents; max: Cents } | null;
  compileFact(ref: FactRef, rules: R): (view: V, last: RoundOutcome | null) => FactValue | null;
  /** Optional (§8.4): reuse the plugin's indexed counters for a generic history predicate. */
  compileHistory?(
    predicate: HistoryPredicate,
    rules: R,
  ): ((view: V, last: RoundOutcome | null) => FactValue | null) | null;
}

export interface TraceSink {
  window(rec: TraceWindow): void;
}

export interface StrategyRuntime {
  readonly def: StrategyDefinition;
  readonly stageIds: readonly string[]; // summary stopStage / per-stage rounds index this
  readonly stopReasons: readonly string[]; // every reason this strategy can stop with, SORTED (S3; harness endedBy enum 16 + j)
  createMemory(): StrategyMemory; // once per worker
  reset(mem: StrategyMemory): void; // at the start of every session
  step(mem: StrategyMemory, obs: Observation, out: StepOutput, trace?: TraceSink): void;
}
/** Opaque to everything outside src/core/strategy. */
export interface StrategyMemory {
  readonly __brand: 'StrategyMemory';
}

// Functions exported by src/core/strategy (signatures frozen):
//   validateStrategy(def: unknown, ctx: CompileContext | null): Diagnostic[]
//       ctx null = structural checks only (no plugin); with ctx = full checks (§9).
//   compileStrategy(def: StrategyDefinition, ctx: CompileContext): StrategyRuntime
//       throws StrategyCompileError(diagnostics) if validateStrategy reports any error.
//   stepPure(rt, mem, obs): { mem, out, trace }   // clones memory first; for tests (§11.3)
//   normalizeStrategy(def): StrategyDefinition    // canonical form used by the builder round trip (§13.4)
