# Research ledger

One row per experiment that was run at full size (10,000 sessions). Specs live in
`scripts/research/specs/`, raw reports in `docs/research/results/`. "Ahead until" is the last
spin at which the median equity path is above the bankroll. Predictions come from
`docs/research/plan.md` §2. Append, never edit a row.

| spec | id | seed | N | mean | median | P(win) | bust | ahead until | median peak | realized edge | prediction / note |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| observations | flat-red | 20261031 | 10000 | -$338.21 | -$350.00 | 25.5 % | 0.0 % | — | $0.00 @ 0 | -2.71 % | control; symmetric, median ≈ mean |
| observations | flat-red-cashout-500 | 20261031 | 10000 | -$304.78 | -$350.00 | 29.8 % | 0.0 % | — | $0.00 @ 0 | -2.72 % | cash-out alone barely moves P(win): no skew to harvest |
| observations | martingale-red | 20261031 | 10000 | -$898.24 | -$5,000 | 32.4 % | 51.2 % | 290 | $2,100 @ 220 | -2.56 % | H1: n½ = ln2/(q·p) = 295 |
| observations | martingale-red-br10k | 20261031 | 10000 | -$1,266 | -$375.00 | 34.6 % | 22.2 % | 290 | $2,900 @ 270 | -2.67 % | H1: same levels ⇒ same horizon; bankroll only changes the bust size |
| observations | martingale-red-cashout-500 | 20261031 | 10000 | -$113.80 | $500.00 | 88.8 % | 11.2 % | 500 | $500.00 @ 41 | -2.40 % | cash-out: P(win) ≈ e^(−qW) = 0.91 |
| observations | martingale-red-unit5-L10 | 20261031 | 10000 | -$324.32 | $1,185 | 73.4 % | 15.6 % | 500 | $1,185 @ 500 | -2.64 % | H1: 10 levels ⇒ n½ ≈ 1,100 > 500 |
| observations | fibonacci-red | 20261031 | 10000 | -$783.73 | $1,675 | 57.2 % | 39.1 % | 500 | $1,675 @ 500 | -2.58 % | slower growth ⇒ more levels in $5,000 ⇒ longer horizon than Martingale |
| observations | fibonacci-red-cashout-500 | 20261031 | 10000 | -$227.62 | $500.00 | 86.6 % | 13.2 % | 500 | $500.00 @ 120 | -2.67 % | cash-out on Fibonacci |
| observations | two-dozens-x3 | 20261031 | 10000 | -$1,447 | -$5,000 | 31.8 % | 67.3 % | 220 | $2,100 @ 150 | -2.85 % | H2: right factor for 24 numbers (×3) but only 4 full levels fit |
| observations | martingale-dozen | 20261031 | 10000 | -$1,060 | -$5,000 | 17.3 % | 82.1 % | 48 | $1,900 @ 42 | -2.63 % | H2: wrong factor (×2 on a 2:1 bet) ⇒ q = 0.043 ⇒ n½ ≈ 50 |
| observations | martingale-straight | 20261031 | 10000 | -$600.38 | -$5,000 | 7.8 % | 91.9 % | — | $0.00 @ 0 | -2.56 % | H2: 8 levels on a 1/37 bet: q = 0.80, median never positive |
