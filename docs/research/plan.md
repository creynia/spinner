# Progressions, variance and the median: a research plan

Owner: creynia. Status: v2, loop complete (2026-10-31). Tooling: `scripts/research/sim.mjs` (this branch).

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
Sections 3 to 6 are the experiments and the loop. Section 7 is what the loop found (§7.0 answers
the three questions), §8 the open questions, §9 the candidate strategies.

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

## 7. Findings

### 7.0 Answers

**Q1. Does spread, or varying the stake, change EV?** No. EV per dollar is fixed at −2.70 %
(−5.26 % American; −1.36 % on flat red under la partage, the one placement effect on EV). E1
(§7.2): $25 on red, red + dozen or 25 straight-ups loses −$338.21 / −$336.64 / −$337.98 per 500
spins (pred −$337.84); only the session SD moves ($557 / $490 / $375). Varying the stake changes
turnover, and turnover sets EV in dollars: flat red wagers $12,500 (mean −$338), Fibonacci $30,397
(−$784), c9 with cash-out $1,962 (−$46). The edge oracle held on every row (§7.7).

**Q2. Why the median rises then falls, and why only on even money.** The median stays above
break-even while fewer than half the sessions have capped: n½ = ln2/(q·p) (H1; E3 §7.3: Martingale
red 295 predicted, 290 measured; L5–L10 all inside their 10-spin checkpoint). Placement enters
through the growth factor g = 36/(36 − c), ×2 only for 18 numbers, and the table log-budget
ln(max/min)/ln g (H2; E4 §7.12: with the right g all 6 placements cross within one checkpoint of
n½; doubling on a dozen cuts n½ to 33). At equal bankroll the horizon ranks by B/(m·p); only the
$5-base dozen (B 921) keeps a positive median to spin 500: +$1,611, mean −$345, CVaR 5 % −$5,000,
bust 16.4 %.

**Q3. Can widening or stacking plus a cash-out report an above-break-even median?** Yes over 500
spins, as a skew trade only. c9 (streets widened to 12, then stacked) with a $280 stop-win (W20) and
a half-ladder stop-loss: median $286, P(win) 90.3 / 89.9 / 90.1 / 89.8 % on four seeds, mean −$46 / −$60 /
−$54 / −$61, CVaR 5 % −$3,210 / −$3,214 / −$3,212 / −$3,209, bust 0 (§7.11, §9). Limits (E5 §7.14): P(no cap) ≤
e^(−x), a ceiling none of 53 ladders beat; layout is no lever beyond B; widening raises k (1.58 at
33 numbers vs 1.14 for one street), and the widening survivor lost its median on the American wheel
(§7.13). The mean is negative on every row.

### Batch one (`specs/observations.json`, 10,000 sessions, seed 20261031)

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

### 7.10 Predictions for E8 robustness (written before the runs)

Survivors b3, c9, a1 as in `specs/e6-full.json` (onCap stop), plus a flat-red control. Reporting seed
20261031 unless noted; 10,000 sessions.

| axis | b3 | c9 | a1 | flat-red |
| --- | --- | --- | --- | --- |
| American wheel (p → c/38, q × Π((38 − c_k)/38 ÷ (37 − c_k)/37)) | q .00685, P(no cap) .58, median still > 0 (≈ $1,600), mean ≈ −$626 (−5.26 % of turnover) | q .00425, P(no cap) .63, median > 0 (≈ $1,500), mean ≈ −$575 | q .00598, P(no cap) .49: **median flips to ≤ 0** (marginal), mean ≈ −$645 | edge −5.26 %, mean ≈ −$658 |
| la partage (even money only) | identical to European, row for row (no even-money bets) | identical | identical | edge −1.35 %, mean ≈ −$169 |
| $10,000 bankroll | identical to $5,000 (fixed ladder, onCap stop, cap loss < $5,000) | identical | identical | identical |
| 250 spins | P(no cap) .79, median ≈ +$850 | .82, ≈ +$780 | .74, ≈ +$750 | median ≈ −$175 |
| 1,000 spins | P(no cap) .38: median < 0 | .45: median < 0 | .30: median < 0 | median ≈ −$700 |
| holdout seed 3 | as §7.8 holdouts (b3 $1,698, .62) | ($1,540, .67) | ($1,497, .55) | −$350 |

Edge: −2.70 % (European) or −5.26 % (American) within the residual-z interval on every row.

### 7.11 E7 on the survivors (`specs/e7-{b3,c9,a1}.json`, 10,000 sessions, seed 20261031)

Stop-win at W mean cycle profits. Bust 0 and rejected/adjusted 0 on every row. Residual |z| ≤ 2.4;
the b3 rows share §7.8's unlucky stream.

| survivor | W | target | median | mean | CVaR 5 % | P(win) measured (pred) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| b3 | 5 / 10 / 20 / 50 | $115 / 230 / 460 / 1,150 | $124 / 240 / 470 / 1,156 | -$32 / -39 / -79 / -212 | -$3,038 / -4,491 / -4,491 / -4,491 | .966 / .941 / .886 / .736 (.971 / .942 / .888 / .744) |
| b3 | 100 / none | $2,300 / — | $1,680 / 1,679 | -$321 / -321 | -$4,491 | .608 / .608 (.62) |
| b3 | 20 + SL $2,287 | $460 | $468 | -$77 | **-$2,720** | .817 (.845) |
| c9 | 5 / 10 / 20 / 50 | $70 / 140 / 280 / 700 | $77 / 146 / 286 / 705 | -$11 / -27 / -56 / -143 | -$1,705 / -3,344 / -4,820 / -4,820 | .982 / .965 / .932 / .839 (.982 / .965 / .931 / .837) |
| c9 | 100 / none | $1,400 / — | $1,404 / 1,540 | -$269 / -295 | -$4,820 | .704 / .671 (.62 / .67) |
| c9 | 20 + SL $2,460 | $280 | $286 | **-$46** | **-$3,210** | .903 (.855) |
| a1 | 5 / 10 / 20 / 50 | $57 / 113 / 226 / 565 | $63 / 119 / 232 / 570 | -$13 / -32 / -64 / -138 | -$1,465 / -2,920 / -3,380 / -3,380 | .978 / .957 / .917 / .811 (.976 / .952 / .906 / .781) |
| a1 | 100 / none | $1,130 / — | $1,133 / 1,494 | -$251 / -331 | -$3,380 | .658 / .551 (.61 / .55) |
| a1 | 20 + SL $1,722 | $226 | $232 | -$64 | -$3,380 | .917 (.69): SL never fires before the cap level |

- **The cash-out works exactly as a skew trade on every survivor.** The median sits at the target
  (plus one win's overshoot) while P(win) > ½. The mean shrinks with W only because sessions are
  shorter. Edge per dollar is unchanged.
- **Prediction misses are in my inputs, not the model.** (1) For a1 I used τ̄ = $11.30 from the D6
  stop-win; cap loss / B = $3,444/258 = $13.30, and with it (1 − q)^(W·11.3/13.3) gives .919 / .810 /
  .657 against measured .917 / .811 / .658. (2) "Target unreachable in 500 spins" for b3/c9 at W100
  was wrong for c9: 70 % reach it, and the b3 row is marginal (1.2 %).
- **The half-ladder stop-loss depends on the ladder's shape.** Where the deficit grows smoothly (b3,
  c9) it fires mid-ladder and halves the tail: c9 CVaR 5 % −$4,820 → −$3,210 and mean −$56 → −$46,
  for 3 points of P(win). It overshoots half the cap loss by one level because the stop is checked
  after the round. On a widening ladder (a1) the last level carries $2,592 of the $3,444 cap loss, so
  an equity stop at half never fires before it (cf. Martingale, §7.4).

### 7.12 E4, placement with the right growth factor (`specs/e4-*.json`, 10,000 sessions, seed 20261031)

Base ≈ $25, $5,000 bankroll. "Crossing" = first spin where the never-capped share (the `-g-stop` twin)
drops below ½, against n½ = ln2/(q·p).

| placement (c) | g | n½ | crossing (stop twin) | g median@500 | g mean | g CVaR 5 % | g bust | ×2 control: median / ahead until |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| dozen (12) | 1.5 | 159 | 160 | -$4,984 | -$930 | -$5,000 | 51.2 % | -$5,000 / 70 (n½ 33) |
| dozen, $5 base (12) | 1.5 | 765 | > 500 | **+$1,611** | -$345 | -$5,000 | 16.4 % | -$2,948 / 70 |
| two dozens (24) | 3 | 200 | 200 | -$1,569 | -$1,070 | -$5,000 | 34.1 % | -$182 / 220 (does not recover) |
| six-line (6) | 1.2 | 147 | ≈ 147 | -$4,994 | -$865 | -$5,000 | 55.9 % | -$5,000 / 9 |
| corner (4) | 1.125 | 141 | ≈ 135 | -$4,989 | -$764 | -$5,000 | 56.5 % | -$5,000 / never |
| 25 straight-ups (25) | 36/11 | 286 | 290 | -$635 | -$1,107 | -$5,000 | 47.9 % | -$272 / 130 (does not recover) |
| 35 straight-ups (35) | 36 | 251 | 250 | -$824 | -$1,323 | -$4,940 | 4.3 % | -$480 / 12 (does not recover) |

- **H2 confirmed.** With the right growth factor every placement's crossing lands within one
  checkpoint of n½ (6 of 6). Doubling collapses the horizon wherever g ≠ 2 (dozen 33 → measured 70
  ahead-until on a noisy flat crossing; six-line 9; corner never).
  The "only even money works" observation is the wrong growth factor plus the table's log-budget, not
  placement.
- **Ranking follows B/(m·p)** (D4's correction): at equal B, wider coverage holds longer (25 straight-ups
  286 > two dozens 200 > dozen 159 > six-line 147 > corner 141).
- **No placement keeps a positive median to 500 spins at B ≈ 200 base stakes.** The $5-base dozen
  (B 921) does, with median +$1,611 and a never-capped share that equals e^(−q·p·s) to within .003.
  Base stakes, not placement, set the horizon.
- Reset ladders show `medianAheadUntil` beyond n½ (dozen 330, two dozens 460) because sessions
  survive one cap on banked profit (§7.3). The stop twins give the clean number. Realized edges −2.16 %
  to −3.20 %, all consistent with −2.70 % (§7.7).

### 7.13 E8 American wheel (`specs/e8-american.json`)

| id | median Eur → Am | mean Eur → Am | CVaR 5 % Eur → Am | P(win) Eur → Am | edge (analytic −5.26 %) | residual z |
| --- | --- | --- | --- | --- | ---: | ---: |
| b3 | $1,679 → $1,594 | -$321 → -$521 | -$4,491 → -$4,510 | 60.8 → 58.0 % | -5.43 % | -0.56 |
| c9 | $1,540 → $1,497 | -$295 → -$535 | -$4,820 → -$4,836 | 67.1 → 63.3 % | -4.91 % | 1.38 |
| a1 | $1,494 → **-$1,978** | -$331 → -$700 | -$3,380 → -$3,397 | 55.1 → 47.3 % | -5.47 % | -1.10 |
| flat-red | -$350 → -$650 | -$338 → -$653 | -$1,480 → -$1,794 | 25.5 → 11.4 % | -5.23 % | 0.85 |

Predictions held for medians and P(no cap), including a1's flip (.473 vs .49 predicted). My mean
predictions for b3/c9 were too negative: I used a turnover that ignored the stop at the cap. With the
realized wager, −5.26 % × turnover matches within 1 z. The American wheel costs 3–4 points of P(win);
the widening ladder, whose late levels cover the most numbers, loses its median.

### 7.14 E5, the universal curve (`briefs/E5.md`; 53 ladders from E3, E4 and E6)

Never-capped share at S against x = p·S/B, with B in cycle profits. Excluded: recovers:false ×2
controls, cash-out rows (censored), and screen rows duplicated by the 3-seed full rows.

| group | mean residual vs e^(−x) | RMS residual vs D6 form e^(−k·x), k = qB/(1 − q) |
| --- | ---: | ---: |
| all 53 ladders | −6.0 pts (none above 0) | 0.8 pts (RMS z 1.47) |
| E3 Martingale red | −4.9 | ≤ 1.1 |
| E4 outside | −6.2 | ≤ 1.1 |
| E4 inside | −15.7 (35 straight-ups −44.6, k 3.79) | 1.1 (z 3.59: long ladders, Poisson approx.) |
| E6 widen / stack / hybrid | −7.3 / −4.8 / −5.9 | 0.4–1.1 |

- **H3 holds as a ceiling, and D6's form is the point prediction.** No ladder sits above e^(−x).
  e^(−k·x) predicts to 0.8 points RMS; the three |z| > 2 outliers (L 20–53) close with an exact
  run-length DP (34 single-coverage ladders: RMS z 0.72, max |z| 1.49). It also predicts the
  American wheel (b3: .585 measured, .580 D6, .587 DP).
- **Coverage is not a lever beyond B.** At equal B, layouts tie within sampling error (b3/b4 .635/.615,
  b5/b6 .639/.650, b7/b8 .534/.554). Layout enters only through k = 1 + 0.027 × turnover per dollar
  of cycle profit: one street stacked 1.14, Martingale red 1.27, two dozens 1.37, widening to 33
  numbers 1.58. The best case over red is +3.3 points of P(no cap) at the leaders' x (never more than
  +7 points, the k = 1 limit), worth under $70 of median at fixed risk. **Widening moves k the wrong way.**
- **What moves the median horizon:** S½ = ln2·B/(k·p), so bankroll in cycle profits first, then k, then
  the stopping rule.
- **Median check.** "Median ≈ x·B profits" runs 2–15 % high: the median session is the poorest
  survivor. τ̄ × the (1 − 1/(2P₀)) quantile of Bin(S, p) lands within −3 % to +6 %. "Median > 0 iff
  e^(−k·x) > ½" held on all 65 recovering, uncensored rows. Every positive median sits beside a
  negative mean (−$110 to −$602) and a CVaR 5 % of −$1,275 to −$5,115.
- Tooling note: E4's `meta.B` is in level-0 stakes, so the aggregator's x for E4 rows is too large by
  the payout m. The brief uses corrected values.

### 7.15 E8 robustness (`specs/e8-{american,length,partage,br10k}.json`, `results/e8-seed3.json`)

Survivors as in `specs/e6-full.json` (onCap stop), 10,000 sessions per row. Reporting seed 20261031
unless the axis is a seed; holdouts 1 and 2 come from e6-full. Predictions are in §7.10. Bust 0 and
rejected/adjusted 0 on every row. Edge is the realized value; analytic −2.70 % (American −5.26 %).

**b3-two-streets-l29** (stacking)

| axis | median | mean | CVaR 5 % | bust | P(win) | cap rate | edge | prediction → result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| reporting seed | $1,679 | -$320.90 | -$4,491 | 0 % | 60.8 % | 38.7 % | -3.41 % | $1,698 / .63 → low; unlucky stream (§7.8) |
| holdout 1 | $1,698 | -$246.96 | -$4,487 | 0 % | 62.1 % | 37.4 % | -2.63 % | held |
| holdout 2 | $1,698 | -$245.78 | -$4,483 | 0 % | 62.1 % | 37.3 % | -2.62 % | held |
| holdout 3 | $1,687 | -$285.86 | -$4,490 | 0 % | 61.5 % | 37.9 % | -3.03 % | $1,698 / .62 → held |
| American | $1,594 | -$520.74 | -$4,510 | 0 % | 58.0 % | 41.5 % | -5.43 % | ≈ $1,600, P(no cap) .58 → held (.585); mean (−$626) off, turnover |
| la partage | $1,679 | -$320.90 | -$4,491 | 0 % | 60.8 % | 38.7 % | -3.41 % | identical to European → held |
| $10,000 bankroll | $1,679 | -$320.90 | -$4,491 | 0 % | 60.8 % | 38.7 % | -3.41 % | identical to $5,000 → held |
| 250 spins | $862 | -$166.99 | -$4,491 | 0 % | 77.5 % | 20.3 % | -3.22 % | ≈ $850, P(no cap) .79 → held (.797) |
| 1,000 spins | -$1,947 | -$474.46 | -$4,491 | 0 % | 37.5 % | 62.5 % | -3.12 % | median < 0, P(no cap) .38 → held (.375) |

**c9-streets-to12-stack** (hybrid)

| axis | median | mean | CVaR 5 % | bust | P(win) | cap rate | edge | prediction → result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| reporting seed | $1,540 | -$295.45 | -$4,820 | 0 % | 67.1 % | 32.7 % | -2.82 % | $1,542 / .67 → held |
| holdout 1 | $1,542 | -$297.28 | -$4,827 | 0 % | 67.2 % | 32.6 % | -2.85 % | held |
| holdout 2 | $1,537 | -$320.50 | -$4,826 | 0 % | 66.7 % | 33.0 % | -3.09 % | held |
| holdout 3 | $1,540 | -$326.25 | -$4,819 | 0 % | 66.6 % | 33.2 % | -3.12 % | $1,540 / .67 → held |
| American | $1,497 | -$535.24 | -$4,836 | 0 % | 63.3 % | 36.4 % | -4.91 % | ≈ $1,500, P(no cap) .63 → held (.636); mean (−$575) off, turnover |
| la partage | $1,540 | -$295.45 | -$4,820 | 0 % | 67.1 % | 32.7 % | -2.82 % | identical → held |
| $10,000 bankroll | $1,540 | -$295.45 | -$4,820 | 0 % | 67.1 % | 32.7 % | -2.82 % | identical → held |
| 250 spins | $777 | -$156.42 | -$4,820 | 0 % | 81.8 % | 17.4 % | -2.74 % | ≈ $780, P(no cap) .82 → held (.826) |
| 1,000 spins | -$2,126.50 | -$472.93 | -$4,820 | 0 % | 45.2 % | 54.7 % | -2.70 % | median < 0, P(no cap) .45 → held (.453) |

**a1-streets-w27** (widening)

| axis | median | mean | CVaR 5 % | bust | P(win) | cap rate | edge | prediction → result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| reporting seed | $1,494 | -$330.93 | -$3,380 | 0 % | 55.1 % | 44.9 % | -2.62 % | $1,503 / .55 → held |
| holdout 1 | $1,497 | -$348.13 | -$3,377 | 0 % | 54.6 % | 45.3 % | -2.76 % | held |
| holdout 2 | $1,498 | -$324.08 | -$3,385 | 0 % | 55.3 % | 44.6 % | -2.57 % | held |
| holdout 3 | $1,491.50 | -$351.14 | -$3,381 | 0 % | 54.7 % | 45.2 % | -2.79 % | $1,497 / .55 → held |
| American | **-$1,978** | -$699.61 | -$3,397 | 0 % | 47.3 % | 52.7 % | -5.47 % | median flips ≤ 0, P(no cap) .49 → flip held (.473) |
| la partage | $1,494 | -$330.93 | -$3,380 | 0 % | 55.1 % | 44.9 % | -2.62 % | identical → held |
| $10,000 bankroll | $1,494 | -$330.93 | -$3,380 | 0 % | 55.1 % | 44.9 % | -2.62 % | identical → held |
| 250 spins | $775 | -$190.84 | -$3,380 | 0 % | 74.1 % | 25.5 % | -2.65 % | ≈ $750, P(no cap) .74 → held (.745) |
| 1,000 spins | -$1,568 | -$538.08 | -$3,380 | 0 % | 29.5 % | 70.5 % | -2.74 % | median < 0, P(no cap) .30 → held (.295) |

**flat-red control** (median / mean / CVaR 5 %, bust 0): reporting −$350 / −$338.21 / −$1,480;
seed 3 −$350 / −$344.60 / −$1,496; American −$650 / −$653.14 / −$1,794 (edge −5.23 %); la partage
−$175 / −$169.82 / −$1,302 (edge −1.36 %, pred −1.35 %); $10,000 identical to $5,000; 250 spins
−$150 / −$170.85 / −$966; 1,000 spins −$650 / −$675.80 / −$2,324.

- **Seeds.** Across four seeds the medians move by at most $19 (b3), $5 (c9) and $6 (a1), and P(win)
  by at most 1.3 points. The low b3 reporting row is §7.8's spin stream; seed 3 sits with the
  holdouts.
- **La partage and $10,000 matched the European $5,000 rows exactly, row for row.** The survivors
  place no even-money bets. With onCap stop, the cap loss (under $5,000) never reaches the extra
  bankroll. Flat red under la partage: edge −1.36 % (pred −1.35 %), mean −$169.82.
- **American** (§7.13) costs 3–8 points of P(win). b3 and c9 keep their medians; a1 loses its median.
- **Length.** All three are positive at 250 spins, with roughly half the 500-spin median. All three
  are negative at 1,000 spins. At 1,000 spins the median stays ahead until spin 690 / 860 / 570,
  against n½ = ln2/(q·p) from the specs' meta (723 / 874 / 577). That check was not registered
  before the run.

### 7.16 Predictions for X1 (written before the runs)

Two specs, 10,000 sessions each, seed 20261031: `specs/x1-c9-cashout-axes.json` (the c9 cash-out
`e7-c9-W20-SLhalf`: stop-win $280, stop-loss $2,459.50, `onCap stop`, $1 minimums, copied unchanged) and
`specs/x1-a1-trailing.json` (a1, stop-win $226 where stated). Reference row, European 500 spins:
median $286, P(win) .9028, mean −$46.25, CVaR 5 % −$3,210, edge −2.36 % on $1,962 mean wager, 84
rounds per session, ended by stop-win 9,028 and stop-loss 972.

**c9 cash-out on the other axes.** q_eff from the European W5–W50 rows: 1 − P(win)^(1/W) = .00363 /
.00356 / .00351 / .00350, so q_eff ≈ .0035. The stop-loss row fires on the loss of level 14 (15 levels
lost, cumulative $3,275 against a $2,459.50 limit; level 13 ends at $2,179), so its per-cycle rate is
q_SL = 1 − .9028^(1/20) = .00510 (theory Π(1 − c_k/37) over 15 levels: .00528). American: the ratio
Π (1 − c_k/38)/(1 − c_k/37) over those 15 levels is 1.181, so q_am = .00510 × 1.181 = .00602 and
P(win) = (1 − q_am)^20 = .886. Medians stay at the target plus one win's overshoot ($286) while
P(win) > ½. Mean = −5.26 % × turnover; sessions run ≈ 3 % longer (86 rounds, wager ≈ $2,000), so the
mean is ≈ −$105. CVaR 5 %: the worst 5 % are stop-loss sessions, whose loss is fixed by the ladder, so
the tail is unchanged.

For the length rows: c9 cash-out sessions end at a median of 86 rounds (mean 84) because 20 cycle
profits take ≈ 20 × 4.5 spins; 250 spins is about 6 standard deviations out, so no session should be
unfinished at spin 250, and 1,000 spins adds nothing a 500-spin session did not already have. A session
is a function of its own spin stream only, so these rows should reproduce the 500-spin row session for
session.

| id | P(win) | median | mean | CVaR 5 % | reasoning |
| --- | ---: | ---: | ---: | ---: | --- |
| x1-c9-am (American, 500) | .886 | $286 | ≈ −$105 | ≈ −$3,215 | q_am = 1.181 × q_SL; edge −5.26 % |
| x1-c9-S250 (European, 250) | .903 | $286 | −$46.25 | −$3,210 | identical to the 500-spin row: no session is still running at spin 250 (at most a handful) |
| x1-c9-S1000 (European, 1,000) | .903 | $286 | −$46.25 | −$3,210 | identical to the 500-spin row |
| x1-c9-am-S1000 (American, 1,000) | .886 | $286 | ≈ −$105 | ≈ −$3,215 | identical to x1-c9-am |

**a1 with a trailing stop.** a1 has 9 levels, coverage 3, 6, …, 27, amounts 1, 2, 2, 3, 5, 10, 24, 72,
288 dollars per street; the last level carries $2,592 of the $3,444 cap loss. Dropping it gives 8
levels (`onCap stop`) with a cap loss of $852. q' = q/(1 − 27/37) = q/.2703. The measured P(win) at
W5–W100 (.978 / .957 / .917 / .811) gives q_eff = .0043 per cycle (the nominal meta q = .00494 needs
the W × 11.3/13.3 correction of §7.11), so q' = .0043/.2703 = .0159, and P(win at W20) = (1 − q')^20 = .726
(the uncorrected form, q = .00494 and 17 effective cycles, gives .731; the uncorrected 20 cycles give
.69). The median is the target plus overshoot ($232). A cap leaves banked profit − $852 and the worst 5 %
are the earliest caps (cycle ≤ 3, ≈ $20 banked), so CVaR 5 % ≈ −$830. Without a stop-win the session
runs to the cap or to 500 spins (122 cycles); equity ends above zero only if the cap comes after
$852 / $13.3 ≈ 64 cycles, so P(win) ≈ (1 − q')^64 = .36 and the median is the median cap time
ln 2/q' = 44 cycles → 44 × $13.3 − $852 ≈ −$270. Mean = −2.70 % × turnover; capped sessions end early,
so turnover falls to ≈ $2,000 (W20) and ≈ $4,000 (no stop), giving ≈ −$55 and ≈ −$110.

| id | P(win) | median | mean | CVaR 5 % | cap rate | reasoning |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| x1-a1-W20-ctrl (9 levels, W20) | .917 | $232 | −$63.55 | −$3,380 | 8.3 % | unchanged spec: reproduces `e7-a1-W20` exactly |
| x1-a1-L8-W20 (8 levels, W20) | .726 | $232 | ≈ −$55 | ≈ −$830 | ≈ 27 % | (1 − q')^20, q' = q_eff/.2703; CVaR = shortened cap loss − early banked |
| x1-a1-L8-nostop (8 levels) | ≈ .36 | ≈ −$270 | ≈ −$110 | ≈ −$830 | ≈ 86 % | positive only if the cap comes after ≈ 64 cycles |

Edge: −2.70 % European, −5.26 % American on every row; |residual z| > 2.5 is a bug.

### 7.17 X1 results (`specs/x1-c9-cashout-axes.json`, `specs/x1-a1-trailing.json`, 10,000 sessions, seed 20261031)

Predictions are in §7.16. Bust 0 and rejected/adjusted 0 on every row. Edge is the realized value
(analytic −2.70 % European, −5.26 % American); every residual |z| ≤ 1.04.

| id | median | mean | CVaR 5 % | bust | P(win) | cap rate | edge (z) | prediction → result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| x1-c9-am (American, 500) | $286 | -$100.32 | -$3,220 | 0 % | 88.7 % | 0 % (stop-loss 11.3 %) | -4.75 % (1.04) | .886, $286, -$105, -$3,215 → held |
| x1-c9-S250 (European, 250) | $286 | -$46.25 | -$3,210 | 0 % | 90.3 % | 0 % (stop-loss 9.7 %) | -2.36 % (0.68) | identical to the 500-spin row → held, session for session |
| x1-c9-S1000 (European, 1,000) | $286 | -$46.25 | -$3,210 | 0 % | 90.3 % | 0 % (stop-loss 9.7 %) | -2.36 % (0.68) | identical → held |
| x1-c9-am-S1000 (American, 1,000) | $286 | -$100.32 | -$3,220 | 0 % | 88.7 % | 0 % (stop-loss 11.3 %) | -4.75 % (1.04) | identical to x1-c9-am → held |
| x1-a1-W20-ctrl (9 levels, W20) | $232 | -$63.55 | -$3,380 | 0 % | 91.7 % | 8.3 % | -2.76 % (-0.14) | reproduces `e7-a1-W20` exactly → held |
| x1-a1-L8-W20 (8 levels, W20) | $230 | -$38.08 | -$841 | 0 % | 72.4 % | 27.6 % | -2.81 % (-0.34) | .726, $232, ≈ -$830, cap ≈ 27 % → held; mean ≈ -$55 → refuted |
| x1-a1-L8-nostop (8 levels) | -$360 | -$124.31 | -$841 | 0 % | 30.6 % | 89.9 % | -2.81 % (-0.58) | .36, -$270, ≈ -$110, CVaR ≈ -$830 → P(win) and median refuted; mean and CVaR held |

- **c9 cash-out on the American wheel.** The stop-loss rate rose from 9.7 % to 11.3 %, as
  q_am = 1.181 × q_SL predicted: P(win) .887 against .886. The median is the target plus overshoot
  ($286), the mean is -$100.32 (-4.75 % of a $2,113 wager, against my -$105), and CVaR 5 % moved by
  $10. The wheel's extra cost is 1.6 points of P(win) and $54 of mean, much less than for the no-stop
  ladders (§7.13: 3.8 points for c9), because the session ends after about 85 spins. Sessions run 85.0
  rounds (86 predicted), median 87.
- **Length changes nothing for the c9 cash-out.** All 10,000 sessions had stopped by round 250, so the
  250- and 1,000-spin reports equal the 500-spin report to the cent, on both wheels. Where the no-stop
  c9 ladder goes from +$777 (250 spins) to -$2,126.50 (1,000 spins), the cash-out version stays at $286.
- **The a1 trailing stop works as the E7b analogue did.** Dropping the $2,592 level cuts the cap loss
  from $3,444 to $852 and CVaR 5 % from -$3,380 to -$841 (the 5 % worst are caps in the first cycles, with
  $11 banked). It costs 19 points of P(win) at W20 (91.7 % → 72.4 %, predicted .726) because
  q' = q/(1 − 27/37) = .0183 is 3.7 times q. The median stays at the target ($230, predicted $232: this
  stop-win overshoots by $4 instead of $6). The mean improves from -$63.55 to -$38.08.
- **Two misses, both in my inputs.** (1) The mean: I assumed turnover fell from $2,303 to about $2,000,
  but the dropped level is the heavy-wagering one: $1,354 (wager per spin $33.64 → $22.15). The edge on
  that turnover is -2.81 %, in line. (2) The no-stop row: I fitted q' from the W-nominal rows
  (q_eff = .0043, which already includes the 17/20 correction of §7.11) and then applied it to the real
  122 cycles of a 500-spin session. With q' = .00494/.2703 = .0183, (1 − q')^64 = .31 and the median cap
  cycle is ln 2/q' = 38 → 38 × $13.3 − $852 = -$348. Measured .306 and -$360, 89.9 % of sessions
  capped (10.1 % ran the 500 spins; (1 − q')^122 = .10). That is a post-hoc fix, not a held prediction.
  The rule for next time: use the nominal q with the corrected number of cycles, or q_eff with the
  nominal count, never one of each.
- **The trade.** Against the 9-level W20 row the shortened ladder gives up 19 points of P(win) and keeps
  the median at the target for a CVaR 5 % that is $2,539 better and a mean $25 better. Against c9's
  cash-out (90.3 %, CVaR -$3,210) it is a worse deal on P(win) and a much better one on the tail.
  Without a stop-win the 8-level ladder is a loss-limiter, not a median-positive strategy: the median
  is -$360 because the cap arrives at cycle 38.

### 7.18 Predictions for E9 (written before the runs)

**Question.** Every ladder so far ended its cycle at the first win (q = (1 − p)^L). Does a
slow-recovery ladder, which needs several wins to unwind, buy a longer median horizon or a higher
P(ahead) than the best one-win ladder on the same $5,000, and at what cost in the tail? And does
E5's "layout is no lever beyond B" survive when cycles need several wins?

**Setup.** European wheel, $5,000, 500 spins, 10,000 sessions, seed 20261031; holdouts 1 and 2
(`specs/x-e9-holdout.json`). Seven specs, generated by `scripts/research/e9.ts --specs`:
`x-e9-controls` (flat red, Martingale red L8 at $25, L10 at $5, the Fibonacci preset, and the one-win
frontier at $1/$2/$4/$9 with 12/11/10/9 levels), `x-e9-fib` (a), `x-e9-geo-back` and `x-e9-geo-reset`
(b), `x-e9-dal-lab` (c), `x-e9-transplant` (d), `x-e9-cashout` (e). Every ladder has maxSteps (or
maxLength) set to the levels whose straight losing run fits $5,000, so the bankroll is the cap. Each
runs `onCap: reset` and an `onCap: stop` twin (`-stop`), whose cap rate is the never-capped share;
transplants run stop first. Outside minimum = the unit (rules override) below $25; c9 rows use $1
minimums. Labouchere caps at maxLength 16 or a next bet above $1,000.

**Model** (`scripts/research/slowLadder.ts`, tests in `slowLadder.test.ts`). A level-indexed ladder
is a Markov chain on the level: a loss climbs one level, a win moves to max(0, k − back) (back 1:
d'Alembert and `sequence onWin back`; 2 or 3: `fibonacci back`; ∞: one-win). A cycle starts at
level 0 and ends when a win lands on level 0, or caps on a loss at the top. Iterating that chain to
absorption gives q, E[T], the done-cycle profit τ̄ and its variance, the mean cap loss C and the
turnover per cycle (E[R]/turnover = −1/37 on every row, the edge identity). From them: λ = q·S/E[T]
caps per session, never-capped e^(−λ), n½ = ln 2·E[T]/q, p_eff = (1 − q)/E[T] winning cycles per
spin, B = C/τ̄, x = p_eff·S/B, k = qB/(1 − q) (so e^(−λ) = e^(−k·x), E5's form), and the closed-form
median (E5's survivor-quantile rule with the renewal CLT). Two exact columns are added: the level
chain run for S spins ("exact": P(no cap seen in 500 spins) from a fresh ladder) and a session DP
over (level, equity) with the harness's rules (bet cut to the equity if that meets the minimum,
bust otherwise, stop-win and stop-loss after the round, a cap seen at the next window). The DP
reproduces the ledger: Martingale red $25 L8 reset −$939 / −$5,000 / 32.1 % / bust 51.4 % (ledger
−$898 / −$5,000 / 32.4 % / 51.2 %), $5 L10 $1,185 / 73.3 % (ledger $1,185 / 73.4 %), the Fibonacci
preset $1,625 / 56.7 % / bust 39.5 % (ledger $1,675 / 57.2 % / 39.1 %), c9 $1,543 / 67.3 % (e6-full
$1,540 / 67.1 %), c9 cash-out $286 / 90.1 % / −$53 / −$3,213 (ledger $286 / 90.3 % / −$46.25 /
−$3,210). Labouchere's state is the line, whose exact chain grows exponentially with maxLength (18 s
at 8), so its cycle numbers come from 10⁶ sampled cycles (checked against the exact chain at maxLength
6) and it has no session DP.

**Predictions.** The session DP columns are the point predictions for median, P(win), mean, CVaR 5 %
and cap rate; a measured value outside its 95 % interval around the DP is a miss.

1. **The level walk's drift decides whether a slow ladder works at all.** The level moves +1 with
   probability 1 − p and −back with probability p, drift (1 − p) − back·p. On red, back 1 drifts
   *up* (+1/37 per spin), so a cycle is a near-fair random walk that reaches the top with probability
   of order 1/L: q = .030–.070 per cycle for every back-1 ladder (geometric ×1.2–×2.0, Fibonacci
   back 1, d'Alembert), against .0008 for Fibonacci back 2 (drift −17/37). All nine back-1 ladders
   have a negative median at spin 500: n½ 53–378 spins and stop-twin cap rates 58–100 %, except
   d'Alembert $5 (E[T] 30, cap rate 22 %), whose median is negative for the reason in item 4.
2. **Fibonacci back 2 is the only slow family on red with a long horizon.** Back 2 keeps the deficit a
   function of the level (D_k = F(k+1) − 1 units), so every cap loses the whole ladder and q =
   .00082 at $5 (14 levels, $4,930): never capped .868, median $415, P(win) 85.8 %, mean −$262, CVaR 5 %
   −$4,857, n½ 2,358. At $25 (10 levels, $3,575) q is .00482, Martingale-L8's, so the median is
   negative at 500 (n½ 387). Back 3 under-recovers (each win leaves F(k−3) of the deficit): fewer caps
   (never capped .957 at $5) but survivors are often still in a hole, so P(win) .650, median $105.
3. **No slow ladder beats the one-win frontier at the same bankroll.** k = 1 + 0.027 × turnover per
   (1 − q)τ̄ is higher for the slow ladder on every layout (red 1.65 / 4.27 for Fibonacci back 2 / 3
   vs 1.27–1.38 for Martingale; dozen 1.36 / 1.51 vs 1.22; c9 1.33 / 1.45 vs 1.21), and at equal
   bankroll C and equal never-capped share P0 the median is about C·ln(1/P0)/k. On red the one-win
   frontier at $5,000 is Martingale at $1/$2/$4–5/$9 base: P(win) 91.9 / 85.1 / 73.3 / 54.6 % at medians $240 /
   $478 / $948–$1,185 / $2,034. Fibonacci $5 back 2 (85.8 %, $415) sits just under the $2 point (same
   P(win), $63 less); the dozen back-4 transplant (75.1 %, $925) has 1.8 points more P(win) than the
   $4–$5 points for $23–$260 less median; every other slow ladder sits further below. Fibonacci's CVaR
   5 % (−$4,857) is no better than Martingale's (−$4,017 at $2, −$4,984 at $5).
4. **P(ahead) < never-capped for under-recovering ladders.** Fibonacci back 3 ($5): .957 never capped,
   65.0 % ahead; d'Alembert $5: .780 vs 46.1 %, median −$180 although four sessions in five never cap.
   The closed-form median, which assumes every survivor is ahead, is wrong for these rows (d'Alembert
   +$1,258 closed form vs −$180 DP).
5. **The Poisson form needs short cycles.** e^(−λ) matches the exact chain within .01 for every ladder
   with E[T] ≤ 6.5 (the one-win ladders, Fibonacci back 2 and 3, the transplants) and drifts as cycles
   lengthen: Fibonacci $5 back 1 (E[T] 8.4) .048 vs .026, geometric ×1.4 back (10.3) .112 vs .077, ×1.2
   back (18.6) .400 vs .423, d'Alembert $5 (30.5) .614 vs .780. E5's point form e^(−k·x) inherits this; the ceiling e^(−x) holds on
   every row (k ≥ 1).
6. **Transplants (d).** The two best slow ladders on red are Fibonacci $5 back 2 and back 3. Their
   analogues on a dozen (payout 2) keep the same recovery rule: back 4 at r = 1.36, the root of
   2r⁴ = r³ + r² + r + 1, recovers exactly the last four levels (as Fibonacci back 2 recovers two), and
   back 5 at the same r under-recovers by one level (as back 3 does). Dozen back 4: never capped .759,
   median $925, P(win) 75.1 %, k 1.36 (one-win dozen $5: .639, $1,611, 63.7 %, k 1.22). Same rule on the
   c9 streets layout ($1, widening to four streets by level 3, 19 levels, $3,843): back 4 .708 / $921 /
   70.2 %, back 5 .806 / $518 / 76.7 % (c9 one-win .676 / $1,543 / 67.3 %). The layout still enters only
   through k and B: every transplant's never-capped share equals its own chain's prediction.
7. **Cash-out (e)** on Fibonacci $5 back 2 (`onCap stop`; base profit $5; half ladder $2,465): W10 ($50)
   98.3 %, W20 ($100) 96.7 %; with the half-ladder stop-loss 97.4 % / 94.9 %, CVaR 5 % −$1,531 / −$2,999.
   At c9's own target ($280 with the half-ladder stop) 86.4 %, mean −$153, CVaR 5 % −$2,999, against the
   c9 cash-out's 90.1 %, −$53, −$3,213 on the same seed: 3.7 points of P(win) and $100 of mean worse,
   $214 better in the tail. The median is the target on every cash-out row.
8. Edge: −2.70 % on every row; |residual z| > 2.5 is a bug, not a finding. Rejected and adjusted rounds
   0 on the stop rows; reset rows reject rounds after a cap (a cut-down bankroll below the minimum).

`docs/research/results/x-e9-predictions.json` has every number (`node scripts/research/e9.ts` prints
the table). Selected columns, $ rounded; "(reset)" marks an `onCap: reset` row:

| id | L | q | E[T] | τ̄ | B | x | k | e^(−λ) | exact | n½ | median cf | DP median | DP P(win) | DP mean | DP CVaR 5 % | DP cap / bust |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| e9-flat-red (reset) | 1 | 0.51351 | 1.00 | $25.00 | — | — | — | 0.000 | -0.000 | 1 | neg | −$350 | 25.8 % | −$338 | −$1,489 | 0.0 / 0.0 % |
| e9-mart-u25-L8 (reset) | 8 | 0.00484 | 2.05 | $25.00 | 255 | 0.954 | 1.24 | 0.307 | 0.306 | 293 | neg | −$5,000 | 32.1 % | −$939 | −$5,000 | 0.0 / 51.4 % |
| e9-mart-u25-L8-stop | 8 | 0.00484 | 2.05 | $25.00 | 255 | 0.954 | 1.24 | 0.307 | 0.306 | 293 | neg | −$3,000 | 30.5 % | −$843 | −$5,000 | 69.1 / 0.5 % |
| e9-mart-u5-L10 (reset) | 10 | 0.00128 | 2.05 | $5.00 | 1023 | 0.238 | 1.31 | 0.733 | 0.736 | 1116 | $1,198 | $1,185 | 73.3 % | −$332 | −$5,000 | 0.0 / 15.5 % |
| e9-mart-u5-L10-stop | 10 | 0.00128 | 2.05 | $5.00 | 1023 | 0.238 | 1.31 | 0.733 | 0.736 | 1116 | $1,198 | $1,185 | 73.3 % | −$319 | −$4,984 | 26.4 / 0.0 % |
| e9-fib-preset (reset) | 12 | 0.00198 | 2.74 | $12.19 | 771 | 0.236 | 1.53 | 0.697 | 0.703 | 962 | $2,050 | $1,625 | 56.7 % | −$819 | −$5,000 | 0.0 / 39.5 % |
| e9-fib-preset-stop | 12 | 0.00198 | 2.74 | $12.19 | 771 | 0.236 | 1.53 | 0.697 | 0.703 | 962 | $2,050 | $1,625 | 56.7 % | −$819 | −$5,000 | 11.7 / 27.8 % |
| e9-mart-u1-L12 | 12 | 0.00034 | 2.05 | $1.00 | 4095 | 0.059 | 1.38 | 0.921 | 0.923 | 4236 | $243 | $240 | 91.9 % | −$87 | −$4,020 | 7.7 / 0.0 % |
| e9-mart-u2-L11 | 11 | 0.00065 | 2.05 | $2.00 | 2047 | 0.119 | 1.34 | 0.853 | 0.855 | 2175 | $483 | $478 | 85.1 % | −$153 | −$4,017 | 14.5 / 0.0 % |
| e9-mart-u4-L10 | 10 | 0.00128 | 2.05 | $4.00 | 1023 | 0.238 | 1.31 | 0.733 | 0.736 | 1116 | $958 | $948 | 73.3 % | −$255 | −$4,014 | 26.4 / 0.0 % |
| e9-mart-u9-L9 | 9 | 0.00248 | 2.05 | $9.00 | 511 | 0.476 | 1.27 | 0.546 | 0.548 | 572 | $2,079 | $2,034 | 54.6 % | −$447 | −$4,511 | 45.2 / 0.0 % |
| e9-fib-u5-b1 (reset) | 14 | 0.05091 | 8.37 | $66.31 | 28 | 2.021 | 1.50 | 0.048 | 0.026 | 114 | neg | −$5,000 | 32.5 % | −$1,299 | −$5,000 | 0.0 / 53.3 % |
| e9-fib-u5-b1-stop | 14 | 0.05091 | 8.37 | $66.31 | 28 | 2.021 | 1.50 | 0.048 | 0.026 | 114 | neg | −$1,695 | 31.8 % | −$642 | −$4,641 | 97.4 / 0.0 % |
| e9-fib-u5-b2 (reset) | 14 | 0.00082 | 2.77 | $2.43 | 2025 | 0.089 | 1.65 | 0.863 | 0.868 | 2358 | $428 | $415 | 85.8 % | −$268 | −$5,000 | 0.0 / 6.7 % |
| e9-fib-u5-b2-stop | 14 | 0.00082 | 2.77 | $2.43 | 2025 | 0.089 | 1.65 | 0.863 | 0.868 | 2358 | $428 | $415 | 85.8 % | −$262 | −$4,857 | 13.2 / 0.0 % |
| e9-fib-u5-b3 (reset) | 14 | 0.00021 | 2.28 | $0.24 | 20781 | 0.011 | 4.27 | 0.956 | 0.957 | 7688 | $37 | $105 | 65.0 % | −$170 | −$4,488 | 0.0 / 3.2 % |
| e9-fib-u5-b3-stop | 14 | 0.00021 | 2.28 | $0.24 | 20781 | 0.011 | 4.27 | 0.956 | 0.957 | 7688 | $37 | $105 | 65.0 % | −$169 | −$4,472 | 4.3 / 0.0 % |
| e9-fib-u25-b1 (reset) | 10 | 0.06471 | 5.94 | $94.18 | 19 | 4.103 | 1.33 | 0.004 | 0.001 | 64 | neg | −$5,000 | 30.6 % | −$1,582 | −$5,000 | 0.0 / 58.1 % |
| e9-fib-u25-b1-stop | 10 | 0.06471 | 5.94 | $94.18 | 19 | 4.103 | 1.33 | 0.004 | 0.001 | 64 | neg | −$1,225 | 31.7 % | −$452 | −$3,380 | 99.9 / 0.0 % |
| e9-fib-u25-b2 (reset) | 10 | 0.00482 | 2.69 | $12.22 | 293 | 0.633 | 1.42 | 0.408 | 0.409 | 387 | neg | −$1,150 | 40.8 % | −$827 | −$5,000 | 0.0 / 23.8 % |
| e9-fib-u25-b2-stop | 10 | 0.00482 | 2.69 | $12.22 | 293 | 0.633 | 1.42 | 0.408 | 0.409 | 387 | neg | −$1,825 | 40.8 % | −$628 | −$3,523 | 59.1 / 0.0 % |
| e9-fib-u25-b3 (reset) | 10 | 0.00206 | 2.26 | $4.29 | 853 | 0.259 | 1.76 | 0.633 | 0.637 | 759 | $399 | $375 | 56.8 % | −$675 | −$5,000 | 0.0 / 12.6 % |
| e9-fib-u25-b3-stop | 10 | 0.00206 | 2.26 | $4.29 | 853 | 0.259 | 1.76 | 0.633 | 0.637 | 759 | $399 | $375 | 56.8 % | −$581 | −$4,000 | 36.3 / 0.0 % |
| e9-geo-r12-back (reset) | 29 | 0.03415 | 18.64 | $31.21 | 67 | 0.384 | 2.38 | 0.400 | 0.423 | 378 | neg | −$932 | 44.6 % | −$863 | −$5,000 | 0.0 / 13.1 % |
| e9-geo-r12-back-stop | 29 | 0.03415 | 18.64 | $31.21 | 67 | 0.384 | 2.38 | 0.400 | 0.423 | 378 | neg | −$1,100 | 44.1 % | −$755 | −$4,310 | 57.7 / 0.0 % |
| e9-geo-r14-back (reset) | 17 | 0.04496 | 10.28 | $45.11 | 35 | 1.333 | 1.64 | 0.112 | 0.077 | 158 | neg | −$1,430 | 37.2 % | −$1,079 | −$5,000 | 0.0 / 30.2 % |
| e9-geo-r14-back-stop | 17 | 0.04496 | 10.28 | $45.11 | 35 | 1.333 | 1.64 | 0.112 | 0.077 | 158 | neg | −$1,337 | 30.3 % | −$570 | −$3,461 | 92.3 / 0.0 % |
| e9-geo-r16-back (reset) | 13 | 0.05354 | 7.75 | $59.84 | 26 | 2.375 | 1.45 | 0.032 | 0.015 | 100 | neg | −$3,031 | 35.0 % | −$1,222 | −$5,000 | 0.0 / 45.2 % |
| e9-geo-r16-back-stop | 13 | 0.05354 | 7.75 | $59.84 | 26 | 2.375 | 1.45 | 0.032 | 0.015 | 100 | neg | −$1,288 | 31.6 % | −$479 | −$3,523 | 98.5 / 0.0 % |
| e9-geo-r18-back (reset) | 11 | 0.06029 | 6.54 | $77.01 | 21 | 3.365 | 1.37 | 0.010 | 0.003 | 75 | neg | −$5,000 | 31.3 % | −$1,382 | −$5,000 | 0.0 / 57.3 % |
| e9-geo-r18-back-stop | 11 | 0.06029 | 6.54 | $77.01 | 21 | 3.365 | 1.37 | 0.010 | 0.003 | 75 | neg | −$1,385 | 32.5 % | −$466 | −$3,855 | 99.7 / 0.0 % |
| e9-geo-r20-back (reset) | 9 | 0.07015 | 5.36 | $65.92 | 17 | 5.072 | 1.29 | 0.001 | 0.000 | 53 | neg | −$3,730 | 34.7 % | −$1,228 | −$5,000 | 0.0 / 47.9 % |
| e9-geo-r20-back-stop | 9 | 0.07015 | 5.36 | $65.92 | 17 | 5.072 | 1.29 | 0.001 | 0.000 | 53 | neg | −$895 | 33.1 % | −$255 | −$2,489 | 100.0 / 0.0 % |
| e9-geo-r12-reset (reset) | 29 | 0.00000 | 2.06 | $-0.36 | — | — | — | 1.000 | 1.000 | > 10⁵ | neg | −$80 | 29.7 % | −$88 | −$451 | 0.0 / 0.0 % |
| e9-geo-r12-reset-stop | 29 | 0.00000 | 2.06 | $-0.36 | — | — | — | 1.000 | 1.000 | > 10⁵ | neg | −$80 | 29.7 % | −$88 | −$451 | 0.0 / 0.0 % |
| e9-geo-r14-reset (reset) | 17 | 0.00001 | 2.06 | $-0.44 | — | — | — | 0.997 | 0.997 | > 10⁵ | neg | −$65 | 38.1 % | −$117 | −$1,077 | 0.0 / 0.0 % |
| e9-geo-r14-reset-stop | 17 | 0.00001 | 2.06 | $-0.44 | — | — | — | 0.997 | 0.997 | > 10⁵ | neg | −$65 | 38.1 % | −$117 | −$1,074 | 0.3 / 0.0 % |
| e9-geo-r16-reset (reset) | 13 | 0.00017 | 2.06 | $-0.06 | — | — | — | 0.959 | 0.960 | 8251 | neg | $38 | 54.5 % | −$170 | −$3,357 | 0.0 / 0.3 % |
| e9-geo-r16-reset-stop | 13 | 0.00017 | 2.06 | $-0.06 | — | — | — | 0.959 | 0.960 | 8251 | neg | $38 | 54.5 % | −$167 | −$3,296 | 4.0 / 0.0 % |
| e9-geo-r18-reset (reset) | 11 | 0.00065 | 2.05 | $1.59 | — | — | — | 0.853 | 0.855 | 2175 | neg | $362 | 76.6 % | −$248 | −$4,692 | 0.0 / 3.1 % |
| e9-geo-r18-reset-stop | 11 | 0.00065 | 2.05 | $1.59 | — | — | — | 0.853 | 0.855 | 2175 | neg | $362 | 76.6 % | −$234 | −$4,048 | 14.5 / 0.0 % |
| e9-geo-r20-reset (reset) | 9 | 0.00248 | 2.05 | $5.00 | 511 | 0.476 | 1.27 | 0.546 | 0.548 | 572 | $1,155 | $1,130 | 54.6 % | −$321 | −$4,994 | 0.0 / 4.9 % |
| e9-geo-r20-reset-stop | 9 | 0.00248 | 2.05 | $5.00 | 511 | 0.476 | 1.27 | 0.546 | 0.548 | 572 | $1,155 | $1,130 | 54.6 % | −$249 | −$2,506 | 45.2 / 0.0 % |
| e9-dal-u5 (reset) | 44 | 0.02979 | 30.49 | $34.35 | 104 | 0.153 | 3.20 | 0.614 | 0.780 | 710 | $1,258 | −$180 | 46.1 % | −$925 | −$5,000 | 0.0 / 5.2 % |
| e9-dal-u5-stop | 44 | 0.02979 | 30.49 | $34.35 | 104 | 0.153 | 3.20 | 0.614 | 0.780 | 710 | $1,258 | −$180 | 46.1 % | −$904 | −$4,452 | 22.0 / 0.0 % |
| e9-dal-u25 (reset) | 19 | 0.04210 | 11.59 | $92.29 | 38 | 1.089 | 1.67 | 0.163 | 0.126 | 191 | neg | −$3,750 | 35.7 % | −$1,839 | −$5,000 | 0.0 / 47.2 % |
| e9-dal-u25-stop | 19 | 0.04210 | 11.59 | $92.29 | 38 | 1.089 | 1.67 | 0.163 | 0.126 | 191 | neg | −$2,175 | 22.1 % | −$1,253 | −$4,301 | 87.4 / 0.0 % |
| e9-lab-1 (reset) | — | 0.00278 | 3.45 | $5.00 | 608 | 0.238 | 1.69 | 0.669 | — | 862 | $687 | — | — | — | — | — |
| e9-lab-1-stop | — | 0.00278 | 3.45 | $5.00 | 608 | 0.238 | 1.69 | 0.669 | — | 862 | $687 | — | — | — | — | — |
| e9-lab-123 (reset) | — | 0.01441 | 7.29 | $30.00 | 103 | 0.658 | 1.50 | 0.372 | — | 351 | neg | — | — | — | — | — |
| e9-lab-123-stop | — | 0.01441 | 7.29 | $30.00 | 103 | 0.658 | 1.50 | 0.372 | — | 351 | neg | — | — | — | — | — |
| e9-doz-r136-b4-stop | 19 | 0.00230 | 4.02 | $8.05 | 591 | 0.210 | 1.36 | 0.751 | 0.759 | 1210 | $964 | $925 | 75.1 % | −$314 | −$4,680 | 24.1 / 0.0 % |
| e9-doz-r136-b4 (reset) | 19 | 0.00230 | 4.02 | $8.05 | 591 | 0.210 | 1.36 | 0.751 | 0.759 | 1210 | $964 | $925 | 75.1 % | −$331 | −$5,000 | 0.0 / 11.0 % |
| e9-doz-r136-b5-stop | 19 | 0.00125 | 3.56 | $4.02 | 1205 | 0.116 | 1.51 | 0.839 | 0.844 | 1970 | $497 | $511 | 79.3 % | −$263 | −$4,833 | 15.6 / 0.0 % |
| e9-doz-r136-b5 (reset) | 19 | 0.00125 | 3.56 | $4.02 | 1205 | 0.116 | 1.51 | 0.839 | 0.844 | 1970 | $497 | $511 | 79.3 % | −$271 | −$5,000 | 0.0 / 8.2 % |
| e9-c9-r136-b4-stop | 19 | 0.00463 | 6.50 | $13.35 | 287 | 0.267 | 1.33 | 0.701 | 0.708 | 974 | $966 | $921 | 70.2 % | −$286 | −$3,767 | 29.2 / 0.0 % |
| e9-c9-r136-b4 (reset) | 19 | 0.00463 | 6.50 | $13.35 | 287 | 0.267 | 1.33 | 0.701 | 0.708 | 974 | $966 | $921 | 70.2 % | −$318 | −$5,000 | 0.0 / 7.9 % |
| e9-c9-r136-b5-stop | 19 | 0.00245 | 5.50 | $6.62 | 589 | 0.154 | 1.45 | 0.800 | 0.806 | 1555 | $514 | $518 | 76.7 % | −$239 | −$3,917 | 19.4 / 0.0 % |
| e9-c9-r136-b5 (reset) | 19 | 0.00245 | 5.50 | $6.62 | 589 | 0.154 | 1.45 | 0.800 | 0.806 | 1555 | $514 | $518 | 76.7 % | −$257 | −$4,931 | 0.0 / 4.5 % |
| e9-doz-onewin-u5 | 15 | 0.00279 | 3.07 | $10.55 | 437 | 0.371 | 1.22 | 0.635 | 0.639 | 763 | $1,649 | $1,611 | 63.7 % | −$307 | −$4,516 | 36.1 / 0.0 % |
| e9-c9-onewin | 16 | 0.00356 | 4.47 | $14.52 | 339 | 0.329 | 1.21 | 0.671 | 0.676 | 870 | $1,574 | $1,543 | 67.3 % | −$282 | −$4,823 | 32.4 / 0.0 % |
| e9-fib5b2-W10 | 14 | 0.00082 | 2.77 | $2.43 | 2025 | 0.089 | 1.65 | 0.863 | 0.868 | 2358 | $428 | $50 | 98.3 % | −$32 | −$1,596 | 1.7 / 0.0 % |
| e9-fib5b2-W20 | 14 | 0.00082 | 2.77 | $2.43 | 2025 | 0.089 | 1.65 | 0.863 | 0.868 | 2358 | $428 | $100 | 96.7 % | −$64 | −$3,181 | 3.3 / 0.0 % |
| e9-fib5b2-W10-SLhalf | 14 | 0.00082 | 2.77 | $2.43 | 2025 | 0.089 | 1.65 | 0.863 | 0.868 | 2358 | $428 | $50 | 97.4 % | −$29 | −$1,531 | 0.0 / 0.0 % |
| e9-fib5b2-W20-SLhalf | 14 | 0.00082 | 2.77 | $2.43 | 2025 | 0.089 | 1.65 | 0.863 | 0.868 | 2358 | $428 | $100 | 94.9 % | −$57 | −$2,999 | 0.0 / 0.0 % |
| e9-fib5b2-W280-SLhalf | 14 | 0.00082 | 2.77 | $2.43 | 2025 | 0.089 | 1.65 | 0.863 | 0.868 | 2358 | $428 | $280 | 86.4 % | −$153 | −$2,999 | 0.0 / 0.0 % |
| e9-c9-cashout-ctrl | 16 | 0.00356 | 4.47 | $14.52 | 339 | 0.329 | 1.21 | 0.671 | 0.676 | 870 | $1,574 | $286 | 90.1 % | −$53 | −$3,213 | 0.0 / 0.0 % |

## 8. Open questions

- ~~**A trailing stop for widening ladders.**~~ Closed in §7.17: a1's half-ladder stop-loss never fires
  (the last level carries $2,592 of the $3,444 cap loss, §7.11), and the E7b analogue (drop that level,
  `onCap stop`) at W20 gives CVaR 5 % -$841, P(win) 72.4 %, median $230, mean -$38.08.
- **The stop is checked after the round, so it overshoots.** b3: stop $2,287, CVaR 5 % −$2,720. c9:
  stop $2,459.50, CVaR 5 % −$3,210, worst −$3,275. A pre-bet guard is untested. It would skip a
  level whose loss would cross the limit.
- **Resolved (not open): the c9 cash-out candidate's in-strategy stops.** The candidate file was run as
  is (rules override, seed 20261031, 10,000 sessions; commit 4939916). It reproduced e7-c9-W20-SLhalf
  exactly (median $286, mean −$46.25, P(win) 90.3 %, CVaR 5 % −$3,210, rej/adj 0). The American and
  250/1,000-spin axes ran as X1 (§7.17); seed 3 is in the ledger.
- **The runner should report the never-capped share and the cap count directly.** Today they are
  read from `endedBy` `strategy:cap-*` or from `onCap: stop` twins (§7.3, §7.14).
- **The aggregator's x for E4.** `meta.B` is in level-0 stakes, not cycle profits, so x is too large
  by m (§7.14). Fix the meta or the aggregator.
- **Put the exact run-length DP into `ladder.ts`.** The Poisson form misses long ladders (L 20–53,
  |z| > 2) that the DP closes (§7.14).
- **The reporting seed's b-family stream.** b1, b3 and d-b1 run at z −2.4 to −3.1 on 20261031
  (§7.8), and b3's reporting median ($1,679) sits below its three holdouts ($1,687–$1,698). Quote
  the holdout medians as the estimate.
- **Default-table versions.** All survivors need $1 minimums. The default-table references in D6
  (a9, b11, c6) had P(no cap) .001–.099 (§7.6). A $25-base survivor needs 25× the bankroll for the
  same B, and that has not been simulated.
- **Longer sessions and the cash-out on other axes.** No survivor keeps a positive median at 1,000
  spins without a cash-out. E8 ran only the no-stop survivors. The c9 cash-out (median session length
  86 spins) on the American wheel and at 250/1,000 spins is closed in §7.17 (~~no American, 250/1,000-spin row~~);
  b3 and a1 cash-outs have no American or length row.
- **Reproducibility.** `results/e8-seed3.json` has no spec of its own (it reruns e6-full ids on seed
  3). Three batch-one ledger rows (flat-red-cashout-500, fibonacci-red, fibonacci-red-cashout-500)
  carry an interpretation, not a pre-run prediction. The e1/e3/e7-mart rows predate the "CVaR5
  first" note rule; their CVaR values are in §7.2–7.4.

## 9. Candidates

Strategy documents under `scripts/research/candidates/`, ordered by how well they answer question 3.
500 spins, $5,000 bankroll, European wheel. Seeds: reporting 20261031 / holdout 1 / 2 / 3.

| candidate file | spec id | median | P(win) | mean | CVaR 5 % | bust |
| --- | --- | --- | --- | --- | --- | --- |
| `c9-streets-to12-stack-cashout.json` | e7-c9 `e7-c9-W20-SLhalf` (holdouts: `results/e7-c9-holdout.json`, seed 3: `results/e7-c9-seed3.json`) | $286 / $286 / $286 / $286 | 90.3 / 89.9 / 90.1 / 89.8 % | -$46.25 / -$60.12 / -$53.65 / -$60.90 | -$3,210 / -$3,214 / -$3,212 / -$3,209 | 0 / 0 / 0 / 0 |
| `c9-streets-to12-stack.json` | e6-full `c9-streets-to12-stack` (seed 3: `results/e8-seed3.json`) | $1,540 / $1,542 / $1,537 / $1,540 | 67.1 / 67.2 / 66.7 / 66.6 % | -$295.45 / -$297.28 / -$320.50 / -$326.25 | -$4,820 / -$4,827 / -$4,826 / -$4,819 | 0 / 0 / 0 / 0 |
| `b3-two-streets-l29.json` | e6-full `b3-two-streets-l29` (seed 3: `results/e8-seed3.json`) | $1,679 / $1,698 / $1,698 / $1,687 | 60.8 / 62.1 / 62.1 / 61.5 % | -$320.90 / -$246.96 / -$245.78 / -$285.86 | -$4,491 / -$4,487 / -$4,483 / -$4,490 | 0 / 0 / 0 / 0 |

- **What each is.** c9 cash-out is the direct answer to question 3: a median above break-even on
  90 % of sessions and the smallest mean loss and tail of the three. c9 without a stop has the best
  P(win) of the no-stop ladders. b3 has the highest median and a 29-level stacked ladder on two
  streets.
- **American wheel** (§7.13, no-stop versions only). c9: median $1,497, mean −$535.24, CVaR 5 %
  −$4,836, bust 0, P(win) 63.3 %. b3: $1,594, −$520.74, −$4,510, 0, 58.0 %. The c9 cash-out
  (X1, §7.17, `x1-c9-am`): median $286, mean −$100.32, CVaR 5 % −$3,220, bust 0, P(win) 88.7 %.
- **Session length** (§7.15, no-stop). At 250 spins: c9 $777 (mean −$156.42, CVaR 5 % −$4,820,
  bust 0) and b3 $862 (−$166.99, −$4,491, 0). At 1,000 spins both medians are negative: c9
  −$2,126.50 (−$472.93, −$4,820, 0) and b3 −$1,947 (−$474.46, −$4,491, 0). c9 cash-out sessions end
  at a median of about spin 86, so session length does not bind it (X1, §7.17): 250 and 1,000 spins
  reproduce the 500-spin row exactly (median $286, mean −$46.25, CVaR 5 % −$3,210, bust 0, P(win)
  90.3 %), and 1,000 spins on the American wheel the American row (median $286, mean −$100.32, CVaR 5 %
  −$3,220, bust 0, P(win) 88.7 %).
- **Table requirement.** Every candidate needs a $1 outside minimum and a $1 inside minimum total
  (rules override `limits.outside.min 100`, `limits.inside.minTotal 100`, in cents). The default
  table's $25 minimums break all three. The strategy document does not carry table limits, so set
  them on the run's table. Import a file by pasting it into the Define screen's JSON mode (the JSON
  tab, strategy.md §13). The `notes` field of each file repeats the setup and the ledger numbers.
