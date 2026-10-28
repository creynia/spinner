# Strategy language design (spike)

Status: design spike output for `src/core/strategy/**` and the frozen contract `src/core/contracts/strategy.ts`.
Authority: `docs/design/decisions.md` > this document > `PLAYBOOK.md`. This document refines PLAYBOOK §5; where it changes §5 it says so explicitly ("**Change from §5**").

The language is game-agnostic. Everything game-specific comes from the plugin's **bet catalog** (`bets.catalog`, `bets.parse`, `persistent`, `contract`), **limits** and **fact schema** (facts, events). Bet ids and fact names used in examples (`red`, `straight:17`, `dozen:1`, `lastColor`, `phase`, `place-6`, ...) are provisional; `game.md` is canonical and the golden fixtures are renamed to its ids at reconciliation.

Contents

1. Principles
2. The contract (`src/core/contracts/strategy.ts`)
3. Decision-window semantics (normative)
4. Expressions
5. Conditions
6. Effects
7. Progression library
8. Facts, events and history
9. Validation (error codes, JSON-pointer paths)
10. Compile step
11. Runtime API and memory
12. Trace format
13. Builder UI model
14. Prior-art coverage (crappy, baccaratton, holdumb)
15. Golden strategies (24 roulette, 7 craps)
16. Deferred: code strategies
17. Test plan
18. Requests to sibling contracts
19. Open questions

---

## 1. Principles

1. **Desired layouts, not actions.** Each decision window the strategy states what it wants on the table; the plugin's `reconcile` turns that into legal actions (PLAYBOOK §3.1). The interpreter never emits engine actions.
2. **A deterministic state machine.** Same definition + same observations ⇒ same outputs, byte for byte. No clocks, no `Math.random`, no iteration over unordered collections (object-keyed things are processed in sorted key order, §3.9).
3. **JSON AST is the contract.** No string expressions in v1. A text syntax may be layered on later as sugar that compiles to this AST.
4. **Errors are visible.** Anything the strategy asked for that could not happen is in the trace and counted: rejected bets, null amounts, capped progressions, runtime errors. Nothing is silently dropped (PLAYBOOK §14).
5. **Sitting out is a legitimate round.** An empty desired layout still plays a round; facts and history advance.
6. **Compile once, allocate never.** Validation and compilation happen once per worker; the per-round path mutates preallocated memory only (§10).
7. **Integer cents** for money. Expressions are evaluated in IEEE doubles (exact for integers below 2^53); amounts are floored to integer cents at the boundary (§4.3). No floats leak into money except through that single, specified floor.

---

## 2. The contract (`src/core/contracts/strategy.ts`)

This block is meant to be copied verbatim into `src/core/contracts/strategy.ts` by WP0 and then frozen. It imports `Cents`, `BetId`, `Layout`, `LayoutEntry`, `RoundOutcome` from `contracts/game.ts`, and the fact-schema types it needs from `contracts/facts.ts` (§8.1; proposed as a new shared contract file because both the plugin and the strategy core use it).

```ts
// src/core/contracts/strategy.ts — FROZEN after the spikes (decisions.md)
import type { BetId, Cents, Layout, RoundOutcome } from './game';
import type { FactRef, FactValue, FactSchema } from './facts';

export const STRATEGY_SCHEMA = 1 as const;

/** Stage ids, progression names, rule ids, stop reasons: /^[a-z][a-z0-9-]{0,39}$/ */
export type Slug = string;
/** Var names: /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/ */
export type VarName = string;

// ---------------------------------------------------------------- definition

/** A rule-based strategy (v1). A code strategy (§16) is a separate, deferred kind. */
export interface StrategyDefinition {
  schema: 1;
  kind?: 'rules';                                   // default 'rules'; 'code' is reserved (§16)
  id: Slug;
  name: string;                                     // 1..80 chars
  game: string;                                     // plugin id, e.g. 'roulette'
  notes?: string;                                   // ≤ 4000 chars
  tags?: string[];                                  // ≤ 16, each a Slug
  unit: Cents;                                      // integer ≥ 1; { units: n } = n × unit
  vars?: Record<VarName, number>;                   // initial values (finite numbers)
  progressions?: Record<Slug, ProgressionSpec>;
  stages: Stage[];                                  // ≥ 1; stages[0] is the entry stage
  /** Keys starting with 'x-' anywhere in the document are ignored by the interpreter (UI metadata). */
  [ext: `x-${string}`]: unknown;
}

export interface Stage {
  id: Slug;
  label?: string;
  extends?: Slug;                                   // inherit layout and rules (§3.6)
  layout?: LayoutSpec[];                            // desired layout every window while in this stage
  onEnter?: Effect[];                               // not inherited; may not contain goto
  onExit?: Effect[];                                // not inherited; may not contain goto
  rules?: Rule[];                                   // default []; evaluated in order every window
}

export interface LayoutSpec {
  bet: BetId;
  amount: AmountExpr;
  when?: Condition;                                 // default: always
  parent?: BetId;                                   // odds and other parented bets
  working?: 'auto' | 'on' | 'off';                  // passed through to reconcile
  label?: string;
}

/** An amount: an expression, or "keep what is on the table, else place this". */
export type AmountExpr = Expr | { keepOr: Expr };

export interface Rule {
  id?: Slug;                                        // unique within the strategy when present
  label?: string;
  enabled?: boolean;                                // default true; false = skipped (builder toggle)
  when: Condition;
  then: Effect[];                                   // 1..16
  once?: boolean | 'stage';                         // true: once per session; 'stage': once per stage entry
  cooldown?: number;                                // integer ≥ 1: skipped for this many windows after firing
}

// ---------------------------------------------------------------- expressions (§4)

export type Expr =
  | number                                          // literal (cents when used as money)
  | string                                          // a plain numeric fact: 'net', 'round', 'lastNumber'
  | { units: number }                               // n × unit
  | { fact: FactRef }                               // numeric fact, possibly parameterised
  | { var: VarName }
  | { prog: Slug }                                  // current amount of a progression (cents)
  | { progStep: Slug }                              // current level (kind-specific, §7)
  | { progCaps: Slug }                              // times the progression has capped this session
  | { stageEntries: Slug }
  | { amountOn: BetId }                             // on the table now (before this window's reconcile)
  | { lastAmount: BetId }                           // staked on the bet in the round just resolved
  | { lastProfit: BetId }                           // profit of the bet in the round just resolved
  | { pctOfBankroll: number }                       // percent (5 = 5%) of bankroll (cash)
  | { tableMin: BetId | string }                    // a bet id or a limits class ('outside', 'inside')
  | { tableMax: BetId | string }
  | { streakLen: HistoryPredicate }
  | { countInLast: HistoryPredicate & { n: number } }
  | { roundsSince: HistoryPredicate }
  | { add: Expr[] } | { times: Expr[] } | { max: Expr[] } | { min: Expr[] }   // 2..8 operands
  | { sub: [Expr, Expr] } | { div: [Expr, Expr] } | { floorTo: [Expr, Expr] }
  | { abs: Expr }
  | { if: [Condition, Expr, Expr] };

// ---------------------------------------------------------------- conditions (§5)

export type CmpOp = '<' | '<=' | '==' | '!=' | '>=' | '>';
export type FactOp = CmpOp | 'in' | 'notIn';

export type Condition =
  | { always: true }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
  | { cmp: [Expr, CmpOp, Expr] }
  | { fact: [FactRef, FactOp, FactValue | FactValue[]] }
  | { event: string; bet?: BetId; prog?: Slug; args?: Record<string, string | number> }
  | { onTable: BetId }
  | { streak: HistoryPredicate & { atLeast: number } }
  | { countInLast: HistoryPredicate & { n: number; atLeast?: number; atMost?: number; partial?: boolean } }
  | { since: HistoryPredicate & { atLeast?: number; atMost?: number } }
  | { everyN: number; offset?: number; of?: 'round' | 'stage' }
  | { chance: number };                             // reserved: E_DEFERRED in v1

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
  | { inc: VarName; by?: Expr }                     // by default 1; may be negative
  | { goto: Slug }
  | { prog: Slug; do: 'win' | 'loss' | 'push' | 'reset' | 'advance' | 'back' }
  | { stop: Slug }
  | { skipRound: true }
  | { act: string; args?: Record<string, string | number> };  // game decision (fold, ...), §6.11

// ---------------------------------------------------------------- progressions (§7)

export type CapPolicy = 'reset' | 'stay' | 'stop';
export type Track = 'round' | 'manual' | BetId | { bets: BetId[] };   // 1..16 bets
export type SeqStep = 'advance' | 'back' | 'reset' | 'stay';

interface ProgCommon {
  track: Track;
  feed?: 'sized' | 'always';                        // default 'sized' (§7.2)
  base?: Expr;                                      // default { units: 1 }; latched at cycle start (§7.3)
  maxAmount?: Expr;                                 // a transition to an amount above this is a cap
  onCap?: CapPolicy;                                // kind-specific default (§7.5)
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
  | ({ kind: 'labouchere'; line: number[]; onEmpty?: 'reset' | 'stop'; maxLength?: number } & ProgCommon)
  | ({ kind: 'sequence'; amounts: Expr[]; onWin: SeqStep; onLoss: SeqStep; onPush?: SeqStep }
      & Omit<ProgCommon, 'base'>);

// ---------------------------------------------------------------- diagnostics (§9)

export type Severity = 'error' | 'warning';
export interface Diagnostic {
  code: string;                                     // e.g. 'E_UNKNOWN_BET'
  severity: Severity;
  path: string;                                     // RFC 6901 JSON pointer into the strategy, '' = root
  message: string;                                  // English, generated from code + params
  params?: Record<string, string | number>;
}

// ---------------------------------------------------------------- runtime (§11)

export type ProgResult = 'win' | 'loss' | 'push' | 'none';

/** What the harness gives the interpreter at each decision window. Objects are reused, never reallocated. */
export interface Observation {
  window: number;                                   // = rounds already played in this session (0-based)
  session: SessionFacts;
  table: Layout;                                    // layoutOf(state) before this window's reconcile
  last: RoundOutcome | null;                        // null at window 0
  state: unknown;                                   // plugin state, read only, for compiled fact accessors
}
export interface SessionFacts {
  start: Cents; bankroll: Cents; equity: Cents; net: Cents; peak: Cents; drawdown: Cents;
  wagered: Cents; roundsWagered: number; lastNet: Cents; exposure: Cents;
}

export interface StepOutput {
  desired: Layout;                                  // a view over a reused buffer: copy before keeping
  acts: readonly { act: string; args?: Record<string, string | number> }[];
  stop: string | null;                              // strategy stop reason → endedBy 'strategy:<reason>'
  error: { code: string; message: string; path?: string } | null;  // → endedBy 'error'
}

export interface CompileContext<R = unknown> {
  catalog: readonly import('./game').BetCatalogEntry[];
  parseBet(id: string): BetId | null;
  facts: FactSchema;
  rules: R;                                          // resolved game rules (limits, availability)
  limits(betOrClass: string, rules: R, state?: unknown): { min: Cents; max: Cents } | null;
  compileFact(ref: FactRef, rules: R): (state: unknown, last: RoundOutcome | null) => FactValue | null;
}

export interface TraceSink { window(rec: import('./strategy-trace').TraceWindow): void }

export interface StrategyRuntime {
  readonly def: StrategyDefinition;
  createMemory(): StrategyMemory;                   // once per worker
  reset(mem: StrategyMemory): void;                 // at the start of every session
  step(mem: StrategyMemory, obs: Observation, out: StepOutput, trace?: TraceSink): void;
}
/** Opaque to everything outside src/core/strategy. */
export interface StrategyMemory { readonly __brand: 'StrategyMemory' }

// Functions exported by src/core/strategy (signatures frozen):
//   validateStrategy(def: unknown, ctx: CompileContext | null): Diagnostic[]
//       ctx null = structural checks only (no plugin); with ctx = full checks (§9).
//   compileStrategy(def: StrategyDefinition, ctx: CompileContext): StrategyRuntime
//       throws StrategyCompileError(diagnostics) if validateStrategy reports any error.
//   stepPure(rt, mem, obs): { mem, out, trace }   // clones memory first; for tests (§11.3)
//   normalizeStrategy(def): StrategyDefinition    // canonical form used by the builder round trip (§13.4)
```

The trace types (`TraceWindow`) live in `contracts/strategy-trace.ts` (§12) so the harness and the Watch screen can import them without the interpreter.

**Change from §5.1:** `rules` is optional (default `[]`), `kind`, `tags`, `x-*` extension keys, `Rule.enabled`, `Rule.label`, `once: 'stage'`, `LayoutSpec.label`, `AmountExpr.keepOr` and `Effect.act` are new. `ProgressionSpec` gains `feed`, `maxAmount` and kind parameters (§7).

### 2.1 Structural limits

| Thing | Limit | Code when exceeded |
|---|---|---|
| stages | 1..32 | `E_LIMIT` |
| rules per stage (own) | 64 | `E_LIMIT` |
| rules per stage after `extends` flattening | 128 | `E_LIMIT` |
| layout entries per stage after flattening | 64 | `E_LIMIT` |
| effects per `then`, `onEnter`, `onExit` list | 16 | `E_EFFECT_CAP` |
| vars | 64 | `E_LIMIT` |
| progressions | 16 | `E_LIMIT` |
| distinct history predicates | 32 | `E_LIMIT` |
| `countInLast.n` | 1..1000 | `E_RANGE` |
| expression / condition depth | 16 | `E_LIMIT` |
| AST nodes in the whole strategy | 4096 | `E_LIMIT` |
| `extends` chain depth | 4 | `E_EXTENDS_DEPTH` |
| labouchere `line` length / `maxLength` | 1..64 / ≤ 256 | `E_RANGE` |
| `sequence.amounts` | 1..64 | `E_RANGE` |
| canonical JSON size | 64 KiB | `E_LIMIT` |

---

## 3. Decision-window semantics (normative)

A session is a sequence of **windows** `w = 0, 1, 2, ...`. Window `w` precedes round `w`. The interpreter's `step` covers phases 0–4 below; the harness owns 5–7 and calls `step` once per window. **This section refines PLAYBOOK §5.6 and replaces it.**

### 3.1 Phase 0: session start (window 0 only)

`reset(mem)` sets vars to their initial values, progressions to their initial state, history trackers to empty, all rule `once`/`cooldown` state to clear, `stage = stages[0]`, `stageEntries[stages[0]] = 1`, `roundsInStage = 0`. Then `stages[0].onEnter` runs as part of window 0 (its effects count toward the window's effect cap and are traced under rule id `@enter`).

### 3.2 Phase 1: observe

For `w > 0`, the interpreter first ingests the round just resolved (`obs.last`):

1. **History trackers** (§8.4) are updated with that round's round-scoped facts and events. This happens for every round, wagered or not.
2. **Session-derived facts** kept by the interpreter: `lastResult` (from `last`: `win` if `net > 0`, `loss` if `net < 0`, `push` if `net == 0` and at least one resolution other than `stays`, else `none`), `winStreak`/`lossStreak` (a `win` increments `winStreak` and zeroes `lossStreak`, and vice versa; `push` and `none` leave both unchanged), `roundsInStage += 1`.
3. **Event set** for this window: the plugin events in `last.events`, plus core events derived from `last.resolutions`: `bet-won` / `bet-lost` / `bet-push` for each resolution with `profit > 0` / `< 0` / `== 0` (resolutions with `result: 'stays'` produce none). Progression events (`prog-cap`, `prog-done`) are added during phases 2 and 3.

Game facts are read lazily through compiled accessors (§10) against `obs.state` and `obs.last`; at window 0 round-scoped facts are `null`.

### 3.3 Phase 2: feed progressions

For `w > 0`, every progression with `track ≠ 'manual'` is fed, **in sorted name order** (§3.9), with the result of the round just resolved (§7.1–§7.2). A feed may cap (§7.5): a `prog-cap` event is added; with `onCap: 'stop'` the window ends immediately with `stop = 'cap-<name>'` (no rules, no round). A labouchere whose line empties adds `prog-done`; with `onEmpty: 'stop'` the window ends with `stop = 'done-<name>'`.

Then every progression that is now in its **initial state** re-latches its `base` (and `step`, `maxAmount`) by evaluating the expressions (§7.3). At window 0 all progressions latch.

### 3.4 Phase 3: rules

The current stage's **flattened rule list** (§3.6) is evaluated in order. For each rule:

1. Skip if `enabled === false`.
2. Skip if `once === true` and it has fired this session, or `once === 'stage'` and it has fired since the current stage entry.
3. Skip if `w < nextEligible[rule]` (cooldown).
4. Evaluate `when` (§5). Short-circuit evaluation; a skipped rule does not evaluate its condition at all.
5. If true, the rule **fires**: record it in the trace, set its once flag, set `nextEligible[rule] = w + cooldown + 1` when `cooldown` is set, then execute `then` in order.

Effects take effect immediately; later effects and later rules see their results (vars, progression state, stage, event set). Effect semantics are in §6. Three effects end phase 3 early:

- **`goto: S`** runs the old stage's `onExit`, switches `stage = S`, sets `roundsInStage = 0`, increments `stageEntries[S]`, clears all `once: 'stage'` flags, runs `S.onEnter`, and **ends rule evaluation for this window**. The new stage's rules first run in window `w + 1`. Phase 4 uses the **new** stage's layout, so round `w` is played under `S` and counts as `S`'s first round (`roundsInStage` is 1 at window `w + 1`). `goto` to the current stage is a re-entry (`onExit`, `onEnter`, counters reset). `onEnter`/`onExit` may not contain `goto` (`E_GOTO_IN_HOOK`), so a window performs at most one stage change.
- **`stop: reason`** ends the window immediately: no further effects, no `onExit`, no layout, no round. The harness ends the session with `endedBy = 'strategy:<reason>'`.
- An **effect-cap overflow** (below) ends the window with a runtime error.

**Effect cap.** At most **16 effects execute per window**, counting phase 0's `onEnter`, every executed rule effect, and `onExit`/`onEnter` effects run by `goto`. The 17th effect is not executed; the window ends with `error = { code: 'E_RT_EFFECT_CAP' }` and the harness ends the session with `endedBy = 'error'`. Definition time: a single list longer than 16 is `E_EFFECT_CAP` (error); a stage whose worst case (entry hooks + every flattened rule's `then` + the largest `onExit`+`onEnter` pair reachable by its gotos) exceeds 16 is `W_EFFECT_CAP_POSSIBLE` (warning), because rules are rarely all true at once.

Effects after a `goto` or `stop` in the same list are unreachable: `E_UNREACHABLE_EFFECT`.

### 3.5 Phase 4: build the desired layout

If `skipRound` was executed this window, the desired layout is exactly the current table (`obs.table`, each entry at its current amount): nothing is added, removed or changed; for roulette this is empty. Skip to 4.6.

Otherwise:

1. **Base layout.** Walk the current stage's flattened layout list (§3.6) in order. For each entry whose `bet` has not been decided yet, evaluate `when` (default true). If it holds, the entry **decides** that bet: evaluate `amount` (for `{ keepOr: e }`: `amountOn(bet)` if that is `> 0`, else `e`) and record `{ bet, amount, parent, working }`. Later entries for a decided bet are ignored. Layout `when`s and amounts are evaluated now, after phase 3, so they see this window's var changes and the post-`goto` stage.
2. **Window patches.** Apply the bet-changing effects executed in phase 3 (and hooks) in execution order: `bet` sets the bet's entry (amount evaluated at effect time), `remove` deletes it, `press` sets it to its pressed amount (computed at effect time), `clear` deletes every entry. Patches recorded before a `goto` are kept.
3. **Implicit keep of contract bets.** For every bet on `obs.table` whose catalog entry has `contract: true`, that is absent from the result, and that was not named by an explicit `remove` this window, add it back at its table amount. (Leaving a contract bet out of a layout is not a request to take it down. Craps pass-line after the come-out is the case; an explicit `remove` is still sent and reconcile rejects it visibly.)
4. **Amount boundary.** Every amount is floored to integer cents (`Math.floor`). `null`/`NaN` amounts and amounts `≤ 0` remove the entry; the trace lists it under `dropped` with reason `null`, `zero` or `negative`, and a `null` drop increments the session's `strategyAnomalies` counter (§18). Infinite amounts are a runtime error `E_RT_NONFINITE`.
5. **Order.** Entries are emitted in first-decided order (base layout order, then patch-added bets in patch order, then implicit keeps in table order). Amounts are **not** rounded to bet units or clamped to limits here; that is reconcile's job (PLAYBOOK §5.3).
6. **Arming** (for `feed: 'sized'` progressions, §7.2) is updated from which entries read which progressions.

`step` returns `desired`, the window's `acts` (§6.11), `stop` and `error`.

### 3.6 `extends`

`extends: P` makes a stage inherit P's layout and rules. The chain `S → P → Q ...` (depth ≤ 4, no cycles) is flattened at compile time:

- **Rules:** S's rules, then P's, then Q's (child first, PLAYBOOK §5.1). Each rule keeps the identity of the stage that **declares** it: its `once`/`cooldown` state is shared by every stage that inherits it, and its trace id is the declaring stage's (§12).
- **Layout:** S's entries, then P's, then Q's. Because the first matching entry decides a bet (§3.5.1), a child entry for the same bet overrides the parent's whenever the child's `when` holds and falls back to the parent's otherwise.
- **Not inherited:** `onEnter`, `onExit`, `label`. Hooks describe the transition into or out of that stage id; a stage that wants its parent's entry effects repeats them.
- `stage` (the fact) and `roundsInStage` always refer to the current stage, never to the stage that declared the rule.

### 3.7 Phases 5–7 (harness, restated for completeness)

5. **Reconcile** `desired` through the plugin. `deferred` entries are retried naturally (the layout restates them next window); `rejected` entries are traced and counted. If `affordable` is false, `desired` is non-empty and the table is empty, the session ends with `bust`.
6. **Play the round**; record outcome, equity, analytic expected loss and variance.
7. **Stops**, in this order: strategy `stop` (phase 2 or 3) → error → bust (phase 5) → `stopWin`/`stopLoss` (after phase 6, on equity vs start) → `maxRounds`. `endedBy ∈ rounds | bust | stop-win | stop-loss | strategy:<reason> | error`.

### 3.8 Counting conventions

| Fact | At window `w` |
|---|---|
| `round` | `w` (rounds played so far) |
| `roundsInStage` | rounds played since the current stage was entered; 0 at window 0 and in the window of a `goto` (before it), ≥ 1 afterwards |
| `stageEntries(S)` | entries into S including the initial one and re-entries |
| `everyN: n` | true when `(round - offset) mod n == 0` and `round ≥ offset` (`of: 'stage'` uses `roundsInStage`) |
| cooldown `c` | a rule firing at `w` is skipped in `w+1 .. w+c` |

Sat-out rounds count everywhere (they are rounds).

### 3.9 Determinism rules

- Object-keyed collections (`vars`, `progressions`) are processed in **sorted UTF-16 code-unit order of their keys**, never insertion order, because the definition is canonicalised (keys sorted) before hashing and the two orders must not differ in behaviour.
- Arrays (`stages`, `rules`, `layout`, effects) keep document order.
- `chance` is reserved; if enabled later it draws from the strategy RNG stream (PLAYBOOK §7.1) only when evaluated, so short-circuiting is part of the semantics.
- The interpreter never reads time, locale or global state.

---

## 4. Expressions

### 4.1 Values

An expression evaluates to a finite number or **null**. Implementations represent null as `NaN` internally; it never reaches money or vars (§4.3). Enum and boolean facts are not expressions; they are tested with the `fact` condition (§5.3).

| Form | Value | Null when |
|---|---|---|
| `123` | the literal | never |
| `"net"` (bare string) | the plain numeric fact of that name (session fact §8.2 or unparameterised game fact) | the fact is null (e.g. `lastNumber` at window 0) |
| `{ fact: ref }` | numeric fact, possibly parameterised (`{ fact: { name: 'spinsSince', args: [17] } }`) | the fact is null |
| `{ units: n }` | `n × unit` (`n` finite, may be fractional) | never |
| `{ var: x }` | current var value | never (vars are never null) |
| `{ prog: p }` | progression amount in cents: `multiplier(state) × latchedBase` (§7) | never |
| `{ progStep: p }` | progression level (§7.6) | never |
| `{ progCaps: p }` | caps this session | never |
| `{ stageEntries: S }` | count | never |
| `{ amountOn: b }` | cents on the table for `b` now (0 if absent) | never |
| `{ lastAmount: b }`, `{ lastProfit: b }` | from the last round's resolution of `b` (0 if `b` did not resolve) | window 0 |
| `{ pctOfBankroll: p }` | `bankroll × p / 100` | never |
| `{ tableMin: x }`, `{ tableMax: x }` | plugin limits for a bet id or class at the current rules and state | plugin returns null |
| `{ streakLen: h }`, `{ countInLast: h & {n} }`, `{ roundsSince: h }` | history tracker values (§8.4) | never |
| `{ add: [...] }`, `{ times: [...] }` | sum, product | any operand null |
| `{ sub: [a, b] }` | `a − b` | any operand null |
| `{ div: [a, b] }` | `a / b` (IEEE) | any operand null, or `b == 0` |
| `{ max: [...] }`, `{ min: [...] }` | extremum | any operand null |
| `{ floorTo: [a, m] }` | `floor(a / m) × m` | any operand null, or `m ≤ 0` |
| `{ abs: a }` | `|a|` | `a` null |
| `{ if: [c, a, b] }` | `a` if `c` holds else `b`; only the chosen branch is evaluated | chosen branch null |

Bare-string facts and `{ fact }` must have a numeric type in the fact schema (`E_FACT_TYPE` otherwise). All expressions are side-effect free.

### 4.2 Static typing

The validator assigns each expression a **unit kind**: `money` (cents), `count`, or `scalar`. `units`, `prog`, `amountOn`, `lastAmount`, `lastProfit`, `pctOfBankroll`, `tableMin`, `tableMax` and money facts are money; `round`, streaks, counts are count; literals are scalar (they adopt the other operand's kind). `add`/`sub`/`max`/`min`/`if` of money and count is `W_UNIT_MIX` (warning only: `{ add: ['net', 'round'] }` is legal and probably a mistake). Amount positions (`LayoutSpec.amount`, `bet.amount`, `press.by`, `press.cap`, progression `base`, `step`, `maxAmount`, `sequence.amounts`) expect money; a count-only expression there is `W_UNIT_MIX`.

### 4.3 Boundaries

- **Amounts** (layout, `bet`, `press`): floor to integer cents, then `≤ 0` or null drops the entry (§3.5.4).
- **`set` / `inc`:** a null result leaves the var unchanged and is traced as `null-skipped`; otherwise the var takes the exact double (vars may be fractional; amounts are floored only at the amount boundary).
- **Progression `base`, `step`, `maxAmount`** latch the floored value; a null or `≤ 0` base latches the previous value (or `unit` at window 0) and is traced as an anomaly.
- **Comparisons** in `cmp` use the exact doubles.
- Non-finite intermediate values (overflow to ±Infinity) are a runtime error `E_RT_NONFINITE`; ordinary strategies never get close because amounts are bounded by the 2^31 cents guard (§7.5).

---

## 5. Conditions

### 5.1 Evaluation

Conditions evaluate to `true` or `false` (never null). Evaluation is left to right with short-circuit for `all` and `any`. `{ all: [] }` is true, `{ any: [] }` is false (both are lint warnings `W_EMPTY_GROUP`; the builder writes `{ always: true }` instead).

### 5.2 `cmp`

`{ cmp: [a, op, b] }`: both sides are expressions. If either side is null the result is **false for every operator, including `!=`** (SQL-style; the implementation must not use JS `NaN != x`, which is true). `==` and `!=` are exact on doubles; use integers.

### 5.3 `fact`

`{ fact: [ref, op, value] }` tests a typed fact (session, strategy or game):

| Fact type | Allowed ops | `value` |
|---|---|---|
| `enum` | `==`, `!=`, `in`, `notIn` | a member (`'red'`), or an array of members for `in`/`notIn` |
| `boolean` | `==`, `!=` | `true`/`false` |
| `number` | all `CmpOp`, `in`, `notIn` | number, or array of numbers |

Values are checked against the schema (`E_FACT_VALUE` for a non-member). Null fact ⇒ false for every op (so "last colour is not red" is false at window 0). Enum facts include the core `stage` (members = stage ids) and `lastResult` (`win | loss | push | none`).

### 5.4 `event`

`{ event: name, bet?, prog?, args? }` is true when the window's event set (§3.2.3, plus progression events raised so far this window) contains an event of that name whose parameters match every given filter. `bet` is legal only for events that carry a bet (`bet-won`, `bet-lost`, `bet-push`, plugin events declaring a `bet` param); `prog` only for `prog-cap`/`prog-done`; `args` keys must be declared params of the event (`E_EVENT_FILTER`). At window 0 the set is empty except phase-2 progression events (none at window 0).

### 5.5 `onTable`

`{ onTable: b }` ⇔ `amountOn(b) > 0`.

### 5.6 History conditions

Sugar over the history expressions (§8.4):

| Condition | Meaning |
|---|---|
| `{ streak: { ...h, atLeast: n } }` | `streakLen(h) ≥ n` |
| `{ countInLast: { ...h, n, atLeast?, atMost?, partial? } }` | at least `n` rounds observed (unless `partial: true`) **and** count satisfies every given bound; at least one bound required |
| `{ since: { ...h, atLeast?, atMost? } }` | `roundsSince(h)` satisfies every given bound; at least one required |

`partial` defaults to false so "at most 2 reds in the last 10" does not fire at window 3.

### 5.7 `everyN`, `always`, `chance`

`everyN` per §3.8 (`n` integer ≥ 1, `offset` integer ≥ 0). `{ always: true }` is the rule that always fires. `chance` is schema-valid and rejected by the v1 validator with `E_DEFERRED`.

---

## 6. Effects

Every effect counts 1 toward the window cap (§3.4). "Patch" effects change only this window's desired layout (§3.5.2); the stage layout is recomputed from scratch next window.

| # | Effect | Semantics |
|---|---|---|
| 6.1 | `{ bet, amount, parent?, working? }` | Patch: this window's entry for `bet` is set to `amount` (evaluated now), overriding the stage layout's entry for that bet. |
| 6.2 | `{ remove: b }` | Patch: no entry for `b` this window. On a contract bet: `E_REMOVE_CONTRACT` at definition time (where the plugin catalog says `contract: true`). |
| 6.3 | `{ clear: true }` | Patch: delete every entry decided so far, including base layout entries (applied in patch order, so later `bet` patches still add). Contract bets on the table are kept by §3.5.3. |
| 6.4 | `{ press: b, by, cap? }` | Patch: if `amountOn(b) > 0`, set `b` to `min(amountOn(b) + by, cap)` (cap default: no cap); else no-op traced `not-on-table`. Only on bets with `persistent: true` (`E_PRESS_NON_PERSISTENT` otherwise, PLAYBOOK §5.8). To make a pressed amount stick across windows the layout entry uses `{ keepOr: ... }` (golden C5). |
| 6.5 | `{ set: x, to }` | Var `x` := value (null ⇒ unchanged, traced). |
| 6.6 | `{ inc: x, by? }` | Var `x` += `by` (default 1). |
| 6.7 | `{ goto: S }` | §3.4. Ends rule evaluation. |
| 6.8 | `{ prog: p, do }` | `win`/`loss`/`push`: feed that result now (§7), as if a tracked bet resolved; caps and events apply immediately (a `prog-cap` raised here is visible to later rules this window; `onCap: 'stop'` ends the window with `stop = 'cap-<p>'`). `reset`: initial state and re-latch. `advance`/`back`: move one level up/down (cap rules apply to `advance`; `back` floors at level 0). `advance`/`back` on `labouchere` or `oscars-grind` are `E_PROG_OP_UNSUPPORTED`. A manual feed does not change arming. |
| 6.9 | `{ stop: reason }` | §3.4. Reason is a Slug; reasons starting `cap-` or `done-` are reserved (`E_RESERVED_REASON`). |
| 6.10 | `{ skipRound: true }` | §3.5: the desired layout is the current table, unchanged. Rules continue to run (vars, gotos); later patch effects are executed but ignored for the layout and traced `ignored-skip`. |
| 6.11 | `{ act, args? }` | A game decision that is not a bet (e.g. Ultimate Texas Hold'em `fold`, blackjack `hit` later). Names and args are declared by the plugin's fact schema `actions` (`E_UNKNOWN_ACT`); passed to reconcile alongside the layout (§18). Roulette and craps declare none. |

Patch effects and `act` executed in a window that ends by `stop` or error have no effect (there is no round).

---

## 7. Progression library

A progression is a small state machine that owns an **amount**. It is referenced by `{ prog: p }` in amounts and fed with **results** of the bets it tracks.

### 7.1 Results and `track`

After each round the result for a progression is computed from `last.resolutions`:

| `track` | Resolutions considered | Result |
|---|---|---|
| a bet id `b` | the resolution of `b` | by profit sign |
| `{ bets: [...] }` | resolutions of the listed bets that are armed (§7.2) | by the **sum** of their profits |
| `'round'` | all resolutions | by `last.net` |
| `'manual'` | none (only `prog` effects feed it) | – |

"By profit sign": `win` if profit > 0, `loss` if < 0, `push` if = 0. Resolutions with `result: 'stays'` (a persistent bet that did not resolve this round, an en-prison bet that is imprisoned) are ignored. If no considered resolution remains, the result is **`none`**. `none` never changes a progression (a bet that was not on the table, a sat-out round, a craps roll that did not decide the pass line). La partage half-losses are losses (profit < 0). For a single bet this agrees with the plugin's `win/lose/push` result; using the sign makes groups and the round consistent.

### 7.2 Feeding: `sized` (default) and `always`

With `feed: 'sized'` a progression only learns from bets **it sized**. Each tracked bet has an **armed** bit:

- In phase 4, for each tracked bet `b`: if the final desired layout has an entry for `b` whose amount evaluation read `{ prog: p }` (directly or through any sub-expression, including the chosen branch of an `if`), `b` is armed; if it has an entry that did not read `p`, `b` is disarmed; if it has no entry, `b` stays armed only if it is on the table (a persistent bet riding to its resolution) and is disarmed otherwise.
- In phase 2, only armed bets feed; a bet that resolves (non-`stays`) is disarmed after feeding.
- `'round'` is armed when any entry of the last window's desired layout read `p`.

So in `red-mart-then-flat` (golden R12) the Martingale stops moving while the `flat` stage bets red with `{ units: 1 }`, and in `martingale-pass` (C6) the pass-line bet placed at the come-out with `{ prog: 'm' }` feeds `m` when it is decided several rolls later. `feed: 'always'` feeds from every resolution of the tracked bets regardless of who sized them. `'manual'` ignores `feed`.

**Change from §5.5:** the playbook fed every progression from its tracked bet unconditionally; that makes a progression drift while a stage is not using it.

### 7.3 Base latching

`base` (default `{ units: 1 }`), dalembert `step` (default = base) and `maxAmount` are expressions **latched** (evaluated and stored) whenever the progression is in its initial state at the end of phase 2, at window 0, and on `reset`. While a cycle is in progress the latched values are used. A constant base behaves identically either way; a `{ pctOfBankroll: 2 }` base resizes once per cycle rather than shrinking in the middle of a Martingale recovery. `flat` is always in its initial state, so its base is re-evaluated every window. `sequence` has no base: its `amounts[k]` are evaluated when read.

### 7.4 Kinds

Notation: level `k` starts at 0; `L` = number of levels (`maxSteps`); amounts are `mult(k) × base` unless noted. "Cap" means §7.5.

| Kind | Params (default) | Amount | On win | On loss | Push |
|---|---|---|---|---|---|
| `flat` | – | `base` | – | – | – |
| `martingale` | `maxSteps` L (required, 1..30), `onCap` (required), `multiplier` m (2; integer 2..10) | `m^k × base` | k := 0 | k+1 (cap if > L−1) | stay |
| `grand-martingale` | `maxSteps` (required, 1..29), `onCap` (required) | `(2^(k+1) − 1) × base`: 1, 3, 7, 15, 31, ... | k := 0 | k+1 (cap) | stay |
| `fibonacci` | `maxSteps` (20; 1..40), `back` (2), `onCap` (`reset`) | `F(k) × base`, F = 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, ... | k := max(0, k − back) | k+1 (cap) | stay |
| `dalembert` | `maxSteps` (50; 1..1000), `step` (= base), `onCap` (`stay`) | `base + k × step` | k := max(0, k−1) | k+1 (cap) | stay |
| `paroli` | `maxSteps` (3; 1..20), `multiplier` (2), `onCap` (`reset`) | `m^k × base` | k+1 (cap if > L−1) | k := 0 | stay |
| `1-3-2-6` | `onCap` (`reset`); L = 4 fixed | `[1,3,2,6][k] × base` | k+1 (cap) | k := 0 | stay |
| `oscars-grind` | `maxSteps` (20) as max units, `onCap` (`stay`) | `u × base`, `u ≥ 1`; also keeps `cycle` (cents) | see below | `cycle += profit`; u unchanged | stay |
| `labouchere` | `line` (required, 1..64 positive integers), `maxLength` (32), `onEmpty` (`reset`), `onCap` (`reset`) | `(first + last) × base`, or `first × base` if one number | remove first and last (or the only one); if empty: `prog-done`, then `onEmpty` | append `first + last` (cap if the line would exceed `maxLength`) | stay |
| `sequence` | `amounts` (required, 1..64 exprs), `onWin`, `onLoss` (required), `onPush` (`stay`), `onCap` (`stay`) | `amounts[k]` evaluated when read | per `onWin` | per `onLoss` | per `onPush` |

Sequence steps: `advance` = k+1 (cap if > L−1), `back` = max(0, k−1), `reset` = k := 0, `stay` = unchanged.

**Oscar's Grind on a win** with profit `P > 0` on stake `S` (sum of the considered resolutions' `amount`): `cycle += P`; if `cycle ≥ base` the cycle is complete: `prog-done`, `u := 1`, `cycle := 0`. Otherwise `need = ceil((base − cycle) × S / (P × base))` (integer arithmetic; the units needed to finish the cycle at this bet's payout) and the target is `u' = max(1, min(u + 1, need))` (cap if `u' > maxSteps`). For even-money bets `need = ceil((base − cycle)/base)`; the formula generalises to Banker's 0.95 and to other payouts. For a `manual` feed (`{ prog, do: 'win' }`) `P = S = ` the current amount (even money).

Manual `do: 'win' | 'loss' | 'push'` feeds use the same transitions; labouchere and oscar's treat a manual feed as even money.

### 7.5 Caps

A **cap** happens when a transition's target is beyond the last level (`k > L − 1`; oscar's `u > maxSteps`; labouchere line longer than `maxLength`), or when the target state's amount would exceed the latched `maxAmount`, or (always, as a guard) would exceed 2^31 − 1 cents. On a cap the progression's `caps` counter increments, a `prog-cap` event `{ prog: p }` is raised, and `onCap` applies:

- `reset`: go to the initial state (and re-latch at the end of phase 2).
- `stay`: the transition is **not applied**; the progression stays in its current state (for Martingale: keeps betting the top level; for d'Alembert: stays at the cap, as baccaratton does).
- `stop`: the session ends this window with `stop = 'cap-<p>'` (`endedBy = 'strategy:cap-<p>'`). To do something else on a cap, use `stay` or `reset` plus a rule on `{ event: 'prog-cap', prog: p }`.

The validator computes the top-level amount where the base is constant and reports `E_PROG_OVERFLOW` (> 2^31 − 1 cents) or `W_PROG_ABOVE_TABLE_MAX` (above `tableMax` of a bet it sizes: reconcile will reject or clamp it).

### 7.6 `progStep` and trace state

| Kind | `progStep` | Trace state |
|---|---|---|
| flat | 0 | `{}` |
| martingale, grand, fibonacci, dalembert, paroli, 1-3-2-6, sequence | k | `{ k }` |
| oscars-grind | u | `{ u, cycle }` |
| labouchere | current line length | `{ line: [...] }` |

### 7.7 Reference sequences (pinned by unit tests)

Computed with the reference model in the spike's scratch script; W = win, L = loss, base = 1 unit. Each cell is `level:amount` before the result.

| Progression | Results | Levels and amounts | Next |
|---|---|---|---|
| martingale L=6, reset | L L L L L L L W | 0:1 1:2 2:4 3:8 4:16 5:32 (**cap → reset**) 0:1 1:2 | 1 |
| martingale L=6, stay | L L L L L L L W | 0:1 1:2 2:4 3:8 4:16 5:32 (cap, stay) 5:32 (cap, stay) 5:32 | 1 |
| martingale L=4, m=3 | L L L L W | 0:1 1:3 2:9 3:27 (cap → reset) 0:1 | 1 |
| grand-martingale L=6 | L×6 W | 0:1 1:3 2:7 3:15 4:31 5:63 (cap → reset) 0:1 | 1 |
| fibonacci L=12 | L L L L L W W L W W W | 0:1 1:1 2:2 3:3 4:5 5:8 3:3 1:1 2:2 0:1 0:1 | 1 |
| dalembert | L L L W L W W W W | 0:1 1:2 2:3 3:4 2:3 3:4 2:3 1:2 0:1 | 1 |
| paroli L=3 | W W W W L W | 0:1 1:2 2:4 (cap → reset) 0:1 1:2 0:1 | 2 |
| 1-3-2-6 | W W W W W L W | 0:1 1:3 2:2 3:6 (cap → reset) 0:1 1:3 0:1 | 3 |
| oscars-grind (even money) | L L W W W L W | u1:1 u1:1 u1:1 u2:2 (done) u1:1 (done) u1:1 u1:1 | 1 |
| oscars-grind | W L L L W W W W | u1:1 (done) 1 1 1 u1:1 u2:2 u1:1 (done) u1:1 (done) | 1 |
| labouchere [1,2,3,4] | L W L W W W | [1,2,3,4]:5 [1,2,3,4,5]:6 [2,3,4]:6 [2,3,4,6]:8 [3,4]:7 (done → reset) [1,2,3,4]:5 | 5 |
| sequence [1,2,4,8] win=reset loss=advance cap=stop | L L L L | 0:1 1:2 2:4 3:8 (cap → stop `cap-p`) | – |

Check of the second oscar's row: after W(+1, done), L L L leave `cycle = −3`; W at u=1 → `cycle = −2`, need = ceil(3/1) = 3, u' = min(2, 3) = 2; W at u=2 → `cycle = 0`, need = 1, u' = max(1, min(3, 1)) = 1; W at u=1 → `cycle = 1 ≥ 1` → done.
