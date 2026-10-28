# Chips (deferred ideas and nits)

Owned by the orchestrator. Each entry: what, where it came from, and when to pick it up.

## Deferred by decision

- **Extract `src/core` to `casino-lab-core`** and refactor crappy, baccaratton and holdumb onto it (user decision 2026-10-28; only when the user asks). Plan: `docs/design/shared-core.md` §4, `architecture.md` §5.
- **Single-file offline build** with inlined workers (decisions #9).
- **Code strategies** (a JS `decide(observation, memory)` in the worker): designed in `strategy.md`, not built in v1.
- **In-round decision policies** (UTH): `setPolicy`, policies, `exposure()`, counters, `'moves'` results, `commission` (reconciliation G10, G11).
- From PLAYBOOK Appendix B: a text syntax for conditions; sound; hosted results sync; strategy lint suggestions ("your Martingale cap is reachable in 1.5% of sessions"); importing crappy sandbox layouts as a stage; a live "what if" sweep slider; sharing a run as a link to a committed gallery bundle.

## Nits from reviews

- ~~PR #2: `dollars(0.29)` throws~~ (fixed in #8, via core-strategy's early validate commit).
- PR #2: confirm the e2e smoke covers `#/more`. Owner: integration.

## Deferred to integration (must be done before v1 is called done)

- **Wire the gallery analyzer** (`build/vite-plugin-gallery.ts` `GalleryAnalyzer`) to core-store's bundle decoder and `@core/analysis` headline metrics. Until then committing a bundle under `gallery/` breaks the build (PR #5).
- **Service-worker update-path e2e**: build A → build B → update toast → reload → new SHA in About (architecture.md §8.4; PR #5).
- **Roulette golden traces** for every preset (seed 20261028, session 0, bankroll $5,000) in `src/game/roulette/__fixtures__`, and a "zero reconcile rejections over a full run" test per preset (PR #8).
- Harness: a committed test for a plugin exception in `createState` (session ends with `error`), and assert `wagered > 0` in `tests/build/harness-roulette.test.ts` (PR #9).
- Pass `{ tableMax }` to `runMetrics`/`compareRuns`/`sweepResult` everywhere (`pAtTableMax` is null otherwise) (PR #4).
- The shell's db adapter (`src/app/services/db.ts`) can switch to core-store's `createRepo` (PR #7).
- strategy.md §17.9 heap/throughput test in `tests/perf` (PR #11).
- Confirm the e2e smoke covers `#/more` (PR #2).

## Later (nice to have)

- Charts: the FanChart `alive` strip (harness-data-analysis.md §12.1); Bars tick collisions at very large values; one money format for axis ticks and tables (PR #6).
- Roulette table: the racetrack and the 20-pocket history strip from game.md §12 need a history input on `TableViewProps` (a contract addition) (game-ui).
- `tests/build/gallery.test.ts` loads the plugin by dynamic import because `tsconfig.app.json` cannot reference `build/`; clean up with a tsconfig change (PR #5).
- Strategy: dedupe history trackers whose predicates differ only by threshold; the 64 KiB definition limit counts UTF-16 units, not bytes (PR #11).
- Store: library backup import/export (harness-data-analysis.md §10.4) (PR #10).
- Analysis: report both sample sizes for Welch differences (needs a `PairDiff` contract field) (PR #4).
