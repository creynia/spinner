# Shared core: audit and plan

Spike output for PLAYBOOK §11 ("Shared-core plan") and Appendix A. Authority: `decisions.md` >
this file. Scope: what crappy (craps), baccaratton (baccarat) and holdumb (Ultimate Texas Hold'em)
duplicate today, what spinner's `src/core` should hold from day one so it can become
`casino-lab-core` (a git submodule mounted back at `src/core`), the game-plugin contract (§4)
checked against all three games, a migration plan for the existing apps, and open questions.

The three repos were read at: crappy `d1d30d1`, baccaratton `e0bad47`, holdumb `becd4ae`
(`/home/user/creynia/*`, read-only). "Diff lines" below are `diff a b | grep -c '^[<>]'`.

Similarity scale used throughout:

- **identical**: byte-identical, or differs only in the app name / a comment.
- **drifted**: same design and lineage; small, mergeable differences (bug fixes landed in one copy,
  renamed fields, extra options).
- **divergent**: same purpose, different code, coupled to one game's types; share the idea, not the file.

---

## 1. Duplication inventory

### 1.1 Repo scaffolding and tooling

All three were generated from the same scaffold (same file list outside `src/`, `content/`).
Lineage is crappy → baccaratton → holdumb; holdumb is usually newest, baccaratton newest for PWA.

| Piece | Paths (each repo) | Status | Notes |
|---|---|---|---|
| Editor/format | `.editorconfig`, `.prettierrc.json`, `.nvmrc`, `.gitignore`, `tsconfig.json` | identical ×3 | Copy verbatim. `.prettierignore` drifted (5–7 lines: per-app output names). |
| Community files | `CODE_OF_CONDUCT.md`, `.github/pull_request_template.md` | identical ×3 | `CONTRIBUTING.md`, `LICENSE` (year/name line), issue templates drifted. `lesson_idea.md` template is irrelevant to spinner. |
| `package.json` | root | drifted (4–9 lines) | Only `name`, `build:all` file name, one extra script each (`screenshots`, `gen:tables`); holdumb adds `overrides.playwright-core: 1.56.1`. Same deps and versions in all three. |
| TS configs | `tsconfig.app.json`, `tsconfig.node.json` | drifted (1–5 lines) | holdumb adds `paths` for `#ev-worker` and `allowImportingTsExtensions`; crappy excludes `tests/e2e`. |
| ESLint | `eslint.config.js` | crappy **divergent** (≈200 lines) from b/h; b ↔ h **drifted** (84 lines) | crappy: hand-written per-layer `group` lists (only three layers, `../` patterns of fixed depth). b/h: generated `layerRules(layer, depth)` blocks for depth 0..4 + alias globs + `no-restricted-globals` for pure layers, + a guard test `tests/build/layering.test.ts` (b 151 lines, h 68) that lints deliberately bad imports. b ↔ h differ only in `jobs` vs `worker` layer name and the `#ev-worker` alias rule. **The b/h generator is the one to port.** |
| Vite config | `vite.config.ts` | drifted (5–18 lines) | Same `base: './'`, `__SINGLE_FILE__`, `__APP_VERSION__`, `__BUILD_SHA__` defines; holdumb adds the `#ev-worker` alias (inline vs URL worker per build) and `worker.format`. |
| Vitest config | `vitest.config.ts` | drifted (8–16 lines) | Identical two-project design (`node` + `happy-dom` by glob); drift = `#ev-worker` alias to the in-thread transport, `__BUILD_SHA__`. |
| Playwright config | `playwright.config.ts` | b ↔ h drifted (2 lines); crappy drifted (34) | `PORT` env, `reuseExistingServer: !CI`, projects `mobile` 390×844, `phone-landscape` 844×390, `desktop`; perf only on mobile (b/h); crappy adds an opt-in `visual` project. |
| SW build plugin | `build/vite-plugin-sw.ts` | identical ×3 (modulo name) | 4 diff lines = plugin name and the single-file html name. Parameterise by `appName`. |
| Content plugin | `build/vite-plugin-content.ts` | drifted | Lesson/markdown pipeline. Not needed by spinner (no curriculum, §0 non-goals). |
| Icon generator | `scripts/gen-icons.mjs` | divergent (65–86 lines) | Same PNG-writer skeleton; per-brand art. Skeleton is shareable, art is not. |
| Single-file finaliser | `scripts/finalize-single.mjs` | drifted | Spinner: not in v1 (`decisions.md` #9). |
| CI | `.github/workflows/ci.yml` | b ↔ h drifted (4 lines); crappy drifted (38) | `check` (lint, typecheck, format, `build:all`, test) then `e2e`; crappy lacks `timeout-minutes`, has an advisory `visual` job. |
| Pages | `.github/workflows/pages.yml` | identical ×3 (crappy lacks one `timeout-minutes`) | Copy verbatim. |
| Release | `.github/workflows/release.yml` | drifted (11–15 lines, file names) | Uploads the single-file html; spinner does not need it in v1. |

### 1.2 Runtime modules (pure)

| Piece | Paths | Status | Notes |
|---|---|---|---|
| Seeded RNG | `src/sim/engine/rng.ts` | b ↔ h **identical**; crappy **drifted** (30 lines) | All three: splitmix32 seeding → xoshiro128\*\*, `RngState { s: [4 × u32] }`, immutable `[value, next]` returns. b/h add `randBelow(n)` (rejection, limit `2^32 − 2^32 mod n`) and Fisher–Yates `shuffle`. crappy has `rollDie` with `DIE_REJECT_LIMIT = 4294967292` = exactly `randBelow(6)` + 1, so **crappy's dice streams are bit-identical under the shared `randBelow`** (seed 42's first u32 is `660444221` in both test suites). |
| Seeds per session | `strategy/simulate.ts` | identical idea ×3 | "session i uses seed + i" fed to `seedRng` (32-bit, `Math.trunc(seed) \| 0`). No explicit seed mixing; spinner's harness spike defines one. |
| Exact fractions | `src/sim/math/fraction.ts` | b ↔ h **identical** (104 lines); crappy **drifted** (93 lines, 155 diff lines) | b/h: `Fraction { num, den }` (comment "D13: wire format"), ops `add sub mul div neg abs scale cmp eq lt… sum toNumber toFixed toRatio round`. crappy: `{ n, d }`, fewer ops, `roundToInt` returns bigint. holdumb also has a **second internal copy** `src/sim/strategy/fraction.ts` (36 lines, `fracAdd…`). |
| Money formatting | `src/sim/engine/money.ts` | b ↔ h identical; crappy drifted (6 lines) | `formatMoney(cents, {sign})` (ASCII minus, thousands commas, cents omitted when whole and ≥ $1) and exact `formatPct(fraction, digits)`. Only drift: `{n,d}` vs `{num,den}`. `Cents = number` (integer) everywhere. |
| Generator jobs | `engine/job.ts` (b, h identical); crappy none | identical b/h | `Job<Req,Res> = (req) => Generator<Progress \| undefined, Res>`; `Progress {done,total}`. |
| Sliced runner | b `src/sim/jobs/runner.ts` ↔ h `src/sim/worker/runner.ts` | identical (1 comment line) | `runSliced(job, req, {sliceMs, onProgress, isCancelled, yieldFn})`, `CancelledError`. |
| Worker protocol | b `jobs/protocol.ts` ↔ h `worker/protocol.ts` | drifted | h adds `PROTOCOL_VERSION`, `ToWorker` (`ping`/`run`/`cancel`), `FromWorker` (`pong`/`progress`/`done`/`error`); both have `EvClient.run(kind, req, {key, signal, onProgress})` with latest-wins per `key`. |
| Worker client/transport | h `worker/{client,host,transport*.ts,ev.worker.ts}`; b `jobs/client.ts` | **divergent** | holdumb is the only real Web Worker: transport abstraction (`worker` / `inthread` / `inline` for file://), ping-timeout fallback to in-thread, LRU memo by `canonicalJson`, MessageChannel yield. baccaratton is in-thread only ("Plan A"); crappy runs `simulateMany` chunked on the main thread. None has a **pool**, batches, checkpoints or resume — all new in spinner. |
| Event log / replay | `engine/log.ts` (b, h identical) | identical | `applyLogged`, `replayLog`. crappy has `replay` in `game.ts`. |
| Percentiles | `strategy/simulate.ts` private `percentile()` | **drifted, numerically different** | crappy: linear interpolation (`type 7`, numpy default). b/h: nearest rank rounding down `sorted[floor(p(n−1))]`. Same name, different p10/p50/p90 on screen. |
| Many-session summary | `SessionSeries` / `ManyResult` | divergent (same fields) | All three compute `p10/p50/p90` per round, `expected` line, `survival`, `finals`, `meanFinal`, `meanFinalCi95` (b/h), `bustRate`, `probAhead`; plus game-specific counters (points made, banker/player/tie, hand categories). This is exactly §8.2's summary table + §8.3 checkpoints, done three times. |
| EV / variance | crappy `math/ev.ts`, `math/luck.ts` (`makeVarianceFn`, `normalCdf`, `luckFrom`); b `math/{evs,edges,distribution}.ts`; h `math/{edges,enumerate,showdown,preflop}.ts`, `strategy/d36.exact.ts` | divergent (game math) | Generic part is tiny: `normalCdf`, z-score "luck", Wilson interval (crappy `strategy/streaks.ts`). Agreement tests exact-vs-MC exist in b (`agreement.test.ts`, `mc.test.ts`) and h (`mc.test.ts`). |
| Oracle tests | `engine/__tests__/oracle.ts` ×3 (+ h `settleOracle.ts`) | divergent (same pattern) | Independent re-implementation of the paytable, checked bet × outcome. Pattern goes into the conformance suite (§2.4); content stays per game. |
| Canonical JSON | h `worker/client.ts` `canonicalJson` | single copy | Sorted keys, bigint as `"<n>n"`, typed arrays as arrays. Seed for spinner's definition hashing (§6). |

### 1.3 UI and app shell

| Piece | Paths | Status | Notes |
|---|---|---|---|
| Hash router | `src/app/router.ts` + `tests/app/router.test.ts` | **identical ×3** | `parseHash`, `matchPath`, `useRoute`. Copy as is. |
| Tiny components | `src/app/components/{Html,Link,ProgressRing}.tsx` | identical ×3 | Spinner needs `Link`; `ProgressRing` is lesson UI. |
| Theme | `src/app/theme.ts` | b ↔ h identical; crappy drifted (10) | `data-theme`, reduced motion → instant speed. |
| Context | `src/app/context.tsx` | b ↔ h identical; crappy drifted (6) | App store context. |
| Persistence | `src/app/storage.ts` | b ↔ h drifted (110 lines); crappy divergent | Same design: `StorageLike`, `MemoryStorage`, probe-then-fallback `createStorage()` with `persistent` flag, one versioned key `<app>:v1`, `sanitize` + `migrate` by version, backup of unreadable data, read-only on newer data, `encodeExport/decodeImport` with an `<app>1:` prefix. Content (lesson progress, drills) is app-specific. No IndexedDB anywhere. |
| Store | `src/app/store.ts` | drifted b ↔ h (63), crappy divergent | Signals-free reducer store; app-specific state. |
| SW runtime | `src/pwa/sw.ts` | **identical** b ↔ h (cache prefix); crappy drifted | crappy **lacks the `cache: 'reload'` precache fix** (b/h test "update within the HTTP max-age window keeps a consistent offline cache"). |
| SW registration | `src/pwa/register.ts` | drifted (29–69 lines) | baccaratton newest: `updatesSupported()`, `checkForUpdates()` with 30 s timeout, prefers `installing` over `waiting`, `controllerchange` reload guard. |
| Update toast | b/h `src/pwa/UpdateToast.tsx` (identical), crappy `src/app/components/UpdateToast.tsx`; b/h `src/app/update.ts` | identical b/h | Inline-styled, imports nothing app-specific. |
| Toasts | `src/sim/ui/Toasts.tsx` | b ↔ h identical (one class name); crappy divergent (95 lines: swipe, auto-dismiss, hidden) | aria-live polite list. |
| Bankroll / fan chart | `src/sim/ui/BankrollChart.tsx` (+ b `SurvivalChart.tsx`, `OutcomeHistogram.tsx`; crappy `ResultsHistogram.tsx`, `EdgeChart.tsx`) | **divergent** (363–664 diff lines) | All hand-rolled SVG, no chart library: one-session line vs dashed exact-expected line; many sessions p10–p90 band + median + survival; colour **and** dash per series; text summary for a11y. b has the best reusable bits: `niceTicks`, `pathOf`, 8 validated `light-dark()` colour slots + dashes, `Legend`, `Swatch`. Each is typed to its own `SessionSeries`. |
| Chips, felt, layouts | `ChipRack`, `ChipStack`, `Felt`, `Table`, `layouts/*` | divergent | Per-game geometry. `layouts/types.ts` shares `Pt/Rect/minTapUnits` vocabulary only. |
| Sim panels | `SessionPanel`, `StatusBar`, `StepPanel`, `AutoPlayPanel` | divergent (same roles) | Same screens re-done per game; spinner's Run/Analyze replaces them. |
| Share links | crappy `src/sim/ui/shareLink.ts` (358 lines) | single copy | URL params for a sandbox state (rules preset, bets, RNG position). Spinner's share link is a definition hash/blob (§6) — new code, keep crappy's param hygiene (`describeSkipped`, max bankroll clamp). |
| Lesson/scene/content | `src/content/*`, `src/sim/scene/*`, `Quiz`, `LessonScene` | drifted/divergent | Curriculum machinery; out of scope (§0). Candidate for a *different* shared repo if the teaching apps ever want one. |

### 1.4 Tests and fixtures

| Piece | Paths | Status | Notes |
|---|---|---|---|
| e2e guard fixture | crappy `tests/e2e/helpers.ts` | single copy | Auto fixture: fails on console/page errors; `guard.check(state)` asserts no horizontal overflow. |
| e2e layout helpers | baccaratton `tests/e2e/helpers.ts` | single copy | `noHorizontalScroll`, `inViewport`, `tabTo` (real keyboard), `uncovered` (nothing covers the centre). |
| axe | crappy `a11y.spec.ts`, holdumb `a11y.spec.ts` + `axe.spec.ts` | drifted | Same filter (serious + critical, target list in message); h factors `clean(page)`. |
| Offline / SW e2e | b/h `tests/e2e/offline.spec.ts` (23 diff lines) | drifted | Offline after install; manifest/icons; consistent cache across an update; h adds "the precache includes the worker file". |
| Build tests | `tests/build/{sw,icons,layering,single-file}.test.ts` | drifted | sw: constants substituted, precache list, `cache: reload`, deletes only own caches, never self-skips waiting. |
| Perf e2e | b/h `tests/e2e/perf.spec.ts` | divergent | CPU-throttled budgets in the mobile project. |
| Unit fixtures | `tests/fixtures/content/*` | app-specific | Nothing reusable for spinner. |

**Summary.** Roughly 40% of each repo by file count is the same scaffold. The genuinely shareable
*code* is small but load-bearing: RNG, fractions, money format, the job/worker plumbing, PWA, router,
toasts, storage wrapper, ESLint layering generator, e2e helpers. The analysis layer (percentiles,
fan, survival, CI of the mean) is duplicated three times **with numeric drift**, and the charts three
times with no shared component: that is what spinner's `src/core` fixes first.

---

## 2. What spinner's `src/core` contains from day one

### 2.1 Extraction rules (make the future submodule a no-op move)

1. `src/core/**` imports nothing outside `src/core` (ESLint, as §11) **and uses only relative
   imports internally** — no `@core/*` inside core, so the submodule builds in its own repo
   without the app's alias config. Apps import it as `@core/<module>`.
2. **Sub-barrels, not one barrel.** `src/core/index.ts` re-exports only pure, DOM-free modules
   (`contracts`, `money`, `rng`, `strategy`, `experiment`, `harness` (protocol + session loop),
   `analysis`). `@core/ui`, `@core/pwa`, `@core/store` (IndexedDB) are imported by path. Reason: the
   worker bundle must never pull in Preact or IndexedDB through a barrel (holdumb's ESLint already
   forbids `preact` in pure layers for this reason).
3. Layers inside core, enforced by the same `layerRules(layer, depth)` generator ported from
   baccaratton/holdumb: `contracts ← nothing`; `money, rng ← contracts`; `strategy, experiment,
   analysis ← contracts, money, rng`; `harness ← all pure`; `store ← contracts, experiment`;
   `ui ← everything in core`; `pwa ← nothing`; `testing ← all pure`; `tooling` is node-only.
   No `document/window/localStorage/navigator` in pure layers (`no-restricted-globals`).
4. `src/core/README.md` states the extraction plan, the layer table, and the semver rule: any change
   to `contracts/*` is a minor bump at least; a change that alters RNG streams or summary-row
   semantics is a major bump (it changes run ids).
5. `src/core/VERSION` (or `contracts/version.ts`) exported as `CORE_VERSION`; it participates in
   run ids next to the plugin `version`.
6. Core-owned test files live next to the code (`*.test.ts`) so they move with it; the app's
   Vitest `include` already covers `src/**`.
7. Node-only code (`tooling/`) is excluded from `tsconfig.app.json` and included in
   `tsconfig.node.json`.

### 2.2 Folder plan

```
src/core/
  README.md  index.ts  VERSION
  contracts/   game.ts strategy.ts experiment.ts run.ts analysis.ts  (frozen; §3 changes applied)
  money/       cents.ts (Cents, assertCents, roundHalfAway), format.ts (formatMoney, formatPct)
  fraction/    fraction.ts  (Fraction {num, den}; full op set)            <- port baccaratton
  rng/         xoshiro.ts (seedRng, nextU32, randBelow, shuffle), seed.ts (mixSeed)  <- port b/h
  strategy/    (strategy spike)
  experiment/  canonical.ts (canonicalJson), hash.ts, migrate.ts, shareLink.ts
  harness/     job.ts runner.ts protocol.ts host.ts transport*.ts pool.ts session.ts  <- port holdumb, extend
  store/       local.ts (StorageLike/MemoryStorage/createStorage/versioned load)  <- port b/h
               idb.ts runs.ts export.ts                                          (new)
  analysis/    quantile.ts intervals.ts (wilson, meanCi) normal.ts metrics.ts fan.ts survival.ts …
  ui/          router.ts Link.tsx Toasts.tsx theme.ts
               charts/ scale.ts (niceTicks, pathOf) palette.ts (8 light-dark slots + dashes)
                       FanChart.tsx Histogram.tsx SurvivalChart.tsx Legend.tsx
  pwa/         register.ts UpdateToast.tsx update.ts sw.ts                       <- port baccaratton
  testing/     conformance.ts (plugin conformance suite), golden.ts, mc.ts (exact-vs-MC agreement)
  tooling/     eslint-layers.js vite-plugin-sw.ts vitest-preset.ts playwright-preset.ts
               e2e/ guard.ts helpers.ts axe.ts
```

`src/core/tooling` is the one unusual choice (node code under `src/`); it is what lets **one**
submodule carry the shared configs that §11 lists as candidates. See open question Q1.

### 2.3 Port now vs leave alone

**Port into spinner now** (adapt names to spinner; keep the tests that came with them):

| Module | From | Into | Change while porting |
|---|---|---|---|
| RNG | b/h `engine/rng.ts` + `rng.test.ts` | `core/rng/xoshiro.ts` | Add `mixSeed(runSeed, sessionIndex)` (harness spike decides the mixer; splitmix64-style on two u32 words is the obvious pick); keep the `660444221` snapshot so cross-app identity stays tested. Roulette uses `randBelow(37/38/39)`. |
| Fractions | b/h `math/fraction.ts` + h `fraction.test.ts` | `core/fraction/` | None. `{num, den}` is the core wire format. |
| Money | b/h `engine/money.ts` | `core/money/format.ts` | Import `Fraction` directly (no `FractionLike` workaround needed inside core). |
| Jobs + worker plumbing | h `worker/{job,runner,protocol,host,transport,transport-worker,transport-inthread}.ts`, `client.ts` | `core/harness/` | `createHost(jobs)` takes the job table as a parameter (today it imports `JOBS` statically, which would make core import the game). Keep ping/version, cancel, in-thread fallback, MessageChannel yield. Add the pool, batches and resume per the harness spike. Drop the LRU memo (runs are stored, not memoised). |
| canonicalJson | h `worker/client.ts` | `core/experiment/canonical.ts` | Also reject `undefined`/NaN/−0 (hashing must be total and stable). |
| Storage wrapper | b `app/storage.ts` (generic half) | `core/store/local.ts` | Generic: `StorageLike`, `MemoryStorage`, `createStorage()` → `{storage, persistent}`, `loadVersioned({key, version, migrate, sanitize})`, backup key, export prefix. Settings shape stays in `src/app`. |
| Router, Link | `app/router.ts` (identical ×3) + test, `components/Link.tsx` | `core/ui/` | None. |
| Toasts | b/h `sim/ui/Toasts.tsx` | `core/ui/Toasts.tsx` | Class names from a `toast-` prefix; no game text import. |
| Theme | b/h `app/theme.ts` | `core/ui/theme.ts` | Keep only `data-theme` + reduced-motion; drop `fourColorDeck`. |
| PWA | b `pwa/register.ts`, b/h `UpdateToast.tsx`, `update.ts`, b/h `sw.ts` | `core/pwa/` | Cache prefix and app name from build constants (`__APP_NAME__`); spinner must precache the worker chunk (holdumb test). Do not precache `gallery/*` bundles (≤ 20 MB) — runtime cache on first open. |
| SW vite plugin | `build/vite-plugin-sw.ts` (identical) | `core/tooling/vite-plugin-sw.ts` | `swPlugin({ appName, exclude })`. |
| ESLint layering | b/h `eslint.config.js` generator + `tests/build/layering.test.ts` | `core/tooling/eslint-layers.js` | Generic `layerRules({root, layers, allowed, depth})` used twice: for `src/{core,game,workers,app}` and for the layers inside `src/core`. Root `eslint.config.js` stays an app file (baton). |
| Vitest / Playwright presets | h `vitest.config.ts`, `playwright.config.ts` | `core/tooling/*-preset.ts` | Presets export objects; app configs spread them. Projects: `mobile` 390×844, `phone-landscape` 844×390, `small` 360×780 (§15), `desktop`. |
| e2e helpers | crappy guard fixture, b helpers, h `clean()` axe | `core/tooling/e2e/` | Merge into one `test` export with `guard` auto-fixture + `axeClean(page)` + layout helpers. |
| Analysis primitives | crappy `luck.ts` `normalCdf`, `streaks.ts` `wilson` | `core/analysis/` | Re-derived and pinned by tests (§12); `quantile()` is **one** function with a documented definition (Q5). |
| Chart helpers | b `BankrollChart.tsx` `niceTicks`, `pathOf`, palette slots | `core/ui/charts/` | New generic components over `Float64Array`s from the checkpoint sketch; keep the shared a11y rules (colour + dash, legend, text summary). |
| Config files | `.editorconfig`, `.prettierrc.json`, `.nvmrc`, `.gitignore`, `tsconfig.json`, CoC, PR template, `pages.yml` | repo root | Verbatim. `ci.yml` from holdumb minus the single-file artifact, plus `submodules: recursive` once core is extracted. |

**Leave alone** (do not port):

- Game engines, math, strategies, presets of all three apps: they become plugins only when a lab
  for that game is built (craps lab first, Appendix A), in that lab's repo.
- Lesson/content/scene/quiz/drill machinery (`src/content`, `src/sim/scene`, `vite-plugin-content`,
  `ProgressRing`, `Quiz`): spinner has no curriculum.
- Table/felt/chip components and layouts: per-game art; spinner's table view is its own.
- crappy's richer `Toasts` (swipe, roll toasts) and `shareLink.ts` (sandbox state, not definitions).
- `finalize-single.mjs`, `release.yml`, `vite-plugin-singlefile`: single-file build is a chip.
- `gen-icons.mjs`: copy holdumb's skeleton into spinner's `scripts/` with roulette art; not core.

### 2.4 Plugin conformance suite (new, highest-value shared test)

`core/testing/conformance.ts` exports `describeGamePlugin(plugin, fixtures)` that every plugin runs
(roulette now; craps, baccarat, UTH later). It encodes the §4 rules once instead of per game:

1. Determinism: same `(rules, seed, bankroll)` + same desired layouts → byte-identical
   `serialize()` after N rounds.
2. **RNG independence (CRN invariant)**: the RNG state after round k is the same whatever the
   layout and in-round decisions were, including sit-out rounds (§3.2 change 10).
3. Zero rejections: `reconcile` never emits an action `apply` rejects, over the golden strategies
   and a fuzzer of random desired layouts.
4. Money: every resolution's `profit` is an integer; `Σ profit − commission = net`;
   `equity` before + net = equity after.
5. Exact-vs-MC agreement: realised mean per round within 4σ of `ev.expectedLossPerRound` over
   `fixtures.mcRounds` (baccaratton `agreement.test.ts` pattern).
6. Information boundary: `observe(visible(s))` equals `observe(visible(s'))` for two states that
   differ only in hidden RNG/shoe order.
7. Serialize/deserialize round-trip; `structuredClone` safe (no class instances, bigint only in
   fractions).
8. Oracle hook: `fixtures.oracle(bet, outcome)` checked for every catalog bet × every enumerable
   outcome when the plugin declares `outcomes()` (roulette 37/38/39, dice 36; card games skip or
   sample).

---

## 3. The game-plugin contract checked against craps, baccarat and UTH

### 3.1 Gaps, game by game

| # | Need | Craps (crappy) | Baccarat (baccaratton) | UTH (holdumb) | Roulette | Draft §4 |
|---|---|---|---|---|---|---|
| 1 | Bankroll inside engine state | `GameState.bankroll` (rack, not table) | same | same | needs it | `createState(rules, seed)` has no bankroll |
| 2 | Hidden information | dice only | **shoe order hidden**; `VisibleView` (unseen ranks, roads) is "what strategies receive" | **dealer hole cards + board hidden**; `VisibleView` | none | `observe(state, …)` sees the full state |
| 3 | Decisions inside a round | none (one window per roll) | none (bets before the deal) | **3 windows per hand**: preflop check/4x/3x, flop check/2x, river check-fold/1x | none | one decision window per round |
| 4 | Derived/linked bets | odds sized from the flat bet | — | **Blind always = Ante**; **Play** amount = multiple × ante, chosen in-round; Trips needs Ante | — | only `needsParent` |
| 5 | Commission / vig | buy/lay vig, timing is a rule (on win or up front) | **5% banker commission** on wins (`BetSettlement.commission`, `commissionPaid`) | — | — | resolutions have no commission field |
| 6 | Bets that move | come/don't-come travel to a number; `betId` instances, `point` on the bet | — | — | — | result `'stays'` only; no destination |
| 7 | Worst-case exposure | odds after a point; crappy has `maxExposure` | side bets | **must afford 6 × ante + trips** (warning `cant-afford-max-raise`) | layout sum | `affordable` only |
| 8 | Composition-dependent EV | phase-dependent (come-out vs point) | per-hand EV depends on unseen cards (`outcomeDistribution(unseenRanks)`); the app plots full-shoe EV | EV depends on the play policy (exact only for precomputed policies, `d36.exact.ts`) | constant | `expectedLossPerRound(state)` assumed exact and cheap |
| 9 | Warnings on legal actions | `short-pay`, `vig-rounding` | — | `cant-afford-max-raise` | — | `apply` ok has no warnings |
| 10 | Sit-out round still advances | rolls happen anyway | "empty felt deals a hand" | deal needs an ante; a sit-out must still burn the deal | spin happens anyway | unstated |
| 11 | Epochs inside a session | hand (come-out → seven-out) | **shoe** (cut card, one more hand, reshuffle) | — | — | only via facts |
| 12 | Per-session game counters | points made, seven-outs, longest hand, totals histogram | P/B/T counts, naturals, commission paid, side-bet hits | outcomes W/L/T/fold, hand categories, blind/trips hits | numbers histogram | `summary` is per round only |
| 13 | Forced outcomes for tests/watch | `forcedDice` queue | `forced` hands, `ShoeSetup` | `forcedDeals` | forced pocket | none |
| 14 | UI in the plugin | — | — | — | — | `ui?` on the pure plugin object would pull Preact into the worker bundle |

### 3.2 Proposed contract changes (apply before spinner freezes `contracts/game.ts`)

Every change is cheap for roulette (trivial implementations noted) and avoids a breaking change
when the second game lands.

1. **State creation takes the bankroll.**
   `createState(init: { rules: R; seed: number; bankroll: Cents }): S`. All three engines keep the
   rack inside the state, and `equity(state)` needs it.

2. **Separate the visible view.** Add `visible(state: S): V` and change
   `observe(view: V, lastOutcome, history): GameFacts`. `reconcile` and policies also receive `V`
   only (plus `rules`). Roulette: `V = S`-minus-RNG. Conformance test 6 enforces it.

3. **In-round decisions are plugin-owned policies, not strategy rules.** Add
   ```ts
   decisions?: {
     policies: Record<string, { label: string; description: string; exact?: { ev: Fraction; wager: Fraction } }>;
     defaultPolicy: string;
     decide(policy: string, view: V, options: readonly D[]): D;   // pure, sync
   };
   playRound(state: S, ctx: { policy?: string }): { state: S; outcome: RoundOutcome<D> };
   ```
   The experiment definition gains `game.policy` (UTH: `perfect`, `basic`, `never-fold`, …), and
   the strategy language gets one generic effect `setPolicy: <id>` so a stage can switch play
   policy. The betting strategy keeps one decision window per round (§5.6 unchanged); in-round
   choices are recorded in `outcome.decisions` for the trace. Roulette, craps, baccarat: omitted.
   (Alternatives in Q2.)

4. **Bet placement kinds.** In `BetCatalogEntry` replace the implicit model with
   `placement: 'layout' | 'linked' | 'decision'` and `linked?: { to: BetId; ratio: number }`.
   UTH Blind = `linked {to: 'ante', ratio: 1}`; Play = `decision`; craps odds stay `layout` with
   `needsParent` and a cap enforced by `reconcile`. Rename `minClass` → `limitClass` (it drives max
   as well as min in `decisions.md` #3).

5. **Resolutions carry commission, a reason, and moves.**
   ```ts
   { bet; amount; result: 'win' | 'lose' | 'push' | 'stays' | 'moves'; profit; commission: Cents;
     to?: BetId; reason: string }
   ```
   `profit` is net of commission; `commission` is reported separately so "where the money went"
   can show vig/commission as its own line. `RoundOutcome` gains `commission: Cents` (sum).
   Definition (normative): `wagered` = chips newly put at risk this round, **excluding** commission;
   up-front vig is reported as `commission` on the bet it buys (charged, not wagered), and is
   part of `net`.
   Roulette: `commission: 0` (la partage/en prison are `push`/`stays` with reason codes).

6. **Positioned bet ids.** A bet that moves gets a new id that encodes its position
   (`come` → `come:6`, `odds:come:6`); `LayoutEntry.parent` refers to that id. Desired layouts can
   then say "odds on my come bet on 6". `BetCatalogEntry.parameters` gains `'position'`.

7. **Exposure.** Add `exposure(view: V, layout: Layout): Cents` = worst-case total commitment for
   the round (UTH 6 × ante + trips; craps flat + max odds the layout implies; roulette Σ amounts).
   The harness bust test is "cannot fund the cheapest non-empty desired layout's exposure"; the
   strategy can read `exposure` as a session fact. `Reconciliation` gains
   `warnings: { entry; code; message }[]`.

8. **`apply` returns warnings.** `{ ok: true; state; events; warnings: Warning[] }`. Warnings are
   counted in the summary (like rejections), never silently dropped.

9. **EV declares its basis.**
   ```ts
   ev: {
     basis: 'exact' | 'nominal';          // nominal = e.g. full-shoe baccarat, policy-table UTH
     expectedLossPerRound(view: V, layout: Layout, ctx: { policy?: string }): number;
     variancePerRound(view: V, layout: Layout, ctx): number | null;   // null = unknown, analysis says so
     betEdge(bet: BetId, rules: R): { edge: Fraction; perRound: Fraction } | null;
   }
   ```
   Taking `(view, layout)` instead of `(state)` lets the strategy validator and quick check price a
   *desired* layout before it is placed. Exact fractions stay available through `betEdge`.

10. **RNG-independence rule (normative).** "The RNG draws consumed by a round depend only on the
    round index and the rules, never on the layout, the strategy or in-round decisions. A round with
    an empty layout still spins/rolls/deals." Needed for common random numbers (§9.6). Card games
    satisfy it by dealing the whole hand from the shuffled order at round start (holdumb's `Deal`
    already holds all nine cards).

11. **Session counters.** `counters: CounterSchema` (name, type `count | cents | histogram[n]`, doc)
    and `count(acc, outcome)`. The harness appends them to the fixed-size summary row (§8.2). Roulette:
    pocket histogram, zero hits; craps: points made, seven-outs; baccarat: P/B/T, commission.

12. **Epoch facts are facts.** No contract field: shoe number, hand-in-shoe, cut-card-out (baccarat)
    and hand number / phase (craps) are declared in `facts` and emitted as events; the strategy
    language's "stop at end of epoch" uses a game fact. Spinner declares none.

13. **Test hook.** `force?(state: S, script: unknown): S` queues predetermined outcomes (all three
    engines have one). Used by golden traces and the Watch demo; never by the harness.

14. **UI out of the plugin object.** Delete `ui?` from `GamePlugin`. Each game exports a separate
    `GameUi` from `src/game/<game>/ui/index.ts` that `src/app` registers. Keeps
    `src/workers/sim.worker.ts` Preact-free (ESLint already bans `preact` in pure layers).

15. **Version fields.** `version` (engine semantics) and `rngVersion` (draw schedule) both enter the
    run id with `CORE_VERSION`; a UI-only change bumps neither.

Not changed: `RulesSchema`, `parse`, `available`, `layoutOf`, `serialize`, `pace`, `facts`. The
draft's `Reconciliation.deferred/rejected` split fits all three games (craps wrong-phase is deferred;
contract bet removal is rejected; UTH set-bet mid-hand is impossible because windows are between
rounds).

### 3.3 How each existing engine maps after the changes

- **Craps** (`crappy/src/sim/engine`): `createGame`→`createState`, `applyAction`→`apply`,
  `roll` action inside `playRound`; `tableExpectedLossPerRoll`/`makeVarianceFn`→`ev` (basis
  `exact`); `primitives.ts` builders→`reconcile`; `Bet.id` instances map to positioned ids;
  `rollDie`→`randBelow(6)+1` with identical streams. Fraction `{n,d}`→`{num,den}` at the boundary.
- **Baccarat** (`baccaratton/src/sim/engine`): `Slip` is the layout (cleared every hand, like
  roulette); `visibleView` is `visible`; `settleHand` gives `commission`; `ev.basis = 'nominal'`
  (full shoe) with an optional exact-composition path via `outcomeDistribution(unseenRanks)`; the
  shoe/cut card are facts and events; roads become facts (`bigRoad` streaks).
- **UTH** (`holdumb/src/sim/engine`): layout = `{ante, trips}`; blind linked; `decisions.policies`
  = holdumb's `Strategy` presets (`perfect`, `expert`, `basic`, `simple`, `never-fold`, …) with their
  exact `ev`/`wager` fractions; `exposure` = 6 × ante + trips; `perfect` needs the preview job
  (expensive) so the lab ships `expert` as default policy and lists `perfect` as slow.

---

## 4. Migration plan for the existing apps (not executed now)

The teaching apps adopt the **shared infrastructure**; they do not have to adopt the strategy lab.
Each stage is an independent PR in that repo, behind its existing tests. Prerequisite for all:
`casino-lab-core` exists (extracted from spinner after spinner's v1 merges, §11) and has its own CI
running the core tests and the conformance suite against a stub game.

### 4.1 Order and rationale

1. **holdumb first** — it is the source of the worker, fraction and RNG code, so most stages are
   "delete the local copy, import the shared one" with zero behaviour change.
2. **baccaratton second** — identical math leaf modules; gains a real Web Worker (it is in-thread
   only today), which is the one stage with user-visible effect.
3. **crappy last** — most drift (fractions `{n,d}`, hand-written ESLint, older SW, no worker) and
   the most tests pinned to its own shapes. Its engine moves into the *craps lab* as a plugin
   (Appendix A) independently of this migration; crappy itself keeps its engine.

### 4.2 Stages per app

| Stage | What | holdumb | baccaratton | crappy | Risk |
|---|---|---|---|---|---|
| S0 | Add submodule at `src/core`, `submodules: recursive` in CI and Pages checkout, alias `@core/*` | S | S | S | Low: Pages job must check out submodules or the build fails (test in a PR first). |
| S1 | Tooling: ESLint layering generator, vitest/playwright presets, e2e guard + helpers + axe | S | S | M (rewrite eslint config; guard fixture may surface hidden console errors) | Low |
| S2 | PWA: `core/pwa` + `swPlugin({appName})` | S | S | S (also fixes the missing `cache: 'reload'`) | Medium: SW changes can strand installed users; keep the cache prefix `<app>-` so `activate` deletes old caches; run the offline/update e2e. |
| S3 | Router, Link, Toasts, theme, storage wrapper | S | S | M (crappy Toasts stay local; storage keys unchanged) | Low: persisted key names and versions must not change. |
| S4 | RNG, money, fractions | S (also delete `strategy/fraction.ts`) | S | M–L (rename `.n/.d`→`.num/.den` across math, tests, snapshots) | Low for values (RNG streams identical, fractions value-identical); review-heavy for crappy. |
| S5 | Job runner + worker transport + protocol | S | M (switch `jobs/` to worker + in-thread fallback, add `#ev-worker` alias) | M (move `simulateMany` chunking to a job) | Medium: worker bundling in the single-file build (inline transport exists in holdumb). |
| S6 | Optional: shared charts (`FanChart`, `SurvivalChart`) fed from their `SessionSeries` | M | M | M | Medium: percentiles change for crappy (or b/h) if they adopt core `quantile`; announce it, update pinned tests deliberately. |
| S7 | Optional: wrap the engine as a `GamePlugin` and run the conformance suite | M | M | (done in craps lab) | Low as tests only; valuable as a bug finder. |

Effort key: S < ½ day agent time, M ½–2 days, L > 2 days. Total: holdumb ≈ 2–3 days, baccaratton
≈ 3–4, crappy ≈ 4–6 (S0–S5); S6–S7 extra.

### 4.3 Guardrails for each migration PR

- No change to persisted storage keys, export prefixes, share-link params, or RNG output; tests
  that pin them must pass unchanged (they are the migration's oracle).
- The app's ESLint still bans relative imports into `src/core` internals (sub-barrels only).
- Bumping the submodule is its own PR with the core changelog in the description.

---

## 5. Open questions

Each has a recommended pick first.

**Q1. Where do the shared configs and build tooling live?**
1. *(recommended)* `src/core/tooling/` inside the one submodule, node-only, excluded from the app
   tsconfig. One repo, one pin, configs move with the code that assumes them.
2. A second submodule (`casino-lab-tooling` at `tooling/`). Cleaner separation, two pins to bump.
3. Copy-paste templates (status quo). No coupling; drift continues (see §1.1).
4. An npm package published from the core repo. Real versioning, but adds a publish step and a
   registry dependency to a no-backend family of apps.

**Q2. How are in-round decisions (UTH) expressed?**
1. *(recommended)* Plugin-owned **policies** selected in the definition plus a generic `setPolicy`
   effect (§3.2 change 3). Keeps the strategy language game-agnostic; matches how holdumb already
   models play strategies (`decide(view)`) with exact EV per policy.
2. Multiple decision windows per round in the strategy language (`window: 'preflop' | …` on rules).
   Most expressive; makes §5.6 semantics, validation and the builder UI game-specific.
3. Defer to code strategies (§5.9): in-round choices only via a JS `decide`. Simple contract; UTH
   lab unusable without the deferred feature.

**Q3. Fraction wire format.**
1. *(recommended)* `{ num, den }` (baccaratton, holdumb; "D13 wire format"). crappy renames on
   migration (S4).
2. `{ n, d }` (crappy). Shorter in JSON; two repos rename instead of one.
3. Opaque class with methods. Nicer API; breaks `structuredClone`/postMessage and JSON exports.

**Q4. When is `casino-lab-core` extracted?**
1. *(recommended)* Right after spinner v1 merges (contracts frozen and exercised by one real game),
   before the craps lab's WP0, so the craps lab starts on the submodule.
2. When the craps lab starts (PLAYBOOK §11 as written). Same result, later; risks the craps lab
   copying spinner's core instead.
3. Now, during spinner's WP0. Maximum discipline from day one; every early core change becomes a
   two-repo PR while the contracts are still moving.

**Q5. One quantile definition for the family (the harness spike owns the formula).**
1. *(recommended)* Type 7 linear interpolation (crappy's; numpy/`statistics` default), so reviewers'
   Python scripts reproduce the numbers exactly.
2. Nearest rank, rounding down (baccaratton, holdumb). Returns an observed cent value; differs from
   numpy at small n.
3. Exact order statistic with a documented `ceil(p·n)` rank. Unambiguous for exact percentiles over
   the summary table; a third convention to explain.

**Q6. Barrel policy for `src/core`.**
1. *(recommended)* Pure root barrel plus path-imported `@core/ui`, `@core/pwa`, `@core/store`,
   `@core/testing`, `@core/tooling` (§2.1 rule 2). The worker can never pull Preact or IDB by
   accident.
2. One barrel for everything plus tree-shaking. Simpler imports; relies on bundler side-effect
   analysis and makes the ESLint boundary weaker.
3. No barrels; deep imports everywhere. Most explicit; extraction then freezes every file path as
   public API.
