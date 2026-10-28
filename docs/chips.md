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
- ~~PR #2: confirm the e2e smoke covers `#/more`~~ (covered by `tests/e2e/smoke.spec.ts` and `shell.spec.ts`).

## Integration items (done)

All "before v1" items are closed by #17 and #18:
- ~~Wire the gallery analyzer to core-store and `@core/analysis`~~ (#18).
- ~~Service-worker update-path e2e~~ (#18, `tests/e2e/sw-update.spec.ts`).
- ~~Roulette golden traces and a zero-`apply`-rejections test per preset~~ (#17).
- ~~Harness tests for a `createState` exception and `wagered > 0`~~ (#17).
- ~~Pass `{ tableMax }` everywhere~~ (#17 audit).
- ~~strategy.md §17.9 heap/throughput test~~ (#17).

## Perf

- ~~Browser benchmark screen and real budget test~~ (#19). The 10,000 × 500 reference run took 6.8–9.1 s on 3 Workers in headless Chromium on the build VM (see `docs/perf.md`), against the 20 s budget. It is not yet measured on a mid-range Android; see `docs/design/open-questions.md`.
- There is no npm script for the node perf tests (`PERF=1 npx vitest run -c tests/perf/vitest.config.ts`); add `npm run perf:node`.
- `tests/perf/budget.spec.ts` asserts at least 2 workers. On a runner with 2 cores or fewer, `poolSize()` gives 1 and the test fails. GitHub's hosted runners have 4 vCPU (#19 review).
- Core harness: `controller.settled()` resolves on the *next* transition, so awaiting it on a finished run hangs. App callers guard for this (Sweep, Benchmark). Clarify the docstring, or add a `whenSettled()` that resolves at once for a terminal run (#19 review).

## Chip layouts follow-ups (from PRs #22–#34)

- **Table-check wording** (#26): the banner is generic ("N spots would not be placed as drawn"). A game-specific message, e.g. "Inside bets total $15; the table needs $25", needs a plugin hook. Also, a folded duplicate's head row reports `ok` when it should report `merged` (cosmetic).
- **Editor shell** (#26, #33): the landscape bet-type control lives inside `ChipBoard`, so the shell can't show it in its rail. Leaving the Library editor through the tab bar or bottom nav, or Back past a deep link, skips the unsaved-changes guard; only a page unload is protected.
- **ChipBoard** (#29, #34): with a very tall host above it, the board can still get small. The mode button label clips slightly at 844×390. Call bets are two taps away (mode button → Call bets…).
- **Library** (#33): there is no "Export all layouts". New layouts start on European; change the wheel from More. After the first save of a new layout the address stays `edit=new`.
- **Builder chips panel** (#31): the table check covers the stage's chip spots, not manual or inherited rows. Rebuild drops `when`-guarded rows on a spot's bet; they were shadowed anyway.
- **Sweep** (#30): add permanent tests for manual rows after chip rows and for `{units}` / `{prog}` chip stages. An invalid chip stage reports "too large for this layout", which misleads.
- **Perf** (#34): a chip strategy with voisins runs at about 101k rounds/s serial versus 220k for the reference strategy. It still fits the budget (16.5 s projected on 3 threads); profile if layouts grow.
- **Design docs**: game.md §12, strategy.md §13 and architecture.md §6.3 now point to `layouts.md`. Fold the details in properly the next time those docs are revised.

## Later (nice to have)

- Charts: the FanChart `alive` strip (harness-data-analysis.md §12.1); Bars tick collisions at very large values; one money format for axis ticks and tables (PR #6).
- Roulette table: the racetrack and the 20-pocket history strip from game.md §12 need a history input on `TableViewProps` (a contract addition) (game-ui).
- `tests/build/gallery.test.ts` loads the plugin by dynamic import because `tsconfig.app.json` cannot reference `build/`; clean up with a tsconfig change (PR #5).
- Strategy: dedupe history trackers whose predicates differ only by threshold; the 64 KiB definition limit counts UTF-16 units, not bytes (PR #11).
- Store: library backup import/export (harness-data-analysis.md §10.4) (PR #10).
- Analysis: report both sample sizes for Welch differences (needs a `PairDiff` contract field) (PR #4).
- Builder editor gaps (#14). These have no editor yet; they still import/export as JSON:
  - fact `in`/`notIn`;
  - `cmp` against expressions;
  - `countInLast` `atMost`/partial windows, and `since` `atMost`;
  - event args;
  - `press.cap`, `goto.reenter`, bet `parent`/`working`, `act`;
  - a full expression tree;
  - Labouchère and custom-sequence editors.
- Define: sticky right column on desktop. Library: export of a single definition with its runs, and per-run storage use (#14).
- A read-only Analyze view for gallery runs, without importing them first (#15).
- Compare and Sweep take `tableMax` from the first run's definition. Runs with different limits get one value (#17 audit).
- Import's `classify()` matches error message text, because core-store exposes no error codes. Add codes to core-store errors (#15).
- The shell's db adapter (`src/app/services/db.ts`) is not switched to core-store's `createRepo`, because core's Repo has no `deleteAll` or definitions export. Add those to core-store first (#7, #18).
- The `vite build` warning "configLoader: 'native' … unsupported" comes from `build/vite-plugin-gallery.ts` importing extensionless `src/core` modules. Fix it before Vite makes native the default: add extensions, bundle the analyzer, or set `configLoader: 'runner'` (#18 review).
- e2e: `sw-update.spec.ts` skips the phone-360 and phone-landscape projects; `resume.spec.ts` relies on 100k sessions to outlast the reload (#18).
