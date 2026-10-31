# Progressions, variance and the median: a research plan

Owner: creynia. Status: draft v1 (2026-10-31). Tooling: `scripts/research/sim.mjs` (this branch).

This plan answers three questions with the spinner engine, in an agentic loop that proposes a
strategy, simulates it, records the numbers and proposes the next one:

1. Does the way a bet is spread (how many numbers, how the stake is split) change expected value
   (EV), or only variance? Does changing the stake from spin to spin change EV?
2. Why do Martingale and Fibonacci on red show a median above break-even for the first few hundred
   spins and then fall below flat betting, and why does that advantage disappear as soon as the
   bet moves off an even-money, 18-number placement?
3. Is there a progression that keeps adding numbers, or stacking higher on some numbers, as the
   sequence deepens, that reports an above-break-even median over a session, with a cash-out rule
   to lock the median in?

Sections 1 and 2 are the position this plan starts from (theory plus the first simulation batch).
Sections 3 to 6 are the experiments and the loop. Section 7 is what the loop has found so far.

## 1. What the engine guarantees, and what that rules out

**EV per dollar is fixed by the wheel, not by the strategy.** On the European wheel every bet
returns 36/37 of the stake in expectation: the edge is 2.70 % of every cent wagered, for a
straight-up, a dozen, red, voisins, or any mix. (The only exception in the catalog is the
American basket at 7.89 %.) The harness records the analytic expected loss of every reconciled
layout, so each run carries its own oracle: `mean(net)` must equal `-0.027 × mean(wagered)` up to
sampling error. The first batch confirms it for every strategy in section 7, including the ones
whose median is far above zero.

So the honest form of the first question is: a strategy cannot change the edge, and therefore

```
EV(session) = -0.027 × E[total wagered in the session]
```

What a strategy *does* control:

- **How much is wagered**, hence the EV in dollars per session. A Martingale on red at the default
  table wagers about 4 units per spin on average, so its EV is about four times worse than flat
  betting per spin. A cash-out rule shortens sessions and so makes the EV in dollars smaller in
  magnitude, never positive.
- **The shape of the distribution**: skew. A recovery progression trades many small wins for a
  rare large loss. The median is a quantile, not a mean, and a right-skewed-to-the-upside
  distribution (most sessions +1 unit per cycle, a few sessions −255 units) has a median above
  zero while the mean is negative. This is the entire effect behind "Fibonacci beats flat on
  median". It is real, it is reproducible, and it is paid for in the left tail.
- **Where the probability mass sits in time.** A progression's median is positive while fewer
  than half the sessions have hit the cap. That gives the horizon in question 2.

Spreading a bet over more numbers at a fixed total stake changes only variance per spin
(coverage c of 37 numbers wins with probability c/37 and pays (36 − c)/c to 1), which is the
first half of the user's impression and is correct. Varying the stake over time changes the
*distribution* of session outcomes and the expected turnover, not the edge, which is the second
half of the impression corrected.

## 2. The cycle model: why the median goes up, then tanks, and why placement matters

A recovery ladder (Martingale, Fibonacci, Labouchere, d'Alembert loosely, any "raise after a
loss" sequence) plays in **cycles**: bet, raise on each loss, and a win ends the cycle with a
small profit. A cycle **caps** when the ladder runs out (table maximum, bankroll, or the
strategy's own `maxSteps`), and the loss at a cap is roughly the whole ladder.

Notation, for a layout that covers c numbers with a single stake:

| symbol | meaning |
| --- | --- |
| p = c/37 | probability a spin wins the cycle |
| m = (36 − c)/c | payout per unit staked |
| g = 36/(36 − c) | the growth factor per level that exactly recovers all losses plus the level-0 profit: ×2 for 18 numbers, ×1.5 for 12, ×3 for 24, ×1.2 for 6, ×36/35 for 1 |
| L | levels that fit under the table max and the bankroll |
| q = (1 − p)^L | probability a cycle caps |
| B = Σ g^k, k < L | bankroll consumed by a full ladder, in level-0 stakes |

Three consequences, each a testable hypothesis in section 4:

**H1, the median horizon.** Wins arrive at rate p per spin, each ending a cycle, so by spin n a
session has seen about n·p cycles and the chance it has not yet capped is about exp(−q·p·n).
The median path is above zero while that is above one half:

```
n½ = ln 2 / (q · p)
```

For Martingale on red, 8 levels ($25 to $3,200): q = (19/37)^8 = 0.0048, p = 0.486, n½ ≈ 295
spins. The first batch measured 290 (section 7). With 10 levels ($5 unit, same $5,000 table
max) q = 0.0013 and n½ ≈ 1,100 spins, beyond a 500-spin session; measured: the median is still
+$1,185 at spin 500. The "first few hundred spins" observation is this formula.

**H2, placement enters only through p, q and the table's log-budget.** Doubling is the right
growth for 18 numbers only. On a dozen the right factor is 1.5; doubling over-recovers, burns the
ladder in fewer levels, and q jumps from 0.005 to (25/37)^8 = 0.043, so n½ collapses from about
300 spins to about 50. That is why every placement other than even money "stops going above
break-even": the presets and the built-in `martingale` kind use integer multipliers, so a dozen
or a straight-up is always played with the wrong growth factor. A correctly scaled ladder (a
`sequence` progression with amounts g^k rounded up to the chip unit) should restore a horizon in
the hundreds of spins on a dozen. The number of levels is set by how many factors of g fit between
the minimum total stake and the maximum for that bet type: ln(max/min)/ln g. On the default table
that ratio is 200 for outside bets ($25 to $5,000), 20 for a straight-up ($25 minimum total,
$500 maximum per number), 80 for a corner, 120 for a six-line. Writing q in terms of that
budget, q ≈ (min/max)^e(c) with e(c) = −ln(1 − p)/ln g, which is 0.96 to 0.97 for every
coverage up to 18 numbers and falls off above it. So on this table even-money outside bets really
do have the best cap probability per dollar of bankroll, and the user's observation is a
structural fact about the limits, not a coincidence.

**H3, a universal curve.** Combining the two: define x = p·S/B (expected cycles in a session of S
spins, divided by the ladder's bankroll in level-0 stakes). The probability of finishing the
session without a cap is about exp(−x·q·B) and q·B is near 1 for any well-scaled ladder, so
P(no cap) ≈ e^(−x) and the median is positive iff x < ln 2 ≈ 0.69. When it is positive it is
about x·B level-0 profits. If this holds, then across coverage, growth factor and bet type the
only lever that moves the median horizon is the bankroll measured in base stakes, B/u, together
with p, and no arrangement of numbers can beat it by more than the few percent in e(c). The
loop's job is to find out how true this is once chip rounding, minimum totals and the harness's
reconcile rules are applied.

**Cash-out.** With a stop-win of W level-0 profits, a session ends ahead if it collects W cycles
before a cap: P ≈ (1 − q)^W ≈ e^(−qW). For Martingale on red, W = 20 ($500) gives 0.91 in
theory; the batch measured 88.8 % of sessions ending at +$500 and a median of exactly +$500.
The mean stays negative (−$114 on $5,000) because the 11 % that bust lose $5,000. This is the
mechanism the user proposed, and it works exactly as a skew trade: it raises the median and the
win rate and leaves EV per dollar untouched.

## 3. Tooling

**`node scripts/research/sim.mjs <spec.json> [--sessions N] [--spins N] [--bankroll CENTS] [--seed N] [--only id,id] [--out report.json]`**

Runs each experiment of a spec through the real compiler, plugin and harness on one thread (about
2 s per 1,000 sessions of 500 spins) and prints one line per experiment; `--out` writes the full
reports. A spec is `{ defaults, experiments: [{ id, strategy, rules?, session?, run? }] }` where
`strategy` is a strategy document or `"preset:<id>"`, `rules` is a preset name or
`{ preset, overrides }` (table limits, wheel, la partage), `session` has `bankroll`, `maxRounds`,
`stopWin`, `stopLoss` in cents, and `run` has `sessions` and `seed`. Examples:
`scripts/research/specs/baseline.json`, `observations.json`.

Each report has the net distribution (mean with CI, median with CI, p1 to p99, CVaR 5 %),
P(net > 0) with a Wilson interval, bust rate, how sessions ended, mean and per-spin wager, the
realized and analytic edge, drawdown, and the equity path (p10/p25/p50/p75/p90, mean and the
share of sessions ahead) at every spin up to 50 and every 10 spins after. Two derived numbers
are the ones the questions are about: `medianAheadUntil` (the last spin at which the median path
is above the bankroll) and `medianPeak`. Sessions that stop early carry their final equity
forward in the path, so a cash-out strategy's path means "money in the pocket".

To add before the loop gets heavy:

- `scripts/research/ladder.ts`: the closed-form calculator of section 2 (p, g, L, q, B, n½ and the
  predicted median at S) for any coverage, growth factor, table limit and bankroll, so a candidate
  is pre-screened before it is simulated, and the prediction is logged next to the measurement.
- A `worker_threads` pool in `sim.mjs` (the harness already has `createPool` and a transport
  interface) when batches exceed a few minutes.
- `--seeds a,b,c` for holdout seeds (section 5).

## 4. Experiments

Common settings unless stated: European wheel, no la partage, default high-limit table ($25 to
$5,000 outside; $1 chips, $25 minimum total and $500 straight-up maximum inside), bankroll $5,000,
500 spins, 10,000 sessions, seed 20261031. Pass/fail is written against the theory so a
surprising result is a finding, not a tuning target.

**E1, the edge oracle (question 1).** Every experiment in this plan, by construction: the
realized `mean(net)/mean(wagered)` must sit inside its 95 % interval around −2.70 %. Any violation
is a harness bug or a sampling-size problem, never a strategy effect. Also the direct test:
flat $25 on red vs $25 split over red and dozen 3 vs $25 over 25 straight-ups, same seed: equal
EV per dollar, variance rising with concentration.

**E2, reproduce and explain (question 2).** Flat, Martingale and Fibonacci on red; Martingale on a
dozen; Martingale on a straight-up; the two-dozens ×3 preset. Record `medianAheadUntil` and
compare with n½. Done in batch one (section 7); keep as the regression set for the loop.

**E3, the horizon law (H1).** Martingale on red with maxSteps 5 to 10 and the table minimum
lowered so the levels fit, bankroll scaled to fit the ladder. Prediction: `medianAheadUntil`
tracks ln2/(q·p) within the checkpoint spacing; the median at spin 500 is positive exactly when
n½ > 500. Then the same with session length 250, 1,000, 2,000.

**E4, placement with the right growth factor (H2).** `sequence` ladders with amounts g^k (rounded
up to the chip unit) on: a dozen (g = 1.5), two dozens (g = 3), a six-line (g = 1.2), a corner
(g = 1.125), 25 straight-ups at $1 (g = 36/11), 35 straight-ups at $1 (g = 36). Each at the
largest L that fits the table and the bankroll. Prediction: n½ lands near ln2/(q·p) for each,
and the ranking of n½ follows B/(u·p), so a dozen regains a horizon of hundreds of spins once g
is right. Also: the same ladders with the naive factor (×2 everywhere) as the control that
reproduces the user's "nothing but even money works".

**E5, the universal curve (H3).** Take every ladder from E3 and E4 and plot P(ahead at spin S)
and the median at S against x = p·S/B. If the points collapse onto e^(−x), coverage is not a
lever and the loop should stop searching over layouts and search over B/u and cash-out rules
instead. If they do not collapse, the residual (by coverage and by bet type) is the thing to
optimise in E6.

**E6, widening and stacking ladders (question 3).** The design the user asked for: a `sequence`
progression tracking the round, `onLoss: advance`, `onWin: reset`, with layout entries guarded by
`when: { cmp: [{ progStep: 'q' }, '>=', k] }` so that deeper levels add numbers (widening: dozen
→ two dozens → two dozens plus a column, ...) or add chips to the numbers already covered
(stacking). The deficit recursion of section 2 generalises: after a loss at level k with coverage
c_k, the amount to recover grows by 36/(36 − c_k); the stake at the next level must satisfy
s·m ≥ deficit + target for the *smallest* payout among the covered numbers. The calculator
proposes ladders that fit the bankroll; the loop simulates the top candidates. Score: median
net at S, P(ahead at S), with the mean, CVaR 5 % and bust rate reported beside them, never
hidden. Candidates: (a) widening with constant stake per number; (b) stacking at fixed coverage
with g matched to the payout; (c) hybrid: widen until coverage 24, then stack; (d) each of the
above with a cash-out at W cycles and a trailing stop (R16 in strategy.md) instead of a fixed
target.

**E7, cash-out and stop-loss (question 3, second half).** For the best two ladders from E4 and
E6 and for Martingale on red: stop-win at 5, 10, 20, 50, 100 level-0 profits; stop-loss at one
ladder and at half a ladder. Prediction: P(win) ≈ e^(−qW), the median equals the target while
qW < ln 2, the mean stays at −0.027 × wager and shrinks only because sessions are shorter.

**E8, robustness.** The two or three strategies that survive: American wheel, la partage (edge
halves on even money only: the one placement effect on EV that is real, and it favours even money
again), a $10,000 bankroll, 250 and 1,000 spins, and three holdout seeds.

## 5. The loop

One iteration:

1. **Propose.** Write or edit a spec in `scripts/research/specs/` with at most 12 experiments,
   each tied to a hypothesis or an E-number above, and record the prediction (from the calculator
   or from the section 2 formulas) in the spec's `id` or in the ledger row before running.
2. **Run.** `node scripts/research/sim.mjs <spec> --out docs/research/results/<spec>.json`
   (2,000 sessions for screening, 10,000 for anything that goes in the ledger as a finding).
3. **Record.** Append one row per experiment to `docs/research/ledger.md`: spec, id, seed,
   sessions, mean, median, P(win), bust, `medianAheadUntil`, peak, the prediction, and one line of
   interpretation. Keep the raw report file.
4. **Decide.** Confirmed prediction: move to the next experiment. Refuted: write the discrepancy
   down, check the harness oracle (E1) first, then refine the model. A candidate that scores well
   on median is re-run on a holdout seed before it is called a finding.
5. **Stop** an experiment when the prediction and the measurement agree within the median's
   confidence interval, or after three refinements that do not close the gap (then it is an open
   question in this file).

Rules that keep the loop honest: never choose a seed; never tune on the same seed that is
reported; always print the mean and CVaR next to the median; always run flat-red on the same seed
as a control; treat any realized edge outside its interval as a bug, not a result; and remember
that with 12 candidates per batch the best median of the batch is biased upward (the holdout
seed is what corrects for it).

## 6. Deliverables

- `docs/research/ledger.md` with every run, and `docs/research/results/*.json`.
- `scripts/research/ladder.ts` and its predictions in the ledger.
- A short write-up (this file's section 7, extended) answering the three questions with numbers,
  including the one that cannot be changed: EV per dollar.
- If E6 produces a ladder worth keeping: its JSON as a preset candidate with the cash-out rule
  built in, plus a gallery bundle.

## 7. Findings so far (batch one: `specs/observations.json`, 10,000 sessions, seed 20261031)

| experiment | mean | median | P(win) | bust | median > 0 until | median peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| flat-red | -$338.21 | -$350.00 | 25.5 % | 0.0 % | — | $0.00 @ 0 |
| flat-red-cashout-500 | -$304.78 | -$350.00 | 29.8 % | 0.0 % | — | $0.00 @ 0 |
| martingale-red | -$898.24 | -$5,000 | 32.4 % | 51.2 % | 290 | $2,100 @ 220 |
| martingale-red-br10k | -$1,266 | -$375.00 | 34.6 % | 22.2 % | 290 | $2,900 @ 270 |
| martingale-red-cashout-500 | -$113.80 | $500.00 | 88.8 % | 11.2 % | 500 | $500.00 @ 41 |
| martingale-red-unit5-L10 | -$324.32 | $1,185 | 73.4 % | 15.6 % | 500 | $1,185 @ 500 |
| fibonacci-red | -$783.73 | $1,675 | 57.2 % | 39.1 % | 500 | $1,675 @ 500 |
| fibonacci-red-cashout-500 | -$227.62 | $500.00 | 86.6 % | 13.2 % | 500 | $500.00 @ 120 |
| two-dozens-x3 | -$1,447 | -$5,000 | 31.8 % | 67.3 % | 220 | $2,100 @ 150 |
| martingale-dozen | -$1,060 | -$5,000 | 17.3 % | 82.1 % | 48 | $1,900 @ 42 |
| martingale-straight | -$600.38 | -$5,000 | 7.8 % | 91.9 % | — | $0.00 @ 0 |

What this already says:

- **Edge oracle holds** for every row: realized edge −2.4 % to −2.7 %, matching the analytic
  −2.70 % within sampling error even where the median is +$1,185. Question 1: EV per dollar does
  not move; turnover and shape do.
- **The horizon formula is right.** Martingale on red: predicted 295 spins, measured 290. With a
  $5 unit and 10 levels under the same $5,000 table max, predicted n½ ≈ 1,100, and the median is
  still +$1,185 at spin 500 (73 % of sessions ahead at the end). Bankroll alone does not do it:
  the $10,000 bankroll with the same 8 levels and $25 unit keeps the same 290-spin horizon and
  only changes how much a bust costs. It is levels, i.e. bankroll in base stakes under the table
  max, that moves the median.
- **Cash-out works as a skew trade.** Martingale on red with a $500 stop-win: 88.8 % of sessions
  end at +$500, median +$500, mean −$114 (flat: −$338). The 11 % that cap lose $5,000. Theory
  said 91 %.
- **Placement behaves as H2 predicts.** Martingale doubling on a dozen: predicted n½ ≈ 50
  spins, measured 48; on a straight-up the median never rises above zero; the two-dozens ×3 ladder
  (the right factor for 24 numbers, but only four full levels under $5,000) holds until 220. These
  are the controls for E4, where the same placements get a correctly scaled ladder.
- **Fibonacci outlasts Martingale** on the same bankroll (median +$1,675 at spin 500, 57 % of
  sessions ahead) because it grows slower and fits more levels before the bankroll runs out. Its
  mean (−$784) is worse than flat's, as the edge identity requires: it wagers three times as
  much.
- **Not a result: a positive mean.** No row has one, none will, and a candidate in a later batch
  that shows one is a sampling fluke or a bug to chase down.
