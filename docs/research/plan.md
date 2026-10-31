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

### 7.1 Predictions for wave 0 (written before the runs, 2026-10-31)

All rows: European wheel, 10,000 sessions, seed 20261031, realized edge −2.70 % within CI.
q = (1 − p)^L, n½ = ln2/(q·p), P(no cap by S) = e^(−q·p·S).

| spec | id | prediction |
| --- | --- | --- |
| e1-spread | red / red12+dozen3 13 / 25 straights $1 | mean −$337.84 each; per-spin SD $25.0 / $22.0 / $16.9; p10–p90 narrows in that order |
| e3a-levels | L5…L10 ($5 unit, bankroll = 2^L − 1 units) | n½ 40 / 78 / 151 / 295 / 574 / 1117; median@500 < 0 for L ≤ 8, > 0 for L9 (P .55, marginal) and L10 (P .73), ≈ +$1,216 |
| e3b-lengths | L8, L10 × S 250 / 1,000 / 2,000 | ahead-until ≈ min(S, n½), independent of S; median > 0 for L8-S250 (marginal), L10-S250, L10-S1000 (marginal) |
| e7-mart | stop-win W = 5…100 units, onCap reset/stop, SL half ladder | P(win) .976 / .953 / .908 / .785 / .617; median = +W; reset ≈ stop; SL half: same P(win), CVaR 5 % ≈ −$3,200 |

### 7.2 E1, spreading a fixed $25 (`specs/e1-spread.json`)

| layout | mean | median | CVaR 5 % | bust | realized edge (95 % CI) | session SD (pred) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| red $25 | -$338.21 | -$350.00 | -$1,479.60 | 0 % | -2.71 % ± 0.09 | $557 ($559) |
| red $12 + dozen 3 $13 | -$336.64 | -$338.00 | -$1,354.56 | 0 % | -2.69 % ± 0.08 | $490 ($493) |
| 25 straight-ups × $1 | -$337.98 | -$332.00 | -$1,128.82 | 0 % | -2.70 % ± 0.06 | $375 ($377) |

Confirmed. Same EV per dollar (predicted −$337.84); only dispersion moves, and it falls as coverage
widens, as predicted to within $3. Question 1, first half: spread changes variance, not EV.

### 7.3 E3, the horizon law (`specs/e3a-levels.json`, `e3b-lengths.json`; analysis `briefs/A3.md`)

$5 unit, bankroll = one ladder (2^L − 1 units), onCap reset. "Never capped" = e^(−q·p·S);
"renewal" = A3's chain that lets a session survive a cap on banked profit.

| id | n½ pred | ahead until | median@S | mean | CVaR 5 % | bust | P(ahead@S): never capped / renewal / measured |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| L5, S 500 | 40 | 39 | -$155 | -$63.25 | -$155 | 82.1 % | .000 / .178 / .167 |
| L6, S 500 | 78 | 70 | -$315 | -$99.34 | -$315 | 71.6 % | .012 / .258 / .244 |
| L7, S 500 | 151 | 150 | -$635 | -$151.37 | -$635 | 58.1 % | .101 / .323 / .310 |
| L8, S 500 | 295 | 290 | -$180 | -$209.14 | -$1,275 | 42.2 % | .308 / .345 / .333 |
| L9, S 500 | 574 | 500 | $1,130 | -$290.70 | -$2,555 | 25.9 % | .547 / — / .542 |
| L10, S 500 | 1,117 | 500 | $1,185 | -$327.56 | -$5,115 | 14.4 % | .733 / — / .734 |
| L8, S 250 | 295 | 250 | $550 | -$117.58 | -$1,275 | 24.2 % | .555 / — / .557 |
| L8, S 1,000 | 295 | 290 | -$1,275 | -$349.01 | -$1,275 | 60.0 % | .095 / .301 / .287 |
| L8, S 2,000 | 295 | 290 | -$1,275 | -$513.09 | -$1,275 | 74.8 % | .009 / .225 / .212 |
| L10, S 250 | 1,117 | 250 | $595 | -$165.17 | -$5,115 | 7.0 % | .856 / — / .855 |
| L10, S 1,000 | 1,117 | 1,000 | $2,300 | -$601.81 | -$5,115 | 26.1 % | .538 / — / .539 |
| L10, S 2,000 | 1,117 | 1,120 | -$1,073 | -$1,045 | -$5,115 | 44.7 % | .289 / — / .293 |

- **H1 holds with no correction.** Every n½ lies inside the 10-spin checkpoint window
  [ahead-until, ahead-until + 10); interpolated crossings 39.3 / 79.0 / 154.8 / 296.7 / 1,120.9 vs
  39.9 / 77.7 / 151.3 / 294.7 / 1,117.5. The horizon does not depend on S. The three L8 rows share
  paths (same seed), so they are one confirmation, not three.
- **Refinement: "ahead" ≠ "never capped"** once p·S > B + 1. A session that banked more than a ladder
  survives a cap. That lifts P(ahead) at long horizons (L8 at 2,000 spins: .212 vs .009 never capped)
  but never moves the median horizon, because recovery takes ≈ (B + 1)/p spins > n½. H3 should be
  scored against the never-capped share (an `onCap: stop` twin on the same seed gives it exactly).
- Realized edge −2.55 % to −2.85 %, all inside CI.

### 7.4 E7 on Martingale red (`specs/e7-mart.json`; analysis `briefs/A3.md` §3)

$25 unit, 8 levels, $5,000 bankroll, stop-win W units. Reset and stop rows are identical for W ≤ 50
(a cap empties the bankroll either way), so only reset is shown.

| W | P(win): e^(−qW) / A3 model / measured | median | mean | CVaR 5 % | bust |
| ---: | --- | ---: | ---: | ---: | ---: |
| 5 | .976 / .969 / .970 | $125 | -$28.24 | -$2,940 | 3.0 % |
| 10 | .953 / .939 / .941 | $250 | -$59.75 | -$5,000 | 5.9 % |
| 20 | .908 / .885 / .888 | $500 | -$113.80 | -$5,000 | 11.2 % |
| 50 | .785 / .754 / .761 | $1,250 | -$241.38 | -$5,000 | 23.9 % |
| 100 | .617 / .593 / .601 | $2,500 | -$448.99 | -$5,000 | 38.7 % |
| 20, stop-loss $3,187.50 | .908 / — / .884 | $500 | -$104.97 | -$5,000 | 0 % (11.6 % stop-loss at −$5,000) |

- **e^(−qW) refuted, mechanism found.** The 8th $3,200 bet does not fit a $5,000 bankroll after seven
  losses (−$3,175): reconcile cuts it to the remaining equity (runner counts: 499 adjusted rounds in
  331 of 500 sessions; 254 refused as unaffordable). A cut-down win leaves the cycle at −(55 − P)
  units, so q_eff = .0060 → .0051 as W grows. A3's exact model of reconcile lands inside the 95 % CI
  on all 12 rows.
- **The median equals +W in every row**, and the mean stays at −2.4 % of turnover: the cash-out is a
  skew trade, as predicted.
- **The half-ladder stop-loss is a no-op**: −$3,175 is above −$3,187.50, so the 8th bet always fires.
  A trailing stop of 7 losses (`maxSteps 7, onCap stop`) is the version that cuts the tail; it runs as
  E7b with A3's predictions (P(win) at W20 .828, CVaR 5 % −$3,120, bust 0).

**E7b, a trailing stop of 7 losses** (`specs/e7b-mart-L7stop.json`: `maxSteps 7, onCap stop`, the
same seed). The A3 predictions were committed before the run (e8289e9).

| W | P(win) pred / measured | median | mean (pred) | CVaR 5 % (pred) | bust | rej / adj |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 5 | .954 / .955 | $125 | -$22.61 (-$25) | -$2,827 (-$2,879) | 0 % | 0 / 0 |
| 10 | .910 / .911 | $250 | -$46.67 (-$49) | -$3,119 (-$3,120) | 0 % | 0 / 0 |
| 20 | .828 / .830 | $500 | -$87.03 (-$94) | -$3,119 (-$3,120) | 0 % | 0 / 0 |
| 50 | .623 / .631 | $1,250 | -$175.31 (-$205) | -$3,119 (-$3,120) | 0 % | 0 / 0 |
| 100 | .388 / .395 | -$1,300 | -$296.77 (-$333) | -$3,119 (-$3,120) | 0 % | 0 / 0 |
| 20, L8 reset control | .885 / .888 | $500 | -$113.80 (-$130) | -$5,000 | 11.2 % | 1,116 / 2,160 |

Confirmed on every row. The trailing stop swaps 6 points of P(win) at W20 for a CVaR 5 % that is
$1,881 better and a mean $27 better, with zero bust. The median flips negative between W50 and
W100: P(win) crosses ½ near qW = ln 2 with q_eff = (19/37)^7 = .0094, at W ≈ 74.

### 7.5 Predictions for E4 (written before the runs; from `briefs/E4.md`)

Base ≈ $25 total ($5 for the u5 pair), $5,000 bankroll (≈ 200 base stakes), onCap reset. "model" is
D4's cycle simulation, run independently of the engine. Ranking correction: at equal B,
n½ ≈ ln2·37·B/(36 − c), so the horizon *grows* with coverage. The ranking follows B/(m·p), not
B/(u·p) as §4 says.

| id | L (binds) | q | B | n½ | model median@500 | model P(ahead@500) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dozen-g | 11 (bankroll) | .0134 | 173 | 159 | -$4,982 | .35 |
| dozen-x2 | 7 (bankroll) | .0643 | 127 | 33 | -$5,000 | .25 |
| dozen-g-u5 | 15 (bankroll) | .0028 | 921 | 765 | +$1,620 | .65 |
| dozen-x2-u5 | 9 (bankroll) | .0294 | 511 | 73 | -$2,665 | .41 |
| two-dozens-g | 5 (bankroll) | .0054 | 121 | 200 | -$1,542 | .47 |
| two-dozens-x2 | 7, does not recover | — | 127 | — | -$182 | .43 |
| sixline-g | 20 (bankroll) | .0291 | 188 | 147 | -$4,994 | .39 |
| sixline-x2 | 7 ($3,000 bet max) | .290 | 127 | 15 | -$5,000 | .12 |
| corner-g | 27 (bankroll) | .0455 | 188 | 141 | -$4,990 | .38 |
| corner-x2 | 7 ($2,000 bet max) | .449 | 127 | 14 | -$5,000 | .09 |
| straights25-g | 5 (bankroll) | .0036 | 198 | 286 | -$894 | .38 |
| straights25-x2 | 7, does not recover | — | 127 | — | -$290 | .36 |
| straights35-g | 2 ($500 straight max) | .0029 | 37 | 251 | -$825 | .24 |
| straights35-x2 | 7, does not recover | ≈ 0 | 127 | — | -$480 | .003 |

H2 claims to test: (1) each correct-g ladder's never-capped crossing lands near its n½ (measured with
an `onCap: stop` twin on the same seed, per A3); (2) the ×2 control collapses the horizon wherever
g ≠ 2; (3) with B ≈ 200 base stakes, no placement keeps a positive median to 500 spins. Only the
$5 dozen (B 921) does, because base stakes, not placement, set the horizon.

### 7.6 Predictions for E6 (written before the screening runs; from `briefs/E6.md`)

Full per-candidate predictions (q, B, P(no cap@500), H3 median and an independent cycle-model Monte
Carlo) are in the brief, which was committed before any E6 run (de5a8f4). All candidates use
`onCap: stop`, so bust is 0 by design and the cap rate is reported instead. Most lower the table
minimums to $1 (one default-table reference per family). H3 as sharpened by D6:
P(no cap) = e^(−x·qB/(1 − q)) with qB/(1 − q) ≥ 1, so **e^(−x) is a ceiling** that no layout should
beat. Wide-coverage levels push a ladder below it. Score 1 − cap rate against e^(−x), not P(ahead).

| family | expected leaders (model median@500, P(no cap@500)) | default-table reference |
| --- | --- | --- |
| (a) widening | a1 streets 3→27 ($1,503, .547); a6 dozen+streets (−$620, .172) | a9: P(no cap) .001 |
| (b) stacking | b3 two streets ($1,698, .617); b1 street ($1,684, .629); b2 corner ($1,665, .640) | b11 red L7: .099 |
| (c) hybrid | c8 six-lines→18 then stack ($1,602, .633); c9 streets→12 then stack ($1,542, .671) | c6: .001 |
| (d) cash-out / trailing | d-b1-trail-j36 (P(win) .65, median $1,575); d-b1-stopwin30 (.73, $1,333) | — |

Expected verdict: stacking at moderate coverage ties Martingale-on-red-scaled ladders at equal B/u.
Widening and widen-to-24 sit at or below the e^(−x) ceiling. Nothing has a positive mean.

**E6 selection (screening seed 9001, 2,000 sessions).** These go to full size on the reporting seed
20261031 and holdout seeds 1 and 2 (10,000 sessions each). Prediction for every seed = D6's
cycle-model median and P(no cap) (the screens matched them within 3 %); realized edge −2.70 % within CI.

| id | family | screen median | mean | CVaR 5 % | P(win) | predicted median / P(win) |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| b3-two-streets-l29 | stack | $1,708 | -$199 | -$4,481 | 63.0 % | $1,698 / .63 |
| b1-street-l53 | stack | $1,697 | -$216 | -$4,806 | 63.1 % | $1,684 / .63 |
| c8-sixlines-to18-stack | hybrid | $1,608 | -$334 | -$4,507 | 63.6 % | $1,602 / .64 |
| c9-streets-to12-stack | hybrid | $1,548 | -$243 | -$4,820 | 67.8 % | $1,542 / .67 |
| a1-streets-w27 | widen | $1,527 | -$221 | -$3,370 | 57.4 % | $1,503 / .55 |
| d-b1-trail-j36 | cash-out | $1,603 | -$210 | -$4,806 | 64.7 % | $1,575 / .645 |
| d-b1-stopwin30 | cash-out | $1,334 | -$96 | -$4,806 | 74.4 % | $1,333 / .73 |
| d-c8-stopwin20 | cash-out | $200 | -$54 | -$4,507 | 94.6 % | $200 / .945 |

Screening verdict: H3's ceiling held in all four families (no 1 − cap rate above e^(−x)). Every
cash-out and trailing rule lies on the frontier P(win) ≈ (1 − q)^(M/τ̄). The a1-family edge readings
(z ≈ +2 to +2.7) share one seed's paths: one draw, to be checked on the holdouts.

### 7.7 Edge oracle under clamping (`briefs/edge-check.md`)

e4-dozen-x2-u5 gave realized edge −3.20 % (z −2.4) on the reporting seed, and other clamp-heavy reset
ladders leaned negative. Chased as a potential bug. The runner now reports `edge.residual` from
per-session residuals r = net + expected loss. That is the correct test; the old sd(net) version ran
3–5 % narrow.

| ladder | pooled residual z, seeds 101–110 (10 × 10,000) | ten-seed edge | mean | CVaR 5 % | bust |
| --- | ---: | ---: | ---: | ---: | ---: |
| e4-dozen-x2-u5 | +0.67 | -2.66 % | -$645 | -$5,000 | 45.9 % |
| e4-sixline-g | +0.95 | -2.64 % | -$753 | -$5,000 | 54.9 % |
| e4-dozen-g | -0.27 | -2.72 % | -$913 | -$5,000 | 50.7 % |
| flat-red control | -1.56 | -2.73 % | -$341 | -$1,490 | 0 % |

Verdict: **noise, no bug.** `src/core/harness/session.ts` charges expected loss on the layout as
placed after reconcile (clamped bets at the clamped amount; a bust round places nothing). The
residual is therefore mean-zero under any stopping rule. Across all 57 committed rows recomputed,
max |z| = 2.36, and same-seed rows count as one draw. Every realized edge in this file is
consistent with −2.70 %.

### 7.8 E6 full size and holdouts (`specs/e6-full.json`, 10,000 sessions × seeds 20261031 / 1 / 2)

| id | median (rep / h1 / h2) | mean | CVaR 5 % | P(win) | cap rate | bust | residual z |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| b3-two-streets-l29 | 1,679 / 1,698 / 1,698 | -321 / -247 / -246 | -4,491 / -4,487 / -4,483 | 60.8 / 62.1 / 62.1 % | 38.7 / 37.4 / 37.3 % | 0 | -2.43 / 0.26 / 0.29 |
| b1-street-l53 | 1,675 / 1,703 / 1,701 | -309 / -197 / -219 | -4,815 / -4,814 / -4,799 | 61.9 / 63.6 / 63.2 % | 37.0 / 35.2 / 35.8 % | 0 | -2.93 / 0.91 / 0.16 |
| c8-sixlines-to18-stack | 1,598 / 1,600 / 1,600 | -405 / -382 / -335 | -4,515 / -4,506 / -4,517 | 62.6 / 62.8 / 63.7 % | 37.3 / 37.0 / 36.1 % | 0 | -2.05 / -1.21 / 0.58 |
| c9-streets-to12-stack | 1,540 / 1,542 / 1,537 | -295 / -297 / -321 | -4,820 / -4,827 / -4,826 | 67.1 / 67.2 / 66.7 % | 32.7 / 32.6 / 33.0 % | 0 | -0.47 / -0.57 / -1.46 |
| a1-streets-w27 | 1,494 / 1,497 / 1,498 | -331 / -348 / -324 | -3,380 / -3,377 / -3,385 | 55.1 / 54.6 / 55.3 % | 44.9 / 45.3 / 44.6 % | 0 | 0.49 / -0.33 / 0.77 |
| d-b1-trail-j36 | 1,582 / 1,601 / 1,619 | -303 / -192 / -211 | -4,815 / -4,814 / -4,799 | 63.3 / 65.2 / 64.6 % | 35.9 / 34.1 / 34.6 % | 0 | -2.87 / 1.01 / 0.32 |
| d-b1-stopwin30 | 1,333 / 1,334 / 1,333 | -241 / -135 / -164 | -4,815 / -4,814 / -4,799 | 71.9 / 73.8 / 73.2 % | 28.1 / 26.2 / 26.8 % | 0 | -3.14 / 1.00 / -0.18 |
| d-c8-stopwin20 | 200 / 200 / 200 | -61 / -42 / -58 | -4,515 / -4,506 / -4,517 | 94.5 / 94.8 / 94.5 % | 5.5 / 5.1 / 5.5 % | 0 | -0.95 / 0.89 / -0.62 |
| flat-red | -350 / -350 / -350 | -338 / -336 / -336 | -1,480 / -1,506 / -1,483 | 25.5 / 26.2 / 25.7 % | — | 0 | -0.07 / 0.25 / 0.26 |

(z here is the sd(net) form; §7.7 shows it runs slightly wide of the residual form.)

- **Predictions held on both holdouts for every candidate.** Medians are within 3 % of the cycle model;
  P(win) within ±0.02. On the reporting seed the four b-family rows (one street or two streets
  stacked) share one unlucky spin stream (z −2.4 to −3.1). Pooled over three seeds, b1 gives z −1.07.
  Combined with §7.7 (no mechanism), that is a draw, not a bug. b3's reporting-seed median ($1,679)
  and P(win) (60.8 %) fall just outside their predicted values for the same reason.
- **Rankings within pairs are ties.** b1 ≈ b3 (gap $4–$5) and c8 ≈ b1-trail (gap $2–$19) swap order
  between seeds.
- **H3 ceiling held everywhere**, and every mean is negative.
- **Survivors for E7/E8**, one per family: **b3** (stacking; ties b1 on median, better CVaR),
  **c9** (hybrid; best P(win) and mean of the hybrids), **a1** (widening; best CVaR of any
  positive-median ladder).

### 7.9 Predictions for E7 on the survivors (written before the runs)

Stop-win at W mean cycle profits τ̄ (b3 $23, c9 $14, a1 $11.3; τ̄ = cap loss / B). Prediction
P(win) = (1 − q)^W times P(the session reaches W cycles within 500 spins). The median equals the
target while P(win) > ½, and the mean is −2.70 % of turnover, smaller in magnitude for small W.
Half-ladder stop-loss: CVaR 5 % ≈ −½ cap loss; P(win) at W20 falls to (1 − q_half)^20.

| survivor (q, cycles in 500 spins) | W5 | W10 | W20 | W50 | W100 | W20 + half-ladder SL |
| --- | --- | --- | --- | --- | --- | --- |
| b3 (.00591, 81) | .971 | .942 | .888 | .744 | target unreachable ⇒ ≈ no-stop row (.62, median ≈ $1,690) | ≈ .845, CVaR ≈ −$2,300 |
| c9 (.00356, 111) | .982 | .965 | .931 | .837 | .700 × .89 ≈ .62 | ≈ .855, CVaR ≈ −$2,400 |
| a1 (.00494, 122) | .976 | .952 | .906 | .781 | .610 | ≈ .69, CVaR ≈ −$1,700 |
