# Handoff: roulette progression research loop

**Status (2026-10-31): loop complete.** The answers to the three questions are in `plan.md` §7.0,
the open questions in §8, and the candidate strategies with holdout numbers in §9 (files under
`scripts/research/candidates/`). Ledger: 141 rows in `ledger.md`, each with a report in `results/`.

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
- **Shared-file ownership when agents run in parallel.** `ledger.md`, `plan.md` and this file
  belong to the orchestrator. A sub-agent commits only files it created: its spec under
  `scripts/research/specs/`, its report under `docs/research/results/`, and a ledger fragment
  `docs/research/ledger/<spec>.md` (same columns as `ledger.md`, rows only). The orchestrator
  folds fragments into `ledger.md`. Before pushing, every agent runs
  `git pull --rebase origin claude/roulette-strategy-variance-utbjcd`; appends to one shared file
  from two agents conflict, separate files never do. Give each agent its own worktree (the Agent
  tool's `isolation: "worktree"`, or `git worktree add`) so working trees do not collide.
- **Compute.** The runner is one process on one core; parallelise by running several `sim.mjs`
  processes at once, one spec (or `--only id,id` subset) each. The VM has 4 cores and 15 GB:
  four runs at a time is the ceiling, more only slows all of them. A 10,000-session,
  500-spin experiment is about 20 s; a 2,000-spin one about 80 s.
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

## 6. Dependency graph

```
T1 calculator ─────────────┐
T2 --seeds, T4 aggregator ─┤ (tooling, no data dependency)
E1 direct test ────────────┤
E3a levels, E3b lengths ───┼──► E5 curve (analysis over E3 + E4 reports)
D4 amounts table ──► E4 per placement (×6) ──┘        │
D6 ladder families ──► E6 screening (×4 families) ──► E6 full size + holdout ──┐
E7-mart (cash-out on Martingale red, runs now)                                  ├──► E8 per axis ──► §7/§8/§9
                                               E7 on E4/E6 winners (per strategy) ┘
```

D4 and D6 are Opus design briefs (an amounts table per placement; the ladder families with the
deficit recursion worked out). Everything else is Sonnet execution until the analysis steps. The
only true serial chain is D6 → E6 screen → E6 full → E7 → E8 → write-up; every other box can
start the moment its inputs exist.

## 7. Parallel breakdown (waves; each bullet is one agent)

Each experiment inside a spec is independent of the others, so any spec can be cut by id into
smaller specs without changing a result (seeds are per session, not per spec). The limits on
fan-out are the 4 cores, not the design. Within a wave, keep at most four simulation agents
running and let the design and tooling agents overlap with them.

**Wave 0 (start all at once; nothing depends on anything).**

- T1 (Sonnet): `scripts/research/ladder.ts` + `npm run research:ladder`. Inputs: coverage c,
  growth g (default 36/(36 − c)), base stake, chip unit, bet max, bankroll, S. Outputs: L, q, B,
  n½, predicted median at S, predicted P(ahead at S). Pin two cases in a unit test under
  `scripts/research/ladder.test.ts` (Martingale red L = 8: q 0.0048, n½ 295; dozen doubling:
  n½ ≈ 50). Add the test glob to `vitest.config.ts` only if `scripts/**` is not picked up.
- T2 + T4 (Sonnet, one agent, both touch the runner): `--seeds a,b,c` in `run.ts` (one report
  per seed, ids suffixed `@seed`), and `scripts/research/aggregate.ts` that reads every
  `results/*.json` and prints one row per experiment with x = p·S/B (p, B taken from a small
  `meta` block the spec may carry per experiment), P(ahead at S), median at S. Test it on
  `results/observations.json`.
- E1 (Sonnet): one spec, three layouts at $25 total (red; red $12 + dozen 3 $13 rounded to chips;
  25 straight-ups at $1), same seed, 10,000 sessions. Acceptance: equal realized edge within CI,
  variance ordered by concentration.
- E3a (Sonnet): Martingale red, maxSteps 5, 6, 7, 8, 9, 10, outside minimum lowered so every
  ladder fits under the $5,000 max, bankroll = 2^L − 1 units. Prediction column from the H1
  formula. 500 spins.
- E3b (Sonnet): maxSteps 8 and 10 at 250, 1,000 and 2,000 spins (six experiments; the 2,000-spin
  ones take four times longer, so this is the slowest agent of the wave).
- E7-mart (Sonnet): Martingale red with stop-win 5, 10, 20, 50, 100 units and stop-loss at one
  and half a ladder; `onCap: reset` and `onCap: stop` variants. Prediction: P(win) ≈ e^(−qW).
- D4 (Opus): for each placement in E4 (dozen, two dozens, six-line, corner, 25 straight-ups at
  $1, 35 straight-ups at $1) the amounts list g^k rounded up to the chip unit, the level count
  that fits $5,000 and the bet max, the bankroll to use, q, n½, plus the naive ×2 control. Output:
  a table in `docs/research/briefs/E4.md` that six Sonnet agents can turn into specs verbatim.
- D6 (Opus): the four ladder families of E6 (widening at constant stake per number; stacking at
  fixed coverage; widen to 24 then stack; each with cash-out and trailing stop), each as a
  concrete strategy JSON skeleton with the deficit recursion checked by hand for the first five
  levels. Output: `docs/research/briefs/E6.md` with one section per family and the prediction
  for each candidate.

**Wave 1 (as wave-0 outputs land).**

- E4 × 6 (Sonnet, one per placement, from `briefs/E4.md`): spec, 10,000 sessions, report, ledger
  fragment. Four at a time.
- E6 screening × 4 (Sonnet, one per family, from `briefs/E6.md`): 2,000 sessions per candidate,
  up to 12 candidates per family; report back the top two by median with mean and CVaR beside
  them. Also report any non-zero `rejected`/`adjusted` counts (the ladder did not run as drawn).
- A3 (Opus): compare E3a/E3b measurements with the H1 predictions; write the §7 paragraph and
  decide whether the formula needs the checkpoint-spacing correction.

**Wave 2.**

- E5 (Opus, with `aggregate.ts`): does P(ahead at S) collapse onto e^(−x)? Write up residuals by
  coverage and bet type. This decides whether E6 keeps searching layouts or moves to B/u and
  cash-out.
- E6 full size (Sonnet, one agent per family's top two): 10,000 sessions on the reporting seed
  and on holdout seeds 1 and 2 via `--seeds`.
- E7 on winners (Sonnet, one agent per strategy): the stop-win/stop-loss grid of E7-mart applied
  to each E4 and E6 winner.

**Wave 3.**

- E8 × per axis (Sonnet, one agent each: American wheel; la partage; $10,000 bankroll; 250 and
  1,000 spins; three holdout seeds), each applied to the same two or three survivors. Five
  agents, four at a time.
- Final write-up (Opus): `plan.md` §7 per group, §8 open questions, §9 candidates table, fold
  ledger fragments into `ledger.md`, save keepers under `scripts/research/candidates/`, run
  `npm run check`, push.

What cannot be split further: a single experiment (one strategy, one seed, N sessions) is the
atom; the runner does not shard sessions across processes, and the T3 worker pool from the plan
is not worth building while four cores are the ceiling. Design briefs D4 and D6 should stay with
one author each so the amounts and the recursion are consistent across the agents that consume
them.
