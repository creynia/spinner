# Casino Strategy Lab: Orchestration Playbook

This playbook describes how to build a **strategy lab** for one casino game: a static web app, hosted on GitHub Pages, in which a player **defines** a betting strategy (which may change from one round to the next), **executes** it over many simulated sessions, and **analyzes** the distribution of outcomes (average result, volatility, bust risk, drawdowns, how the strategy actually behaved).

It is written to be reused across games. The first app built from it is **spinner** (roulette, this repo). The next is a craps lab (a separate repo; crappy, https://github.com/creynia/crappy, already has a craps engine and exact EV math that it can reuse). The design below was worked through for **both** roulette and craps so the generic parts are grounded in real games (§3), even though each app ships one game.

Hand this file to an orchestration session with a one-line kickoff such as:

> *"Follow PLAYBOOK.md to build spinner, a roulette strategy lab, in this repo."*

The orchestrator is expected to be a cheaper model than the design spikes. Everything it needs to decide up front is listed in §13.3; everything it must not decide on its own is marked **ask**.

---

## 0. The ask, generalized

The product is always the same shape:

1. **Define.** A player builds an experiment: the game and its rule variant, a strategy made of *stages* and *rules* (bets, progressions, triggers, stage changes, stop conditions), a session shape (bankroll, unit, length, stops) and a run size (number of sessions, seed).
2. **Execute.** The app runs that experiment: thousands of independent, seeded sessions, in Web Workers, with progress, pause, cancel and resume, surviving a page reload or a phone going to sleep because results are checkpointed as they arrive.
3. **Analyze.** The app shows what the strategy does *on average* and *how widely it varies*: the distribution of session results, the fan of bankroll paths over time, bust and stop rates, drawdowns, realized vs analytic edge, where the money went (per bet, per stage), and comparisons and sweeps across experiments.
4. **Runs on a phone and a desktop.** Responsive, installable as a PWA, no backend, no accounts. Definitions are shareable as links; results as files.
5. **A proper open-source repo:** MIT license, README, CONTRIBUTING, Code of Conduct, tests, CI, Pages deploy.

Explicit **non-goals** (differences from the crappy playbook): no lesson curriculum, no quizzes, no guided scenes, no "teach the game" content. A short rules reference and a glossary are enough. The simulator table view exists to *watch* a strategy play and to pick bets, not to teach.

## 1. Roles and models

| Role | Model | Job |
|---|---|---|
| Orchestrator (main session) | the kickoff session (may be cheaper than Opus) | Plans, asks the user, reconciles designs, owns shared files and batons, dispatches the pool, opens and merges PRs. Writes **no** features. |
| Design spikes | Opus, in parallel | Four spikes (§13.2). Each writes one design doc. They fork in parallel as soon as the kickoff questions are answered. |
| Implementation pool | Sonnet | A fixed-size pool of agents that implement work packages, fix review findings, debug CI, and review each other's PRs. **Ask the user for the pool size at kickoff** (§13.3). An agent never reviews its own PR. |
| Reviewers | Sonnet (from the pool) | One review per PR: read-only, independent re-derivation of math, and actually driving the app with Playwright. |

The orchestrator checks in often. Every agent message and every PR event is a chance to reconcile, relay contract changes, grant batons, and unblock.

## 2. The model: vocabulary used everywhere

These words are used in the code, the docs, the UI and the tests. Spikes must not invent synonyms.

| Term | Meaning | Roulette | Craps |
|---|---|---|---|
| **Game** | A plugin implementing the game contract (§4). One app ships one game. | roulette | craps |
| **Rules** | A resolved rule set: variant, paytables, limits. Presets plus overrides. | single-zero, double-zero, triple-zero, la partage, table min/max | 3-4-5x odds, field pays, vig timing, crapless |
| **Round** | The atomic step of play: one **decision window** followed by one **random event** and its **resolution**. | one spin | one roll |
| **Decision window** | The moment the strategy acts: it sees an *observation* and produces a *desired layout* and *effects*. Always before the random event. | before the spin | before the roll |
| **Layout** | The set of bets on the table, each `{bet, amount, ...}`. | cleared after every spin | persists across rolls (contract bets, place bets stay up) |
| **Bet** | A typed wager from the game's **bet catalog**, e.g. `straight:17`, `red`, `pass-line`, `place-6`. | 150+ (inside, outside, call bets) | ~45 |
| **Outcome** | The random event of a round plus every bet's resolution and the round's net cash effect. | number, color, parity, dozen, column | dice, total, hard, phase change, point events |
| **Session** | A sequence of rounds starting from a bankroll and ending by a stop (max rounds, bust, stop-win, stop-loss, strategy `stop`). | | |
| **Strategy** | A deterministic state machine: **stages**, each with ordered **rules** (`when` condition, `then` effects), **progressions**, and **vars** (counters). §5. | | |
| **Observation** | What a rule may test: session facts (equity, net, drawdown, streaks, round number), strategy facts (stage, vars, progression steps), and **game facts** declared by the plugin. | last number, colour, dozen, hits in the last N spins, spins since a number | phase, point, last total, points made this hand, rolls this hand |
| **Trace** | Per-round record of what the strategy saw, which rules fired, which effects ran, which actions reached the engine, what was rejected, the outcome. §5.7. | | |
| **Experiment definition** | The immutable, content-addressed JSON that fully specifies a run (§6). | | |
| **Run** | One execution of a definition: `sessions` seeded sessions, with its results store (§7, §8). Deterministic: same definition and engine version give identical results. | | |
| **Summary row** | The fixed-size per-session record (final, peak, max drawdown, rounds played, ended-by, wagered, expected loss, variance, per-stage and per-bet totals). | | |
| **Checkpoint sketch** | The equity of every session at a fixed schedule of round indices (§8.3), giving exact percentiles over time at a fraction of the storage of full curves. | | |
| **Sample sessions** | A small reservoir of sessions kept in full (every round, with the trace) for replay. | | |
| **Analysis** | Pure functions over summary rows, checkpoints and samples: metrics, distributions, comparisons, sweeps (§9). | | |

Money is always **integer cents**. Probabilities and EV in the math modules are **exact rationals** (bigint fractions), converted to floats only at the edge.

## 3. Grounding: how roulette and craps fit the model

The generic design was checked against both games. The differences below are what the game contract (§4) and the strategy language (§5) have to absorb; everything else is shared.

### 3.1 Round and layout lifetime

- **Roulette:** every bet resolves on the spin it was placed for. The layout is empty at the start of every decision window. "Keep the same bets" is a strategy's choice, re-placed each spin. Sitting out a spin is normal (a "wait for N reds" system).
- **Craps:** most bets stay up across rolls. Some cannot be removed or reduced once set (contract bets: pass and come on a point). Some can only be placed in one phase (come after a point, pass on the come-out in standard play). Odds bets need a parent bet. Rolls happen whether or not the player has bets up.

Consequence: the strategy language works in **desired layouts**, not in raw engine actions. At each decision window the strategy says what it wants on the table; the game plugin's `reconcile(state, desired)` turns the difference into legal engine actions and reports what it could not do (contract bet cannot come down, wrong phase, below minimum, unaffordable). For roulette, reconcile is trivial (place everything). For craps it is the hard, game-specific part, and it is where crappy's `Builder`/`placeNumbers`/`molly` primitives live today.

### 3.2 What a rule can look at

Session facts are generic. Game facts are declared by the plugin as a typed **fact schema** so the builder UI, the validator and the interpreter all know what exists:

- **Roulette facts:** `lastNumber`, `lastColor` (red/black/green), `lastParity`, `lastHalf`, `lastDozen`, `lastColumn`, `spinsSince(number|color|dozen|column)`, `countInLast(n, predicate)` (e.g. reds in the last 10 spins), `streak(color|parity|half|dozen|column)`, `zeroCount`.
- **Craps facts:** `phase`, `point`, `lastTotal`, `lastHard`, `rollsThisHand`, `pointsMadeThisHand`, `rollsSincePoint`, `hits(number) since point`, `sevenOutCount`, `comeOutCount`, `betOnTable(bet)`, `amountOn(bet)`.
- **Events** (fired for the round just resolved): roulette `spin`, `zero`; craps `point-established`, `point-made`, `seven-out`, `natural`, `craps`, `bet-won(bet)`, `bet-lost(bet)`, `bet-travelled(bet, number)`.

Both games also expose per-bet resolution results so a **progression can track one bet** ("double the red bet after it loses", "press the 6 after it hits") rather than the whole round's net.

### 3.3 What changes a bet's size

- Progressions driven by the result of a tracked bet: Martingale, Grand Martingale, Fibonacci, d'Alembert, Labouchere, Paroli (reverse Martingale), 1-3-2-6, Oscar's Grind, custom sequences. Needed by both games.
- Craps-specific moves that are still expressible generically: *press* (increase a winning bet by N units up to a cap), *regress* (take down all but some bets after a hit), *take down*, *odds as a multiple of the flat bet* (an amount expression that reads another bet's amount). Roulette has no "press" in the engine sense, but "add a unit to the straight-up that just hit" is the same effect.

### 3.4 Exact math

Both games have closed-form EV and variance per bet per round, so every session accumulates an **analytic expected loss and variance** alongside the actual result. That is what makes "was this run lucky?" and "actual vs expected" charts possible. The plugin provides `expectedLossPerRound(state)` and `variancePerRound(state)` for the *current layout and phase*; the harness sums them per round.

- Roulette: per bet `EV = amount × (p × payout − (1 − p))`, with la partage/en prison handled as a rule flag on even-money bets. Variance per bet is exact; covariance between bets on the same spin matters (two bets on overlapping numbers are not independent), so the plugin computes round variance from the **joint** distribution over the 37/38/39 pockets, not by summing per-bet variances.
- Craps: crappy's `tableExpectedLossPerRoll` and `makeVarianceFn` already do this per roll over the 36 dice outcomes; phase and point matter.

### 3.5 Pace

"Cost per hour" needs rounds per hour. Each game declares a default and the definition can override it: roulette live ~40–60 spins/hour, electronic ~80–120; craps ~100 rolls/hour. Default values are a kickoff **ask**.

### 3.6 Two strategies in the language (illustrative)

**Roulette:** "$5 on red, Martingale up to 6 steps, reset on a win; once up $100 flat-bet $5 for 50 more spins then stop; stop if down $300."

```json
{
  "schema": 1, "id": "red-mart-then-flat", "game": "roulette", "unit": 500,
  "progressions": { "m": { "kind": "martingale", "base": { "units": 1 }, "maxSteps": 6, "onCap": "reset", "track": "red" } },
  "stages": [
    { "id": "mart",
      "layout": [ { "bet": "red", "amount": { "prog": "m" } } ],
      "rules": [
        { "when": { "cmp": ["net", ">=", 10000] }, "then": [ { "goto": "flat" } ] },
        { "when": { "cmp": ["net", "<=", -30000] }, "then": [ { "stop": "stop-loss" } ] }
      ] },
    { "id": "flat",
      "layout": [ { "bet": "red", "amount": { "units": 1 } } ],
      "rules": [
        { "when": { "cmp": ["roundsInStage", ">=", 50] }, "then": [ { "stop": "plan-complete" } ] }
      ] }
  ]
}
```

**Craps:** "Pass with 2x odds at $10; after two points made in a row add place 6 and 8 at $12; if down $150 go back to pass only; quit when up $200."

```json
{
  "schema": 1, "id": "pass-then-inside", "game": "craps", "unit": 1000,
  "vars": { "pointsInRow": 0 },
  "stages": [
    { "id": "line",
      "layout": [ { "bet": "pass-line", "amount": { "units": 1 }, "when": { "fact": ["phase", "==", "come-out"] } },
                  { "bet": "pass-odds", "amount": { "times": [ { "amountOn": "pass-line" }, 2 ] }, "when": { "fact": ["phase", "==", "point"] } } ],
      "rules": [
        { "when": { "event": "point-made" }, "then": [ { "set": "pointsInRow", "to": { "add": [ { "var": "pointsInRow" }, 1 ] } } ] },
        { "when": { "event": "seven-out" }, "then": [ { "set": "pointsInRow", "to": 0 } ] },
        { "when": { "cmp": [ { "var": "pointsInRow" }, ">=", 2 ] }, "then": [ { "goto": "inside" } ] },
        { "when": { "cmp": ["net", ">=", 20000] }, "then": [ { "stop": "stop-win" } ] }
      ] },
    { "id": "inside",
      "extends": "line",
      "layout": [ { "bet": "place-6", "amount": 1200, "when": { "fact": ["phase", "==", "point"] } },
                  { "bet": "place-8", "amount": 1200, "when": { "fact": ["phase", "==", "point"] } } ],
      "rules": [
        { "when": { "cmp": ["net", "<=", -15000] }, "then": [ { "goto": "line" } ] }
      ] }
  ]
}
```

The spikes refine the schema (§5); these examples set the level of expressiveness required. Both must be among the golden test strategies in the finished app for its game.

## 4. The game plugin contract

Lives in `src/core/contracts/game.ts`, frozen by `decisions.md` after the spikes. Draft:

```ts
export type Cents = number;                       // integer
export type BetId = string;                       // game-defined, stable, e.g. 'red', 'straight:17', 'place-6'
export interface BetCatalogEntry {
  id: BetId; label: string; category: string;     // category drives UI grouping and table limits
  minClass: 'inside' | 'outside' | 'prop' | string;
  description: string;                            // payout in words, for the picker
  persistent: boolean;                            // stays up after a round it did not resolve in
  contract: boolean;                              // cannot be removed/reduced once in force
  needsParent?: BetId[];                          // e.g. odds need a line bet
  parameters?: Record<string, 'number' | 'point' | 'dicePair'>; // parameterised ids, e.g. 'straight:<n>'
}
export interface RulesSchema<R> { presets: Record<string, R>; defaultPreset: string; resolve(p?: Partial<R> | string): R; describe(r: R): string[]; }

export interface LayoutEntry { bet: BetId; amount: Cents; parent?: BetId; working?: 'auto' | 'on' | 'off'; }
export type Layout = readonly LayoutEntry[];

export interface Reconciliation<A> {
  actions: A[];                                   // legal engine actions, in order
  deferred: { entry: LayoutEntry; reason: string }[]; // e.g. wrong phase: retried next window
  rejected: { entry: LayoutEntry; reason: string }[]; // e.g. contract bet cannot come down, unaffordable
  affordable: boolean;                            // false when nothing at all could be funded (bust test input)
}

export interface RoundOutcome { net: Cents; wagered: Cents; resolutions: { bet: BetId; amount: Cents; result: 'win' | 'lose' | 'push' | 'stays'; profit: Cents }[]; events: readonly GameEvent[]; summary: Record<string, number | string | boolean>; }

export interface GamePlugin<S, A, R, E extends GameEvent = GameEvent> {
  id: string; name: string; version: string;      // version participates in run ids
  rules: RulesSchema<R>;
  bets: { catalog(rules: R): BetCatalogEntry[]; parse(id: string): BetId | null; available(id: BetId, state: S): boolean };
  createState(rules: R, seed: number): S;
  layoutOf(state: S): Layout;
  reconcile(state: S, desired: Layout): Reconciliation<A>;
  apply(state: S, action: A): { ok: true; state: S; events: E[] } | { ok: false; code: string; message: string };
  playRound(state: S): { state: S; outcome: RoundOutcome };    // consumes the engine RNG
  equity(state: S): Cents;                        // bankroll + bets at face value
  ev: {
    expectedLossPerRound(state: S): number;       // cents (float), current layout and phase
    variancePerRound(state: S): number;           // cents^2, joint over the round's outcomes
    betEdge(bet: BetId, state: S): { edge: number; perRound: number } | null;
  };
  facts: FactSchema;                              // names, types, enums and docs of game facts and events
  observe(state: S, lastOutcome: RoundOutcome | null, history: RoundHistory): GameFacts;
  pace: { roundsPerHour: number; label: string }; // default; the definition may override
  serialize(state: S): unknown; deserialize(x: unknown): S;
  ui?: { TableView; OutcomeGlyph; BetPicker };    // optional Preact components
}
```

Rules for every plugin:

- **Pure and framework-free.** `src/game/**` imports nothing from `src/app` or the DOM. The core imports nothing from `src/game`. Enforced by ESLint (§11).
- **Deterministic.** All randomness comes from the seeded RNG inside the state. `playRound` is the only function that advances it.
- **Payouts are integer cents** with a declared rounding policy; EV uses exact fractions and the two are tested against each other (§12).
- **An exhaustive oracle test**: every bet × every outcome (37/38/39 pockets; 36 dice × phases) checked against the paytable.
- **`reconcile` is the only path from a strategy to the engine.** It must never emit an action `apply` rejects; a rejection is a bug and the test suite asserts zero rejections across the golden strategies.

How crappy's engine maps onto this (for the craps app later): `GameState`/`Action`/`applyAction`/`createGame` are `S`/`A`/`apply`/`createState`; `tableExpectedLossPerRoll` and `makeVarianceFn` are `ev`; the strategy `primitives.ts` (`Builder`, `placeNumbers`, `molly`, `lineStrategy`, `martingale`) become `reconcile`; the dice RNG stays.

## 5. The strategy language

Owned by `src/core/strategy/**`: the JSON schema, a validator with precise error paths, the interpreter, the progression library, and golden tests. The language is game-agnostic; it is **parameterized by the plugin's bet catalog and fact schema**.

### 5.1 Shape

```ts
interface StrategyDefinition {
  schema: 1; id: string; name: string; game: string; notes?: string;
  unit: Cents;
  vars?: Record<string, number>;                // initial counter values
  progressions?: Record<string, ProgressionSpec>;
  stages: Stage[];                               // stages[0] is the entry stage
}
interface Stage {
  id: string; label?: string;
  extends?: string;                              // inherit layout and rules of another stage (child rules run first)
  layout?: LayoutSpec[];                         // the desired layout every decision window while in this stage
  onEnter?: Effect[]; onExit?: Effect[];
  rules: Rule[];                                 // evaluated in order, every decision window
}
interface LayoutSpec { bet: BetId; amount: Expr; when?: Condition; parent?: BetId; working?: 'auto'|'on'|'off'; }
interface Rule { id?: string; when: Condition; then: Effect[]; once?: boolean; cooldown?: number; }
```

### 5.2 Conditions

A JSON AST, no string expressions in v1 (a text syntax can be layered on later; the AST is the contract):

```
{ all: Condition[] } | { any: Condition[] } | { not: Condition }
{ cmp: [Expr, '<' | '<=' | '==' | '!=' | '>=' | '>', Expr] }
{ fact: [factName, op, value] }            // typed game or session fact (enums allowed: ['phase','==','point'])
{ event: eventName, bet?: BetId }          // fired in the round just resolved
{ streak: { of: factName, equals: value, atLeast: n } }   // e.g. lastColor == 'red' for 5 spins
{ countInLast: { n, fact: factName, equals: value, atLeast | atMost } }
{ since: { event | fact-equals, atLeast } }
{ everyN: n } | { chance: p }               // 'chance' uses the strategy RNG stream (seeded), deferred unless a spike needs it
```

Session facts available in `cmp` and `fact`: `bankroll`, `equity`, `net`, `peak`, `drawdown`, `round`, `roundsInStage`, `roundsWagered`, `wagered`, `lastNet`, `lastResult` (win/loss/push/none), `winStreak`, `lossStreak`, `stageEntries(stageId)`, `var(x)`, `prog(p).step`, `prog(p).amount`, `amountOn(bet)`, `onTable(bet)`.

### 5.3 Expressions (amounts and values)

`number | { units: n } | { var } | { fact } | { prog } | { amountOn: bet } | { pctOfBankroll: p } | { tableMin: betOrClass } | { add | sub | times | div | max | min | floorTo: [...] }`. Amounts are rounded to the game's bet unit for that bet by `reconcile`, never by the interpreter.

### 5.4 Effects

`{ bet, amount, parent? }` (add to this window's desired layout, overriding the stage layout for that bet), `{ remove: bet }`, `{ clear: true }`, `{ press: bet, by: Expr, cap?: Expr }`, `{ set: var, to: Expr }`, `{ inc: var, by? }`, `{ goto: stage }`, `{ prog: name, do: 'advance' | 'reset' | 'win' | 'loss' }`, `{ stop: reason }`, `{ skipRound: true }` (sit out: no bets this window; rounds still advance).

### 5.5 Progressions

```ts
type ProgressionSpec =
  | { kind: 'flat' }
  | { kind: 'martingale' | 'grand-martingale'; base: Expr; maxSteps: number; onCap: 'reset' | 'stay' | 'stop' }
  | { kind: 'fibonacci' | 'dalembert' | 'paroli' | 'oscars-grind' | '1-3-2-6'; base: Expr; maxSteps?: number; onCap?: ... }
  | { kind: 'labouchere'; line: number[]; base: Expr; onEmpty: 'reset' | 'stop' }
  | { kind: 'sequence'; amounts: Expr[]; onWin: Step; onLoss: Step; onPush?: Step }   // Step = 'advance'|'reset'|'stay'|'back'
```

Every progression has `track: BetId | 'round'`. After each round the interpreter feeds the tracked bet's resolution (or the round's net) to the progression; a bet that was not on the table is `none` and does not advance it. The current amount is available as `{ prog: name }`.

### 5.6 Semantics of a decision window (normative)

1. **Observe.** The harness builds the observation from session facts, the plugin's `observe`, the strategy's vars, stages and progressions, and the last round's events and resolutions.
2. **Update progressions** from the last round's resolutions (step 0 on the first window).
3. **Evaluate rules** of the current stage (child rules first when `extends` is used), in order. Effects apply immediately and later rules see them. `goto` runs `onExit` of the old stage and `onEnter` of the new one, switches the stage, and **ends rule evaluation for this window** (the new stage's rules run from the next window). `stop` ends the session after this window without playing a round. At most 16 effects per window; more is a validation error at definition time where detectable and a runtime `strategy-error` otherwise.
4. **Build the desired layout** from the stage layout (entries whose `when` holds), modified by this window's `bet`/`remove`/`press`/`clear` effects.
5. **Reconcile** through the plugin. `deferred` entries are retried next window; `rejected` entries are recorded in the trace and counted in the summary. If `affordable` is false and the desired layout was non-empty and the table is empty, the session ends with `bust`. (Craps: nothing can be funded and nothing is on the table. Roulette: cannot fund the smallest desired bet.)
6. **Play the round** through the plugin and record the outcome, equity, analytic expected loss and variance.
7. **Session stops** are checked in this order: strategy `stop` (step 3) → bust (step 5) → `stopWin`/`stopLoss` from the session config (after step 6, on equity vs start) → `maxRounds`. `endedBy` is one of `rounds | bust | stop-win | stop-loss | strategy:<reason> | error`.

The interpreter is a pure function `step(def, compiled, memory, observation) → { memory, desired, effects, trace }` and is tested as one.

### 5.7 Trace

For dry runs and sample sessions, every window records: round, stage, observation snapshot (facts referenced by any rule only), rules that fired, effects, desired layout, reconcile result (actions, deferred, rejected), outcome, net, equity, progression steps. The trace is what the **Watch** screen (§10) shows and what a user reads to answer "why did my strategy do that?". It is also the format of the golden tests: a strategy plus a seed produces a trace that is pinned.

### 5.8 Validation and lint

Definition-time checks with JSON-pointer paths: unknown bet, fact, event, stage, var or progression; `goto` to self with no condition; stages unreachable from the entry; amounts below the table minimum for the bet class at the declared rules; a strategy with no possible `stop` and no session cap (warning); a `press` on a non-persistent bet (error in roulette); a contract bet in a `remove` (error in craps). The builder shows these inline; `defineExperiment` refuses to run with errors.

### 5.9 Deferred: code strategies

A `{ kind: 'code', source }` strategy, run as a `decide(observation, memory)` function inside the worker (sandboxed by being in a worker with no DOM, optionally a `Function` constructor with a frozen global), is designed into the contract (the interpreter already has the `step` shape) but **not built in v1**. Record it in `docs/chips.md`.

## 6. The definition layer

`src/core/experiment/**`.

```ts
interface ExperimentDefinition {
  schema: 1;
  name: string; notes?: string; tags?: string[];
  game: { id: string; rules: string | Partial<Rules> };   // preset id or preset + overrides
  strategy: StrategyDefinition | { ref: string };          // inline, or a strategy library id (resolved and inlined before hashing)
  session: { bankroll: Cents; maxRounds: number; stopWin?: Cents; stopLoss?: Cents; roundsPerHour?: number };
  run: { sessions: number; seed: number; checkpointSchedule?: 'auto' | number[]; sampleSessions?: number };
}
```

- **Identity:** `definitionId = sha256(canonicalJson(definition))` (sorted keys, no whitespace, inlined strategy). A run is keyed by `(definitionId, game.version, core.version)`. Editing a definition creates a new id; the library keeps a `derivedFrom` pointer for history.
- **Library:** definitions and reusable strategies are stored in IndexedDB with name, tags, created/updated, and the ids of runs made from them. Built-in **presets** ship with the game (classic systems: flat, Martingale, Fibonacci, d'Alembert, Labouchere, Paroli, James Bond, dozens progressions for roulette; pass/odds, three-point Molly, Iron Cross, place 6/8 press, Martingale on pass for craps) as JSON files under `src/game/<game>/presets/` with a test that each validates and runs.
- **Sharing:** `#/define?d=<base64url(deflate(canonicalJson))>` using the native `CompressionStream` where available (fallback: uncompressed base64url). Long definitions that exceed ~8 kB after compression fall back to "export file". A definition link never carries results.
- **Versioning:** `schema` numbers on the definition and strategy; `migrate()` functions keep old links and exports loadable; a test loads every fixture from every past schema.

## 7. The execution layer (harness)

`src/core/harness/**`. It knows nothing about the UI and nothing about any game beyond the plugin contract.

### 7.1 Seeds and determinism

- `sessionSeed(i) = mix64(run.seed, i)` (SplitMix64 or an equivalent hash), so session *i* is identical regardless of which worker or batch runs it, and so two experiments with the same `run.seed` see the **same random stream per session index** (common random numbers, §9.6).
- Engine RNG: xoshiro128** or PCG32 seeded from `sessionSeed(i)`; the strategy RNG (for `chance`, if ever used) is a separate stream seeded from `sessionSeed(i) ^ const`.
- A **determinism test** runs the same definition with 1, 2 and 4 workers and asserts byte-identical results.

### 7.2 Workers and batches

- A pool of `min(navigator.hardwareConcurrency - 1, 8)` module Workers (`new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })`); 1 on a weak phone. The worker bundle contains the plugin, the interpreter and the session loop only.
- Work is split into **batches** of `B` consecutive session indices (`B` chosen so a batch takes ~250 ms, measured on the first batch and adapted). A worker returns per batch: summary rows (typed arrays), the checkpoint slice, sample sessions (reservoir decision made by the main thread from the session index, so it is deterministic), and the elapsed time.
- The main thread **merges** batch results into the run store and marks the batch done in a `batches` bitmap. Every `K` batches (or every 2 s) the run store is **checkpointed to IndexedDB**.
- **Pause/cancel** via `AbortController`; **resume** reads the bitmap and schedules only the missing batches. A run interrupted by a reload or a sleeping phone resumes from its checkpoint when reopened (the Run screen offers "Resume"). `document.visibilityState` changes are logged in the run meta; workers keep running while the tab is backgrounded but may be throttled.
- **Budget:** a progress estimate (sessions/s, ETA) and a soft warning when the estimated time exceeds 2 minutes on this device, with a suggestion to reduce sessions or rounds. Target: 10,000 sessions × 500 roulette spins with a 3-stage strategy in under 20 s on a 4-core laptop and under 90 s on a mid-range phone (perf test, §12).
- The session loop never allocates per round beyond the typed arrays it fills; the interpreter compiles the definition once per worker (resolved bet ids, fact accessors, rule closures).

### 7.3 Runs as data

```ts
interface RunMeta { runId; definitionId; gameVersion; coreVersion; createdAt; status: 'queued'|'running'|'paused'|'done'|'cancelled'|'error';
  sessions; completedSessions; batchSize; batches: Uint8Array /* bitmap */; device: { cores; ua }; timing: { startedAt; elapsedMs; }; error?: string }
```

Run ids are `definitionId` + a short random suffix (two runs of the same definition are allowed and must produce identical results; a test compares them).

## 8. Data model and storage

`src/core/store/**`. IndexedDB via a small hand-written wrapper (or `idb`, if the architecture spike prefers; it is the only candidate runtime dependency besides `preact`). Every access is guarded: storage can be missing, blocked or full, and the app must still run an experiment in memory and offer export.

### 8.1 Stores

| Store | Key | Value |
|---|---|---|
| `definitions` | definitionId | definition JSON + library metadata |
| `strategies` | strategyId | reusable strategy JSON + metadata |
| `runs` | runId | `RunMeta` |
| `summaries` | runId | struct-of-arrays summary table (§8.2) as `ArrayBuffer`s |
| `checkpoints` | runId | `{ schedule: Int32Array, equity: Int32Array /* sessions × schedule.length */ }` |
| `samples` | runId | sample sessions with full traces (JSON, capped) |
| `breakdowns` | runId | per-bet and per-stage totals (small JSON) |
| `settings` | key | user preferences |

Run data is **append-only during execution** and immutable after; deleting a run deletes all five entries. Storage use per run is shown in the UI; `navigator.storage.estimate()` and `persist()` are called on first run.

### 8.2 Summary table (per session, struct of arrays)

`final` (Int32, equity at end), `net` (Int32), `peak` (Int32), `maxDrawdown` (Int32), `roundsPlayed` (Int32), `roundsWagered` (Int32), `wagered` (Float64), `expectedLoss` (Float64), `variance` (Float64), `endedBy` (Uint8 enum), `endedRound` (Int32), `stopStage` (Uint8), `rejectedActions` (Uint16), `maxExposure` (Int32), plus **per-stage rounds** (`Int32` × stages) and **per-bet-category wagered/net** (`Float64` × categories). Typed arrays make a 100,000-session run a few MB and make quantiles a sort on a copy.

### 8.3 Checkpoint schedule

`auto`: every round for rounds 0..32, then geometric spacing up to `maxRounds` with at most 128 checkpoints, always including `maxRounds`. A session that ended early carries its final equity forward to later checkpoints (money in the pocket), and the survival curve is computed exactly from `endedRound`/`endedBy` rather than from the checkpoints. Storage: `sessions × checkpoints × 4 bytes` (10,000 × 128 × 4 = 5 MB). Percentiles at a checkpoint are exact over all sessions.

### 8.4 Samples

A reservoir of `run.sampleSessions` (default 24) full sessions chosen deterministically by index (the first few, plus a spread), each with the full trace, so **Watch** can replay them and so the extremes are inspectable: the app also keeps the best, worst and median-final sessions by re-running those three indices on demand (determinism makes re-running cheap and exact; "re-simulate session #4821" is a feature, not a cache).

### 8.5 Export and import

- `<slug>-<runId8>.spinner.json`: `{ format: 'casino-lab-run', version, app: { id, version }, game: { id, version }, definition, meta, summaries: { columns, base64 }, checkpoints: { base64 }, breakdowns, samples }`. Typed arrays as base64 (`CompressionStream` gzip when available: `.spinner.json.gz`).
- `summaries.csv`: one row per session, for spreadsheets.
- `definition.json` and the share link for the definition alone.
- Import validates `format`/`version`, migrates, and refuses files whose game id the app does not ship (with a clear message). Imported runs are marked `imported` with the source app version; analysis works on them exactly as on local runs.
- **Gallery (optional, ask):** exported bundles committed under `gallery/` are listed by a build-time index (`gallery/index.json` generated by a Vite plugin) and openable read-only from `#/gallery`. Keep each under 2 MB and the folder under 20 MB; CI fails otherwise.

## 9. The analysis layer

`src/core/analysis/**`: pure functions over the stores' shapes; no DOM. Every metric has a precise definition in `docs/metrics.md` and a unit test against a hand-computed fixture.

### 9.1 Per-run metrics (one experiment)

- **Result distribution:** mean net (and standard error), median, SD, p1/p5/p10/p25/p75/p90/p95/p99, min, max, skew; histogram with Freedman–Diaconis bins, zero line and expected-net line marked.
- **Probabilities with Wilson intervals:** P(ahead), P(bust), P(stop-win), P(stop-loss), P(strategy stop by reason).
- **Expected vs realized:** mean analytic expected loss, mean realized loss, luck z = (realized − expected)/sqrt(sum variance) per session and for the run.
- **Edge:** realized loss / wagered vs analytic expected loss / wagered; expected loss per round, per hour (at `roundsPerHour`), per session; and **"cost of play"**: expected loss per hour at this pace.
- **Volatility:** SD of net per session, SD per round (sqrt(mean variance / rounds)), SD per hour; coefficient `mean / SD`; ratio of p90−p10 to expected loss.
- **Paths:** fan chart from checkpoints (p5, p25, p50, p75, p95) with the analytic expected line (start − cumulative expected loss, from the mean per-round expected loss by checkpoint) and the **survival curve** (share still playing per round).
- **Drawdown and exposure:** max drawdown distribution (percentiles, histogram); max exposure (largest layout) distribution, especially for progressions ("how big did the Martingale get?").
- **Session length:** rounds played distribution; rounds wagered vs sat out.
- **Breakdowns:** wagered, net, expected loss by bet category and by stage; rounds spent per stage; stage transition counts; rejected/deferred actions (a non-zero rejected count is surfaced as a warning: the strategy asked for something the table would not allow).
- **Convergence:** running mean and its CI as sessions accumulate, so the user can see whether the run was big enough; a suggested session count for a target CI half-width.

### 9.2 Comparisons (several runs)

Side-by-side table of the metrics above; overlaid histograms (outlines) and fan medians; a **difference** column with a CI: paired by session index when the runs share `run.seed` and `session` config (common random numbers; much tighter), Welch otherwise. The compare view says which it used.

### 9.3 Sweeps

An **experiment group**: one base definition and one parameter path swept over a list (`strategy.unit`, `session.stopWin`, a progression's `maxSteps`, a rule constant). The harness runs each variant as its own run (same seed) and the analysis renders metric-vs-parameter charts (mean, p10/p90 band, P(bust)). Groups are stored as a small record of run ids.

### 9.4 Analytic checks (oracles for the analysis)

For even-money flat betting, the gambler's-ruin formula gives exact bust probability and expected duration; for flat betting, net is a sum of i.i.d. terms with known mean and variance. These are the test oracles for the harness plus analysis end to end (§12).

### 9.5 Pace and money framing

Every money figure is shown per session, and optionally per hour and per 100 rounds; the toggle is global and persisted. Every rate (P(bust), edge) shows its interval; never a bare point estimate from a small run.

### 9.6 Common random numbers

Because `sessionSeed(i)` depends only on `run.seed` and `i`, two strategies run with the same seed experience the same spins per session index. The compare view relies on this; the definition editor's "Compare with…" action copies the seed and session config by default and says so.

## 10. UI

`src/app/**`, Preact, hash routes, responsive: everything works at 360 px wide (stacked cards, one chart at a time, tabs), and desktop gets side-by-side panels. Tap targets ≥ 44 px, reduced motion respected, light and dark tokens, no horizontal scroll at 360 px, axe clean.

Routes and screens:

- `#/` **Home:** recent runs with one-line verdicts ("mean −$41 ± $6, P(ahead) 38%, bust 2%"), recent definitions, presets, "New experiment", "Import".
- `#/define/:id?` **Define:** four cards: *Game & rules* (preset, overrides, limits, pace), *Strategy* (the builder, or pick from the library), *Session* (bankroll, unit, rounds, stops, hours ↔ rounds), *Run* (sessions, seed, samples, estimated time). A **validation panel** with inline errors; a **Quick check** button that runs 200 sessions in a worker and shows a one-line verdict in under a second; **Dry run** opens Watch on one session with the trace. "Run" creates the run and goes to the Run screen.
- **Strategy builder** (inside Define): stages as cards (reorderable), each with a layout list and a rule list. A rule row reads as a sentence: *when* [condition chips] *then* [effect chips]. Bet pickers come from the game plugin (`ui.BetPicker`: a tappable roulette layout; a craps table later); condition editors are generated from the fact schema; amount editors offer units, progression, percent and arithmetic. Import/export the strategy JSON; a "JSON" tab shows the live JSON with the same validation.
- `#/run/:runId` **Run:** progress, sessions/s, ETA, pause/resume/cancel, a live fan chart and histogram updating as batches arrive, storage used, and "Analyze" when done. Reopening a running or paused run offers Resume.
- `#/analyze/:runId` **Analyze:** tabs *Overview* (verdict, histogram, key numbers with CIs), *Paths* (fan + survival), *Risk* (drawdown, exposure, bust), *Where the money went* (bet and stage breakdowns), *Convergence*, *Sessions* (sortable table of summary rows; tap a session to re-simulate and Watch it), *Export*.
- `#/watch/:runId/:index` **Watch:** replays one session on the game's table view with the trace beside it: round by round or play at speed, with the fired rules highlighted and the layout, equity and progression state shown. Works for samples and for any index (re-simulated on demand).
- `#/compare?runs=a,b,c` **Compare** and `#/sweep/:groupId` **Sweep**.
- `#/library` strategies and definitions, `#/gallery`, `#/import`, `#/settings` (theme, money framing, storage, export/import all, about, disclaimer).

Charts are hand-rolled SVG (as in crappy) or a small chart dependency only if the architecture spike makes the case; each chart has a text summary for screen readers and a table fallback. Colors follow the dataviz conventions (no meaning by color alone; tiers get text labels).

## 11. Repo, stack and the shared-core plan

**Stack (same baseline as crappy):** Vite, TypeScript strict with `noUncheckedIndexedAccess`, Preact (the only runtime dependency, plus optionally `idb`), Vitest (node project for core/game, happy-dom project for UI), Playwright pinned to the preinstalled Chromium, ESLint flat config + Prettier (`singleQuote`, `printWidth: 100`), Node 22 in `.nvmrc`. PWA with a hand-written service worker and an update toast. A single-file offline build is **optional** (workers must then be inlined as blob URLs; treat it as a chip unless the user asks).

**Layout:**

```
src/core/            # game-agnostic. Imports nothing from src/game or src/app. Future shared repo (see below).
  contracts/         # game.ts, strategy.ts, experiment.ts, run.ts, analysis.ts  (frozen)
  money/  rng/       # cents helpers, exact fractions, seeded RNG, seed mixing
  strategy/          # schema, validate, compile, interpret, progressions, trace
  experiment/        # definition canonicalisation, hashing, migration, share links
  harness/           # session loop, batches, worker protocol, pool, resume
  store/             # IndexedDB wrapper, stores, export/import formats
  analysis/          # metrics, quantiles, intervals, fan, survival, compare, sweep
  ui/                # game-agnostic components: builder, charts, run/analyze/compare screens' pure parts
src/game/<game>/     # the plugin: rules, bets, engine, resolve, ev (exact), facts, reconcile, presets/, ui/ (table view, picker)
src/app/             # routes, screens, store wiring, settings, pwa registration
src/workers/         # sim.worker.ts (bundles core + game)
build/               # vite plugins (gallery index, sw)
tests/{app,e2e,perf,fixtures}   docs/{design,metrics.md,chips.md,screenshots}   gallery/   .github/workflows/
```

Import boundaries are enforced by ESLint `no-restricted-imports` per folder: `core ← nothing in src/`; `game ← core`; `workers ← core, game`; `app ← everything`. Path aliases `@core/*`, `@game/*`, `@app/*`.

**Shared-core plan.** The user intends a family of apps (roulette here, craps next, possibly Ultimate Texas Hold'em and baccarat; the user will give access to those repos for a shared-pieces audit). The rule is: *keep `src/core` extractable at zero import cost.*

- `src/core` has its own `README.md` and `index.ts` barrel and no imports from outside itself.
- When the second app starts, `src/core` is moved into a new repo (working name `casino-lab-core`) and mounted back at the **same path** with `git submodule add <url> src/core`, so no import changes in either app. Each app pins a commit; CI checks out submodules.
- Candidates for the shared repo beyond `src/core`: the roulette and craps plugins themselves (so a future multi-game app can ship both), the worker protocol, the export format, the e2e helpers, and the Playwright/Vitest/ESLint configs. The audit spike (§13.2, run when the second app starts) lists what crappy, spinner and the other repos duplicate and proposes what moves.
- Not shared: `src/app` (each app has its own shell and branding), presets (game-specific), gallery.

## 12. Correctness and testing standards

- **Exact rationals** in every EV/variance function; integer cents everywhere else. Money never passes through floats except analysis outputs.
- **Game oracle tests:** every bet × every outcome against the paytable; joint variance against a brute-force enumeration; `reconcile` never produces an action `apply` rejects (property test over random desired layouts and states).
- **Monte-Carlo cross-checks:** the realized edge of each preset over a large seeded run is within 3 SE of the analytic edge.
- **Interpreter golden tests:** each preset and each example in §3.6 produces a pinned trace for a fixed seed; semantics tests for every effect, condition and progression (the Martingale sequence, cap behaviour, Labouchere line edits, press caps, `goto` ending evaluation, `once`, `cooldown`, `extends` ordering).
- **Harness tests:** determinism across worker counts and batch sizes; resume from a partial bitmap gives identical results; cancel leaves a consistent store; gambler's-ruin oracle for flat even-money betting (bust rate and mean duration within CI).
- **Analysis tests:** every metric on a hand-computed fixture; quantiles on known arrays; Wilson and paired-CI formulas against reference values; fan chart from a fixture checkpoint matrix.
- **Store tests:** export → import round trip is byte-identical; migrations from every past format fixture; behaviour with IndexedDB missing (in-memory fallback) and quota errors.
- **Perf test** (`tests/perf`, run in CI with a generous bound and locally with a tight one): the §7.2 budget.
- **E2E:** define → quick check → run → analyze → watch → export → import, at 360×780, 390×844, 844×390 and 1280×800; axe on every screen; no console errors; no horizontal overflow (shared helper).
- **UI copy tests assert structure, not placeholder text.**

## 13. Process

### 13.1 Phases

**Phase 0: Bootstrap (orchestrator).** `git status`, Node and npm. Confirm push access *before* planning PRs (the first crappy push failed on a missing GitHub App install). An empty repo has no `main`: make the initial commit (this playbook, README stub, MIT LICENSE, `.gitignore`) and push. Ask the kickoff questions (§13.3) in batches of at most 4. Write `docs/design/decisions.md` with the answers. Remind the user of the one manual step: Settings → Pages → Source: GitHub Actions.

**Phase 1: Design spikes (Opus, parallel, background).** Launch all four at once (§13.2). Each writes one file under `docs/design/`, does not commit, and sends batched questions to "main" (≤4 per message, 2–4 options each, recommended option first) while continuing on its recommended default. The orchestrator relays with `AskUserQuestion` and sends answers back.

**Phase 2: Reconcile (orchestrator + one Sonnet reviewer).** The spikes will disagree on ids, schemas, file names and ownership. Update `decisions.md`, declare it authoritative over every design doc, and have a reviewer list contradictions and re-derive every number in the game doc with exact fractions (Python `fractions` in a scratch script). Fold fixes into `decisions.md`. Commit the docs: PR #1.

**Phase 3: WP0 scaffold (one Sonnet, serial).** All tooling and every dependency up front, so later packages never touch `package.json`, tsconfigs or ESLint. Contract stubs: `src/core/contracts/*.ts` copied verbatim from the designs then frozen; throwing function stubs for every public API; the worker file with a ping protocol; a placeholder app that renders one route; scripts `dev`, `build`, `test`, `test:e2e`, `test:perf`, `lint`, `typecheck`, `format:check`, `check`. Exit: `npm run check`, `npm run build` and `npm run test:e2e` green. **Review WP0 before fan-out**; in crappy this caught missing deps, untyped test files and lint rules that did not catch relative imports.

**Phase 4: Parallel implementation (the Sonnet pool).** Work packages (§13.4), each on its own worktree and branch. The pool size bounds concurrency; the orchestrator keeps a queue ordered by the dependency graph and hands the next package to whichever agent frees up. Early pushes of contracts and barrels so dependants can merge them.

**Phase 5: Integration (one or two pool agents).** Wire Define → Run → Analyze → Watch end to end; the e2e suite; the perf test; screenshots the orchestrator looks at itself.

**Phase 6: Review, fix, merge, deploy, polish.** One Sonnet review per PR (never the author). The orchestrator posts a short summary comment, resumes the author to fix, merges on green CI at the latest head, unsubscribes. Deferred nits go to `docs/chips.md`. Deploy to Pages; check on a phone; check the service-worker update path.

### 13.2 The four design spikes

Write each to `docs/design/<name>.md`. Templates in §13.6.

1. **`game.md` (game spike):** rules and variants (**the defaults are a kickoff ask**, not the spike's choice), the full bet catalog with ids and categories, exact EV and variance per bet and joint per round (verified with exact fractions in a scratch script and tabulated), the engine state and actions, `reconcile` semantics for this game, the fact schema and events, pace defaults, presets (classic systems in the strategy language), table-view and bet-picker design for phones, the oracle test plan. For roulette: inside, outside, call/neighbour bets, zero rules (la partage, en prison), table limits per class, triple-zero.
2. **`strategy.md` (strategy-language spike):** the final schema (§5), normative semantics (§5.6 refined), the progression library with exact sequences, validation rules with error codes, the compile step, the trace format, the builder UI model (how a rule row maps to JSON and back), 20+ golden strategies across both games (craps ones kept as fixtures for the next app), the JS-code escape hatch design (deferred), and a test plan.
3. **`harness-data-analysis.md` (execution + data + analysis spike):** seed mixing, worker protocol and pool, batch sizing, checkpoint schedule, store schemas, resume semantics, export/import formats with versioning, every analysis metric with its formula and interval (becomes `docs/metrics.md`), compare and sweep semantics, the perf budget and how it is measured, and the gallery build step.
4. **`architecture.md` (app + repo spike):** stack confirmation, repo layout and import boundaries, routes and screens with phone and desktop layouts, chart approach, PWA and service worker, CI/Pages/release workflows, the `src/core` extraction mechanics (submodule at the same path), file ownership, and the work packages with their dependency order sized for the pool.

Each spike reads this playbook, crappy's `docs/design/*` and `src/sim/strategy/*` for prior art, and `decisions.md` for the kickoff answers.

### 13.3 Questions to ask at kickoff (orchestrator)

Batches of at most 4, each option with a one-line consequence, recommended option first. Do not ask about things with a conventional default or that can be verified.

1. **Pool size:** how many Sonnet agents may run at once (implementers, reviewers and debuggers share it)?
2. **Game rules:** default variant and presets (roulette: European single-zero default with American and triple-zero presets and a la partage flag is the recommendation; the user chose to decide this at execution time). Which bet families to simulate vs only list (call/neighbour bets?). Table limits.
3. **Pace defaults:** rounds per hour for the money-per-hour framing.
4. **Default run size** (recommended 10,000 sessions × 500 rounds) and the perf budget device (which phone).
5. **Merge permission:** may the orchestrator merge PRs once reviewed and CI is green?
6. **Repo visibility** (Pages needs public on a free plan) and **license** (MIT recommended).
7. **Gallery:** commit curated result bundles to the repo, or export files only?
8. **Single-file offline build:** wanted in v1, or a chip?
9. **Presets:** which classic systems must ship on day one?
10. **Disclaimer wording** and whether to show a responsible-gambling line on the home screen (recommended: yes).

Record every answer in `decisions.md` and relay it to every affected agent.

### 13.4 Work packages (default cut; the architecture spike refines)

| WP | Owns | Depends on |
|---|---|---|
| WP0 scaffold | tooling, deps, contracts, stubs, worker ping, placeholder app | – |
| core-strategy | `src/core/strategy/**`: validate, compile, interpret, progressions, trace, golden tests | WP0 |
| core-harness | `src/core/harness/**`, `src/workers/**`, `src/core/rng`, `src/core/money`: session loop, pool, batches, resume, determinism tests | WP0 (interfaces), game (to run real sessions; stub game until then) |
| core-store | `src/core/store/**`, `src/core/experiment/**`: IndexedDB, hashing, share links, export/import, migrations | WP0 |
| core-analysis | `src/core/analysis/**`, `docs/metrics.md`: metrics, intervals, fan, survival, compare, sweep, oracles | WP0 |
| game | `src/game/<game>/**`: rules, bets, engine, exact ev, facts, reconcile, presets, oracle and MC tests | WP0 |
| ui-define | builder, define screen, bet picker integration, validation panel, quick check, library | core-strategy, game |
| ui-run-analyze | run screen, charts, analyze tabs, compare, sweep, watch, export/import screens | core-analysis, core-store, core-harness |
| infra | PWA, service worker, CI, Pages, release, gallery plugin, README/CONTRIBUTING/CoC, docs | WP0 |
| integration | end-to-end wiring, e2e suite, perf test, screenshots, chips triage | everything |

With a pool of N, start the first N packages in dependency order; `game` and `core-strategy` first because most things wait on them.

### 13.5 Sub-agent protocol

Shared files outside the repo (e.g. `/home/user/<app>-brief.md`); every agent reads them first.

- **Brief:** create your own worktree (`git -C <repo> worktree add /home/user/wt-<name> -b claude/<app>-<name> <base>`), `npm ci` there, never touch the main tree. Authority order: `decisions.md` > design docs > this playbook. Never edit `package.json`, tsconfigs or ESLint config: ask main. Code against the frozen contracts; propose changes to main before making them. Run the full `npm run check` before every push. Commit messages end with the session's attribution trailer. Push the branch; do not open PRs. Message main at milestones and when blocked. Final report under 250 words with the tail of the check output.
- **Batons file:** a table of who owns each path; shared files belong to the orchestrator. `BATON REQUEST <path> <why>` → wait for `BATON GRANTED` → push → `BATON RELEASE`. Shared files in this product: `package.json`, tsconfigs, ESLint config, `src/core/index.ts`, `src/core/contracts/*`, `src/app/main.tsx`, `src/app/routes.tsx`, `vite.config.ts`, `playwright.config.ts`, `vitest.config.ts`.
- **Update files:** `<app>-brief-updateN.md` per round of decision changes; agents get a one-line pointer.
- **Contract extensions:** agents propose; the orchestrator approves and tells the dependants.
- **Resuming:** `SendMessage` to the same agent id keeps its context and worktree (after rate limits, for review fixes).
- **Ports:** every agent and reviewer uses its own `PORT` for `vite preview`/Playwright; `reuseExistingServer: !process.env.CI`.
- **Small fixes:** the orchestrator may make tiny fixes in a worktree (a test regex, a merge of main); run `check`, commit with the trailer, push.

### 13.6 Prompt templates (fill in `<…>`)

**Game spike:**
> You are the GAME design spike for "<app>", a strategy lab for <game> built from PLAYBOOK.md (read it fully, especially §2–§5 and §12). Repo <path> (do not commit). Read docs/design/decisions.md for the kickoff answers. Sibling spikes design the strategy language, the harness/data/analysis, and the app architecture. Write docs/design/game.md: rules and variants per decisions.md; the complete bet catalog with stable ids, categories, limits classes and payouts; exact EV and variance per bet and joint per round, every number verified with exact fractions in a scratch script and tabulated; engine state/actions; `reconcile` semantics for this game with examples; the fact schema and events the strategy language may use; pace defaults; 10+ presets written in the strategy language; phone table view and bet picker; the oracle and Monte-Carlo test plan. Send questions for the user to "main" (≤4 per message, options plus a recommended pick) and continue on your defaults. Reply with a summary and the canonical ids.

**Strategy-language spike:**
> You are the STRATEGY LANGUAGE spike for "<app>". Read PLAYBOOK.md §3, §5 and §12, crappy's src/sim/strategy (custom.ts, primitives.ts, types.ts) for prior art, and decisions.md. Write docs/design/strategy.md: the final JSON schema with TypeScript types (frozen contract), normative decision-window semantics, the progression library with exact sequences and cap behaviour, validation rules with error codes and JSON-pointer paths, the compile step, the trace format, the builder UI model, 20+ golden strategies (both roulette and craps; craps ones are fixtures for a later app), the deferred code-strategy design, and the test plan. Questions go to "main".

**Harness, data and analysis spike:**
> You are the HARNESS, DATA & ANALYSIS spike for "<app>". Read PLAYBOOK.md §6–§9 and §12 and decisions.md. Write docs/design/harness-data-analysis.md: seed mixing and determinism, worker protocol and pool, batch sizing, checkpoint schedule, IndexedDB store schemas, resume and cancel semantics, export/import formats with versioning and migration, every analysis metric with formula and interval (this section becomes docs/metrics.md), compare (common random numbers) and sweep semantics, the perf budget and its measurement, gallery build step. Questions go to "main".

**Architecture spike:**
> You are the APP & REPO ARCHITECTURE spike for "<app>". Read PLAYBOOK.md §10, §11, §13 and crappy's docs/design/architecture.md. Decide the stack, repo layout and lint-enforced boundaries, routes and screens with phone and desktop layouts, charts, PWA, CI/Pages/release workflows, the src/core extraction mechanics, file ownership and the batons table, and the work packages with dependency order sized for a pool of <N> implementers. Write docs/design/architecture.md. Questions go to "main".

**Implementer (pool):**
> You are implementing work package <WP> for "<app>". Read /home/user/<app>-brief.md, then decisions.md, then the design docs it names. Own only the paths in the batons table for <WP>. Code against src/core/contracts (frozen). Tests as listed in PLAYBOOK.md §12 for your package. Run `npm run check` before every push; push early and often; message main at milestones and when blocked. Do not open a PR.

**Reviewer (pool, never the author):**
> Review PR <n> for "<app>" read-only in a detached worktree. Diff: `<cmd>`. Authority: decisions.md, then the design docs. Verify independently: re-derive the math in a scratch Python script with exact fractions; run the tests; drive the app with Playwright at 390×844, 844×390 and 1280×800 on port <P> through define → quick check → run → analyze → watch; save screenshots to <dir>. Report blocking / should-fix / nit with file:line and the fix, under ~900 words, then APPROVE or REQUEST CHANGES.

### 13.7 PR and review flow

1. One PR per work package; stack dependent branches; after a merge, retarget the next PR to `main` and merge `main` into its branch (retargeting alone does not trigger CI).
2. A pool reviewer per PR, background, read-only, own worktree and port. The orchestrator views the screenshots itself.
3. Short summary comment on the PR (what was verified, findings, fixing commits), ending with the Claude Code footer.
4. Resume the author with the findings; merge only when CI is green on the latest head (`expectedHeadSha`); re-review large fixes.
5. Subscribe to every PR's activity and handle CI-red events immediately: read the log, fix, push.

## 14. Lessons carried over from crappy

- Spikes always disagree: write `decisions.md` within minutes, make it authoritative, push changes to agents as update files.
- All dependencies and contract stubs in WP0; review WP0 before fan-out.
- Use the batons file from the start.
- Rate limits kill agents mid-task; agents commit and push often; resume with `SendMessage`.
- Make the Playwright port configurable; reviewers use their own.
- Agents say "done" without running e2e or Prettier; require the full `check` in every brief.
- Look at screenshots yourself: wrong numbers are visible in images.
- Demos built on mock data hide real bugs; build demos from the real engine and analysis.
- Tests that assert placeholder text break when the real UI lands; assert structure.
- Retargeting a stacked PR does not trigger CI; merge main into the branch.
- Pages deploys can time out on GitHub's side; re-run the job; ship an update toast because the service worker serves the old version.
- Preact can skip re-rendering identical children: an e2e plus axe pass found a real store bug; keep the e2e suite.
- Define every displayed metric precisely and pin it with a test (per round vs per decision vs per hour; analytic steady layout vs actual session cost).
- New for this product: **a strategy that asks for an illegal bet must be visible**, never silently dropped (rejected counts in the summary, red in the trace); **sitting out is a legitimate round**; **two runs of the same definition must match byte for byte**, and a test says so.

## 15. Definition of done

- [ ] Every PR reviewed by a pool reviewer (not its author), findings addressed, CI green, merged.
- [ ] `main` passes `npm run check`, `build`, `test:perf` and e2e (360, 390, 844×390, desktop) plus axe.
- [ ] Every preset validates, runs, and has a pinned golden trace; every number in `docs/metrics.md` is pinned by a test; the game's exact EV is verified by an independent reviewer script.
- [ ] Determinism, resume and export/import round-trip tests pass.
- [ ] A 10,000 × 500 run meets the perf budget on the agreed devices and survives a reload mid-run.
- [ ] Pages deploy succeeded; checked on a phone, including the service-worker update path and a run that spans the phone sleeping.
- [ ] README ("Use it" first: Pages URL, Add to Home screen, how to share a definition, how to export a run), CONTRIBUTING, Code of Conduct, `docs/design/*`, `docs/metrics.md`, `docs/chips.md` current; responsible-gambling disclaimer present.
- [ ] `src/core` has no imports from outside itself (lint) and its README explains the extraction plan.

## Appendix A: notes for the craps app (next)

- Reuse crappy's `src/sim/engine` and `src/sim/math` behind the game contract; `reconcile` is built from `src/sim/strategy/primitives.ts`; `SessionResult`/`ManyResult` are replaced by the generic summary table and checkpoints.
- Craps-specific facts and events are in §3.2; the §3.6 craps example and the craps golden strategies from the strategy spike are the acceptance fixtures.
- Odds as a multiple of the flat bet is an amount expression (`times: [{ amountOn: 'pass-line' }, n]`) capped by the table's max odds inside `reconcile`.
- Contract bets: `remove` is rejected with a reason, never deferred; the validator flags it at definition time.
- When this app starts, run the **shared-pieces audit** spike across crappy, spinner and the other game repos, then extract `src/core` into the shared repo and mount it as a submodule at the same path in both apps.

## Appendix B: chips (deferred ideas, seed list for `docs/chips.md`)

Code strategies (JS `decide` function in the worker); a text syntax for conditions; single-file offline build with inlined workers; sound; a hosted results sync; strategy "lint" suggestions ("your Martingale cap is reachable in 1.5% of sessions"); importing crappy sandbox layouts as a stage; a "what if" slider that re-runs a sweep live; sharing a run as a link to a committed gallery bundle.
