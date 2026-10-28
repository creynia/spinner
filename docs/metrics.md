# Metrics

Precise definitions of every number the analysis shows. Implemented as pure functions in
`src/core/analysis` and pinned by unit tests against the vectors below. Where this file and a design
doc disagree, `docs/design/decisions.md` wins.

**Two medians.** The *median* in every distribution (the `p50` of net, drawdown, length) is the
type-7 quantile at p = 0.5: for an even N it is the mean of the two middle values and need not be a
session. The *median session* (the Watch screen's representative session, section 16) is a real
session: rank `floor((N-1)/2)` of the stable sort by `(net, index)`, i.e. the lower of the two middle
sessions for even N (decisions.md A1). They coincide only for odd N when values are distinct.

## 0 Notation and conventions

- The **analysis domain** is sessions `i = 0 … N−1`: the completed chunk prefix (section 14); for a done run, N = `sessions`. Every metric uses this domain.
- `B` = bankroll; `x_i = net_i` (cents); `L_i = −x_i` (realized loss); `W_i` = wagered; `E_i` = expectedLoss (analytic); `V_i` = variance (analytic, conditional); `R_i` = roundsPlayed; `R^w_i` = roundsWagered; `ρh` = `session.roundsPerHour`.
- `z = 1.959963984540054` (95%). All intervals are 95%.
- Sums run in index order (and chunk stats in chunk order). Sums of i32 and f64i columns are exact in doubles while `N · max|v| < 2^53`.
- A CI is shown only when N ≥ 30; below that the UI shows the point value with "too few sessions for an interval". Probabilities always show their Wilson interval (it is valid for small N).
- Display rounding: money to the cent (to the dollar when |v| ≥ $1,000), probabilities to 0.1 pp, z to 0.01.

## 1 Quantiles: Hyndman–Fan type 7 (R default, NumPy `linear`)

For sorted values `s_0 ≤ … ≤ s_{N−1}` and `p ∈ [0,1]`: `h = (N − 1) · p`, `j = floor(h)`, `q(p) = s_j + (h − j) · (s_{j+1} − s_j)`, and `q(p) = s_{N−1}` when `j + 1 ≥ N`. Computed in exactly this order. Sorting is done on a copy (`Int32Array.prototype.sort` / `Float64Array.prototype.sort`, which are numeric).

Reported set: p1, p5, p10, p25, p50 (median), p75, p90, p95, p99, plus min = `s_0` and max = `s_{N−1}`.

**Quantile CI** (distribution-free, by order statistics, 1-indexed ranks): `l = max(1, floor(Np − z√(Np(1−p))))`, `u = min(N, ceil(Np + z√(Np(1−p))) + 1)`, and `CI = [s_{l−1}, s_{u−1}]` (0-indexed). Vectors: N = 10000, p = 0.5 → ranks (4902, 5099); N = 100, p = 0.5 → (40, 61); N = 10000, p = 0.05 → (457, 544).

Fixture `X = [−2500, −2500, 0, 2500, 7500, −10000, 5000, −5000, 2500, −2500]`: q(0) = −10000, q(.05) = −7750, q(.10) = −5500, q(.25) = −2500, q(.5) = −1250, q(.75) = 2500, q(.9) = 5250, q(.95) = 6375, q(1) = 7500 (compare to 1e−9).

## 2 Mean, SD, SE, skew

- `mean = (1/N) Σ x_i`.
- `SD s = sqrt( Σ (x_i − mean)² / (N − 1) )` (two-pass; N = 1 gives `s = 0`).
- `SE = s / √N`; `CI(mean) = mean ± z·SE`.
- Skew (adjusted Fisher–Pearson) `G1 = N / ((N−1)(N−2)) · Σ ((x_i − mean)/s)³`; it is undefined when N < 3 or s = 0.
- Fixture X: mean = −500, s = 5109.90323891863, SE = 1615.893285805443, G1 = −0.24982777265876538.

## 3 Probabilities and the Wilson interval

`p̂ = k/N`, `d = 1 + z²/N`, `center = (p̂ + z²/(2N)) / d`, `half = (z/d) · sqrt( p̂(1−p̂)/N + z²/(4N²) )`, `CI = [max(0, center − half), min(1, center + half)]`.

| Metric | k counts sessions with |
|---|---|
| P(ahead) | `net > 0` (also shown: P(even) `net = 0`, P(behind) `net < 0`) |
| P(bust) | `endedBy = bust` |
| P(stop-win), P(stop-loss) | `endedBy` = that |
| P(strategy stop: r) | `endedBy = strategy:r`, one row per reason |
| P(played to the cap) | `endedBy = rounds` |
| P(error) | `endedBy = error` (shown as a warning when > 0) |

Vectors: (0, 10) → [0, 0.277533]; (5, 10) → [0.236593, 0.763407]; (10, 10) → [0.722467, 1]; (38, 100) → [0.290976, 0.477902]; (200, 10000) → [0.017435, 0.022934]; (3725, 10000) → [0.363075, 0.382023].

## 4 Expected vs realized, and luck

- Mean analytic expected loss `Ē = (1/N) Σ E_i`; mean realized loss `L̄ = −mean`.
- **Expected net line** (histogram marker) = `−Ē`.
- **Session luck** `z_i = (x_i + E_i) / √V_i`. It is defined when `V_i > 0`; positive means luckier than the house edge predicts.
- **Run luck** `Z = Σ (x_i + E_i) / √(Σ V_i)`. Justification: `x_i + E_i` is a sum over rounds of martingale differences (realized minus conditional expected net), and its variance is `E[Σ V_i]`, so `Z ≈ N(0, 1)` by the martingale CLT. This holds even for adaptive strategies and early stops.
- Labels: |Z| < 1 "ordinary"; 1–2 "a bit lucky/unlucky"; 2–3 "unusual"; ≥ 3 "very unusual: check the strategy or report a bug".
- The distribution of `z_i` is shown as a histogram on the *Overview → Luck* disclosure.

## 5 Edge and cost of play

- Realized edge `e_r = Σ L_i / Σ W_i`. Analytic edge `e_a = Σ E_i / Σ W_i`. Both are undefined when `Σ W = 0`.
- `SE(e_r) = √(Σ V_i) / Σ W_i`, so `(e_r − e_a)/SE(e_r) = −Z`. `CI(e_r) = e_r ± z·SE(e_r)`. This is the section 12 Monte-Carlo cross-check: `|e_r − e_a| ≤ 3·SE(e_r)`.
- Expected loss per round `ℓ = Σ E_i / Σ R_i`; per wagered round `Σ E_i / Σ R^w_i`; per 100 rounds `100ℓ`; per hour `ℓ · ρh`; per session `Ē`.
- **Cost of play** = expected loss per hour = `ℓ · ρh`; this is the headline in the hours framing.
- Realized loss per hour = `(Σ L_i / Σ R_i) · ρh` with `CI = (CI of e_r) × Σ W_i / Σ R_i × ρh`.

## 6 Histogram (Freedman–Diaconis with snapping; zero is always an edge)

Input values `v_i` (net, maxDrawdown, maxExposure, roundsPlayed or z_i).

1. `IQR = q(.75) − q(.25)`; `h0 = 2·IQR·N^(−1/3)`. If `h0 = 0`: `h0 = 3.49·s·N^(−1/3)` (Scott). If still 0: one bin `[v, v+1)`.
2. **Granularity** `g = gcd(|v_i − v_0|)` over all i (integer data; `g = 1` when all values are equal, and floats use `g = 0`, which skips the gcd rounding).
3. **Nice width**: `h` = the smallest value ≥ h0 of the form `m·10^k` with `m ∈ {1, 2, 2.5, 5}`, then rounded up to a multiple of g (`h = ceil(h/g)·g` when g > 0). Money is in cents; counts use `k ≥ 0`.
4. Edges are anchored at multiples of h, so **0 is an edge**: `lo = floor(min/h)·h`, `k = floor((max − lo)/h) + 1` bins; bin `b = floor((v − lo)/h)`, half-open `[lo + b·h, lo + (b+1)·h)`.
5. If `k > 120`, h is replaced by the next nice value until `k ≤ 120`. If `k < 5` and `g < h`, h is replaced by the previous nice value ≥ g while `k ≤ 120`.
6. Output: `{ lo, width: h, counts: Uint32Array, zeroBin, markers: { zero: 0, expected: −Ē, mean } }`.

Fixture X: IQR = 5000, h0 = 2·5000·10^(−1/3) = 4641.59; g = 2500; nice → 5000 (already a multiple of 2500); lo = −10000; bins `[−10000, −5000):1, [−5000, 0):4, [0, 5000):3, [5000, 10000):2`.

## 7 Volatility

- `SD per session = s` (from section 2).
- `SD per round σ_r = √(Σ V_i / Σ R_i)` (pooled analytic). The empirical counterpart `s / √(mean R)` is shown alongside.
- `SD per hour = σ_r · √ρh`; `SD per 100 rounds = 10 σ_r`.
- Signal ratio `mean / s`.
- Spread ratio `(q(.9) − q(.1)) / Ē` ("the typical spread is k× the expected cost"; undefined when Ē ≤ 0).

## 8 Drawdown and exposure

- `maxDrawdown_i` (the summary schema): mean, its CI, the quantile set and the histogram. `P(maxDrawdown ≥ B/2)` and `P(maxDrawdown ≥ B)` with Wilson intervals.
- `maxExposure_i`: quantile set and histogram; `P(maxExposure ≥ tableMax)` for the even-money class max (from the plugin's resolved rules) with Wilson. This answers "how big did the Martingale get?".
- Trough: quantiles of `trough_i − B`.

## 9 Session length

`R_i`: mean and CI, quantile set, histogram. Sat-out share `1 − Σ R^w_i / Σ R_i`. Hours = `R / ρh`.

## 10 Breakdowns (where the money went)

Per category c: `wagered_c = Σ_i catWagered_ic`, `net_c = Σ_i catNet_ic`, `expected_c = Σ_chunks catExpected_c`, realized edge `−net_c / wagered_c`, analytic edge `expected_c / wagered_c`.

Per stage s: rounds `Σ_i stageRounds_is` (and its share of `Σ R_i`), wagered, net, expected (from chunk sums); entries = `Σ` of column s of `transitions` (+N for the entry stage); the transition matrix; the stop-stage distribution (`stopStage` counts).

Rejected/deferred: totals by reason code, with the share of sessions with `rejected > 0` (Wilson). **A non-zero rejected total always shows a warning.** The per-category net sums to the total net exactly; a test asserts this.

## 11 Convergence

- Running mean `m_n = (1/n) Σ_{i<n} x_i` and `s_n` (Welford in index order), evaluated at n ∈ the **convergence grid**: `n_j = ceil(N^(j/199))` for j = 0..199, deduplicated, with N always included. The `N^(j/199)` uses `Math.pow`; it is display only. The band is `m_n ± z·s_n/√n` (n ≥ 30).
- Running P(bust) and P(ahead) with Wilson bands on the same grid.
- **Suggested session count** for a target half-width:
  - Mean: `N* = ceil((z·s / h*)²)`. The default `h* = max(100, 0.1·|Ē|)` cents (10% of the expected loss, at least $1), user-adjustable. Vector: flat $25 red, 500 spins, single zero: `s ≈ 2500·√500·√(1 − (1/37)²)`, `Ē = 500·2500/37`, so N* = 1052.
  - Probability: `N* = ceil(z²·p̃(1−p̃) / h_p²)` with `p̃ = max(p̂, 1/N)` (never 0) and the default `h_p = 0.01`.
  - Verdict: "big enough" when the current half-width ≤ target for both mean net and P(bust); otherwise "run about N* sessions for ±target".

## 12 Fan chart and survival

### 12.1 Fan chart

For each checkpoint c (round `t_c = schedule[c]`):

- Gather column c of the checkpoint matrix over the domain (`equity[i·K + c]`, i < N) into a reused `Int32Array(N)`, sort it, and take type-7 quantiles p5, p25, p50, p75, p95 of `equity − B` (net). Cost: K sorts of N elements (≈ 130 ms for 10k × 128 on a laptop; the analysis runs once per open run and is memoized by `(runId, N)`).
- `mean_c = (1/N) Σ (equity_ic − B)`.
- **Expected line** `exp_c = −(1/N) Σ_chunks expCum_c` (chunk prefix). It is exact for the true mean: `E[equity_c] = B − E[cumulative expected loss to min(t_c, R_i)]` by optional stopping. A test asserts `|mean_c − exp_c| ≤ 4·SE_c` on presets.
- `alive_c = S(t_c)` from section 12.2, shown as a thin strip under the fan.
- The x-axis is rounds, or hours `t/ρh`. The y-axis is net, so runs with different bankrolls compare.
- **Live preview** while running: the same computation on the current prefix, throttled to 1 Hz, on at most 24 checkpoints (the first, the last and evenly spaced indices), using `quickselect` on a copy. The final view uses the exact sort.

### 12.2 Survival (exact)

Counting pass over the domain: `cnt[r] = #{i : R_i = r}` for r = 0..maxRounds, and `cntBy[k][r]` per ended-by class k.

- `S(r) = 1 − (1/N) Σ_{j<r} cnt[j]`: the share that **completed at least r rounds** ("still playing at round r"). `S(0) = 1`; `S(maxRounds)` = the share that reached the cap. This is computed for every r (O(N + maxRounds)).
- Cause-specific cumulative incidence `F_k(r) = (1/N) Σ_{j≤r} cntBy[k][j]`. `S(r+1) + Σ_k F_k(r) = 1`, and a test asserts it.
- Wilson CIs at the checkpoint rounds. Median survival = the smallest r with `S(r) ≤ 0.5`, otherwise "more than half reached the cap".
- The chart is a step line S(r) plus a stacked area of `F_bust`, `F_stop-win`, `F_stop-loss`, `F_strategy`, `F_error`, each with a text label (the meaning never depends on color alone).

---

## 13 Compare and sweep

### 13.1 Compare (common random numbers)

A compare view takes 2–6 runs of the same game id. The **baseline** is the first run; every other run is differenced against it.

**Pairing rule.** Paired iff `run.seed` is equal **and** `gameVersion` and `coreVersion` are equal. The domain is then the common prefix `n = min(N_A, N_B)`, aligned by session index. Otherwise the comparison is **Welch** over each run's own domain. The view states the method: "Paired by session (same seed: common random numbers)" or "Unpaired (Welch)". It also shows the CRN correlation `ρ = corr(x^A, x^B)` and the variance reduction `1 − Var(d)/(Var(x^A) + Var(x^B))`. Pairing is statistically valid whenever pairs are independent across i, which holds for any two runs. Equal seeds make it informative: the same spins per session give large ρ. The definition editor's "Compare with…" copies the seed and the session config (PLAYBOOK §9.6). If the session configs differ, the view adds a note but stays paired.

**Differences reported** (B minus A):

| Quantity | Paired | Unpaired |
|---|---|---|
| Mean net | `d_i = x^B_i − x^A_i`; `d̄ ± z·s_d/√n` | `x̄_B − x̄_A ± z·√(s_A²/N_A + s_B²/N_B)`; Welch–Satterthwaite df `ν = (a + b)² / (a²/(N_A−1) + b²/(N_B−1))` with `a = s_A²/N_A`, `b = s_B²/N_B` (shown; z is used since N ≥ 30) |
| P(ahead), P(bust), P(stop-*) | indicator differences `δ_i = 1[B_i] − 1[A_i]`: `δ̄ ± z·s_δ/√n`, plus discordant counts `b, c`; a note when `b + c < 10` | Newcombe hybrid score: `lo = Δ − √((p_B − l_B)² + (u_A − p_A)²)`, `hi = Δ + √((u_B − p_B)² + (p_A − l_A)²)` (Wilson l, u). Vector: 56/70 vs 48/80 → Δ = 0.2, CI [0.052431, 0.333873] |
| Mean expected loss, mean wagered, mean R, mean maxDrawdown | as mean net | as mean net |
| Realized edge | `Δe = e_B − e_A`, with SE from per-session paired residuals `u_i = (L^B_i − e_B W^B_i)/W̄_B − (L^A_i − e_A W^A_i)/W̄_A`: `SE = s_u/√n` | `√(SE_A² + SE_B²)` (section 5) |
| Medians and quantiles | no difference CI; each run's own quantile CI side by side | same |

Overlays: histogram outlines on one shared bin grid (section 6 computed on the pooled values), fan medians (p50) and the p25–p75 band of the baseline only, survival curves. With more than two runs, every difference is against the baseline, without multiplicity correction, with a footnote.

### 13.2 Sweep

```ts
interface SweepSpec { path: string /* RFC 6901 pointer into the normalized definition */; values: Json[] }
```

- **Allowed paths:** any existing scalar leaf **except** `/schema`, `/game/id`, `/run/*` (seed and sessions stay those of the base, so every variant shares the CRN streams), `/strategy/schema` and `/strategy/game`. 2 ≤ values ≤ 24; numbers are strictly increasing; strings are distinct. A path that does not exist in the base is an error (no implicit creation in v1).
- Each variant = `normalize(setPointer(base, path, value))` with `name = "<base name> · <label>=<value>"`. It is validated individually; an invalid variant blocks the sweep and the error is listed against its value.
- **Execution:** the variants are queued in value order on the run queue, each as its own run using the whole pool. If a done run with the same `simKey` exists, it is reused. The total time estimate is the sum of the variants' estimates; the warning threshold is 120 s.
- **Group record:** `ExperimentGroup { id, kind: 'sweep', name, baseDefinitionId, sweep, variantDefinitionIds[], runIds[], createdAt, updatedAt }` in `groups`. The group status is derived from its runs.
- **Analysis:** for each value, mean net ± CI, the p10/p50/p90 band, P(ahead) and P(bust) with Wilson, the realized/analytic edge, Ē, mean R and p95 maxExposure. The adjacent differences (`v_{j+1} − v_j`) use section 13.1, paired (same seed). The x-axis is categorical for strings and linear for numbers (log when `max/min ≥ 20`).
- 2-D sweeps are a chip.

---
## 14 Analysis domain of an incomplete run

The chunks complete when a run is paused or cancelled are not an outcome-independent sample: whether
an in-flight batch finished depends on how long its sessions were, and long sessions are the ones that
survive. Analysis therefore uses only the **longest completed chunk prefix**: sessions `0 ... N'-1`
with `N' = chunkSize x (first missing chunk)`, capped at `sessions` (`completedPrefix(meta)`). Chunks
completed beyond the prefix are kept for resume but are not analyzed. A done run uses all sessions.
The Quick check is the first 200 sessions of the same seed, so its verdict is the prefix of the full run.

## 15 Implementation notes

- **Histogram step 5 refinement.** The "previous nice width" refinement (fewer than 5 bins while
  `g < h`) applies only when rounding the width up to the granularity `g` is what enlarged it. Fixture
  X (width 5000 already a multiple of g = 2500, 4 bins) keeps its width, as the fixture states.
- **Convergence bands** hold `NaN` for `n < 30` (no interval is shown); Wilson bands are always set.
  "Big enough" additionally requires `N >= 30`.
- **Probability of reaching the table maximum** needs the resolved even-money maximum, which only the
  plugin knows: `runMetrics(data, { tableMax })`. Without it `exposure.pAtTableMax` is `null`.
- **Compare notes.** `session configs differ` (bankroll, maxRounds, stops, pace), `few discordant pairs`
  (b + c < 10 on any rate), `unpaired (Welch)`, and `fewer than 30 sessions`.
- **Survival Wilson bands** are not part of the `Survival` output; use `wilson(round(S*N), N)` on demand.
- **Sums** run in index order; chunk stats in chunk order. Intervals are 95% (`z = 1.959963984540054`).
## 16 Representative sessions

`worst` = argmin net, `best` = argmax net, `median` = the session at rank `floor((N−1)/2)` of a stable sort by `(net, index)`. Ties go to the smallest index.

## 17 Analytic oracles (tests)

- **Gambler's ruin** (flat even-money bet, win probability `p = 18/37`, `q = 1 − p`, `r = q/p`, start a units, stop at 0 or n units, no round cap): `P(ruin) = (r^a − r^n)/(1 − r^n)`. Vector: a = 40, n = 80 → 0.8968485629704275. Expected duration `D = a/(q−p) − (n/(q−p))·(1 − r^a)/(1 − r^n)`. The harness end-to-end test runs 20,000 sessions with `maxRounds` large enough (cap hits < 0.1%) and asserts P(bust) within its Wilson interval and mean R within 3 SE of D.
- **Flat betting**: net is a sum of `R` i.i.d. terms; with no stops `E[net] = −R·unit·(1/37)` and `Var = R·unit²·(1 − 1/37²)`. The test asserts mean and SD within 3 SE (SE of SD ≈ s/√(2N)), and checks the analytic `ΣV_i / N` equals `Var` exactly.

---

