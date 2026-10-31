# Progressions, the typical session and the cash-out: the report

For the owner. This is the readable version of `plan.md` §7–§9; the same prose drives the in-app
Research section (`src/app/screens/Research/content.ts`). Every number below was re-read from
`docs/research/results/*.json`. Unless a table says otherwise: European wheel, $5,000 bankroll,
500 spins, 10,000 sessions, seed 20261031, $25 to $5,000 outside and $25 minimum total inside, $1
chips.

**Words used here.** *Typical session* = the median session (half end better, half worse).
*Average* = the mean over all sessions. *Worst 5 %* = the average result of the worst 5 % of
sessions. *Chance ahead* = the share of sessions that end above the starting bankroll. *Bust* = the
share that lose the whole bankroll. *Ladder lost* = the share that reach the bottom of their ladder
and stop there. Money is rounded to the dollar except averages, which keep their cents.

## Summary

1. **Q1, does the way you bet change what you lose on average?** No. Every dollar you bet costs 2.7 cents on average, no matter how you bet it: $25 a spin on red, on red plus a dozen, or on 25 single numbers lose −$338.21, −$336.64 and −$337.98 over 500 spins. Only the size of the swings differs.
2. Changing the stake from spin to spin changes how much you bet in total, and that sets the average loss in dollars: flat red bets $12,500 a session (average −$338.21), Fibonacci $30,397 (−$783.73), the c9 cash-out ladder $1,962 (−$46.25).
3. **Q2, why does doubling look good for a while, and only on red?** A doubling ladder's typical session stays ahead while fewer than half of sessions have lost the whole ladder: about 295 spins by formula for Martingale on red at $25, 290 measured. Then it falls fast.
4. Off even money, doubling is the wrong raise. Multiply by 36 ÷ (36 − numbers covered), ×1.5 on a dozen, and every placement lasts as long as the formula says. What sets that length is the bankroll counted in base stakes, not the placement.
5. **Q3, can widening or stacking plus a cash-out put the typical session ahead?** Yes, over 500 spins. c9 (one street widening to four, then stacked) with a $280 cash-out and a $2,459.50 stop-loss: typical session +$286, ahead in 90.3 / 89.9 / 90.1 / 89.8 % of sessions on four seeds.
6. The price is in the bad sessions: averages of −$46.25 to −$60.90 and a worst 5 % of about −$3,210 (flat red: −$1,480). The board shape barely matters and widening is slightly worse; bankroll size and the cash-out do the work.

**How the chapters run.** Even money first (chapters 1–3: why doubling on red looks good and when
it stops), then off even money with the right raise (4), then the layouts that are more fun to play,
towers of chips, shapes on the board and favourite numbers (5–6), always sized by the bankroll
counted in cycle profits and protected by a cash-out (7). Chapter 8 lists what breaks it, chapter 9
how to try it.

---

## 0. Start here (`start`)

**You cannot change what roulette costs you, but you can choose what a typical session looks like, and a cash-out is what locks it in.**

Three things hold for every strategy in this report. The edge never changes: every dollar you bet
costs 2.7 cents on average, no matter how you bet it. You can change the shape of your results: a
ladder that raises the bet after a loss turns most sessions into small wins and a few into big
losses. And a cash-out locks the typical session in: you stop the moment you are up a set amount.

The table puts $25 flat on red beside the c9 ladder with a cash-out, both from $5,000 for up to 500
spins. The typical session moves from −$350 to +$286. The worst sessions get worse.

| strategy | typical | chance ahead | average | worst 5 % | bust | bet in total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| $25 flat on red (`observations:flat-red`) | −$350 | 25.5 % | −$338.21 | −$1,480 | 0 % | $12,500 |
| c9 + $280 cash-out + $2,459.50 stop-loss (`e7-c9:e7-c9-W20-SLhalf`) | +$286 | 90.3 % | −$46.25 | −$3,210 | 0 % | $1,962 |

- The typical session moves from −$350 to +$286, and 90.3 % of sessions end ahead instead of 25.5 %.
- The average stays negative (−$46.25), because the edge does not move.
- The worst 5 % of sessions lose more: about −$3,210 against −$1,480 for flat red.

### The math

The expected value of a session is fixed by the wheel: −1/37 = −2.70 % of the total wagered on the
single-zero wheel. A strategy changes the expected turnover and the shape of the distribution of
net results, never the edge.

The median (the typical session) is the 50 % quantile of net. It can sit above zero while the mean
is negative when the distribution is skewed: many small wins, a few large losses. CVaR 5 % (the
worst 5 %) is the mean of the worst 5 % of sessions.

Flat red wagers $12,500: predicted mean −$337.84, measured −$338.21. The c9 cash-out wagers
$1,961.68 on average: predicted −$53.02, measured −$46.25 (realized edge −2.36 %, sampling noise;
the other three seeds give −$53.65 to −$60.90). Its median is $286 and its CVaR 5 % −$3,210.

```
EV(session) = −(1/37) × E[wagered] ≈ −0.0270 × E[wagered]
flat red: −0.0270 × $12,500 = −$337.84
c9 cash-out: −0.0270 × $1,961.68 = −$53.02
```

---

## 1. Every dollar costs the same (`edge`)

**Every dollar you bet costs 2.7 cents on average, no matter how you bet it: spreading $25 across the table only changes how far a session swings.**

Three players bet $25 a spin for 500 spins from $5,000. One puts it all on red, one puts $12 on red
and $13 on the third dozen, one puts $1 on each of 25 single numbers. On average all three lose the
same: −$338.21, −$336.64 and −$337.98, where the wheel predicts −$337.84.

What changes is how far a session swings. The typical swing shrinks from $557 to $490 to $375 as the
bet covers more numbers, and the worst 5 % of sessions improve from −$1,480 to −$1,129. Smaller
swings cut both ways: the chance of ending ahead falls from 25.5 % to 17.5 %.

| layout, $25 a spin (`e1-spread`) | typical | average | swing (SD) | worst 5 % | chance ahead | bust | edge |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| red $25 (`e1-red`) | −$350 | −$338.21 | $557 | −$1,480 | 25.5 % | 0 % | −2.71 % |
| red $12 + dozen 3 $13 (`e1-red12-dozen3-13`) | −$338 | −$336.64 | $490 | −$1,355 | 24.5 % | 0 % | −2.69 % |
| 25 straight-ups × $1 (`e1-straights25`) | −$332 | −$337.98 | $375 | −$1,129 | 17.5 % | 0 % | −2.70 % |

- Same average loss whatever the spread: about $338 per 500 spins at $25 a spin.
- Covering more numbers narrows the swings: the worst sessions are milder and the winning ones rarer.
- Spreading is a comfort choice, not an edge.

### The math

Covering c numbers with $1 wins with probability c/37 and returns 36/c dollars on a hit, so the
expectation per dollar is (c/37)(36/c) − 1 = −1/37 for every c. Spread changes only the variance per
dollar, 36²/(37c) − (36/37)²: 1.00 for red (c = 18) and 0.45 for 25 straight-ups.

Over n independent spins the session standard deviation is √n times the per-spin one. At $25 and
n = 500: red $559 predicted, $557 measured; red + dozen $493 predicted, $490 measured; 25
straight-ups $377 predicted, $375 measured. Realized edge −2.71 %, −2.69 %, −2.70 %. CVaR 5 %:
−$1,480, −$1,355, −$1,129. Medians: −$350, −$338, −$332.

```
EV per $1 = (c/37) × (36/c) − 1 = −1/37 ≈ −0.0270
mean(500 spins at $25) = −$12,500 / 37 = −$337.84
SD(session) = $25 × √500 × √(36²/(37c) − (36/37)²)
```

---

## 2. Why doubling feels like it works (`martingale`)

**Doubling after each loss keeps the typical session ahead for a few hundred spins, until one long losing streak empties the ladder and the typical session falls to a loss.**

Martingale on red starts at $25 and doubles after each loss, up to $3,200: eight bets. Every win
ends a cycle $25 up, and the ladder is lost only when red misses eight times running, about once in
207 cycles. So most sessions climb: the typical session is up $2,100 at spin 220.

Every session keeps facing that streak, though. Once more than half have hit it, the typical session
drops: +$475 at spin 290, −$2,400 at spin 300, −$5,000 at spin 500, with 51.2 % of sessions bust.
Fibonacci grows more slowly and is still ahead at spin 500 (+$1,675), yet its average is worse than
flat betting (−$783.73) because it bets $30,397 a session.

| on red, $25 base (`observations`) | typical at 500 | best typical (spin) | typical ahead until | chance ahead | average | worst 5 % | bust | bet in total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| flat (`flat-red`) | −$350 | $0 (0) | never | 25.5 % | −$338.21 | −$1,480 | 0 % | $12,500 |
| Martingale (`martingale-red`) | −$5,000 | $2,100 (220) | 290 | 32.4 % | −$898.24 | −$5,000 | 51.2 % | $35,056 |
| Fibonacci (`fibonacci-red`) | +$1,675 | $1,675 (500) | 500 (the end) | 57.2 % | −$783.73 | −$5,000 | 39.1 % | $30,397 |

Martingale's typical session along the way: +$1,100 at spin 100, +$2,000 at 200, +$2,100 at 220,
+$1,775 at 280, +$475 at 290, −$2,400 at 300, −$5,000 at 500 (paths in `observations.json`).

- The rising typical session is real, and it has a deadline: about 290 spins for Martingale on red at $25.
- The fall is sudden because a losing session loses the whole ladder at once.
- A strategy that bets more loses more on average: Fibonacci bets 2.4 times what flat betting does.

### The math

A recovery ladder plays in cycles. With a per-spin win probability p and L levels, a cycle caps
with probability q = (1 − p)^L. Wins arrive at rate p per spin, so after n spins the chance of no
cap is about e^(−q·p·n). The median path is above zero while that exceeds ½, which gives the median
horizon n½ = ln 2 / (q·p).

Martingale on red: p = 18/37 = 0.486, L = 8, q = (19/37)^8 = 0.0048, n½ ≈ 295 spins. Measured: the
median is above zero through spin 290 (the path is sampled every 10 spins) and peaks at $2,100 at
spin 220. Mean −$898.24 against an EV of −0.027 × $35,056 = −$947 (realized edge −2.56 %); CVaR 5 %
−$5,000. Fibonacci: median $1,675, mean −$783.73, bust 39.1 %. The skew is the trade: median and
mean point in opposite directions.

```
q = (1 − p)^L = (19/37)^8 = 0.0048
P(no cap by spin n) ≈ e^(−q·p·n)
n½ = ln 2 / (q·p) = 0.693 / (0.0048 × 0.486) ≈ 295
```

---

## 3. Levels, not luck (`levels`)

**To keep a doubling ladder ahead for longer, give it more steps with a smaller base stake; a bigger bankroll on the same steps does not keep it ahead any longer.**

Each extra step makes losing the whole ladder about half as likely, so it roughly doubles how long
the typical session stays ahead. With a $5 base and a bankroll of exactly one ladder, 5 steps hold
to spin 39, 6 to 70, 7 to 150 and 8 to 290; 9 and 10 steps last past spin 500. Ten steps at $5 from
$5,000 end with a typical session of +$1,185.

Doubling the bankroll to $10,000 with the same 8 steps at $25 leaves the turn at spin 290. The extra
money lets sessions survive one lost ladder, but the worst 5 % now lose $10,000 and the average gets
worse.

| Martingale on red | base | steps | bankroll | predicted horizon | typical ahead until | typical at 500 | average | worst 5 % | bust |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `e3a-levels:e3a-L5` | $5 | 5 | $155 | 40 | 39 | −$155 | −$63.25 | −$155 | 82.1 % |
| `e3a-levels:e3a-L6` | $5 | 6 | $315 | 78 | 70 | −$315 | −$99.34 | −$315 | 71.6 % |
| `e3a-levels:e3a-L7` | $5 | 7 | $635 | 151 | 150 | −$635 | −$151.37 | −$635 | 58.1 % |
| `e3a-levels:e3a-L8` | $5 | 8 | $1,275 | 295 | 290 | −$180 | −$209.14 | −$1,275 | 42.2 % |
| `e3a-levels:e3a-L9` | $5 | 9 | $2,555 | 574 | 500 (the end) | +$1,130 | −$290.70 | −$2,555 | 25.9 % |
| `e3a-levels:e3a-L10` | $5 | 10 | $5,115 | 1,117 | 500 (the end) | +$1,185 | −$327.56 | −$5,115 | 14.4 % |
| `observations:martingale-red-unit5-L10` | $5 | 10 | $5,000 | 1,117 | 500 (the end) | +$1,185 | −$324.32 | −$5,000 | 15.6 % |
| `observations:martingale-red` | $25 | 8 | $5,000 | 295 | 290 | −$5,000 | −$898.24 | −$5,000 | 51.2 % |
| `observations:martingale-red-br10k` | $25 | 8 | $10,000 | 295 | 290 | −$375 | −$1,265.78 | −$10,000 | 22.2 % |

- Count your bankroll in base stakes: that number, not the dollars, sets how long the typical session stays ahead.
- A smaller base stake under the same table maximum buys more steps.
- The average loss grows with every step: −$63.25 at 5 steps, −$327.56 at 10.

### The math

Each level multiplies q by 1 − p = 19/37 ≈ 0.51, so n½ = ln 2 / (q·p) roughly doubles per level.
With a $5 unit and bankroll 2^L − 1 units: L5 q 0.0357, n½ 40; L6 0.0183, 78; L7 0.0094, 151; L8
0.0048, 295; L9 0.0025, 574; L10 0.0013, 1,117. Measured medianAheadUntil: 39, 70, 150, 290, 500 and
500 (censored at the session end), each inside its 10-spin checkpoint.

The bankroll enters only through L, the number of levels that fit under the table maximum and the
bankroll. A $10,000 bankroll at $25 still fits 8 doublings under the $5,000 maximum bet, so q and n½
are unchanged (measured 290), while a bust costs twice as much: median −$375, mean −$1,265.78, CVaR
5 % −$10,000, bust 22.2 %. Mean loss grows with L because turnover does: −$63.25 (L5) to −$327.56
(L10).

```
q = (19/37)^L
n½ = ln 2 / (q × 18/37)
L = largest integer with u × (2^L − 1) ≤ bankroll and u × 2^(L−1) ≤ table max
```

---

## 4. Beyond red: grow at the right rate (`placement`)

**Off even money, doubling is the wrong raise: multiply each bet by 36 ÷ (36 − numbers covered), which is ×1.5 on a dozen, and the ladder lasts as long as the formula says.**

“Only even money works” is about the size of the raise, not the numbers. A dozen pays 2 to 1, so
doubling after a loss wins back more than needed and uses up the ladder in 7 bets: the typical
session is ahead only until spin 70. Raising by half instead (×1.5) fits 11 bets and holds until
spin 150, as the formula predicts. Two dozens, six-lines, corners and runs of single numbers behave
the same way.

But at $25 a spin from $5,000 no placement stays ahead to spin 500. A $5 base on a dozen (15 bets)
does: typical +$1,611, average −$345.44, 16.4 % bust.

Base about $25, $5,000 bankroll. "Ahead until" for the right raise is from the version that stops
when the ladder is lost (`-g-stop`), the clean measurement; typical, average, worst 5 % and bust are
from the version that keeps playing (`-g`).

| placement (numbers) | right raise | predicted horizon | right raise: ahead until | typical at 500 | average | worst 5 % | bust | doubling: ahead until | typical at 500 | average | worst 5 % | bust |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dozen (12), `e4-dozen` | ×1.5 | 159 | 150 | −$4,984 | −$930.41 | −$5,000 | 51.2 % | 70 | −$5,000 | −$1,151.10 | −$5,000 | 72.4 % |
| dozen, $5 base (`-g-u5`, `-x2-u5`) | ×1.5 | 765 | 500 (the end) | +$1,611 | −$345.44 | −$5,000 | 16.4 % | 70 | −$2,948 | −$771.88 | −$5,000 | 47.0 % |
| two dozens (24), `e4-two-dozens` | ×3 | 200 | 200 | −$1,569 | −$1,069.53 | −$5,000 | 34.1 % | 220 * | −$182 | −$698.00 | −$5,000 | 5.1 % |
| six-line (6), `e4-sixline` | ×1.2 | 147 | 140 | −$4,994 | −$864.64 | −$5,000 | 55.9 % | 9 | −$5,000 | −$843.96 | −$5,000 | 87.1 % |
| corner (4), `e4-corner` | ×1.125 | 141 | 130 | −$4,989 | −$764.17 | −$5,000 | 56.5 % | never | −$5,000 | −$905.93 | −$5,000 | 90.9 % |
| 25 straight-ups, `e4-straights25` | ×36/11 | 286 | 280 | −$635 | −$1,106.61 | −$5,000 | 47.9 % | 130 * | −$272 | −$617.89 | −$4,397 | 2.4 % |
| 35 straight-ups, `e4-straights35` | ×36 | 251 | 240 | −$824 | −$1,322.75 | −$4,940 | 4.3 % | 12 * | −$480 | −$500.82 | −$966 | 0 % |

\* Doubling never wins back the losses on these layouts, so the typical session drifts down instead
of collapsing.

- Use the right raise for the bet: ×2 for 18 numbers, ×1.5 for 12, ×3 for 24, ×1.2 for 6.
- With the right raise every placement reaches its predicted horizon; with doubling, the dozen, six-line and corner collapse within 70 spins.
- Even with the right raise, base stakes decide: the dozen needed a $5 base to stay ahead for 500 spins.

### The math

A layout covering c numbers pays m = (36 − c)/c. To recover the deficit D plus the level-0 profit τ,
the next stake s must satisfy s·m ≥ D + τ. Each lost stake adds to D, so s(k+1) = s(k)·(1 + 1/m) =
g·s(k) with g = 36/(36 − c). The table and the bankroll set the levels: L ≈ ln(max/min) / ln g.

Dozen (c = 12, p = 0.324): doubling fits L = 7, q = (25/37)^7 = 0.0643, n½ = 33; measured median
ahead until 70 (a flat, noisy crossing). g = 1.5 fits L = 11, q = 0.0134, n½ = 159; the onCap-stop
twin is ahead until 150. At equal bankroll the horizon ranks by B/(m·p), so wider coverage holds
longer: predicted n½ 286 (25 straight-ups), 200 (two dozens), 159 (dozen), 147 (six-line), 141
(corner); measured 280, 200, 150, 140, 130. The $5-base dozen: L = 15, q = 0.0028, n½ = 765, median
$1,611, mean −$345.44, CVaR 5 % −$5,000.

```
g = 36 / (36 − c)
s(k+1) = g × s(k)
q = (1 − c/37)^L
n½ = ln 2 / (q × c/37)
```

---

## 5. One curve rules them all (`curve`)

**Your chance of finishing a session without losing the ladder depends on how many cycle profits your bankroll can absorb, not on which numbers you cover.**

We put 53 ladders on one chart: Martingale on red, right-raise ladders on dozens, six-lines, corners
and single numbers, and the widening and stacking ladders of the next chapter. Across: how many
winning cycles a session plays, divided by how many cycle profits the bankroll can pay back. Up: the
share of sessions that never lost the ladder.

Every ladder sits on or under one ceiling curve, and none beats it. Ladders with the same bankroll
counted in profits tie, whatever the board. Where layout matters at all the effect is small, and
covering more numbers or widening is slightly worse: the best layout beats red-style ladders by 3.3
points.

x and k are from `briefs/E5.md`; the shares, typical, average, worst 5 % and bust are from the
results files (three-seed rows are the average of seeds 20261031, 1 and 2, with the ladder-lost
counts pooled).

| ladder (row) | x | k | never lost the ladder | ceiling e^(−x) | typical | average | worst 5 % | bust |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Martingale red, $5, 9 steps (`e3a-levels:e3a-L9`) | 0.48 | 1.27 | 0.548 † | 0.621 | +$1,130 | −$290.70 | −$2,555 | 25.9 % |
| dozen ×1.5, $5 base (`e4-dozen:e4-dozen-g-u5-stop`) | 0.37 | 1.22 | 0.638 | 0.690 | +$1,611 | −$311.20 | −$4,515 | 0 % |
| b1, one street stacked (`e6-full`, 3 seeds) | 0.41 | 1.14 | 0.640 | 0.666 | +$1,693 | −$241.82 | −$4,809 | 0 % |
| b3, two streets stacked (`e6-full`, 3 seeds) | 0.41 | 1.17 | 0.622 | 0.662 | +$1,692 | −$271.21 | −$4,487 | 0 % |
| b3, two streets (`e6-stack-screen`, 2,000) | 0.41 | 1.17 | 0.635 | 0.662 | +$1,708 | −$199.30 | −$4,481 | 0 % |
| b4, one six-line, same bankroll in profits (`e6-stack-screen`, 2,000) | 0.41 | 1.17 | 0.615 | 0.662 | +$1,545 | −$282.69 | −$4,139 | 0 % |
| c9, streets to 12 then stacked (`e6-full`, 3 seeds) | 0.33 | 1.21 | 0.672 | 0.720 | +$1,540 | −$304.41 | −$4,825 | 0 % |
| a1, widening to 27 numbers (`e6-full`, 3 seeds) | 0.47 | 1.28 | 0.551 | 0.624 | +$1,496 | −$334.38 | −$3,381 | 0 % |
| a7, widening to 33 numbers (`e6-widen-screen`, 2,000) | 0.79 | 1.58 | 0.276 | 0.455 | −$1,464 | −$718.43 | −$2,543 | 0 % |
| 35 straight-ups ×36 (`e4-straights35:e4-straights35-g-stop`) | 0.37 | 3.79 | 0.248 | 0.694 | −$1,060 | −$719.48 | −$1,287 | 0 % |

† From a 2,000-session stop twin run for the E5 brief (not a committed results file); the reset row
itself has no ladder-lost count because it keeps playing.

- No arrangement of numbers beats the ceiling: the shape of the bet is not the lever.
- The lever is bankroll counted in cycle profits: a smaller base stake or a bigger committed bankroll.
- Narrow stacks sit closest to the ceiling; wide coverage and widening sit lower.

### The math

Let B be the cap loss divided by the mean cycle profit τ̄ (bankroll in cycle profits) and x = p·S/B,
the expected cycles in S spins per unit of B. H3 says P(no cap) ≈ e^(−x). The sharper form is
P(no cap) = e^(−k·x) with k = q·B/(1 − q) = 1 + 0.027 × (turnover per cycle) / (τ̄(1 − q)) ≥ 1, so
e^(−x) is a ceiling.

Over 53 ladders the mean residual against e^(−x) is −6.0 points and none is above it; e^(−k·x)
predicts to 0.8 points RMS. k runs from 1.14 (one street stacked) through 1.27 (Martingale red) and
1.37 (two dozens) to 1.58 (widening to 33 numbers) and 3.79 (35 straight-ups). The median horizon is
S½ = ln 2 × B / (k·p), and the median is positive exactly when e^(−k·x) > ½, which held on all 65
recovering rows. Every positive median sits beside a negative mean.

```
x = p × S / B
P(no cap) = e^(−k·x) ≤ e^(−x),  k = q·B / (1 − q) ≥ 1
c9: x = 0.223 × 500 / 338.8 = 0.33, k = 1.21, e^(−0.40) = 0.672 (measured 0.672)
```

---

## 6. Towers, shapes and favourite numbers (`shapes`)

**If you would rather play shapes, towers or favourite numbers, stack chips on a few streets and size the ladder to your bankroll: that stays ahead for 500 spins as well as anything we tested.**

Three ladders passed every test. a1 widens: $1 on street 1-2-3, then one more street after each
loss, up to nine streets (27 numbers) at $288 each. b3 stacks: two streets, 1-2-3 and 16-17-18,
with a tower growing from $2 to $383 on each over 29 steps. c9 does both: one street, then two,
three and four (1 to 12), then stacks those four from $3 to $411 each over 16 steps.

All three start from $5,000, need $1 table minimums and stop when the ladder is lost. Over four
seeds the typical session ends up about $1,500 to $1,700, the average is always negative, and a
third to nearly half of sessions lose the ladder.

Seeds 20261031 / 1 / 2 / 3 (`e6-full` for the first three, `e8-seed3` for seed 3).

| ladder | board | steps | typical | chance ahead | average | worst 5 % | ladder lost | bust |
| --- | --- | ---: | --- | --- | --- | --- | --- | ---: |
| b3 (`b3-two-streets-l29`) | streets 1-2-3 and 16-17-18, stacked $2 → $383 each | 29 | $1,679 / $1,698 / $1,698 / $1,687 | 60.8 / 62.1 / 62.1 / 61.5 % | −$320.90 / −$246.96 / −$245.78 / −$285.86 | −$4,491 / −$4,487 / −$4,483 / −$4,490 | 38.7 / 37.4 / 37.3 / 37.9 % | 0 |
| c9 (`c9-streets-to12-stack`) | 1 → 4 streets (1–12), then stacked $3 → $411 each | 16 | $1,540 / $1,542 / $1,537 / $1,540 | 67.1 / 67.2 / 66.7 / 66.6 % | −$295.45 / −$297.28 / −$320.50 / −$326.25 | −$4,820 / −$4,827 / −$4,826 / −$4,819 | 32.7 / 32.6 / 33.0 / 33.2 % | 0 |
| a1 (`a1-streets-w27`) | 1 → 9 streets (3 → 27 numbers), $1 → $288 each | 9 | $1,494 / $1,497 / $1,498 / $1,491.50 | 55.1 / 54.6 / 55.3 / 54.7 % | −$330.93 / −$348.13 / −$324.08 / −$351.14 | −$3,380 / −$3,377 / −$3,385 / −$3,381 | 44.9 / 45.3 / 44.6 / 45.2 % | 0 |
| flat red (`flat-red`) | $25 on red | — | −$350 / −$350 / −$350 / −$350 | 25.5 / 26.2 / 25.7 / 24.8 % | −$338.21 / −$336.44 / −$336.37 / −$344.60 | −$1,480 / −$1,506 / −$1,483 / −$1,496 | — | 0 |

- Stacking a narrow shape works as well as anything tested: b3’s typical session is +$1,679 to +$1,698.
- Widening across the board is the weakest of the three: a1 ends ahead least often (54.6 % to 55.3 %), though its worst 5 % is the mildest.
- A lost ladder costs $3,444 (a1), $4,574 (b3) or $4,919 (c9) in one go.

### The math

The deficit recursion generalises to mixed layouts: after a loss at level k with deficit D(k), the
stake at the next level must make the smallest-paying covered bet return at least D(k) + τ. A street
pays 11 to 1, so with n streets at $a a hit nets 12a − n·a − D. a1 level 3: D = $11, four streets
need 8a − 11 ≥ 11, so a = $3.

Widening raises the per-spin win chance (27 numbers at the top: p = 0.730) but puts most of the risk
on the last level: $2,592 of a1’s $3,444 cap loss. Survivor parameters (q, B in cycle profits, k):
b3 0.00591, 196.7, 1.17; c9 0.00356, 338.8, 1.21; a1 0.00494, 258.1, 1.28. Predicted P(no cap at
500) = e^(−k·x): 0.617, 0.672, 0.547; measured over three seeds 0.622, 0.672, 0.551. Medians across
four seeds move by at most $19 (b3), $5 (c9) and $6.50 (a1); every mean is negative.

```
n streets at $a: 12a − n·a − D(k) ≥ τ
P(no cap) = e^(−k·p·S/B)
b3: e^(−1.17 × 0.162 × 500 / 196.7) ≈ 0.617
```

---

## 7. Cash out: the stop that moves the typical session (`cashout`)

**Decide before you sit down how much profit you will walk away with: a modest target is reached most of the time, and a stop-loss at half the ladder limits the damage when it is not.**

A cash-out ends the session the moment you are up the target, so the typical session is the target,
a few dollars over. The lower the target, the more often you reach it before losing the ladder: c9
reaches $70 in 98.2 % of sessions, $280 in 93.2 % and $1,400 in 70.4 %.

A stop-loss at half the ladder ($2,459.50) costs three points of that chance (90.3 %) but cuts the
worst 5 % from −$4,820 to −$3,210. Its sibling c8 with a $200 target and no stop-loss gets there more
often (94.5 %) but keeps a worst 5 % of −$4,515. On Martingale red a half-ladder stop-loss never
fires; stopping after seven losses does.

| strategy (row) | target | typical | chance ahead (predicted) | average | worst 5 % | bust |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c9, 5 cycle profits (`e7-c9:e7-c9-W5`) | $70 | $77 | 98.2 % (98.2) | −$11.38 | −$1,705 | 0 % |
| c9, 10 (`e7-c9-W10`) | $140 | $146 | 96.5 % (96.5) | −$27.46 | −$3,344 | 0 % |
| c9, 20 (`e7-c9-W20`) | $280 | $286 | 93.2 % (93.1) | −$56.21 | −$4,820 | 0 % |
| c9, 50 (`e7-c9-W50`) | $700 | $705 | 83.9 % (83.7) | −$142.92 | −$4,820 | 0 % |
| c9, 100 (`e7-c9-W100`) | $1,400 | $1,404 | 70.4 % (70.0) | −$268.52 | −$4,820 | 0 % |
| c9, no target (`e7-c9-nostop`) | — | $1,540 | 67.1 % | −$295.45 | −$4,820 | 0 % |
| **c9, 20 + stop-loss $2,459.50** (`e7-c9-W20-SLhalf`) | $280 | $286 | 90.3 % | −$46.25 | −$3,210 | 0 % |
| c8, $200, no stop-loss (`e6-full:d-c8-stopwin20`, seeds 20261031 / 1 / 2) | $200 | $200 / $200 / $200 | 94.5 / 94.8 / 94.5 % | −$61.11 / −$42.20 / −$57.50 | −$4,515 / −$4,506 / −$4,517 | 0 % |
| Martingale red, $500 (`e7-mart:e7m-reset-W20`) | $500 | $500 | 88.8 % (90.8) | −$113.80 | −$5,000 | 11.2 % |
| Martingale red, $500 + stop-loss $3,187.50 (`e7m-reset-W20-SLhalf`) | $500 | $500 | 88.4 % | −$104.97 | −$5,000 | 0 % ‡ |
| Martingale red, $500, stop after 7 losses (`e7b-mart-L7stop:e7b-L7stop-W20`) | $500 | $500 | 83.0 % (82.8) | −$87.03 | −$3,119 | 0 % |

‡ 11.6 % of sessions end at the stop-loss, which only triggers at the last bet, so they lose the
whole $5,000 anyway.

- The typical session equals your target as long as more than half of sessions reach it.
- Higher targets are reached less often, and the average loss grows with the time you play.
- Pair the cash-out with a stop-loss sized to the ladder, not to the bankroll.

### The math

With a stop-win of W cycle profits a session ends ahead if it collects W cycles before a cap:
P(win) ≈ (1 − q)^W ≈ e^(−q·W). c9, q = 0.00356: W = 5, 10, 20, 50, 100 predicts 0.982, 0.965, 0.931,
0.837, 0.700; measured 0.982, 0.965, 0.932, 0.839, 0.704. The median equals the target while
P(win) > ½, that is while q·W < ln 2. The mean stays at −2.70 % of a smaller turnover: c9 at W20
wagers $2,157, mean −$56.21.

The half-ladder stop-loss is checked after the round, so it overshoots by one level: CVaR 5 %
−$3,210, worst session −$3,275. Martingale red at W20: e^(−q·W) predicts 0.908, measured 0.888,
because after seven losses (−$3,175) the eighth $3,200 bet does not fit the remaining $1,825 and is
cut. A 7-loss stop (maxSteps 7, onCap stop): q = (19/37)^7 = 0.0094, (1 − q)^20 = 0.828, measured
0.830, CVaR 5 % −$3,119, bust 0.

```
P(win) ≈ (1 − q)^W
c9 at W = 20: (1 − 0.00356)^20 = 0.931
median = target while q·W < ln 2
```

---

## 8. What breaks it (`limits`)

**The gain survives other seeds and a bigger bankroll, but long sessions, $25 table minimums and, for wide layouts, the double-zero wheel break the ladders; only the cash-out version shrugs off length and the wheel.**

We re-ran the survivors under each change. Other seeds moved the typical session by at most $19. A
$10,000 bankroll and the la partage rule changed nothing. The American wheel’s extra zero costs 3 to
8 points of chance of ending ahead; b3 and c9 stay ahead, the widening a1 drops to −$1,978. At 1,000
spins every ladder without a cash-out ends negative.

The c9 cash-out shrugs most of this off: every session stops by spin 250, so length does not touch
it, and on the American wheel it keeps +$286 and 88.7 %. At $25 table minimums nothing works:
comparable ladders lost the ladder in 90 % to 100 % of sessions. Every average is negative.

| change (results file) | ladder | typical | chance ahead | average | worst 5 % | bust |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| none: European, 500 spins (`e6-full`, seed 20261031) | b3 / c9 / a1 / flat red | $1,679 / $1,540 / $1,494 / −$350 | 60.8 / 67.1 / 55.1 / 25.5 % | −$320.90 / −$295.45 / −$330.93 / −$338.21 | −$4,491 / −$4,820 / −$3,380 / −$1,480 | 0 % |
| American wheel (`e8-american`) | b3 / c9 / a1 / flat red | $1,594 / $1,497 / **−$1,978** / −$650 | 58.0 / 63.3 / 47.3 / 11.4 % | −$520.74 / −$535.24 / −$699.61 / −$653.14 | −$4,510 / −$4,836 / −$3,397 / −$1,794 | 0 % |
| 250 spins (`e8-length`) | b3 / c9 / a1 / flat red | $862 / $777 / $775 / −$150 | 77.5 / 81.8 / 74.1 / 30.5 % | −$166.99 / −$156.42 / −$190.84 / −$170.85 | −$4,491 / −$4,820 / −$3,380 / −$966 | 0 % |
| 1,000 spins (`e8-length`) | b3 / c9 / a1 / flat red | −$1,947 / −$2,126.50 / −$1,568 / −$650 | 37.5 / 45.2 / 29.5 / 18.2 % | −$474.46 / −$472.93 / −$538.08 / −$675.80 | −$4,491 / −$4,820 / −$3,380 / −$2,324 | 0 % |
| la partage (`e8-partage`) | flat red (the ladders: identical to "none") | −$175 | 37.1 % | −$169.82 | −$1,302 | 0 % |
| $10,000 bankroll (`e8-br10k`) | all four | identical to "none" | | | | 0 % |
| c9 cash-out, European, 500 spins (`e7-c9:e7-c9-W20-SLhalf`) | c9 + $280 / $2,459.50 | $286 | 90.3 % | −$46.25 | −$3,210 | 0 % |
| c9 cash-out, American (`x1-c9-cashout-axes:x1-c9-am`) | c9 + $280 / $2,459.50 | $286 | 88.7 % | −$100.32 | −$3,220 | 0 % |
| c9 cash-out, 250 or 1,000 spins (`x1-c9-S250`, `x1-c9-S1000`; American 1,000: `x1-c9-am-S1000`) | c9 + $280 / $2,459.50 | identical to the 500-spin rows above, to the cent | | | | 0 % |
| a1 + $226 cash-out, 9 steps (`x1-a1-trailing:x1-a1-W20-ctrl`) | a1 | $232 | 91.7 % | −$63.55 | −$3,380 | 0 % |
| a1 + $226 cash-out, last step dropped (`x1-a1-L8-W20`) | a1, 8 steps | $230 | 72.4 % | −$38.08 | −$841 | 0 % |
| a1, last step dropped, no cash-out (`x1-a1-L8-nostop`) | a1, 8 steps | −$360 | 30.6 % | −$124.31 | −$841 | 0 % |
| $25 minimums, default table (`e6-*-screen`, 2,000 sessions) | a9 / b11 / c6 | −$1,292.50 / −$1,350 / −$825 | 31.9 / 30.9 / 29.3 % | −$421.66 / −$470.16 / −$354.73 | −$2,947 / −$3,124.50 / −$1,951 | 0 % |

On the $25-minimum table the three reference ladders (a9 widening a dozen with streets, b11 red
with 7 steps, c6 a dozen to two dozens) lost the ladder in 99.8 %, 90.3 % and 100 % of sessions.

- Plan the length: without a cash-out these ladders are built for about 500 spins.
- Play on $1 minimums and a single-zero wheel; the double zero hurts wide layouts most.
- Widening needs a shorter ladder, not a stop-loss: dropping a1’s last level with a $226 cash-out cuts the worst 5 % from −$3,380 to −$841, for 19 points of chance (91.7 % → 72.4 %).

### The math

American wheel: p(k) = c(k)/38 and the edge is 2/38 = 5.26 %; realized −5.43 % (b3), −4.91 % (c9),
−5.47 % (a1), −5.23 % (flat red). q grows by Π (1 − c(k)/38) / (1 − c(k)/37) over the levels: b3
0.00591 → 0.00685, predicted P(no cap) 0.58, measured 0.585; a1 predicted 0.49, measured 0.473, below
½, so its median flips. The c9 cash-out: q_SL 0.00510 × 1.181 = 0.00602, (1 − q)^20 = 0.886,
measured 0.887; mean −$100.32 (−4.75 % of $2,113).

Length: P(no cap at S) = e^(−k·p·S/B) falls below ½ at S½ = ln 2 × B/(k·p); at 1,000 spins the
medians stay ahead until 690, 860, 570 (b3, c9, a1) against n½ 723, 874, 577. La partage halves the
edge on even money only: flat red −1.36 %, mean −$169.82. With onCap stop the cap loss ($3,444 to
$4,919) stays under $5,000, so extra bankroll is never used. Default table ($25 minimums): a9, b11,
c6 kept 0.3 %, 9.8 % and 0 % of 2,000 sessions uncapped.

```
edge (American) = −2/38 = −5.26 %
q(American) = q × Π (1 − c(k)/38) / (1 − c(k)/37)
S½ = ln 2 × B / (k·p)
```

---

## 9. Try it (`try`)

**Pick one of the three candidates, play it on a $1-minimum table from $5,000 for up to 500 spins, and judge it by the typical session, the average and the worst 5 % together.**

The candidates are saved strategy files. For now: open Define, switch to its JSON mode and paste the
file, then set the table’s outside minimum and inside minimum total to $1, because a strategy file
cannot carry table limits. Use a $5,000 bankroll and 500 spins. The Research screen will offer a
one-tap Open in Define that does all of this for you.

After the run, read Analyze: the typical session, the chance of ending ahead, the average and the
worst 5 % of sessions. Expect the average to be negative; that is the wheel, not a bug. Play only
with money you can afford to lose.

Seeds 20261031 / 1 / 2 / 3; European wheel, $5,000, 500 spins (plan.md §9).

| candidate file (`scripts/research/candidates/`) | typical | chance ahead | average | worst 5 % | bust |
| --- | --- | --- | --- | --- | --- |
| `c9-streets-to12-stack-cashout.json` (`e7-c9-W20-SLhalf`) | $286 / $286 / $286 / $286 | 90.3 / 89.9 / 90.1 / 89.8 % | −$46.25 / −$60.12 / −$53.65 / −$60.90 | −$3,210 / −$3,214 / −$3,212 / −$3,209 | 0 / 0 / 0 / 0 |
| `c9-streets-to12-stack.json` (`c9-streets-to12-stack`) | $1,540 / $1,542 / $1,537 / $1,540 | 67.1 / 67.2 / 66.7 / 66.6 % | −$295.45 / −$297.28 / −$320.50 / −$326.25 | −$4,820 / −$4,827 / −$4,826 / −$4,819 | 0 / 0 / 0 / 0 |
| `b3-two-streets-l29.json` (`b3-two-streets-l29`) | $1,679 / $1,698 / $1,698 / $1,687 | 60.8 / 62.1 / 62.1 / 61.5 % | −$320.90 / −$246.96 / −$245.78 / −$285.86 | −$4,491 / −$4,487 / −$4,483 / −$4,490 | 0 / 0 / 0 / 0 |

On the American wheel the c9 cash-out keeps a typical $286, 88.7 % ahead, average −$100.32, worst
5 % −$3,220, bust 0 (`x1-c9-cashout-axes:x1-c9-am`).

- Start with c9 with cash-out: it ends ahead about 90 % of the time, with the smallest average loss and the mildest worst 5 % of the three.
- Size your own ladder with the calculator before you play it.
- Every dollar you bet costs 2.7 cents on average, no matter how you bet it.

### The math

The calculator uses the formulas of chapters 2 to 7. Inputs: coverage c, growth g (default
36/(36 − c)), base stake u, chip unit, table maximum, bankroll and session length S. Outputs: levels
L, cap probability q = (1 − c/37)^L, the bankroll a full ladder consumes in level-0 stakes
B = Σ g^k for k < L, the horizon n½ = ln 2 / (q·p), the never-capped share e^(−q·p·S), and with a
cash-out of W cycle profits P(win) ≈ (1 − q)^W.

Pinned case: Martingale on red with 8 levels gives q = 0.0048 and n½ = 295. Check against the c9
cash-out: q = 0.00356 and W = 20 give 0.931 without the stop-loss (measured 93.2 %); the half-ladder
stop-loss lowers it to 90.3 %, 89.9 %, 90.1 % and 89.8 % on four seeds, with means −$46.25, −$60.12,
−$53.65, −$60.90 and CVaR 5 % −$3,210, −$3,214, −$3,212, −$3,209.

```
L = levels that fit the table maximum and the bankroll
B = Σ g^k (k = 0 … L − 1)
n½ = ln 2 / (q·p);  P(win) ≈ (1 − q)^W
```

---

## What you can and cannot expect

- **The cost is fixed.** Every dollar you bet costs 2.7 cents on average, no matter how you bet it
  (−2.70 % of turnover; −5.26 % on the American wheel; −1.36 % on flat red under la partage, the only
  case where the bet type changes the edge). The engine checked this on every run.
- **You choose the shape, not the cost.** A ladder or a cash-out moves the typical session and the
  chance of ending ahead. The typical session is bought with the bad sessions: the c9 cash-out's
  +$286 comes with a worst 5 % of −$3,210, where flat red's is −$1,480.
- **Betting less loses less.** The average loss in dollars is 2.7 % of what you bet in total, so a
  cash-out that ends sessions early (c9: about 85 spins) shrinks it: −$46.25 against −$338.21 for
  500 spins of flat red. It never turns it positive.
- **Every row's average is negative.** All of them, in every chapter and every results file. If a
  run in the app shows a positive average, it is luck over too few sessions; run more.
- **What the ladders need:** $1 table minimums, a single-zero wheel for wide layouts, a bankroll big
  enough for the whole ladder, and either about 500 spins or a cash-out.

## How to run a candidate in the app

1. Open a candidate file from `scripts/research/candidates/` (start with
   `c9-streets-to12-stack-cashout.json`) and copy its contents.
2. In the app, go to **Define**, switch to **JSON** mode and paste it. The `notes` field repeats the
   table setup and the ledger numbers.
3. Set the table: outside minimum $1 and inside minimum total $1 (in the rules override:
   `limits.outside.min 100`, `limits.inside.minTotal 100`, in cents). The strategy file cannot carry
   table limits, and on the default $25 table none of the candidates works.
4. Run with a $5,000 bankroll and 500 spins; seed 20261031 reproduces the reporting-seed row.
5. Read **Analyze**: the typical session, chance ahead, average and worst 5 % should land near the
   first number of each cell in the chapter 9 table.

The Research screen will offer a one-tap **Open in Define** per candidate that carries the strategy,
the $1-minimum table, the $5,000 bankroll, 500 spins and the stops in one link.
