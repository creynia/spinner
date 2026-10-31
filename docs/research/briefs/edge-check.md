# Edge check: is the −3.20 % on e4-dozen-x2-u5 a bias or noise?

Serves plan.md §4 E1 (the edge oracle) and §5 ("treat any realized edge outside its interval as a
bug, not a result"). Tooling: `scripts/research/run.ts` now reports `edge.residual`, and
`aggregate.ts` shows it as the `edge z` column.

**Verdict: noise.** No experiment's pooled residual z leaves ±3 over ten fresh seeds, the
clamp-heavy reset ladders do not lean negative on those seeds, and all 57 committed rows have
|z| ≤ 2.36. The §4 mechanism hunt was therefore not triggered. A read of the harness accounting
(below) shows no path that could bias it. Nothing under `src/` needs to change.

## 1. The right statistic

The engine adds up, per session, `expectedLoss` = Σ over rounds of the analytic loss of the
layout actually placed after reconcile (`src/core/harness/session.ts`, `el` computed from
`plugin.layoutOf(state)` after the actions apply, before `playRound`). Clamped and reduced bets
are therefore charged at their placed amount, and a bust round (nothing affordable, nothing on
the table) is charged nothing and has net 0. `net` = final equity − bankroll. Each round's net has
conditional mean −el given the past, so r_i = net_i + EL_i has mean exactly 0 under any stopping
rule (stop-win, stop-loss, onCap stop, bust).

The test is z = mean(r) / (sd(r)/√N). The earlier test used sd(net). That has the right numerator
(Σnet + ΣEL), but sd(net) is 3–5 % smaller than sd(r) on these ladders, because EL is negatively
correlated with net: sessions that bust early wager less. That inflates |z| a little. It does not
explain −2.4 on its own: on seed 20261031 the corrected z is −2.36. One row at 2.4σ is an ordinary
draw among 57 rows.

## 2. Ten fresh seeds (101–110, 10,000 sessions × 500 spins each)

Pooled z = Σz/√10. Means, CVaR 5 % and bust are averages over the ten seeds.

| experiment | 101 | 102 | 103 | 104 | 105 | 106 | 107 | 108 | 109 | 110 | pooled z | edge (avg) | mean | CVaR5 | bust |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| e4-dozen-x2-u5 | 0.81 | −0.21 | −0.53 | 0.19 | 0.41 | −1.16 | −0.60 | 2.44 | 0.64 | 0.13 | **0.67** | −2.66 % | −$645 | −$5,000 | 45.9 % |
| e4-sixline-g | 1.16 | 0.91 | 1.10 | −0.23 | −1.00 | 0.58 | −0.09 | 0.16 | −0.39 | 0.80 | **0.95** | −2.64 % | −$753 | −$5,000 | 54.9 % |
| e4-dozen-g | 0.01 | −0.95 | 0.13 | −0.14 | 0.34 | −1.17 | −1.38 | 2.14 | −0.49 | 0.66 | **−0.27** | −2.72 % | −$913 | −$5,000 | 50.7 % |
| flat-red (control) | 1.28 | 1.19 | −0.83 | −1.59 | −0.82 | −0.44 | −0.67 | −1.41 | 0.24 | −1.89 | **−1.56** | −2.73 % | −$341 | −$1,490 | 0.0 % |

Analytic edge is −2.703 % throughout. The ladders' reconcile counts stay at the levels the
committed reports show. Per seed: e4-dozen-x2-u5 has rej ≈ 4,600 (all `unaffordable`, one per
bust) and adj ≈ 6,650. e4-sixline-g has rej ≈ 5,480 and adj ≈ 5,750. e4-dozen-g has rej ≈ 5,070
and adj ≈ 7,110. Their medians are −$2,560, −$4,993 and −$4,982, each next to its mean, CVaR and
bust above. The two dozen-1 ladders move together seed by seed (both +2 on seed 108) because they
bet the same pocket on the same spin stream. That is expected, and it is also why rows at one
seed are not independent evidence.

## 3. Committed reports, recomputed

Every committed report was re-run at its committed seed (20261031) and size. Each reproduced the
committed mean exactly, so the z values belong to the committed rows themselves. The exception is
e1-straights25, re-run at 2,000 sessions.

| file | rows: residual z |
| --- | --- |
| e1-spread | red −0.07, red12-dozen3-13 0.24, straights25 (2k) 1.20 |
| e3a-levels | L5 0.40, L6 1.06, L7 0.58, L8 0.59, L9 −0.85, L10 0.33, flat-red −0.07 |
| e3b-lengths | L8-S250 0.55, L8-S1000 0.29, L8-S2000 1.15, L10-S250 0.52, L10-S1000 0.56, L10-S2000 0.82 |
| e4-dozen | g −0.54, x2 −0.03, g-u5 −0.13, **x2-u5 −2.36**, g-stop −0.76, g-u5-stop −0.11 |
| e4-sixline | g −1.81, g-stop −0.73, x2 1.55 |
| e4-two-dozens | g −0.64, g-stop −0.31, x2 −0.72 |
| e7-mart | reset W5/10/20/50/100: 0.65, 0.57, 0.85, 1.70, 1.70; stop W5/10/20/50/100: 0.65, 0.57, 0.85, 1.70, 1.74; SLhalf reset/stop 1.13, 1.13 |
| e7b-mart-L7stop | W5 0.35, W10 0.21, W20 0.49, W50 1.63, W100 1.62, L8reset-W20 0.85 |
| observations | flat-red −0.07, cashout-500 −0.32, martingale-red 0.96, br10k 0.25, mart-cashout-500 0.85, unit5-L10 0.32, fibonacci-red 1.05, fib-cashout-500 0.15, two-dozens-x3 −1.22, martingale-dozen 0.28, martingale-straight 0.18 |

There are 57 rows, with max |z| 2.36 and one row beyond 2 (about 3 expected if the rows were
independent). The E7 "positive lean" and the E4 "negative lean" are each a block of rows that
share the seed-20261031 spin stream and mostly the same placement. The E7 reset/stop pairs are
even identical up to the cap. Each block is one draw, not twelve. On fresh seeds the E4 ladders
centre on zero (§2).

## 4. Rule going forward

Read `edge.residual.z` (the aggregator's `edge z`) instead of comparing realized with analytic
edge by eye. The runner appends `EDGE z=…` to its line when |z| > 3. A ratio such as −3.20 % vs
−2.70 % on a ladder whose sd(net) is ~$5,000 per session is within 2.4σ at N = 10,000.
