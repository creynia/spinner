# Harness, data and analysis (design spike)

Status: proposal for reconciliation. Authority order: `docs/design/decisions.md` > this doc > `PLAYBOOK.md`.
Covers PLAYBOOK §6 (definition layer), §7 (harness), §8 (store), §9 (analysis) and the harness, store and analysis parts of §12.
Owned code paths: `src/core/rng/**`, `src/core/harness/**`, `src/workers/**`, `src/core/experiment/**`, `src/core/store/**`, `src/core/analysis/**`, `build/vite-plugin-gallery.ts`, `tests/perf/**`, `docs/metrics.md`.
Contracts proposed here (§16): `src/core/contracts/experiment.ts`, `run.ts`, `analysis.ts`.

Inputs taken from `decisions.md`: the default run is **10,000 sessions × 500 spins**; the perf budget is **< 90 s on a mid-range Android phone (Pixel 6a class)** and **< 20 s on a 4-core laptop**; the **gallery ships**, with ≤ 2 MB per bundle and ≤ 20 MB for the folder, enforced in CI; default pace is 40 spins/hour (`electronic` preset 100); money is integer cents; `unit` defaults to 2500.

Every test vector in this document was computed by a scratch script (Node 22 BigInt reference vs the 32-bit implementation below, and Python `math` for the statistics). An implementer pins the same vectors in unit tests.

---

## 0. Prior art and what differs

Prior art read (read-only): `creynia/crappy`, `creynia/baccaratton`, `creynia/holdumb`.

| Prior art | What we reuse | What differs, and why |
|---|---|---|
| `*/src/sim/engine/rng.ts`: splitmix32 → 4 words → **xoshiro128\*\***; `randBelow` by rejection (`u < 2^32 − 2^32 mod n`, return `u % n`) | **Identical** xoshiro128\*\* step and the **identical** `randBelow` rejection rule, so a die or a pocket drawn from a given state is the same in every app in the family. | (1) Prior art takes a session seed of `seed + i` through splitmix32. We derive session seeds with **SplitMix64** (PLAYBOOK §7.1), with 64-bit state held as two 32-bit halves, because a 32-bit seed space shared by all sessions of all runs collides early (the birthday bound at 2^16 sessions) and `seed + i` makes run `s` session 1 equal to run `s+1` session 0. (2) Prior art is immutable (`[value, nextState]` tuples): one allocation per draw. The session loop must not allocate per round (§7.2), so `Xoshiro128ss` here is a **mutable class over a `Uint32Array(4)`**. A pure wrapper with the old shape stays available for tests. |
| `holdumb/src/sim/worker/{protocol,transport-*,client,runner}.ts`: a `t`-tagged message union (`ping`/`run`/`cancel` → `pong`/`progress`/`done`/`error`), `PROTOCOL_VERSION`, transports (worker, in-thread, inline) | The `t` discriminant, `PROTOCOL_VERSION` in `pong`, the **transport abstraction** (a real Worker in the browser, an in-thread transport in Vitest/node and as a fallback when `Worker` is missing), and the AbortError conventions. | Prior art runs **one job per worker**, as a sliced generator that yields to the event loop so that `cancel` gets through. Here a run is thousands of **batches**, sent to a **pool**. A batch is synchronous and short (~250 ms) and does not yield (yielding costs throughput). So there is no in-batch cancel: *pause* stops dispatching, *cancel* terminates the workers (§6). `progress` events are per batch, not per slice. |
| `baccaratton/src/sim/jobs/*`: `EvClient.run(kind, req, {key, signal, onProgress})`, latest-wins by `key` | The `EvClient` shape for **single-shot jobs**: Quick check, re-simulating one session (Watch), and analysis jobs if they move off the main thread. | Long runs are not a `run()` promise. They are a `RunController` with pause/resume/cancel and persisted progress (§6). |
| `*/src/app/storage.ts`: probe-then-fallback (`createStorage()` never throws; `MemoryStorage`; `persistent: false` shows a banner; validate, migrate by version, read-only on data from a newer app) | **Exactly this policy**, applied to IndexedDB (§9.3). | Storage is IndexedDB, not one localStorage key, because a run is megabytes of typed arrays. |
| `crappy/src/sim/ui/ResultsHistogram.tsx`: equal-width bins with **0 always a bin edge** (no bin mixes losers and winners) | The zero-edge rule. | The bin width comes from Freedman–Diaconis with snapping (§11.6), not a fixed 15 bins. |
| `crappy/src/sim/ui/BankrollChart.tsx`: median line, 10th–90th band, a table fallback | The table fallback and screen-reader summary. | The bands come from the checkpoint sketch (p5/p25/p50/p75/p95), with an analytic expected line (§12). |

---

## 1. Seeds and RNG (`src/core/rng`)

### 1.1 Streams

```
runSeed      : uint32 integer in [0, 2^32 − 1], stored in definition.run.seed
               (new definitions draw it from crypto.getRandomValues; links carry it)
base         = mix64(runSeed)                          // 64-bit, once per run
sessionSeed(i)  = SplitMix64 output number (i + 1) from state `base`
                = mix64(base + (i + 1) · γ  mod 2^64),  i = 0 … sessions − 1
engineRng(i)    = xoshiro128** seeded by seedXoshiro(sessionSeed(i))
strategyRng(i)  = xoshiro128** seeded by seedXoshiro(sessionSeed(i) XOR STRATEGY_SALT)
seedXoshiro(x)  : a = mix64(x + γ), b = mix64(x + 2γ)  (the first two SplitMix64 outputs from state x)
                  s = [lo32(a), hi32(a), lo32(b), hi32(b)]; if s is all zero, s[0] = 1
γ             = 0x9E3779B97F4A7C15
STRATEGY_SALT = 0x5354524154454759                     // ASCII "STRATEGY"
mix64(z):  z = (z ^ (z >>> 30)) · 0xBF58476D1CE4E5B9 ; z = (z ^ (z >>> 27)) · 0x94D049BB133111EB ; return z ^ (z >>> 31)
           (all arithmetic mod 2^64, >>> is the logical shift)
```

Properties:

- Session *i* depends only on `(runSeed, i)`. It does not depend on worker count, batch, chunk or the order in which sessions run.
- Two experiments with the same `runSeed` see the same engine stream per session index. These are the common random numbers of §13.
- The strategy stream (used only by a `chance` condition, if the strategy spike keeps it) is independent of the engine stream. Adding a `chance` rule therefore never changes the spins.
- **Plugin seam (open question Q1):** the game plugin receives a ready `Rng` (the engine stream) in `createState(rules, rng)`, and does not take a numeric seed. Pockets are drawn with `rng.below(pockets)`. The plugin must draw a **fixed number of `below` calls per round, whatever the bets** (roulette: exactly one). This makes the spin sequence identical across strategies, which common random numbers require.

### 1.2 Reference implementation (32-bit safe, no BigInt in the hot path)

```ts
// src/core/rng/splitmix64.ts : 64-bit values as [hi, lo] uint32 pairs
const G_HI = 0x9e3779b9, G_LO = 0x7f4a7c15;

/** (a·b) mod 2^64 for a = (ah,al), b = (bh,bl); 16-bit limbs for the low product, Math.imul for the cross terms. */
function mul64(ah: number, al: number, bh: number, bl: number, out: Uint32Array): void {
  const a0 = al & 0xffff, a1 = al >>> 16, b0 = bl & 0xffff, b1 = bl >>> 16;
  const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  out[1] = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;                 // lo
  out[0] = (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16)
            + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0;                 // hi
}
function add64(ah: number, al: number, bh: number, bl: number, out: Uint32Array): void {
  const lo = (al + bl) >>> 0;
  out[0] = (ah + bh + (lo < al ? 1 : 0)) >>> 0; out[1] = lo;
}
/** mix64 in place on out = [hi, lo]. */
export function mix64(h: number, l: number, out: Uint32Array): void {
  let nl = (l ^ ((l >>> 30) | (h << 2))) >>> 0, nh = (h ^ (h >>> 30)) >>> 0;
  mul64(nh, nl, 0xbf58476d, 0x1ce4e5b9, out); nh = out[0]!; nl = out[1]!;
  nl = (nl ^ ((nl >>> 27) | (nh << 5))) >>> 0; nh = (nh ^ (nh >>> 27)) >>> 0;
  mul64(nh, nl, 0x94d049bb, 0x133111eb, out); nh = out[0]!; nl = out[1]!;
  out[0] = (nh ^ (nh >>> 31)) >>> 0; out[1] = (nl ^ ((nl >>> 31) | (nh << 1))) >>> 0;
}
/** k-th SplitMix64 output (k ≥ 1) from state s: mix64(s + k·γ). k ≤ 2^32 − 1. */
export function splitmixAt(sh: number, sl: number, k: number, out: Uint32Array): void {
  mul64(0, k >>> 0, G_HI, G_LO, out);                 // k·γ
  add64(sh, sl, out[0]!, out[1]!, out);
  mix64(out[0]!, out[1]!, out);
}
```

```ts
// src/core/rng/xoshiro128ss.ts : mutable, allocation-free
export class Xoshiro128ss implements Rng {
  readonly s = new Uint32Array(4);
  next(): number {                                   // uint32
    const s = this.s;
    const s0 = s[0]!, s1 = s[1]!;
    const r = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    const n2 = (s[2]! ^ s0) >>> 0, n3 = (s[3]! ^ s1) >>> 0;
    s[1] = s1 ^ n2; s[0] = s0 ^ n3; s[2] = n2 ^ t; s[3] = rotl(n3, 11);   // Uint32Array stores mod 2^32
    return r;
  }
  /** Uniform in [0, n), 1 ≤ n ≤ 2^32. The rejection rule is identical to crappy/baccaratton randBelow. */
  below(n: number): number {
    const limit = 0x100000000 - (0x100000000 % n);
    for (;;) { const u = this.next(); if (u < limit) return u % n; }
  }
  /** Uniform double in [0, 1) with 53 random bits; consumes exactly two next() calls. */
  float53(): number {
    const a = this.next() >>> 5, b = this.next() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }
  snapshot(): [number, number, number, number] { /* copy of s, for traces and tests */ }
}
const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
```

`sessionRng(runSeed, i, stream)` composes the pieces above and writes into an existing `Xoshiro128ss`, so it does not allocate per session either.

### 1.3 Test vectors (pin all of them)

| Check | Expected |
|---|---|
| SplitMix64 from state 0, outputs 1..3 | `0xe220a8397b1dcdaf`, `0x6e789e6aa1b965f4`, `0x06c45d188009454f` |
| `mix64(0)`, `mix64(1)` | `0x0000000000000000`, `0x5692161d100b05e5` |
| xoshiro128\*\* with state `[1,2,3,4]`, first 6 `next()` | `11520, 0, 5927040, 70819200, 2031721883, 1637235492` (the official reference sequence) |
| `below` rejection limits | n=37 → 4294967289; n=38 → 4294967290; n=39 → 4294967274 |
| 20,000 random 64-bit inputs: 32-bit `mix64` vs BigInt reference | all equal (property test) |

Per-session vectors. `engineState` is the xoshiro state after seeding; `u32` is its first 3 `next()`; `spins37` and `spins38` are the first 10 `below(37)` and `below(38)` from a fresh copy of that state; `strat s0` is word 0 of the strategy stream's state.

| runSeed | base | i | sessionSeed | engineState | u32 | spins37 | spins38 | strat s0 |
|---|---|---|---|---|---|---|---|---|
| 0 | `0x0000000000000000` | 0 | `0xe220a8397b1dcdaf` | `4d197e6f a706dd2f f4414f5e b382a305` | 443589289, 1472243107, 1913443415 | 26,9,33,9,29,11,15,22,32,34 | 13,25,3,13,37,11,31,1,18,8 | `417a5407` |
| 0 | | 1 | `0x6e789e6aa1b965f4` | `f0c37c00 46b73e79 3d0cc8a6 374327c6` | 452830256, 406101180, 3035359336 | 21,21,30,15,27,3,24,5,31,18 | 26,6,10,16,2,25,3,17,0,19 | `b07c6ac1` |
| 0 | | 9999 | `0x488601e3f80e210a` | `4c92b244 d6121dfb 5d3f2958 2d9fc2ab` | 2544013391, 1432048011, 1255932693 | 25,11,31,8,10,4,8,31,2,14 | 31,37,13,23,36,20,31,32,20,30 | `387a5656` |
| 1 | `0x5692161d100b05e5` | 0 | `0xbfef8030ddc2d772` | `ed403149 55c55969 9a7e41f1 fb85af9c` | 3629890950, 321708431, 2084616383 | 30,17,12,30,10,26,7,13,33,0 | 2,13,33,5,22,24,25,14,16,18 | `b8bb2613` |
| 42 | `0xa759ea27d4727622` | 0 | `0x989b3f130a063869` | `6d073327 5599b3e0 a31128df d6171d07` | 38744838, 541465636, 2322453245 | 29,14,23,9,17,24,11,27,28,15 | 0,26,25,37,7,25,20,16,15,31 | `6be3ccb2` |
| 42 | | 1 | `0x290db4bf2570ded7` | `6cf5a31d 66723b87 b9eea3a1 e44acd82` | 171662720, 3216290240, 2625501703 | 36,9,18,35,22,12,12,34,17,13 | 0,32,3,33,36,6,12,25,1,4 | `41fe118c` |
| 42 | | 9999 | `0x2a3d69327abab063` | `0012630c 783ef7f6 a22ba7cf fb420b0a` | 2295013516, 2717919657, 3575286224 | 12,1,15,15,36,4,5,12,35,23 | 20,19,22,29,20,5,22,10,27,3 | `daf87a79` |
| 4294967295 | `0x8b32c408e8c2c97c` | 0 | `0x7f65c5cfc4eb5526` | `a4a135c3 6a576032 c208279e ceaa8390` | 2918475089, 1561248416, 3925626691 | 4,5,25,21,5,32,22,34,16,24 | 1,24,21,3,27,15,25,22,29,23 | `06d4b189` |

How a pocket index maps to a wheel number (for example index 37 → `00`) is the game spike's mapping. The vectors pin the RNG, not the wheel.

---

## 2. Determinism rules (normative)

A run's **results** (summary columns, checkpoint matrix, chunk stats, samples) are a pure function of `(normalized definition, game.version, core.version)`. They must be byte-identical across worker counts (1, 2, 4, …), dispatch sizes, resume points and repeated runs. They should also be identical across JS engines; §2 rule 4 is what makes that hold.

1. **Per-index seeding** (§1). No state is shared between sessions.
2. **Index-addressed merge.** A worker returns rows for a contiguous index range; the main thread writes them at their index. Arrival order never matters.
3. **No cross-session float accumulation in arrival order.** Everything a worker aggregates across sessions is aggregated **per chunk** (a fixed grid of `chunkSize` consecutive sessions, §5.3), in index order within the chunk. The analysis combines chunks in chunk order. Within a session, floats (expected loss, variance) accumulate in round order. Integers that are exactly representable are summed in any order.
4. **Only correctly-rounded float operations in anything that feeds results:** `+ − × ÷`, `Math.sqrt`, `Math.round/floor/ceil/trunc`, `Math.abs/min/max`, comparisons. **No** `Math.pow`, `exp`, `log`, `sin`, `**` with a non-integer exponent, or `Intl` in the worker's result path; their last bit may differ between engines. The checkpoint schedule (§4) is built without `pow` for this reason. Analysis (display only) may use anything.
5. **Sample selection is a function of indices only** (§5.6). The main thread tells each batch which indices to trace.
6. **`resultsDigest`** = SHA-256 over, in order: the canonical JSON (§8.2) of `{ definitionId, gameVersion, coreVersion, sessions, chunkSize, schedule, columns: [name, dtype, width] }`; then the little-endian bytes of every summary column in column order, the checkpoint matrix, and every chunk-stats array in a fixed order; then the canonical JSON of `samples`. Digests are compared by the determinism tests, stored in `RunMeta`, carried in exports, re-checked on import, and re-checked by the gallery build.

---

## 3. What a session produces

The session loop (`src/core/harness/session.ts`) follows PLAYBOOK §5.6. Per round it adds the plugin's `expectedLossPerRound` and `variancePerRound` (for the reconciled layout, before the spin) to the session totals, and updates equity, peak, trough, drawdown, exposure and the per-stage and per-category tallies. The output for each session is one summary row, one checkpoint row, its contribution to chunk stats, and a trace when the index is a sample.

### 3.1 Summary columns (schema v1, struct of arrays, length = `sessions`)

| Column | dtype | Meaning |
|---|---|---|
| `final` | i32 | equity at session end (bankroll + bets at face value; tables are empty at session end in roulette) |
| `net` | i32 | `final − bankroll` |
| `peak` | i32 | max equity over rounds 0..end (round 0 = bankroll) |
| `trough` | i32 | min equity over rounds 0..end |
| `maxDrawdown` | i32 | `max_t (peak_t − equity_t)` with `peak_t` the running max including round 0; ≥ 0 |
| `roundsPlayed` | i32 | rounds resolved, sat-out rounds included (playbook's `endedRound` equals this, so it is **not** stored separately) |
| `roundsWagered` | i32 | rounds with total wager > 0 |
| `wagered` | f64i | Σ wager (integer-valued double; avoids Int32 overflow on long Martingales) |
| `expectedLoss` | f64 | Σ analytic expected loss per round, cents |
| `variance` | f64 | Σ analytic round variance (conditional on the layout), cents² |
| `endedBy` | u8 | 0 `rounds`, 1 `bust`, 2 `stop-win`, 3 `stop-loss`, 4 `error`, 16 + j `strategy:<reasons[j]>` |
| `stopStage` | u8 | index of the stage active when the session ended |
| `rejected` | u16 | reconcile rejections (saturates at 65535) |
| `deferred` | u16 | reconcile deferrals (saturates) |
| `maxExposure` | i32 | max total amount on the table after reconcile in any round |
| `stageRounds` | i32 × S | rounds spent in each stage |
| `catWagered` | f64i × C | wagered per bet category |
| `catNet` | f64i × C | net per bet category |

`f64i` is a Float64Array whose values are integers with |v| < 2^53; the export uses varint encoding for it. `S` = number of stages (≤ 32), `C` = number of plugin bet categories. `reasons[]`, `stages[]` and `categories[]` are label arrays fixed at compile time: stages in definition order; reasons in order of first appearance in the definition, at most 239 of them; categories in plugin catalog order.

Overflow guard: equity is stored as i32 cents, so it is capped at ±$21,474,836.47. `defineExperiment` rejects `bankroll > 100,000,000` ($1M). If equity would leave the i32 range, the session ends with `error` (`code: 'equity-overflow'`).

### 3.2 Chunk stats (per chunk of `chunkSize` sessions, summed in index order)

| Field | dtype × length | Meaning |
|---|---|---|
| `expCum` | f64 × K | Σ over the chunk's sessions of the cumulative expected loss at each checkpoint round (a session that ended early contributes its total) |
| `catExpected` | f64 × C | expected loss by category |
| `stageWagered`, `stageNet` | f64i × S | wagered and net by stage |
| `stageExpected` | f64 × S | expected loss by stage |
| `transitions` | i32 × S·S | `goto` counts from stage a to stage b (row-major) |
| `rejectedByReason` | `Record<code, number>` | reconcile rejection codes (the plugin's codes), counts |
| `deferredByReason` | `Record<code, number>` | as above |
| `errors` | `{ index, code, message }[]` | session errors (the run keeps the first 100 overall plus a total count) |

The memory cost is small: 313 chunks × (128 + …) doubles is about 400 KB for the default run.

---

## 4. Checkpoint schedule (exact algorithm)

`checkpointSchedule(maxRounds, sessions, spec)` returns a strictly increasing `Int32Array` of round indices. Round *r* means "equity after *r* rounds"; 0 is the bankroll.

**`'auto'`:**

```
K  = clamp(floor(4_194_304 / sessions), 16, 128)    // ≤ 16 MB matrix (sessions × K × 4 B)
if maxRounds + 1 ≤ K:  return [0, 1, …, maxRounds]
D  = min(33, floor(K / 4) + 1)                      // dense head: rounds 0..D−1
a  = D − 1 ;  M = K − D ;  ratio = maxRounds / a
// g = ratio^(1/M) without Math.pow: bisection with powInt(x, M) = x·x·…·x (M multiplications, left to right)
lo = 1 ; hi = 2 ; while powInt(hi, M) < ratio: hi = hi · 2
repeat 64 times: mid = (lo + hi) / 2 ; if powInt(mid, M) < ratio then lo = mid else hi = mid
g = hi
p = a ; for k = 1..M: p = p · g ; geo[k] = floor(p + 0.5)
geo[M] = maxRounds
forward:  prev = a ; for k = 1..M: if geo[k] ≤ prev then geo[k] = prev + 1 ; prev = geo[k]
backward: geo[M] = maxRounds ; for k = M−1 down to 1: if geo[k] ≥ geo[k+1] then geo[k] = geo[k+1] − 1
return [0..a] ++ geo[1..M]
```

The backward pass keeps everything > a because `maxRounds + 1 > K` implies `maxRounds − a ≥ M`. Every step uses only correctly rounded operations, so the schedule is the same on every engine.

**Custom (`number[]`):** values are integers; sorted, deduplicated, filtered to `[0, maxRounds]`; 0 and `maxRounds` are added if missing; at most 512 entries and `sessions × length × 4 ≤ 32 MB`, otherwise a validation error (`checkpoints-too-many`).

**Test vectors:**

- `(500, 10000)` → K = 128, D = 33, 128 points: `0..40, 42,43,44,45,47,48,49,51,52,54,55,57,59,60,62,64,66,68,70,72,74,76,78,81,83,86,88,91,93,96,99,102,105,108,111,114,118,121,125,128,132,136,140,144,148,153,157,162,167,171,176,182,187,192,198,204,210,216,222,229,236,243,250,257,265,272,280,289,297,306,315,324,333,343,353,364,374,385,397,408,420,433,445,458,472,486,500`.
- `(100, 10000)` → 101 points `0..100`.
- `(128, 10000)` → 128 points `0..126, 128`.
- `(10000, 10000)` → 128 points; entries 30..44 are `30,31,32,34,36,38,41,43,46,49,52,55,59,62,66`; the last five are `7852, 8341, 8861, 9413, 10000`.
- `(500, 100000)` → K = 41, D = 11, 41 points: `0..10, 11,13,15,17,19,22,25,28,32,37,42,48,54,62,71,81,92,105,119,136,155,176,201,229,261,297,338,385,439,500`.

Semantics: the checkpoint matrix is `Int32Array(sessions × K)`, **session-major** (`equity[i·K + c]`). A session that ended before round `schedule[c]` carries its final equity forward ("money in the pocket"). Survival is computed exactly from `roundsPlayed`/`endedBy` (§12.2), never from checkpoints.

---

## 5. Workers, pool and batches (`src/core/harness`, `src/workers/sim.worker.ts`)

### 5.1 Worker protocol (v1)

```ts
export const SIM_PROTOCOL = 1;
export type ToSim =
  | { t: 'ping' }
  | { t: 'init'; runKey: string; definition: NormalizedDefinition; schedule: Int32Array; chunkSize: number; sessions: number }
  | { t: 'batch'; runKey: string; batchId: number; firstChunk: number; chunkCount: number; traceIndices: number[] }
  | { t: 'simulate'; reqId: number; definition: NormalizedDefinition; index: number; schedule?: Int32Array }  // Watch / re-sim, full trace
  | { t: 'dispose' };
export type FromSim =
  | { t: 'pong'; protocol: number; coreVersion: string; game: { id: string; version: string } }
  | { t: 'ready'; runKey: string; labels: RunLabels; columns: ColumnSpec[] }
  | { t: 'init-error'; runKey: string; errors: ValidationIssue[] }
  | { t: 'batch-done'; runKey: string; batchId: number; firstChunk: number; chunkCount: number;
      firstSession: number; count: number;
      columns: ArrayBuffer[];          // one per ColumnSpec, `count × width` elements, transferred
      checkpoints: ArrayBuffer;        // Int32 count × K, transferred
      chunks: ChunkStats[];            // chunkCount entries (typed arrays transferred)
      samples: SampleSession[];        // traced indices in this batch
      elapsedMs: number }              // performance.now() around the compute loop only
  | { t: 'simulated'; reqId: number; row: SummaryRow; checkpoints: Int32Array; trace: SessionTrace }
  | { t: 'error'; runKey?: string; batchId?: number; reqId?: number; code: string; message: string };
```

- `init` compiles the strategy once per worker per run (resolved bet ids, fact accessors, rule closures; PLAYBOOK §7.2). A worker holds one compiled run at a time, keyed by `runKey`; a `batch` with another `runKey` is answered with `error{code:'stale-run'}`.
- On boot the main thread sends `ping`. A `pong` whose protocol, core version or game version differs from the page's (a stale service-worker cache) stops the run with "App updated, reload". This is the same version check as holdumb.
- There is no `cancel` message (see §0): a batch is short and synchronous. Pause means "stop dispatching"; cancel means `worker.terminate()`.
- The transports are `worker` (a module Worker, `new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' })`) and `inthread` (the same `handle(msg)` called through a `queueMicrotask`/MessageChannel hop). Vitest in node uses `inthread`; the browser uses it only if `Worker` is missing.
- Session-level failures (a strategy runtime error, an engine exception) end that session with `endedBy = error` and are reported in chunk `errors`; the batch still succeeds. An `error` message means the worker itself failed.

### 5.2 Pool

- Size `P = clamp((navigator.hardwareConcurrency ?? 2) − 1, 1, 8)`; the user can override it in Settings (1–16). The pool is created lazily on the first run, shared by runs, and terminated after 60 s idle. A Pixel 6a reports 8 → 7 workers; the perf test verifies that 7 is not slower than 4 on big.LITTLE (if it is, the default for `hc ≥ 8` becomes `hc / 2` — open question Q6).
- **One active run at a time.** Other runs (sweep variants, the user's queue) wait in a FIFO run queue. Quick check and re-simulate use a **separate single worker** (`aux`), so Watch stays responsive while a run is going.
- Worker crash (`error`/`messageerror` event, or no `batch-done` within `max(10 s, 40 × expected batch time)`): terminate it, start a fresh one, re-dispatch the same batch once. If the same batch fails a second time, the run goes to `error` (data kept, resumable after an update).

### 5.3 Chunks and batches

- **Chunk** = the persistence and bitmap unit, fixed per run:
  `chunkSize = largest power of two c in [1, 64] with c · maxRounds ≤ 16384` (≈ ≤ 16k rounds, about 0.1–0.2 s on a laptop). Vectors: maxRounds 1 → 64, 100 → 64, 500 → 32, 1000 → 16, 10000 → 1. The last chunk may be partial. `chunks = ceil(sessions / chunkSize)`.
- **Batch** = a dispatch of `k` consecutive chunks to one worker. `k` adapts; results do not depend on it (§2).

**Batch sizing (exact).** Target `T = 250 ms`. Per worker `w`:

```
first batch of a run:   k = 1
after batch-done(k, elapsedMs):  r = k / max(elapsedMs, 1)                      // chunks per ms
                                 rate_w = rate_w === undefined ? r : 0.5·rate_w + 0.5·r
next k = clamp(round(T · rate_w), 1, 64)
tail:   k = min(k, max(1, floor(remainingChunks / (2·P))))
```

Each worker keeps **up to 2 batches in flight** (one computing, one queued), so it never idles waiting for the main thread. Chunks are handed out in **ascending order**, so the completed set is almost always a prefix.

### 5.4 Merge

On `batch-done` the main thread does: `col.set(new T(buf), firstSession × width)` for each column; `checkpoints.set(…, firstSession × K)`; store the chunk stats by chunk index; set the bitmap bits; append the batch to `pendingParts` (for the next flush); update progress. Merging costs O(count). A merge must take < 2 ms of main-thread time for a 64-session batch; this is measured in the perf test.

### 5.5 Progress and ETA

`sessionsPerSec` is an EWMA (α = 0.3) of the completed sessions per wall-second over 1-second windows. `ETA = remaining / sessionsPerSec`. **Pre-run estimate** (Define screen): `rounds = sessions × maxRounds × 0.8` (a cap on the early-stop discount; the Quick check refines it with its measured rounds/s and mean `roundsPlayed`). Estimated time = `rounds / (P × deviceRoundsPerSecPerWorker)`, where `deviceRoundsPerSecPerWorker` is the last Quick check or benchmark measurement on this device (persisted in `settings`; default 60,000). A soft warning appears above **120 s**.

### 5.6 Sample sessions (deterministic)

`S = run.sampleSessions` (default 24, max 100, 0 allowed). `N = run.sessions`.

```
f = min(8, ceil(S / 3))                  // the first f sessions
m = S − f
I = {0, …, f−1} ∪ { floor((j + 0.5) · N / m) : j = 0..m−1 }    // when m > 0
if |I| < min(S, N): add the smallest unused indices ascending until |I| = min(S, N)
```

Vectors: N = 10000, S = 24 → f = 8, m = 16: `0..7, 312, 937, 1562, 2187, 2812, 3437, 4062, 4687, 5312, 5937, 6562, 7187, 7812, 8437, 9062, 9687`. N = 200, S = 24 → `0..8, 18, 31, 43, 56, 68, 81, 93, 106, 118, 131, 143, 156, 168, 181, 193` (6 collides with the head, so 8 fills in). N = 10, S = 24 → `0..9`.

A sample keeps its summary row plus the full trace (format owned by the strategy spike, PLAYBOOK §5.7), **capped at 2,000 rounds and 512 KB of serialized JSON per sample and 8 MB per run**. A truncated trace is flagged `truncated: true`; Watch re-simulates the rest. **Best, worst and median** sessions are not stored: the analysis names their indices (§11.14) and Watch re-simulates them through `aux`. When a re-simulation returns a summary row that differs from the stored row, Watch shows "this run was made with a different engine version" (this happens for imported or legacy runs).

---

## 6. Run lifecycle, resume and cancel

### 6.1 States

```
queued → running ⇄ paused
running → done | cancelled | error
paused  → running | cancelled
cancelled → running            ("Continue": same as resume)
error     → running            (after an app update, if versions match)
(reload while running)  → paused  with interrupted = true
```

### 6.2 Flush schedule (checkpointing to IndexedDB)

A flush happens on **whichever comes first**: 16 merged batches since the last flush; 2 s since the last flush; pause; cancel; done; `visibilitychange → hidden`; `pagehide`; `freeze` (Page Lifecycle).

A flush is **one `readwrite` transaction over `runs` + `runParts`**: `put` each pending part (`{ runId, firstChunk, chunkCount, columns, checkpoints, chunks, samples }`) and `put` the updated `RunMeta` (bitmap, `completedSessions`, `timing`). Because the bitmap and the parts commit together, the store is consistent at any crash point. The in-memory state may run ahead of the store; what counts as durable is the last committed bitmap. Only one flush runs at a time; if a second is requested meanwhile, it is coalesced and runs next.

**Done:** a single compaction transaction `put`s `summaries`, `checkpoints`, `breakdowns` (the chunk stats arrays), `samples` and the final `RunMeta` (`status: 'done'`, `resultsDigest`), then deletes `runParts` in `IDBKeyRange.bound([runId, 0], [runId, Infinity])`.

### 6.3 Pause, resume, cancel

- **Pause:** stop dispatching; in-flight batches (≤ 2 per worker, ≤ ~0.5 s) finish and are merged; flush; `status = paused`. Workers stay alive (60 s idle timeout).
- **Cancel:** `worker.terminate()` on every pool worker; in-flight results are discarded; flush the merged data; `status = cancelled`. The data is kept and can be analyzed on its prefix (§6.5) or continued. "Delete run" is a separate action.
- **Resume / Continue:** this requires `meta.coreVersion === core.version && meta.gameVersion === game.version`. If the versions differ, Resume is disabled with "made with an older version: analyze what was completed, or run again". Otherwise: load the parts (or the compacted records), rebuild the in-memory columns, compute the missing chunks from the bitmap, and dispatch them in ascending order. `timing.elapsedMs` accumulates; each resume appends `{ at, completedSessions }` to `meta.resumes`.
- **Reload mid-run:** on app start, every run with `status: 'running'` that is not locked by another tab (§6.4) becomes `paused` with `interrupted: true`. Home and the Run screen offer **Resume**.
- **Phone sleep:** workers may be throttled or frozen; nothing special is required. `visibilitychange` events are appended to `meta.visibility` (capped at 50 entries). If the browser discards the page, the reload path applies.

### 6.4 Multi-tab

The executing tab holds a Web Lock `spinner:run:<runId>` (`navigator.locks.request(name, { ifAvailable: true }, …)`) for the whole execution. Another tab that opens the run sees "running in another tab" and its controls are disabled. If the Locks API is missing (all target browsers have it), there is no lock and a warning is logged.

### 6.5 Analysis domain of an incomplete run

The chunks that are complete when a run is paused or cancelled are **not** an outcome-independent sample. Whether an in-flight batch finished depends on how long its sessions were, and long sessions are the ones that survive. Analysis therefore uses only the **longest completed chunk prefix**: sessions `0 … N' − 1`, with `N' = chunkSize × (first missing chunk)`, capped at `sessions`. Chunks completed beyond the prefix are kept for resume but are not analyzed. The UI says "analyzing the first N' of N sessions". The Quick check is exactly the first 200 sessions of the same seed, so its verdict is the prefix of the full run.

---

## 7. Errors and storage failures

| Event | Behavior |
|---|---|
| Strategy runtime error / engine exception in a session | session `endedBy = error`; listed in chunk errors; warning on Analyze: "k sessions ended in error" |
| Worker crash | retry once on a fresh worker; on a second crash the run goes to `error` |
| IDB unavailable at boot | memory backend; `persistent: false` banner "Results are not saved; export to keep them" |
| `QuotaExceededError` during a flush | the run continues in memory; `meta.storage = 'memory'` (data already committed stays consistent); banner; Export offered when done |
| Pre-run size check | `bytes ≈ sessions × (rowBytes + K × 4) × 1.1`; if `navigator.storage.estimate()` reports `quota − usage < bytes`, warn before starting |
| First run | call `navigator.storage.persist()` once (result kept in `settings`) |

---

## 8. Definition layer (`src/core/experiment`)

### 8.1 Normalization (before hashing, storing or running)

`normalizeDefinition(def, ctx: { plugin, library }) → NormalizedDefinition`, applied in this order:

1. `migrateDefinition` to the current schema (both `definition.schema` and `strategy.schema`).
2. `strategy: { ref }` → inline the library strategy (PLAYBOOK §6). Where it came from is library metadata, not part of the definition.
3. `game.rules`: a string `"european"` → `{ preset: "european", overrides: {} }`. Overrides whose value equals the preset's resolved value are pruned (`plugin.rules.resolve`). Override keys are sorted by canonicalization anyway.
4. Defaults made explicit: `session.roundsPerHour` = the plugin pace (40); `run.checkpointSchedule = 'auto'`; `run.sampleSessions = 24`. Absent `stopWin`/`stopLoss` stay absent (they are not set to `null`).
5. `tags`: trimmed, deduplicated, sorted. Empty strings and empty `notes` are removed.
6. Numbers: `-0 → 0`. `NaN`/`±Infinity` are rejected. Cents and counts must be safe integers (`not-integer` error).
7. Validation (the strategy spike's validator plus the harness checks: `sessions ∈ [1, 100000]`, `maxRounds ∈ [1, 100000]`, `bankroll ∈ [1, 1e8]`, `seed` a uint32, `sessions × maxRounds ≤ 5e8`, schedule limits). `defineExperiment` refuses to run with errors.

### 8.2 Canonical JSON

This is RFC 8785 (JCS) restricted to our value space. Object keys are sorted by UTF-16 code units (`Array.prototype.sort()` default). There is no whitespace. Numbers use ECMAScript `Number.prototype.toString` (i.e. `JSON.stringify(n)`). Strings use `JSON.stringify` (well-formed escaping, ES2019+). `undefined` members are omitted. Arrays keep their order.

```ts
export function canonicalJson(v: Json): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number': if (!Number.isFinite(v)) throw new Error('non-finite'); return JSON.stringify(Object.is(v, -0) ? 0 : v);
    case 'string': case 'boolean': return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k]!)}`).join(',')}}`;
}
```

### 8.3 Identity

- `definitionId = hex(sha256(utf8(canonicalJson(normalized))))`: 64 lowercase hex characters, shown as its first 12. It uses `crypto.subtle.digest('SHA-256')` when available (secure contexts and workers). Otherwise (plain `http://` on a LAN phone during development) it falls back to a ~60-line pure-TS SHA-256 in `src/core/experiment/sha256.ts`, tested against the same vectors.
- **The whole normalized definition is hashed, `name`/`notes`/`tags` included** (PLAYBOOK §6; open question Q2). A separate `simKey = sha256(canonical(normalized without name, notes, tags, strategy.name, strategy.notes)) + gameVersion + coreVersion` detects "you already ran this" and lets a sweep reuse a finished run.
- `runKey = sha256(canonicalJson({ definitionId, gameVersion, coreVersion }))`: the key under which results must be identical.
- `runId = definitionId[0..16] + '-' + crockfordBase32(5 random bytes)` (lowercase, 8 characters), for example `f8126470b3609e8a-7k2m9qxd`. `runId8` is the 8-character suffix.

**Vectors:**

- `sha256("")` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; `sha256("abc")` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
- The fixture `tests/fixtures/definitions/flat-red.json` normalizes to the 418-byte canonical string below:

```
{"game":{"id":"roulette","rules":{"overrides":{},"preset":"european"}},"name":"Flat red","run":{"checkpointSchedule":"auto","sampleSessions":24,"seed":42,"sessions":10000},"schema":1,"session":{"bankroll":100000,"maxRounds":500,"roundsPerHour":40},"strategy":{"game":"roulette","id":"flat-red","name":"Flat red","schema":1,"stages":[{"id":"main","layout":[{"amount":{"units":1},"bet":"red"}],"rules":[]}],"unit":2500}}
```

  Its `definitionId` is `f8126470b3609e8aae6ec3c8667ff63ded8cbd819e7c6e25366f1d0832d7f0a5`. (The strategy body follows PLAYBOOK §3.6 syntax and is re-pinned if the strategy spike changes the schema.)

### 8.4 Share links

```
#/define?d=<payload>[&h=<definitionId first 12 hex>]
payload = 'z' + base64url(deflateRaw(utf8(canonicalJson(normalized))))   // CompressionStream('deflate-raw')
        | 'j' + base64url(utf8(canonicalJson(normalized)))                 // when CompressionStream is missing
```

- base64url is RFC 4648 §5 with no padding. Links are written with `'z'` whenever possible.
- If `payload.length > 8000`, the app offers no link and says "too long for a link: export the definition file".
- On open: decode, inflate (`DecompressionStream`; if it is missing for a `'z'` link, the app says the browser is too old), `JSON.parse`, migrate, normalize, validate, and show the result in Define as an **unsaved draft**. If `h` is present and the schema is current, a hash mismatch shows "link damaged or edited". A link never carries results.
- Size vector: the flat-red fixture is 558 base64url characters uncompressed and 327 compressed (Node zlib `deflateRawSync` level 9; browser output can differ by a few bytes, and only the round trip is tested, not these bytes).

### 8.5 Schema versioning

`definition.schema` and `strategy.schema` start at 1. `migrateDefinition(x)` applies `MIGRATIONS[v]: (x_v) => x_{v+1}` until current. `x.schema > current` is refused ("made with a newer version"). Every past schema has fixtures under `tests/fixtures/definitions/v<n>/`, and a test loads each one, migrates it, validates it, and checks that its migrated hash is stable.

---

## 9. Store (`src/core/store`)

### 9.1 IndexedDB database `spinner` (name injected by the app), version 1

| Store | keyPath | Indexes | Value (all records carry `v: 1`) |
|---|---|---|---|
| `definitions` | `id` (definitionId) | `byUpdated` (`updatedAt`) | `{ id, definition: NormalizedDefinition, createdAt, updatedAt, derivedFrom?, origin: 'user'\|'preset'\|'link'\|'import'\|'gallery', runIds: string[] }` |
| `strategies` | `id` (library uuid) | `byUpdated` | `{ id, strategy, hash, createdAt, updatedAt, derivedFrom? }` |
| `runs` | `runId` | `byDefinition` (`definitionId`), `byCreated` (`createdAt`), `byStatus` | `RunMeta` (§16.2) |
| `runParts` | `['runId','firstChunk']` | none | `RunPart` (during execution only) |
| `summaries` | `runId` | none | `{ runId, columns: { name, dtype, width, data: TypedArray }[] }` |
| `checkpoints` | `runId` | none | `{ runId, schedule: Int32Array, equity: Int32Array }` |
| `breakdowns` | `runId` | none | `{ runId, chunkSize, chunks: ChunkStatsColumns }` (per-chunk arrays concatenated) |
| `samples` | `runId` | none | `{ runId, samples: SampleSession[] }` |
| `groups` | `id` | `byUpdated` | `ExperimentGroup` (compare or sweep, §13) |
| `settings` | `key` | none | `{ key, value }` |

Typed arrays are stored natively (structured clone). Deleting a run deletes `runs`, `runParts`, `summaries`, `checkpoints`, `breakdowns`, `samples` in one transaction, and removes the runId from `definitions.runIds` and from groups.

Upgrades: `onupgradeneeded` runs `UPGRADES[oldVersion + 1 … newVersion]` (structural changes only). Record contents are migrated lazily on read using `v`. `onblocked` shows "close other spinner tabs to update". `onversionchange` closes the connection.

### 9.2 Backend interface

```ts
interface Backend {
  readonly kind: 'idb' | 'memory';
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: StoreName, index?: string, range?: IDBKeyRange): Promise<T[]>;
  tx(stores: StoreName[], mode: 'readonly' | 'readwrite', fn: (t: TxOps) => void): Promise<void>; // atomic
}
```

The memory backend implements this with `Map`s and `structuredClone` on put/get, so tests catch aliasing bugs. The same suite runs against both backends (fake-indexeddb is not needed if the architecture spike prefers the memory one in node; otherwise `fake-indexeddb` is a dev dependency).

### 9.2a Renaming an experiment

An experiment is a `DefinitionRecord`; its runs point at it by `definitionId`. A rename (`Repo.renameDefinition`)
changes `definition.name` and `updatedAt` only. The record id (so `definitionId`, `runKey` and the run id prefix)
never changes, and `simKey` ignores names. Run meta stores no name: every screen resolves the live name through the
record, so a rename needs no other write (there is no snapshot to update). Names are trimmed, non-empty, at most 120
characters; duplicates are allowed.

The id is a hash of the whole definition, name included, so a renamed record no longer hashes to its own id. The record
keeps `idName`, the name the id was minted with (cleared when renamed back). Run files carry it as the optional
`definitionIdName`, and the importer checks the hash with it. A file keeps the name it had when exported; importing a
run whose definition already exists locally keeps the local (live) name.

### 9.3 Opening and fallback (prior-art policy)

`openStore()` **never throws**. It tries `indexedDB.open(name, 1)` with a 4 s timeout. On a `SecurityError`, an `InvalidStateError`, a missing `indexedDB`, the timeout, or a `VersionError` (the stored DB is newer: "data from a newer version of the app, update to see it"), it returns the memory backend with `persistent: false`. It does not delete or overwrite anything it cannot read.

---

## 10. Export and import formats

### 10.1 Run bundle `<slug>-<runId8>.spinner.json[.gz]`

`slug` = the kebab-cased definition name (ASCII, at most 40 characters, `run` if empty). The bundle is written as **canonical JSON** (§8.2), so export → import → export is byte-identical, and it carries **no export timestamp**. When `CompressionStream('gzip')` exists, the default is `.gz`. Import detects gzip by its magic bytes `1f 8b`, not by the file name.

```ts
interface RunBundleV1 {
  format: 'casino-lab-run'; version: 1;
  app: { id: string; version: string }; core: { version: string }; game: { id: string; version: string };
  definitionId: string; definition: NormalizedDefinition;
  meta: { runId: string; createdAt: string; sessions: number; chunkSize: number; resultsDigest: string;
          partial?: { of: number }; trimmed?: { checkpoints: number[] /* kept schedule indices */; samples: number };
          imported?: { appVersion: string; importedAt: string } };   // set on the stored run, not in files we write
  labels: RunLabels;                                  // stages, categories, reasons
  schedule: number[];
  columns: EncodedArray[];                            // one per summary ColumnSpec, in order, with name
  checkpoints: EncodedArray;                          // i32, shape [sessions, K]
  chunks: Record<string, EncodedArray> & { rejectedByReason: Record<string, number>[]; deferredByReason: Record<string, number>[]; errors: SessionError[] };
  samples: SampleSession[];
}
interface EncodedArray { name?: string; dtype: 'i32' | 'u8' | 'u16' | 'f64' | 'f64i'; shape: number[];
  encoding: 'le' | 'zv' | 'dzv'; data: string /* base64, RFC 4648 §4, padded */ }
```

Encodings (all implemented with `DataView`, explicitly little-endian):

- `le`: the raw little-endian bytes of the typed array.
- `zv`: each value zigzag-encoded (`(v << 1) ^ (v >> 31)` for i32, the BigInt-free 53-bit form `v ≥ 0 ? 2v : −2v − 1` for f64i) and written as unsigned LEB128. This is the default for i32, u16 and f64i summary columns.
- `dzv`: along the last axis, the first value is taken relative to 0 and every following value relative to its predecessor; then `zv`. This is the default for the checkpoint matrix (equity changes little between adjacent checkpoints).
- f64 columns (`expectedLoss`, `variance`, `expCum`, …) are always `le`.

The encoders are pure and deterministic, so re-encoding the decoded arrays reproduces the same bytes.

A **partial export** (a paused or cancelled run) contains only the analysis prefix (§6.5): `meta.sessions = N'` and `partial.of = N`. An imported partial run can be analyzed but not resumed.

A **gallery trim** (an export option) keeps every summary column, keeps the 48 checkpoints chosen by `trimSchedule(schedule, 48)` (all dense-head points up to round 16, then evenly spaced by index, always the last), and keeps at most 6 samples. Trimmed bundles keep the **full-run** `resultsDigest` and add `trimmed`. Their digest cannot be re-verified on import (the UI shows "trimmed: verified at export").

Size estimate for 10,000 × 500 roulette with 6 categories, trimmed: summaries ≈ 10k × (≈ 40 B varint + 16 B f64) ≈ 0.56 MB; checkpoints ≈ 10k × 48 × ≈ 2 B ≈ 0.96 MB; with base64 ×4/3 and then gzip, that is ≈ 1.3–1.8 MB. So a full 10k run usually fits under the 2 MB gallery limit only when trimmed; the CI limit decides.

### 10.2 Import pipeline

1. Read the bytes, gunzip if the magic matches, decode UTF-8, `JSON.parse`. Each failure produces a precise message.
2. `format === 'casino-lab-run'`, otherwise the file is refused ("not a spinner run file"; a `casino-lab-library` file is routed to the library import).
3. `version > 1`: refused ("made with a newer version"). Otherwise `migrateRun` chain (`RUN_MIGRATIONS[v]`).
4. `game.id !== plugin.id`: refused ("this file is a craps run; open it in the craps lab").
5. Shape validation: every array's decoded length matches `shape`; `sessions` and `K` agree everywhere; the labels match the column widths; the definition validates (errors are shown, but import still proceeds read-only).
6. Unless the bundle is trimmed, recompute `resultsDigest`; a mismatch is refused ("file damaged").
7. Store the run with `imported: { appVersion: bundle.app.version, importedAt }` and status `done`. If the `runId` exists locally with the same digest: "already in your library". If it exists with a different digest, a new suffix is assigned.
8. Re-simulation (Watch, best/worst/median) is allowed only when `gameVersion` and `coreVersion` equal the app's; otherwise only the stored samples can be watched.

### 10.3 CSV `<slug>-<runId8>.summaries.csv`

RFC 4180, UTF-8 without BOM, CRLF line endings, comma separator, header row. Money is in **dollars, formatted from integer cents exactly** (`-12.50`, never through floats); float money uses 4 decimals; z uses 4 decimals. Columns, in order:
`session, final, net, peak, trough, max_drawdown, rounds_played, rounds_wagered, wagered, expected_loss, sd, luck_z, ended_by, stop_stage, rejected, deferred, max_exposure, rounds_in:<stageId>…, wagered:<category>…, net:<category>…`. Here `sd = sqrt(variance)/100`, `luck_z` is defined in §11.4 (empty when variance = 0), and `ended_by` is the string form (`strategy:<reason>`).

Also exported:

- `fan.csv`: `checkpoint, round, hours, p5, p25, p50, p75, p95, mean, expected, alive_share`, as net in dollars.
- `definition.json`: the normalized definition, as pretty JSON with 2-space indentation.

CSV is export-only.

### 10.4 Library backup `spinner-library.json`

`{ format: 'casino-lab-library', version: 1, app, definitions[], strategies[], groups[], settings }` (no runs). Import merges by id (existing ids are kept, and the incoming copy is skipped and reported).

---

## 11. Metrics (copy this section to `docs/metrics.md`)

### 11.0 Notation and conventions

- The **analysis domain** is sessions `i = 0 … N−1`: the completed chunk prefix (§6.5); for a done run, N = `sessions`. Every metric uses this domain.
- `B` = bankroll; `x_i = net_i` (cents); `L_i = −x_i` (realized loss); `W_i` = wagered; `E_i` = expectedLoss (analytic); `V_i` = variance (analytic, conditional); `R_i` = roundsPlayed; `R^w_i` = roundsWagered; `ρh` = `session.roundsPerHour`.
- `z = 1.959963984540054` (95%). All intervals are 95%.
- Sums run in index order (and chunk stats in chunk order). Sums of i32 and f64i columns are exact in doubles while `N · max|v| < 2^53`.
- A CI is shown only when N ≥ 30; below that the UI shows the point value with "too few sessions for an interval". Probabilities always show their Wilson interval (it is valid for small N).
- Display rounding: money to the cent (to the dollar when |v| ≥ $1,000), probabilities to 0.1 pp, z to 0.01.

### 11.1 Quantiles: Hyndman–Fan type 7 (R default, NumPy `linear`)

For sorted values `s_0 ≤ … ≤ s_{N−1}` and `p ∈ [0,1]`: `h = (N − 1) · p`, `j = floor(h)`, `q(p) = s_j + (h − j) · (s_{j+1} − s_j)`, and `q(p) = s_{N−1}` when `j + 1 ≥ N`. Computed in exactly this order. Sorting is done on a copy (`Int32Array.prototype.sort` / `Float64Array.prototype.sort`, which are numeric).

Reported set: p1, p5, p10, p25, p50 (median), p75, p90, p95, p99, plus min = `s_0` and max = `s_{N−1}`.

**Quantile CI** (distribution-free, by order statistics, 1-indexed ranks): `l = max(1, floor(Np − z√(Np(1−p))))`, `u = min(N, ceil(Np + z√(Np(1−p))) + 1)`, and `CI = [s_{l−1}, s_{u−1}]` (0-indexed). Vectors: N = 10000, p = 0.5 → ranks (4902, 5099); N = 100, p = 0.5 → (40, 61); N = 10000, p = 0.05 → (457, 544).

Fixture `X = [−2500, −2500, 0, 2500, 7500, −10000, 5000, −5000, 2500, −2500]`: q(0) = −10000, q(.05) = −7750, q(.10) = −5500, q(.25) = −2500, q(.5) = −1250, q(.75) = 2500, q(.9) = 5250, q(.95) = 6375, q(1) = 7500 (compare to 1e−9).

### 11.2 Mean, SD, SE, skew

- `mean = (1/N) Σ x_i`.
- `SD s = sqrt( Σ (x_i − mean)² / (N − 1) )` (two-pass; N = 1 gives `s = 0`).
- `SE = s / √N`; `CI(mean) = mean ± z·SE`.
- Skew (adjusted Fisher–Pearson) `G1 = N / ((N−1)(N−2)) · Σ ((x_i − mean)/s)³`; it is undefined when N < 3 or s = 0.
- Fixture X: mean = −500, s = 5109.90323891863, SE = 1615.893285805443, G1 = −0.24982777265876538.

### 11.3 Probabilities and the Wilson interval

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

### 11.4 Expected vs realized, and luck

- Mean analytic expected loss `Ē = (1/N) Σ E_i`; mean realized loss `L̄ = −mean`.
- **Expected net line** (histogram marker) = `−Ē`.
- **Session luck** `z_i = (x_i + E_i) / √V_i`. It is defined when `V_i > 0`; positive means luckier than the house edge predicts.
- **Run luck** `Z = Σ (x_i + E_i) / √(Σ V_i)`. Justification: `x_i + E_i` is a sum over rounds of martingale differences (realized minus conditional expected net), and its variance is `E[Σ V_i]`, so `Z ≈ N(0, 1)` by the martingale CLT. This holds even for adaptive strategies and early stops.
- Labels: |Z| < 1 "ordinary"; 1–2 "a bit lucky/unlucky"; 2–3 "unusual"; ≥ 3 "very unusual: check the strategy or report a bug".
- The distribution of `z_i` is shown as a histogram on the *Overview → Luck* disclosure.

### 11.5 Edge and cost of play

- Realized edge `e_r = Σ L_i / Σ W_i`. Analytic edge `e_a = Σ E_i / Σ W_i`. Both are undefined when `Σ W = 0`.
- `SE(e_r) = √(Σ V_i) / Σ W_i`, so `(e_r − e_a)/SE(e_r) = −Z`. `CI(e_r) = e_r ± z·SE(e_r)`. This is the §12 Monte-Carlo cross-check: `|e_r − e_a| ≤ 3·SE(e_r)`.
- Expected loss per round `ℓ = Σ E_i / Σ R_i`; per wagered round `Σ E_i / Σ R^w_i`; per 100 rounds `100ℓ`; per hour `ℓ · ρh`; per session `Ē`.
- **Cost of play** = expected loss per hour = `ℓ · ρh`; this is the headline in the hours framing.
- Realized loss per hour = `(Σ L_i / Σ R_i) · ρh` with `CI = (CI of e_r) × Σ W_i / Σ R_i × ρh`.

### 11.6 Histogram (Freedman–Diaconis with snapping; zero is always an edge)

Input values `v_i` (net, maxDrawdown, maxExposure, roundsPlayed or z_i).

1. `IQR = q(.75) − q(.25)`; `h0 = 2·IQR·N^(−1/3)`. If `h0 = 0`: `h0 = 3.49·s·N^(−1/3)` (Scott). If still 0: one bin `[v, v+1)`.
2. **Granularity** `g = gcd(|v_i − v_0|)` over all i (integer data; `g = 1` when all values are equal, and floats use `g = 0`, which skips the gcd rounding).
3. **Nice width**: `h` = the smallest value ≥ h0 of the form `m·10^k` with `m ∈ {1, 2, 2.5, 5}`, then rounded up to a multiple of g (`h = ceil(h/g)·g` when g > 0). Money is in cents; counts use `k ≥ 0`.
4. Edges are anchored at multiples of h, so **0 is an edge**: `lo = floor(min/h)·h`, `k = floor((max − lo)/h) + 1` bins; bin `b = floor((v − lo)/h)`, half-open `[lo + b·h, lo + (b+1)·h)`.
5. If `k > 120`, h is replaced by the next nice value until `k ≤ 120`. If `k < 5` and `g < h`, h is replaced by the previous nice value ≥ g while `k ≤ 120`.
6. Output: `{ lo, width: h, counts: Uint32Array, zeroBin, markers: { zero: 0, expected: −Ē, mean } }`.

Fixture X: IQR = 5000, h0 = 2·5000·10^(−1/3) = 4641.59; g = 2500; nice → 5000 (already a multiple of 2500); lo = −10000; bins `[−10000, −5000):1, [−5000, 0):4, [0, 5000):3, [5000, 10000):2`.

### 11.7 Volatility

- `SD per session = s` (from §11.2).
- `SD per round σ_r = √(Σ V_i / Σ R_i)` (pooled analytic). The empirical counterpart `s / √(mean R)` is shown alongside.
- `SD per hour = σ_r · √ρh`; `SD per 100 rounds = 10 σ_r`.
- Signal ratio `mean / s`.
- Spread ratio `(q(.9) − q(.1)) / Ē` ("the typical spread is k× the expected cost"; undefined when Ē ≤ 0).

### 11.8 Drawdown and exposure

- `maxDrawdown_i` (§3.1): mean, its CI, the quantile set and the histogram. `P(maxDrawdown ≥ B/2)` and `P(maxDrawdown ≥ B)` with Wilson intervals.
- `maxExposure_i`: quantile set and histogram; `P(maxExposure ≥ tableMax)` for the even-money class max (from the plugin's resolved rules) with Wilson. This answers "how big did the Martingale get?".
- Trough: quantiles of `trough_i − B`.

### 11.9 Session length

`R_i`: mean and CI, quantile set, histogram. Sat-out share `1 − Σ R^w_i / Σ R_i`. Hours = `R / ρh`.

### 11.10 Breakdowns (where the money went)

Per category c: `wagered_c = Σ_i catWagered_ic`, `net_c = Σ_i catNet_ic`, `expected_c = Σ_chunks catExpected_c`, realized edge `−net_c / wagered_c`, analytic edge `expected_c / wagered_c`.

Per stage s: rounds `Σ_i stageRounds_is` (and its share of `Σ R_i`), wagered, net, expected (from chunk sums); entries = `Σ` of column s of `transitions` (+N for the entry stage); the transition matrix; the stop-stage distribution (`stopStage` counts).

Rejected/deferred: totals by reason code, with the share of sessions with `rejected > 0` (Wilson). **A non-zero rejected total always shows a warning.** The per-category net sums to the total net exactly; a test asserts this.

### 11.11 Convergence

- Running mean `m_n = (1/n) Σ_{i<n} x_i` and `s_n` (Welford in index order), evaluated at n ∈ the **convergence grid**: `n_j = ceil(N^(j/199))` for j = 0..199, deduplicated, with N always included. The `N^(j/199)` uses `Math.pow`; it is display only. The band is `m_n ± z·s_n/√n` (n ≥ 30).
- Running P(bust) and P(ahead) with Wilson bands on the same grid.
- **Suggested session count** for a target half-width:
  - Mean: `N* = ceil((z·s / h*)²)`. The default `h* = max(100, 0.1·|Ē|)` cents (10% of the expected loss, at least $1), user-adjustable. Vector: flat $25 red, 500 spins, single zero: `s ≈ 2500·√500·√(1 − (1/37)²)`, `Ē = 500·2500/37`, so N* = 1052.
  - Probability: `N* = ceil(z²·p̃(1−p̃) / h_p²)` with `p̃ = max(p̂, 1/N)` (never 0) and the default `h_p = 0.01`.
  - Verdict: "big enough" when the current half-width ≤ target for both mean net and P(bust); otherwise "run about N* sessions for ±target".

### 11.12 Fan chart and survival

These are specified in §12 (they are part of `docs/metrics.md` too).

### 11.13 Comparisons

Specified in §13.1 (part of `docs/metrics.md`).

### 11.14 Representative sessions

`worst` = argmin net, `best` = argmax net, `median` = the session at rank `floor((N−1)/2)` of a stable sort by `(net, index)`. Ties go to the smallest index.

### 11.15 Analytic oracles (tests)

- **Gambler's ruin** (flat even-money bet, win probability `p = 18/37`, `q = 1 − p`, `r = q/p`, start a units, stop at 0 or n units, no round cap): `P(ruin) = (r^a − r^n)/(1 − r^n)`. Vector: a = 40, n = 80 → 0.8968485629704275. Expected duration `D = a/(q−p) − (n/(q−p))·(1 − r^a)/(1 − r^n)`. The harness end-to-end test runs 20,000 sessions with `maxRounds` large enough (cap hits < 0.1%) and asserts P(bust) within its Wilson interval and mean R within 3 SE of D.
- **Flat betting**: net is a sum of `R` i.i.d. terms; with no stops `E[net] = −R·unit·(1/37)` and `Var = R·unit²·(1 − 1/37²)`. The test asserts mean and SD within 3 SE (SE of SD ≈ s/√(2N)), and checks the analytic `ΣV_i / N` equals `Var` exactly.

---

## 12. Fan chart and survival computation

### 12.1 Fan chart

For each checkpoint c (round `t_c = schedule[c]`):

- Gather column c of the checkpoint matrix over the domain (`equity[i·K + c]`, i < N) into a reused `Int32Array(N)`, sort it, and take type-7 quantiles p5, p25, p50, p75, p95 of `equity − B` (net). Cost: K sorts of N elements (≈ 130 ms for 10k × 128 on a laptop; the analysis runs once per open run and is memoized by `(runId, N)`).
- `mean_c = (1/N) Σ (equity_ic − B)`.
- **Expected line** `exp_c = −(1/N) Σ_chunks expCum_c` (chunk prefix). It is exact for the true mean: `E[equity_c] = B − E[cumulative expected loss to min(t_c, R_i)]` by optional stopping. A test asserts `|mean_c − exp_c| ≤ 4·SE_c` on presets.
- `alive_c = S(t_c)` from §12.2, shown as a thin strip under the fan.
- The x-axis is rounds, or hours `t/ρh`. The y-axis is net, so runs with different bankrolls compare.
- **Live preview** while running: the same computation on the current prefix, throttled to 1 Hz, on at most 24 checkpoints (the first, the last and evenly spaced indices), using `quickselect` on a copy. The final view uses the exact sort.

### 12.2 Survival (exact)

Counting pass over the domain: `cnt[r] = #{i : R_i = r}` for r = 0..maxRounds, and `cntBy[k][r]` per ended-by class k.

- `S(r) = 1 − (1/N) Σ_{j<r} cnt[j]`: the share that **completed at least r rounds** ("still playing at round r"). `S(0) = 1`; `S(maxRounds)` = the share that reached the cap. This is computed for every r (O(N + maxRounds)).
- Cause-specific cumulative incidence `F_k(r) = (1/N) Σ_{j≤r} cntBy[k][j]`. `S(r+1) + Σ_k F_k(r) = 1`, and a test asserts it.
- Wilson CIs at the checkpoint rounds. Median survival = the smallest r with `S(r) ≤ 0.5`, otherwise "more than half reached the cap".
- The chart is a step line S(r) plus a stacked area of `F_bust`, `F_stop-win`, `F_stop-loss`, `F_strategy`, `F_error`, each with a text label (the meaning never depends on color alone).

---

## 13. Compare and sweep

### 13.1 Compare (common random numbers)

A compare view takes 2–6 runs of the same game id. The **baseline** is the first run; every other run is differenced against it.

**Pairing rule.** Paired iff `run.seed` is equal **and** `gameVersion` and `coreVersion` are equal. The domain is then the common prefix `n = min(N_A, N_B)`, aligned by session index. Otherwise the comparison is **Welch** over each run's own domain. The view states the method: "Paired by session (same seed: common random numbers)" or "Unpaired (Welch)". It also shows the CRN correlation `ρ = corr(x^A, x^B)` and the variance reduction `1 − Var(d)/(Var(x^A) + Var(x^B))`. Pairing is statistically valid whenever pairs are independent across i, which holds for any two runs. Equal seeds make it informative: the same spins per session give large ρ. The definition editor's "Compare with…" copies the seed and the session config (PLAYBOOK §9.6). If the session configs differ, the view adds a note but stays paired.

**Differences reported** (B minus A):

| Quantity | Paired | Unpaired |
|---|---|---|
| Mean net | `d_i = x^B_i − x^A_i`; `d̄ ± z·s_d/√n` | `x̄_B − x̄_A ± z·√(s_A²/N_A + s_B²/N_B)`; Welch–Satterthwaite df `ν = (a + b)² / (a²/(N_A−1) + b²/(N_B−1))` with `a = s_A²/N_A`, `b = s_B²/N_B` (shown; z is used since N ≥ 30) |
| P(ahead), P(bust), P(stop-*) | indicator differences `δ_i = 1[B_i] − 1[A_i]`: `δ̄ ± z·s_δ/√n`, plus discordant counts `b, c`; a note when `b + c < 10` | Newcombe hybrid score: `lo = Δ − √((p_B − l_B)² + (u_A − p_A)²)`, `hi = Δ + √((u_B − p_B)² + (p_A − l_A)²)` (Wilson l, u). Vector: 56/70 vs 48/80 → Δ = 0.2, CI [0.052431, 0.333873] |
| Mean expected loss, mean wagered, mean R, mean maxDrawdown | as mean net | as mean net |
| Realized edge | `Δe = e_B − e_A`, with SE from per-session paired residuals `u_i = (L^B_i − e_B W^B_i)/W̄_B − (L^A_i − e_A W^A_i)/W̄_A`: `SE = s_u/√n` | `√(SE_A² + SE_B²)` (§11.5) |
| Medians and quantiles | no difference CI; each run's own quantile CI side by side | same |

Overlays: histogram outlines on one shared bin grid (§11.6 computed on the pooled values), fan medians (p50) and the p25–p75 band of the baseline only, survival curves. With more than two runs, every difference is against the baseline, without multiplicity correction, with a footnote.

### 13.2 Sweep

```ts
interface SweepSpec { path: string /* RFC 6901 pointer into the normalized definition */; values: Json[] }
```

- **Allowed paths:** any existing scalar leaf **except** `/schema`, `/game/id`, `/run/*` (seed and sessions stay those of the base, so every variant shares the CRN streams), `/strategy/schema` and `/strategy/game`. 2 ≤ values ≤ 24; numbers are strictly increasing; strings are distinct. A path that does not exist in the base is an error (no implicit creation in v1).
- Each variant = `normalize(setPointer(base, path, value))` with `name = "<base name> · <label>=<value>"`. It is validated individually; an invalid variant blocks the sweep and the error is listed against its value.
- **Execution:** the variants are queued in value order on the run queue, each as its own run using the whole pool. If a done run with the same `simKey` exists, it is reused. The total time estimate is the sum of the variants' estimates; the warning threshold is 120 s.
- **Group record:** `ExperimentGroup { id, kind: 'sweep', name, baseDefinitionId, sweep, variantDefinitionIds[], runIds[], createdAt, updatedAt }` in `groups`. The group status is derived from its runs.
- **Analysis:** for each value, mean net ± CI, the p10/p50/p90 band, P(ahead) and P(bust) with Wilson, the realized/analytic edge, Ē, mean R and p95 maxExposure. The adjacent differences (`v_{j+1} − v_j`) use §13.1, paired (same seed). The x-axis is categorical for strings and linear for numbers (log when `max/min ≥ 20`).
- 2-D sweeps are a chip.

---

## 14. Perf budget and how it is measured

### 14.1 Budget

| Device | P (workers) | Budget for the reference run | Implied throughput |
|---|---|---|---|
| 4-core laptop | 3 | < 20 s | 5,000,000 rounds / 20 s = 250k rounds/s → ≥ 83.4k rounds/s per worker, overhead included |
| Mid-range Android (Pixel 6a) | 7 | < 90 s | ≥ 55.6k rounds/s total |
| CI (`ubuntu-latest`, 4 vCPU) | 3 | < 60 s (generous) | trend only |

The **reference run** `tests/fixtures/perf-reference.json` is 10,000 × 500 European spins, seed 1, bankroll $5,000, unit $25, no session stops (so almost every session plays all 500 rounds; the run cannot get faster by busting early). The 3-stage strategy, in PLAYBOOK §3.6 syntax (re-pinned to the strategy spike's final schema):

- `warm`: flat red 1u; after 20 rounds in the stage, go to `mart`.
- `mart`: Martingale on red, maxSteps 6, onCap reset; at `net ≥ +50000` go to `flat`; at `net ≤ −150000` go to `warm`.
- `flat`: dozens 1 and 2 at 1u each; after 50 rounds go to `warm`.

Its pinned `resultsDigest` doubles as a cross-engine determinism check.

### 14.2 Measurement

1. **Micro-benchmark** (`tests/perf/loop.bench.ts`, Vitest bench, node, single thread): `runBatch` for the reference definition over 64 sessions, repeated. It reports rounds/s. Local target ≥ 150k rounds/s. CI fails below 40k (generous) and posts the number to `$GITHUB_STEP_SUMMARY`.
2. **End-to-end** (`tests/perf/run.spec.ts`, Playwright, the pinned Chromium, a production build served by `vite preview` on `$PORT`): it opens `#/settings/benchmark`, which runs the reference definition through the real pool and the real IndexedDB store.
   - It measures `t0` = the click on Run (pool spin-up included) and `t1` = the commit of the `done` compaction transaction.
   - It also records sessions/s, rounds/s, `P`, the longest main-thread long task (`PerformanceObserver('longtask')`; it must stay < 200 ms, and merges must be < 2 ms each), the peak JS heap (`performance.memory` where present), and the `resultsDigest`.
   - The page exposes the result as `data-bench` JSON on the benchmark card (no globals), and the test asserts `t1 − t0 < PERF_BOUND_MS`. The default is 20000 locally and 60000 when `CI` is set; the environment can override it. The test asserts that the digest equals the pinned digest.
   - It runs alone (not in parallel with e2e; there are 4 cores in the container).
3. **Phone:** the same Settings → *Benchmark this device* screen. On each release the orchestrator, or a person, runs it on a Pixel 6a-class phone (Chrome, plugged in, screen on) and records `device, browser, P, ms, rounds/s, digest` in `docs/perf.md`. A result over 90 s blocks the release (a §15 definition-of-done item).
4. **Determinism tests** (functional, in Vitest with the in-thread transport): the reference definition with 2,000 sessions, run with P = 1, 2 and 4 and with forced dispatch sizes `k ∈ {1, 3, 64}`, plus a resume from a random partial bitmap, plus two separate runs. All of them must give the same `resultsDigest`.

### 14.3 Engineering rules that make the budget

- Per worker the compile happens once. The session loop reuses the `Xoshiro128ss`, the scratch layout arrays, the observation object and the per-session accumulators (no per-round allocation; verified by a heap-snapshot test of 100k rounds showing < 1 MB growth).
- The plugin's `expectedLossPerRound`/`variancePerRound` is memoized per **layout signature** inside the worker (a roulette layout repeats every spin under a flat or Martingale stage). The cache is keyed by a string built only when the layout changed.
- Results are transferred, never cloned. The main thread does no per-session work during a run except `TypedArray.set`.
- The trace is built only for sample indices.

---

## 15. Gallery build step

- **Source:** `gallery/*.spinner.json` or `gallery/*.spinner.json.gz` (committed with Git LFS **off**; plain files). Optional `gallery/order.json`: `string[]` of file names giving the display order (if absent, files sort by name).
- **Plugin:** `build/vite-plugin-gallery.ts`, which exports `galleryPlugin({ dir = 'gallery', maxBundleBytes = 2_097_152, maxTotalBytes = 20_971_520 })`.
  - In `buildStart` it reads every bundle and checks its on-disk size against `maxBundleBytes` and the folder total (bundles plus `order.json`) against `maxTotalBytes`. It gunzips with `node:zlib`, parses, and runs the same `importRun` validation as the app (`src/core/store/bundle.ts` is pure and runs in node), including the digest check for untrimmed bundles. It computes the headline metrics with `src/core/analysis`. Any violation fails with `this.error('gallery/<file>: <reason>')`, so `npm run build` fails in CI.
  - It emits `gallery/index.json` (an asset) and copies the bundles to `dist/gallery/` unchanged.
  - In dev (`configureServer`) it serves the same index and files from memory and rebuilds on change.
- **Index format** (deterministic, no timestamps, canonical JSON):

```ts
interface GalleryIndexV1 {
  format: 'casino-lab-gallery'; version: 1; app: { id: string; version: string };
  totalBytes: number;
  entries: {
    file: string; bytes: number; sha256: string;             // of the file as committed
    slug: string; title: string; notes?: string; tags: string[];
    game: { id: string; version: string }; coreVersion: string;
    definitionId: string; runId: string; resultsDigest: string; trimmed: boolean; partial: boolean;
    sessions: number; maxRounds: number; bankroll: number; roundsPerHour: number;
    headline: { meanNet: number; seMean: number; pAhead: number; pAheadCI: [number, number];
                pBust: number; pBustCI: [number, number]; expectedLossPerHour: number };
  }[];
}
```

- **App:** `#/gallery` fetches `gallery/index.json` (relative to the base URL) and lists the cards with headline numbers. Opening one fetches the bundle and imports it **into memory only** (read-only; "Save to my library" copies it into IDB as `origin: 'gallery'`). The service worker caches the index (network-first) but not the bundles (they are cached on open).
- **CI:** `npm run build` enforces the limits. A unit test of the plugin covers oversize, a bad digest, the wrong game and an empty folder (an empty folder gives `entries: []`).
- **Curating:** Analyze → Export → "For the gallery" makes a trimmed `.spinner.json.gz` (§10.1). The contributor commits it under `gallery/`, and CONTRIBUTING documents this.

---

## 16. Proposed contracts

These files contain types and constants only. Function declarations are listed for the WP0 stubs (`throw new Error('not implemented')`). `StrategyDefinition`, `SessionTrace` and `ValidationIssue` come from the strategy spike's `strategy.ts`; `GamePlugin` comes from `game.ts`.

### 16.1 `src/core/contracts/experiment.ts`

```ts
import type { Cents, GamePlugin } from './game';
import type { StrategyDefinition, ValidationIssue } from './strategy';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export const DEFINITION_SCHEMA = 1 as const;

export interface RulesRef { preset: string; overrides: Record<string, Json> }

export interface SessionConfig {
  bankroll: Cents;              // 1 … 100_000_000
  maxRounds: number;            // 1 … 100_000
  stopWin?: Cents;              // stop when equity − bankroll ≥ stopWin (> 0)
  stopLoss?: Cents;             // stop when bankroll − equity ≥ stopLoss (> 0)
  roundsPerHour?: number;       // default: plugin pace (normalized: always present)
}

export interface RunConfig {
  sessions: number;             // 1 … 100_000
  seed: number;                 // uint32
  checkpointSchedule?: 'auto' | number[];
  sampleSessions?: number;      // 0 … 100, default 24
}

export interface ExperimentDefinition {
  schema: typeof DEFINITION_SCHEMA;
  name: string; notes?: string; tags?: string[];
  game: { id: string; rules: string | RulesRef };
  strategy: StrategyDefinition | { ref: string };
  session: SessionConfig;
  run: RunConfig;
}

/** Output of normalizeDefinition: strategy inlined, rules as RulesRef, defaults explicit. */
export interface NormalizedDefinition extends ExperimentDefinition {
  game: { id: string; rules: RulesRef };
  strategy: StrategyDefinition;
  session: SessionConfig & { roundsPerHour: number };
  run: Required<Pick<RunConfig, 'sessions' | 'seed' | 'checkpointSchedule' | 'sampleSessions'>>;
}

export type DefinitionId = string;   // 64 lowercase hex, sha256 of canonical JSON
export type SimKey = string;         // 64 hex; ignores name/notes/tags; includes versions

export interface DefinitionRecord {
  v: 1; id: DefinitionId; definition: NormalizedDefinition;
  createdAt: string; updatedAt: string; derivedFrom?: DefinitionId;
  origin: 'user' | 'preset' | 'link' | 'import' | 'gallery';
  runIds: string[];
}
export interface StrategyRecord {
  v: 1; id: string; strategy: StrategyDefinition; hash: string;
  createdAt: string; updatedAt: string; derivedFrom?: string;
}

export interface SweepSpec { path: string; values: Json[] }
export interface ExperimentGroup {
  v: 1; id: string; kind: 'compare' | 'sweep'; name: string;
  baseDefinitionId?: DefinitionId;              // sweep
  sweep?: SweepSpec;                            // sweep
  variantDefinitionIds?: DefinitionId[];        // sweep, in value order
  runIds: string[];                             // compare: baseline first
  createdAt: string; updatedAt: string;
}

export interface NormalizeContext {
  plugin: Pick<GamePlugin<unknown, unknown, unknown>, 'id' | 'rules' | 'pace' | 'bets' | 'facts'>;
  resolveStrategyRef(ref: string): StrategyDefinition | undefined;
}
export type NormalizeResult =
  | { ok: true; definition: NormalizedDefinition; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

export const SHARE_LINK_MAX_CHARS = 8000;

// Public API (src/core/experiment):
export declare function migrateDefinition(x: unknown): ExperimentDefinition;   // throws DefinitionFormatError
export declare function normalizeDefinition(d: ExperimentDefinition, ctx: NormalizeContext): NormalizeResult;
export declare function canonicalJson(v: Json): string;
export declare function sha256Hex(data: string | Uint8Array): Promise<string>;
export declare function definitionId(d: NormalizedDefinition): Promise<DefinitionId>;
export declare function simKey(d: NormalizedDefinition, gameVersion: string, coreVersion: string): Promise<SimKey>;
export declare function encodeShareLink(d: NormalizedDefinition): Promise<{ hash: string } | { tooLong: true; chars: number }>;
export declare function decodeShareLink(hashParams: URLSearchParams): Promise<{ definition: ExperimentDefinition; checksumOk: boolean | null }>;
export declare function setPointer(d: NormalizedDefinition, path: string, value: Json): ExperimentDefinition;
export declare function sweepPathAllowed(path: string): boolean;
```

### 16.2 `src/core/contracts/run.ts`

```ts
import type { Cents } from './game';
import type { DefinitionId, NormalizedDefinition } from './experiment';
import type { SessionTrace, ValidationIssue } from './strategy';

export const SIM_PROTOCOL = 1 as const;
export const RUN_FORMAT = 'casino-lab-run' as const;
export const RUN_FORMAT_VERSION = 1 as const;
export const SUMMARY_SCHEMA = 1 as const;

export type Dtype = 'i32' | 'u8' | 'u16' | 'f64' | 'f64i';
export interface ColumnSpec { name: SummaryColumn; dtype: Dtype; width: 1 | number /* S or C for wide columns */ }
export type SummaryColumn =
  | 'final' | 'net' | 'peak' | 'trough' | 'maxDrawdown' | 'roundsPlayed' | 'roundsWagered'
  | 'wagered' | 'expectedLoss' | 'variance' | 'endedBy' | 'stopStage' | 'rejected' | 'deferred'
  | 'maxExposure' | 'stageRounds' | 'catWagered' | 'catNet';

export const ENDED_BY = { rounds: 0, bust: 1, 'stop-win': 2, 'stop-loss': 3, error: 4 } as const;
export const ENDED_BY_STRATEGY_BASE = 16;     // 16 + index into RunLabels.reasons
export type EndedBy = 'rounds' | 'bust' | 'stop-win' | 'stop-loss' | 'error' | `strategy:${string}`;

export interface RunLabels { stages: string[]; categories: string[]; reasons: string[] }

/** Struct of arrays, length = sessions × width. */
export interface SummaryTable {
  sessions: number;
  final: Int32Array; net: Int32Array; peak: Int32Array; trough: Int32Array; maxDrawdown: Int32Array;
  roundsPlayed: Int32Array; roundsWagered: Int32Array;
  wagered: Float64Array; expectedLoss: Float64Array; variance: Float64Array;
  endedBy: Uint8Array; stopStage: Uint8Array; rejected: Uint16Array; deferred: Uint16Array;
  maxExposure: Int32Array;
  stageRounds: Int32Array;   // sessions × S, session-major
  catWagered: Float64Array;  // sessions × C
  catNet: Float64Array;      // sessions × C
}
export interface SummaryRow {
  index: number; final: Cents; net: Cents; peak: Cents; trough: Cents; maxDrawdown: Cents;
  roundsPlayed: number; roundsWagered: number; wagered: Cents; expectedLoss: number; variance: number;
  endedBy: EndedBy; stopStage: string; rejected: number; deferred: number; maxExposure: Cents;
  stageRounds: number[]; catWagered: Cents[]; catNet: Cents[];
}

export interface CheckpointSketch { schedule: Int32Array; equity: Int32Array /* sessions × K, session-major */ }

export interface SessionError { index: number; code: string; message: string }
export interface ChunkStats {
  chunk: number;
  expCum: Float64Array;          // K
  catExpected: Float64Array;     // C
  stageWagered: Float64Array; stageNet: Float64Array; stageExpected: Float64Array; // S
  transitions: Int32Array;       // S × S
  rejectedByReason: Record<string, number>;
  deferredByReason: Record<string, number>;
  errors: SessionError[];
}
/** All chunks, struct of arrays (chunks × width), as stored in `breakdowns`. */
export interface ChunkStatsColumns {
  chunks: number;
  expCum: Float64Array; catExpected: Float64Array;
  stageWagered: Float64Array; stageNet: Float64Array; stageExpected: Float64Array;
  transitions: Int32Array;
  rejectedByReason: Record<string, number>[]; deferredByReason: Record<string, number>[];
  errors: SessionError[]; errorCount: number;
}

export interface SampleSession { index: number; row: SummaryRow; trace: SessionTrace; truncated: boolean }

export type RunStatus = 'queued' | 'running' | 'paused' | 'done' | 'cancelled' | 'error';
export interface RunMeta {
  v: 1;
  runId: string; definitionId: DefinitionId; simKey: string; runKey: string;
  gameId: string; gameVersion: string; coreVersion: string; appVersion: string;
  createdAt: string; status: RunStatus; interrupted?: boolean;
  sessions: number; completedSessions: number;  // durable (committed) count
  prefixSessions: number;                       // analysis domain N' (§6.5)
  chunkSize: number; chunks: number;
  bitmap: Uint8Array;                           // bit c set ⇔ chunk c durable; LSB-first within a byte
  schedule: Int32Array; labels: RunLabels; columns: ColumnSpec[];
  storage: 'idb' | 'memory';
  device: { cores: number; workers: number; ua: string };
  timing: { startedAt?: string; finishedAt?: string; elapsedMs: number };
  resumes: { at: string; completedSessions: number }[];
  visibility: { at: string; state: DocumentVisibilityState }[];   // capped at 50
  resultsDigest?: string;                       // when done (or on import)
  error?: { code: string; message: string };
  imported?: { appVersion: string; importedAt: string; fileSha256: string; trimmed: boolean; partial: boolean };
}

export interface RunPart {
  runId: string; firstChunk: number; chunkCount: number; firstSession: number; count: number;
  columns: ArrayBuffer[]; checkpoints: ArrayBuffer; chunks: ChunkStats[]; samples: SampleSession[];
}

// Worker protocol (§5.1)
export type ToSim =
  | { t: 'ping' }
  | { t: 'init'; runKey: string; definition: NormalizedDefinition; schedule: Int32Array; chunkSize: number; sessions: number }
  | { t: 'batch'; runKey: string; batchId: number; firstChunk: number; chunkCount: number; traceIndices: number[] }
  | { t: 'simulate'; reqId: number; definition: NormalizedDefinition; index: number; schedule?: Int32Array }
  | { t: 'dispose' };
export type FromSim =
  | { t: 'pong'; protocol: number; coreVersion: string; game: { id: string; version: string } }
  | { t: 'ready'; runKey: string; labels: RunLabels; columns: ColumnSpec[] }
  | { t: 'init-error'; runKey: string; errors: ValidationIssue[] }
  | { t: 'batch-done'; runKey: string; batchId: number; firstChunk: number; chunkCount: number;
      firstSession: number; count: number; columns: ArrayBuffer[]; checkpoints: ArrayBuffer;
      chunks: ChunkStats[]; samples: SampleSession[]; elapsedMs: number }
  | { t: 'simulated'; reqId: number; row: SummaryRow; checkpoints: Int32Array; trace: SessionTrace }
  | { t: 'error'; runKey?: string; batchId?: number; reqId?: number; code: string; message: string };

export interface SimTransport {
  readonly mode: 'worker' | 'inthread';
  post(msg: ToSim, transfer?: Transferable[]): void;
  onMessage(fn: (msg: FromSim) => void): () => void;
  terminate(): void;
}

export interface RunProgress {
  runId: string; status: RunStatus; completedSessions: number; prefixSessions: number; sessions: number;
  sessionsPerSec: number; etaMs: number | null; workers: number; storageBytes?: number;
}
export interface RunController {
  readonly runId: string;
  start(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>; cancel(): Promise<void>;
  subscribe(fn: (p: RunProgress) => void): () => void;
  /** Current in-memory data for live preview (prefix only). */
  snapshot(): RunData;
}

/** Everything the analysis reads; prefix already applied (sessions = N). */
export interface RunData {
  meta: RunMeta; definition: NormalizedDefinition; sessions: number;
  summary: SummaryTable; checkpoints: CheckpointSketch; chunkStats: ChunkStatsColumns; samples: SampleSession[];
}

// Constants (§4, §5)
export const CHECKPOINT_BUDGET_VALUES = 4_194_304;   // sessions × K ≤ this for 'auto'
export const CHUNK_ROUNDS = 16_384;
export const BATCH_TARGET_MS = 250;
export const FLUSH_EVERY_BATCHES = 16;
export const FLUSH_EVERY_MS = 2000;
export const MAX_SESSIONS = 100_000;
export const MAX_ROUNDS = 100_000;

// Public API (src/core/harness, src/core/rng, src/core/store):
export declare function checkpointSchedule(maxRounds: number, sessions: number, spec: 'auto' | number[]): Int32Array;
export declare function chunkSizeFor(maxRounds: number): number;
export declare function sampleIndices(sessions: number, samples: number): number[];
export declare function resultsDigest(data: RunData): Promise<string>;
export declare function encodeRunBundle(data: RunData, opts?: { gzip?: boolean; trimForGallery?: boolean }): Promise<Uint8Array>;
export declare function decodeRunBundle(bytes: Uint8Array, gameId: string): Promise<{ data: RunData } | { error: string }>;
export declare function summariesCsv(data: RunData): string;
```

### 16.3 `src/core/contracts/analysis.ts`

```ts
import type { Cents } from './game';
import type { RunData, EndedBy } from './run';

export const Z95 = 1.959963984540054;
export const MIN_N_FOR_CI = 30;

export interface Interval { lo: number; hi: number; level: 0.95 }
export interface Estimate { value: number; se?: number; ci?: Interval }      // ci absent when N < 30
export interface Proportion { k: number; n: number; p: number; ci: Interval } // Wilson, always
export type QuantileKey = 'p1' | 'p5' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p95' | 'p99';
export interface Distribution {
  n: number; mean: Estimate; sd: number; skew: number | null; min: number; max: number;
  q: Record<QuantileKey, number>; medianCI?: Interval; histogram: Histogram;
}
export interface Histogram {
  lo: number; width: number; counts: Uint32Array; zeroBin: number | null;
  markers: { zero?: number; expected?: number; mean?: number };
}

export interface RunMetrics {
  n: number; of: number;                               // prefix N and total sessions
  net: Distribution;
  probabilities: {
    ahead: Proportion; even: Proportion; behind: Proportion;
    bust: Proportion; stopWin: Proportion; stopLoss: Proportion; cap: Proportion; error: Proportion;
    strategy: Record<string, Proportion>;
  };
  expected: { meanExpectedLoss: number; meanRealizedLoss: Estimate; expectedNetLine: number;
              luckZ: number | null; luckLabel: 'ordinary' | 'mild' | 'unusual' | 'very-unusual' | null;
              sessionZ: Histogram | null };
  edge: { realized: Estimate | null; analytic: number | null;
          expectedLossPerRound: number; perWageredRound: number; per100: number; perHour: number;
          perSession: number; costOfPlayPerHour: number; realizedLossPerHour: Estimate | null };
  volatility: { sdSession: number; sdRoundAnalytic: number; sdRoundEmpirical: number; sdHour: number;
                sdPer100: number; signalRatio: number | null; spreadRatio: number | null };
  drawdown: Distribution & { pHalfBankroll: Proportion; pFullBankroll: Proportion };
  exposure: Distribution & { pAtTableMax: Proportion | null };
  trough: Distribution;
  length: Distribution & { satOutShare: number; hours: Estimate };
  breakdown: Breakdown;
  representative: { best: number; worst: number; median: number };   // session indices
}

export interface Breakdown {
  categories: { id: string; wagered: Cents; net: Cents; expected: number; realizedEdge: number | null; analyticEdge: number | null }[];
  stages: { id: string; rounds: number; roundShare: number; wagered: Cents; net: Cents; expected: number; entries: number; stops: number }[];
  transitions: { from: string; to: string; count: number }[];
  rejected: { total: number; byReason: Record<string, number>; sessionsWithRejections: Proportion };
  deferred: { total: number; byReason: Record<string, number> };
  errors: { total: number; first: { index: number; code: string; message: string }[] };
}

export interface FanChart {
  rounds: Int32Array;                  // schedule
  p5: Float64Array; p25: Float64Array; p50: Float64Array; p75: Float64Array; p95: Float64Array;
  mean: Float64Array; expected: Float64Array; alive: Float64Array;   // net cents; alive as a share
}
export interface Survival {
  maxRounds: number;
  alive: Float64Array;                                 // S(r), r = 0..maxRounds
  incidence: Partial<Record<'bust' | 'stop-win' | 'stop-loss' | 'strategy' | 'error' | 'rounds', Float64Array>>;
  medianRounds: number | null;
}
export interface Convergence {
  n: Int32Array; mean: Float64Array; lo: Float64Array; hi: Float64Array;
  pBust: Float64Array; pBustLo: Float64Array; pBustHi: Float64Array;
  pAhead: Float64Array; pAheadLo: Float64Array; pAheadHi: Float64Array;
  target: { meanHalfWidth: number; pHalfWidth: number };
  suggested: { forMean: number; forBust: number };
  bigEnough: boolean;
}

export type CompareMethod = 'paired' | 'welch';
export interface DiffEstimate { value: number; se: number; ci: Interval; df?: number }
export interface PairDiff {
  baseline: string; other: string; method: CompareMethod; n: number;
  crn?: { rho: number; varianceReduction: number };
  meanNet: DiffEstimate; meanExpectedLoss: DiffEstimate; meanWagered: DiffEstimate;
  meanRounds: DiffEstimate; meanMaxDrawdown: DiffEstimate; realizedEdge: DiffEstimate | null;
  probabilities: Record<'ahead' | 'bust' | 'stopWin' | 'stopLoss', DiffEstimate & { discordant?: [number, number] }>;
  notes: string[];                                     // e.g. 'session configs differ', 'few discordant pairs'
}
export interface CompareResult { runIds: string[]; metrics: RunMetrics[]; diffs: PairDiff[]; sharedHistogram: { lo: number; width: number; counts: Uint32Array[] } }

export interface SweepPoint { value: unknown; runId: string; metrics: RunMetrics }
export interface SweepResult { path: string; points: SweepPoint[]; adjacent: PairDiff[]; xScale: 'categorical' | 'linear' | 'log' }

// Public API (src/core/analysis): pure, no DOM
export declare function quantile7(sorted: ArrayLike<number>, p: number): number;
export declare function quantileCI(sorted: ArrayLike<number>, p: number, z?: number): Interval;
export declare function wilson(k: number, n: number, z?: number): Interval;
export declare function newcombe(k1: number, n1: number, k2: number, n2: number, z?: number): Interval;
export declare function meanSd(xs: ArrayLike<number>): { mean: number; sd: number; n: number };
export declare function histogramFD(values: ArrayLike<number>, opts?: { integer?: boolean; maxBins?: number; markers?: Histogram['markers'] }): Histogram;
export declare function runMetrics(d: RunData): RunMetrics;
export declare function fanChart(d: RunData, opts?: { live?: boolean; maxPoints?: number }): FanChart;
export declare function survival(d: RunData): Survival;
export declare function convergence(d: RunData, targets?: Partial<Convergence['target']>): Convergence;
export declare function compareRuns(runs: RunData[]): CompareResult;
export declare function sweepResult(path: string, values: unknown[], runs: RunData[]): SweepResult;
export declare function representativeSessions(d: RunData): { best: number; worst: number; median: number };
export declare function endedByLabel(code: number, reasons: string[]): EndedBy;
```

---

## 17. Test plan (harness, store, analysis)

| Area | Tests |
|---|---|
| rng | every §1.3 vector; the mix64 property test vs BigInt; `below` uniformity chi-square over 37 pockets (1e6 draws, p > 1e−4); no allocation in 1e6 `next()` |
| schedule / chunk / samples | §4, §5.3 and §5.6 vectors; custom schedule validation |
| determinism | §14.2 item 4; two runs of one definition give an equal digest; Quick check rows equal the first 200 rows of the full run |
| resume / cancel | kill the transport at random batch boundaries (memory and IDB backends), resume, then compare the digest; after a cancel, the store bitmap always matches the parts present; the prefix rule (§6.5) gives N' |
| store | the same suite on both backends; quota error injection (the backend throws `QuotaExceededError` on the k-th put): the run completes in memory and the store stays consistent; `VersionError` → memory; delete removes every record |
| export / import | round trip byte-identical (uncompressed); gzip detect by magic; every past format fixture under `tests/fixtures/runs/v<n>/` imports; wrong game, newer version, bad digest and length mismatch each give their message; CSV header and money formatting (`-0.01`, `-12.50`, `1234567.89`) |
| definition | the canonical JSON vector and the definitionId vector; key order independence (shuffled keys give the same id); normalization idempotence (`normalize(normalize(d))` equals `normalize(d)`); share link round trip, the 8000-character limit, and a bad `h` warning; migration fixtures |
| analysis | every §11 vector (quantiles, mean/SD/SE/skew, Wilson, Newcombe, quantile-CI ranks, histogram of X, N*); survival identity `S(r+1) + ΣF = 1`; fan on a hand-made 4×5 checkpoint fixture; the expected line vs the mean within 4 SE on presets; per-category net sums to the total; the paired diff of a run with itself gives 0 ± 0; Welch df on a reference pair |
| oracles | gambler's ruin and flat betting (§11.15); Monte-Carlo edge within 3 SE of analytic for every preset (§12) |
| gallery | plugin tests (oversize, digest, wrong game, empty), a deterministic index (built twice gives equal bytes) |
| perf | §14.2 items 1–3 |

---

## Open questions

The work proceeds on the first option of each.

**Q1. How does the game plugin get its randomness?**
1. **`createState(rules, rng: Rng)` with a core `Xoshiro128ss`; a fixed number of `below` calls per round (roulette: 1).** This keeps common random numbers exact, keeps the RNG in core (shared by every family app), and lets the session loop reuse one RNG object. *(recommended)*
2. Keep `createState(rules, seed: number)` from the PLAYBOOK §4 draft and let the plugin seed its own RNG. The harness would pass the low 32 bits of `sessionSeed(i)`, the seed space drops to 2^32, and each plugin re-implements seeding.
3. Pass the 4-word state `Uint32Array(4)` and let the plugin wrap it.

**Q2. What does `definitionId` hash?**
1. **Everything in the normalized definition (PLAYBOOK §6), plus a separate `simKey` that ignores name/notes/tags for "already ran this" detection and sweep reuse.** *(recommended)*
2. Only the semantic part, so renaming keeps the id. The library then needs its own record id, and two library entries can share an id.
3. Everything, with no `simKey`.

**Q3. What happens to the in-flight work of an interrupted run?**
1. **Analyze only the longest completed chunk prefix (§6.5); keep the other completed chunks for resume.** No duration bias. *(recommended)*
2. Analyze every completed chunk. This uses more data but is biased toward short sessions.
3. Discard partial runs on cancel.

**Q4. How should the gallery bundle size be handled?**
1. **Varint plus delta encodings, with an explicit "For the gallery" trim (48 checkpoints, 6 samples) that keeps all summary rows; CI enforces 2 MB / 20 MB.** *(recommended)*
2. Raw little-endian base64 only (the PLAYBOOK text): a full 10k × 500 bundle is ≈ 9 MB, so gallery runs would need ≤ 2,000 sessions.
3. Store only the definition and the digest in the gallery, and re-simulate on open (≈ 20 s on a laptop, more on phones; breaks after an engine version bump).

**Q5. Which interval should small-N means use?**
1. **z everywhere, with no interval shown below N = 30 (Wilson is always shown for rates).** *(recommended)*
2. Student t with a small inverse-t implementation, for N ≥ 2.

**Q6. What is the default pool size on phones with many small cores?**
1. **`hc − 1` capped at 8, then verify on the Pixel 6a with the benchmark screen; switch to `hc/2` for `hc ≥ 8` if 7 workers is not faster.** *(recommended)*
2. `hc/2` from the start.
3. Benchmark on first use and persist the best P per device.
