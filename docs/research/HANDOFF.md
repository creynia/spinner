# Handoff: roulette progression research loop

**Read this file first.** It is the single entry point for the orchestrator that runs the
research loop described in `docs/research/plan.md`. Everything else is linked from here.

## 0. Where things are

| item | location |
| --- | --- |
| branch (develop and push here, nowhere else) | `claude/roulette-strategy-variance-utbjcd` |
| the research plan: theory, hypotheses H1–H3, experiments E1–E8, loop protocol | `docs/research/plan.md` |
| the ledger: one row per full-size run, append-only | `docs/research/ledger.md` |
| raw reports | `docs/research/results/<spec>.json` |
| experiment specs (input to the runner) | `scripts/research/specs/*.json` |
| the headless runner | `scripts/research/sim.mjs` (launcher), `scripts/research/run.ts` (logic, spec format, report shape) |
| the strategy language (what a strategy JSON may contain) | `docs/design/strategy.md` §2 (contract), §6 (effects), §7 (progressions), §15.1 (24 worked roulette examples) |
| roulette bet ids, table limits, rules overrides | `docs/design/game.md` §3.2, §4; `src/game/roulette/rules.ts` |
| every metric the engine reports | `docs/metrics.md` |
| repository conventions | `CONTRIBUTING.md`; `docs/design/decisions.md` wins over every other document |

Run one batch: `npm run research:sim scripts/research/specs/<spec>.json --sessions 2000` for
screening, `--out docs/research/results/<spec>.json` without `--sessions` (10,000) for a ledger
row. Timing on one thread: about 2 s per 1,000 sessions of 500 spins per experiment; the
11-experiment batch at 10,000 sessions took 4 minutes. `npm test` alone takes about 9 minutes;
run targeted test files while iterating and the full `npm run check` before each push.

## 1. The problem in one paragraph

The owner saw that Martingale and Fibonacci on red show a median return above break-even for the
first few hundred spins before collapsing below flat betting, and that moving the bet off an
even-money 18-number placement kills the effect. They wanted to know whether progressions change
EV or only variance, why placement matters, and whether a progression that widens coverage or
stacks chips as the sequence deepens, plus a cash-out rule, can report an above-break-even
median over a session. Batch one (plan §7) established: EV per dollar never moves (−2.70 % of
turnover, verified by the engine's own analytic oracle on every run); progressions are skew
trades; the median is positive until the horizon n½ = ln2/(q·p) where q is the per-cycle cap
probability and p the per-spin win probability; and placement fails because the recovery growth
factor must equal 36/(36 − c) for c covered numbers (×2 only for 18) and because the table's
max/min ratio is largest for outside bets. The loop's job is E3 to E8 in the plan, ending with the
owner's widening/stacking ladders and cash-out rules, with every claim backed by a ledger row and
its prediction.

## 2. Roles

- **Orchestrator (Opus):** owns the loop in plan §5. Decides which experiment group runs next,
  writes the prediction before the run, reads the reports, appends ledger rows, updates
  `plan.md` §7 (findings) and adds open questions to a new §8. Does the analysis and the design
  of new ladders. Never tunes on the reporting seed; re-runs winners on a holdout seed.
- **Design and analysis (Opus sub-agents):** the ladder calculator design (plan §3), the deficit
  recursion for mixed layouts (plan §2 and E6), interpreting a refuted prediction, writing the
  findings prose.
- **Execution and implementation (Sonnet sub-agents):** writing spec files from a design brief,
  running batches, copying reports into `docs/research/results/`, implementing
  `scripts/research/ladder.ts`, the `--seeds` option and a `worker_threads` pool in `sim.mjs`,
  running `npm run check`, committing and pushing. Give each one the spec or file to produce, the
  command to run, and the acceptance line (which numbers to report back).

Every sub-agent brief should name this file and the plan section it serves.

## 3. Rules of the repository that bite here

- `docs/` is ignored by Prettier, but `scripts/research/specs/*.json`, `scripts/research/*.ts`
  and `package.json` are not: run `npx prettier --write` on them before `npm run check`.
- `scripts/**/*.ts` is linted under the node-tooling ESLint block and typechecked by
  `tsconfig.node.json`, which includes `src/core` and `src/game` (minus ui, tests, fixtures).
  A new script that imports from `@app/` will not typecheck; keep scripts on `@core` and
  `@game/roulette`.
- Do not change anything under `src/` for this research unless the loop finds a harness bug.
  In particular: no `CORE_VERSION` bump, no edits to presets or golden fixtures (they pin
  definition ids and traces), no new strategy kinds. Everything the plan needs is expressible with
  `sequence` progressions, `progStep`, `when`-guarded layout entries and rules overrides.
- Commit messages: `docs: ...` for ledger and plan updates, `feat(research): ...` for tooling.
  Push with `git push -u origin claude/roulette-strategy-variance-utbjcd`. Never open a pull
  request unless the owner asks.
- Money is integer cents everywhere in specs: bankroll `500000` is $5,000, `stopWin: 50000` is
  $500, `unit: 2500` is $25.

## 4. Strategy-language notes for the ladders in E4 and E6

- A scaled ladder on one placement: a `sequence` progression,
  `{ kind: 'sequence', track: 'round', onWin: 'reset', onLoss: 'advance', onCap: 'reset' | 'stop', amounts: [...] }`
  with amounts in cents rounded **up** to the chip unit ($1 inside, $25 outside minimum per bet),
  and a layout entry `{ bet, amount: { prog: 'q' } }`. Two-dozens-martingale (preset) is the
  pattern.
- A widening ladder: the same progression, plus layout entries guarded by
  `when: { cmp: [{ progStep: 'q' }, '>=', k] }` so deeper levels add bets. Per-bet amounts can be
  `{ times: [{ prog: 'q' }, factor] }` or a level-indexed `if` chain.
- Inside bets need $25 total on the table per spin (`minTotal`); 25 straight-ups at $1 meet it,
  a single $1 six-line does not (reconcile will reject or clamp, and the report counts it under
  `rejected`/`adjusted`; a non-zero count there means the ladder did not run as designed).
- Lower the outside minimum for small units through rules overrides:
  `"rules": { "preset": "european", "overrides": { "limits": { "outside": { "min": 500 } } } }`.
  The observations spec has the example.
- Stops: `session.stopWin` / `stopLoss` end a session on equity; a strategy `stop` effect can do
  the same with any condition (trailing stop is strategy.md R16).
- Sessions that stop early carry their final equity through the rest of the equity path, so the
  median path of a cash-out strategy is "money in the pocket".
- Caps: `onCap: 'reset'` keeps playing after a lost ladder (the default in the presets);
  `onCap: 'stop'` ends the session, which is usually what a bankroll-limited design means.
  State which one a spec uses in its ledger note; they have very different medians.

## 5. What to leave for the owner's review

At the end of the loop (or at any checkpoint the owner asks for), the branch should contain:

1. `docs/research/ledger.md` complete, every row with a prediction and a one-line note.
2. `docs/research/results/*.json` for every ledger row.
3. `docs/research/plan.md` §7 updated per experiment group, plus §8 "Open questions" and
   §9 "Candidates" listing the two or three strategies that best answer question 3, each with its
   spec id, median, P(win), mean, CVaR 5 %, bust rate and holdout-seed numbers side by side.
4. Any candidate the owner might keep saved as a strategy JSON under
   `scripts/research/candidates/<id>.json`, importable by the app's Define screen (it is a plain
   strategy document).

A separate reviewer will read these and present them; keep prose short and numbers in tables.

## 6. Suggested order

E3 (horizon law) and the ladder calculator first, in parallel: the calculator's predictions are
what every later ledger row is checked against. Then E4 (placements with the right factor, with
the naive ×2 controls), then E5 (does everything collapse onto x = p·S/B), then E6 and E7 on the
owner's ladders, E8 last. E1 is a property of every run, not a separate batch, except for the
three-layout direct test in plan §4.
