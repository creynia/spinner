# Decisions (authoritative)

This file overrides every design doc under `docs/design/` and `PLAYBOOK.md`. When a design doc disagrees with this file, this file wins. Changes are made only by the orchestrator.

## Kickoff answers (2026-10-28)

| # | Topic | Decision |
|---|---|---|
| 1 | Pool size | **10** Sonnet agents at once (raised from 4 by the user on 2026-10-28; implementers, reviewers, debuggers share it). The VM (4 cores, 16 GB, no swap) is guarded by a **resource baton**: `/home/user/bin/res cpu|browser <agent> -- <cmd>` (2 cpu slots, 1 browser slot, ≥ 3 GB free memory to start). Vitest and Playwright run with at most 2 workers. |
| 2 | Game rules | **European single-zero is the default.** Presets: `european` (default), `american` (double zero), `triple-zero` (0, 00, 000). Rule flags: `laPartage` and `enPrison` (even-money bets only, single-zero wheels; mutually exclusive). **All bet families are simulated:** inside (straight, split, street, corner, six-line, basket/top-line per wheel), outside (red/black, odd/even, low/high, dozens, columns), and **call/neighbour bets** (voisins du zéro, tiers du cylindre, orphelins, jeu zéro, neighbours `n±k`) on single-zero wheels, expanded into their component chips. |
| 3 | Table limits | **High-limit table:** $25 minimum, $5,000 maximum. Classes: *outside* min $25 / max $5,000 per bet; *inside* min $25 total across inside bets per spin, min $1 per inside chip, max $500 per straight-up, with per-bet maxima scaled so the max payout does not exceed 35 × $500 = $17,500 (split $1,000, street $1,500, corner $2,000, six-line $3,000, basket by its payout); *call* bets are limited by their component chips. Limits are rule fields so users can override them. |
| 4 | Pace | Default **40 spins/hour** (live wheel). Pace preset `electronic` at **100 spins/hour**. Definitions may override. |
| 5 | Default run | **10,000 sessions × 500 spins.** Perf budget device: **mid-range Android** (Pixel 6a class): < 90 s; 4-core laptop < 20 s; CI uses a generous bound. |
| 6 | Merge | The orchestrator **may merge** PRs into `main` once reviewed by a pool reviewer (not the author) and CI is green on the latest head. |
| 7 | Repo | Public, **MIT**. Default branch `main` and Pages source "GitHub Actions" (both set by the user); all work happens on `claude/spinner-*` branches and lands through PRs into `main`. |
| 8 | Gallery | **Yes.** Curated result bundles committed under `gallery/`, listed by a build-time `gallery/index.json`, openable read-only at `#/gallery`. ≤ 2 MB per bundle, ≤ 20 MB folder, enforced in CI. |
| 9 | Single-file build | **No** in v1 (chip). |
| 10 | Presets day one | Full classic set: flat, Martingale, Grand Martingale, Fibonacci, d'Alembert, Labouchere, Paroli, 1-3-2-6, Oscar's Grind, James Bond, dozens progression (two dozens, Martingale-style), and the §3.6 example `red-mart-then-flat`. |
| 11 | Disclaimer | **Settings/About only** (and the README). No line on Home, none on Analyze verdicts. Wording: "Every roulette bet has a house edge; no betting system changes it. This is a simulation for understanding risk, not advice. If gambling is a problem for you, seek help (e.g. a national gambling helpline)." |

## Process decisions

- Prior art: creynia/crappy, creynia/baccaratton and creynia/holdumb are cloned read-only at `/home/user/creynia/<repo>`. They share one stack (preact ^10.29.8, vite ^8.3.4, typescript ~6.0.3, vitest ^5.0.4, @playwright/test 1.56.1, eslint ^10); spinner matches it unless a design doc gives a reason.
- A fifth spike, the **shared-pieces audit** (`docs/design/shared-core.md`), runs now rather than when the next app starts, because all three sibling apps already exist.
- Spikes: game, strategy, harness-data-analysis, architecture (PLAYBOOK §13.2), output under `docs/design/`.
- Money is integer cents; `unit` defaults to 2500 ($25) to match the table minimum.

## Later user decisions

- **Shared core stays in this repo** as the `src/core` module (2026-10-28). Moving it to an external `casino-lab-core` repo and refactoring crappy, baccaratton and holdumb onto it is a **chip**, done only when the user asks. `src/core` is still kept extractable (no imports from outside itself, own README and barrel), per `shared-core.md`. Configs and build tooling stay where `architecture.md` puts them; moving them into `src/core/tooling/` is part of that chip.
- **Gallery bundles stay at ≤ 2 MB each, ≤ 20 MB for the folder.** Bundles reach that size with the gallery trim in `harness-data-analysis.md` (all summary rows, 48 checkpoints, ≤ 6 samples).

## Reconciliation (2026-10-28)

`docs/design/reconciliation.md` is the Phase 2 review: 50 contradictions (23 blocking, 27 minor) and the independent exact-fraction re-derivation (575 numbers, 570 matched; the 5 mismatches are fixed in game.md §3.3 and harness-data-analysis.md §4). **Every "Recommended resolution" in its §1 tables is adopted** and overrides the design docs, with the clarifications below. Where a design doc still says otherwise, the resolution wins; WP0 copies contracts with the resolutions applied.

### Contract set (WP0 freezes these)

`src/core/contracts/{game,facts,strategy,strategy-trace,experiment,run,protocol,analysis,version}.ts` plus `src/core/ui/game-ui.ts`. `contracts/*` import nothing outside `contracts/`. `src/core/version.ts` does not exist; `CORE_VERSION` lives in `contracts/version.ts` (R5).

### `contracts/game.ts` (key points)

- `createState({ rules, rng, bankroll })`; the harness owns seeding and hands the plugin a ready `Rng` (G1). Roulette draws exactly one `rng.below(pockets)` per round, bets or not.
- `Rng` (`next, below, float53, snapshot`) and a structural `Fraction { num: bigint; den: bigint }` are declared in contracts; `core/rng` and `core/money` implement them (G2, G14).
- The strategy reads the game through `visible(state)` and `compileFact(ref, rules)` (+ optional `compileHistory`); no `observe()`/`GameFacts` in the contract (G3).
- `limits(betOrClass, rules, view?)`, `pace(rules)`, `ev.{expectedLossPerRound(view), variancePerRound(view), layoutMoments(layout, rules), betEdge(bet, rules)}` with **expected loss positive in cents** and `edge` a negative EV fraction (G4, G8, G9). `NormalizeContext.plugin` is the full `GamePlugin`.
- No `ui` on the plugin; `GameUi` lives in `core/ui/game-ui.ts`: `TableView({rules, layout, pending?, lastOutcome, highlight})`, `BetPicker({rules, value, onPick})`, `OutcomeGlyph({outcome})` (G5).
- `BetCatalogEntry.limitClass` (`'inside'|'outside'|'call'|string`) and `category` = family (G6). `Reconciliation.adjusted: {entry, to, reason}[]` is in v1, counted in the summary and shown in the trace (G7).
- Optional `force?(state, script)` for tests (G12). In-round decision policies (UTH), `setPolicy`, `exposure()`, counters, `'moves'`, `commission`: **not in v1**; additive later (G10, G11). strategy.md's `act` effect stays.

### Facts and events

- `bet-won` / `bet-lost` / `bet-push` are derived by the core from resolutions (profit sign); the roulette plugin does not emit them (F1). Roulette events: `spin`, `zero`, `partage`, `imprisoned`, `released`, `prison-lost`.
- Fact ref grammar: greedy parameter last, `count:<n>:<target>`, with `FactParam.type: 'target'` (bet id or declared extras `zero`, `green`) (F2). strategy.md's `{fact: …}` streak form (F3).

### Strategy and presets

- The day-one preset set is game.md §11 (decisions #10), with `one-three-two-six-red` (S1). strategy.md's roulette strategies are golden fixtures under `tests/fixtures/strategy/roulette/`, prefixed `golden-` where an id collides; its literal $5 `red-mart-then-flat` is a fixture only (S2). Golden convention: seed 20261028, session 0, bankroll $5,000; traces in `src/game/roulette/__fixtures__`.
- `stopReasons` sorted (S3). Reserved stop reasons `stop-win`, `stop-loss`, `bust`, `rounds`, `error` → `E_RESERVED_REASON` (S8). Names `Diagnostic`, `TraceWindow`, `SessionTrace = TraceWindow[]` (S4). R19/R23 amounts fixed per S5.

### Experiment, run, store

- `game.rules` is `string | RulesRef { preset, overrides }`, normalized (E1); `normalizeDefinition` calls `normalizeStrategy` and the definitionId vector is re-pinned by core-store (E2, E3).
- Worker protocol in `contracts/protocol.ts` (R1); the harness writes through a `RunSink` in `contracts/run.ts` and never imports the store (R2); `resultsDigest` and the bundle codec live in `core/store` (R3).
- Summary columns: the harness doc's names plus `adjusted` (u16) and `anomalies` (u16); the playbook's `endedRound` is `roundsPlayed` (R4). Ten IndexedDB stores (R6).

### Analysis, gallery, tooling

- Quantiles: type 7 (linear interpolation) everywhere; the "median session" for Watch is rank `floor((N−1)/2)` and docs/metrics.md says so (A1).
- Gallery: harness-data-analysis.md's `GalleryIndexV1` with architecture.md's file naming and checks; infra owns the plugin (P1). Bundle size is measured in core-store with 12 bet categories; trim further if needed to stay ≤ 2 MB (A2).
- Version pins: architecture.md §1.1 (exact pins; Playwright 1.63.0 because it matches the preinstalled Chromium 1243) (P8). Perf env `PERF_BUDGET_MS`; full Monte Carlo flag `FULL=1` (P6, P7). WP ownership per architecture.md §12.2 (P3). WP0 includes real `money`, `rng` and `coin` (P4).
- WP0 also makes Vitest and Playwright worker counts settable from env (`VITEST_MAX_WORKERS`, `PW_WORKERS`, default 2) for the resource baton.

## Decisions during implementation

- **Roulette has no `compileHistory`** (2026-10-28, PR #8). core-strategy always uses its own generic history trackers; the optional plugin hook is not implemented by roulette. `visible(state)` returns the state itself (the RNG is hidden by type only) to avoid a per-round allocation.
- **`StepOutput.anomalies?: number`** added to `contracts/strategy.ts` (additive, PR #11); the harness sums it into the `anomalies` summary column.
- **`ValidationContext = CompileContext & { gameId?: string }`**: callers set `gameId` so `E_GAME_MISMATCH` can fire; `W_NO_EXIT` comes from `noExitWarning(def, sessionHasStops)` (PR #11).
- **Run control has one owner**: `src/app/services/runs.ts` moved from app-shell to ui-results, which adds keyed starts, the controller registry, resume after reload and `setRunActive` wiring. Define and Home go through it.
- **App-shell export/import is definitions-only**; full per-run bundle export lives on the Analyze → Export tab (ui-results).
- **Core fixtures live next to their module** (`src/core/*/__fixtures__`), never in `tests/fixtures`, because `src/core` may not import outside itself. Game-specific fixtures (such as the roulette strategy goldens above) may live in `tests/fixtures/` or `src/game/roulette/__fixtures__`, since only `src/core` has that restriction.

## Chip layouts (owner request 2026-10-28; design: `docs/design/layouts.md`)

- **Owner request:** tap chips onto the board instead of the multi-step bet flow; save table layouts and reuse them across experiments. A layout is defined in single-denomination chips, and the denomination is picked when a stage uses the layout. Built by an Opus design spike and then the Sonnet swarm, on the same resource protocol (pool 10, baton 2 cpu / 1 browser / 3 GB floor).
- **A layout is a new game-agnostic entity** `ChipLayout` (chip counts only, no money). It lives in a new IndexedDB store `layouts` (`DB_VERSION` 2) and gets a Library tab (layouts.md D1, D2).
- **A stage keeps a reference plus a frozen copy** in `stage['x-chips']`. Editing a saved layout never changes existing definitions or runs; Define offers Update / Keep (D3, D4).
- **The denomination is per stage.** Amount per spot = chips × chip value, and a progression scales the whole layout. Compilation goes to ordinary bet rows, so there is no interpreter, worker or validator change (D5, D6).
- **Limits follow the existing table rule** (cut to max per spot, fund in placement order), previewed in the editor through the real `reconcile` (D7).
- **Presets are not migrated;** goldens and definitionId vectors stay unchanged. Any chip-shaped stage can be converted on request (D11).
- **No `CORE_VERSION` or roulette version bump.** Simulation output does not change, and a bump would stop resume and Watch re-simulation of every existing run. The `version.ts` comment is read as "bump when results change" and is reworded in WP-L0 (orchestrator decision).

## Google Drive sync (owner request 2026-10-28; design: `docs/design/sync.md`)

- **Owner decisions:**
  - Sync goes to the owner's own Google Drive `appDataFolder`, using Google sign-in in the browser. There is no server and no Firebase.
  - Everything syncs, including full run data.
- **Auth:** the GIS token flow with the `drive.appdata` scope only. Tokens last about 1 h, and the client gets no refresh token. On expiry, sync pauses until a one-tap Reconnect. A redirect fallback (`oauth-return.html`) covers installed apps that block popups. The GIS script loads on demand from accounts.google.com, a documented exception to version pinning.
- **Drive layout:**
  - one root marker;
  - one library file per device, written only by that device, because Drive has no compare-and-swap;
  - one file per run, in the existing gzip bundle format.
- **Local-first:**
  - IndexedDB stays the source of truth.
  - Change tracking wraps the store backend, with a dirty mark written in the same transaction.
  - DB v3 adds `syncIndex`, `syncDirty` and `syncMeta`, following the v2 upgrade discipline.
- **Merge (rev 2):**
  - Each entry carries an HLC minted at edit time, a parent pointer `basis` and a per-key version vector.
  - Entries in an ancestor chain take the descendant. Concurrent edits keep both: the loser becomes a deterministic conflicted copy named "<name> (conflict abc123)" (see the rev 2 to 3.1 refinements below), with a notice. An edit beats a delete.
  - A re-pull and recheck run just before each library-file write.
  - Definitions are content-addressed. Their `runIds` merge as a sorted union, and `displayName` merges by `displayNameAt`.
  - Compare and sweep groups are whole-record, never unioned.
  - Merges preserve unknown keys.
- **Runs:**
  - Only done runs get bundles; paused, cancelled and errored runs sync as stubs.
  - The same run imported on several devices (gallery or file) is one shared entry, uploaded once.
  - Dry and benchmark runs are excluded.
  - Every run list shows remote-only runs, and Sweep reuses remote runs.
- **Sign-in gate:** after the sign-in package, the owner tests "Test Google sign-in" on the Pixel before the sync service is built. Android standalone defaults to the redirect flow. The token is kept in localStorage until it expires.
  - **The test sign-in does not revoke at the end** (it differs from sync.md D23's wording). A revoked grant would bring the account chooser back, so "Expire token now" then Reconnect could not be tested. The session stays, and "End test" (`endTestSignIn`) revokes instead.
  - **The gate passed (2026-10-29).** The owner tested on a Pixel 11 Pro:
    - in a Chrome tab: the popup, and Reconnect after expiry;
    - in the installed app: the redirect round trip, and Reconnect after expiry.
    - So the GIS popup stays the default in a browser tab, the redirect stays the default for an installed Android app (R1 closed), and WP-S5a (the sync service) went ahead.
- **Sync service (WP-S5a):**
  - **First sync.** Sign-in never starts syncing by itself. It binds the account and shows the first-sync sheet (after any active run ends); the choice runs `begin('merge' | 'replace')`. "Not now" closes the sheet and stays signed in with sync off; the Account card's "Start syncing" returns to it. A failed `begin` (offline, or Replace with nothing readable in Drive: "Nothing was deleted") keeps the sheet open with the reason and leaves sync off.
  - **One sync-lock cycle at a time.** Each cycle, first sync and erase takes the Web Lock `spinner:sync` with `ifAvailable`. A tab that does not get it reports `busy` and the Account card says "Syncing in another tab". Dirty marks made in any tab are broadcast; every visible tab debounces on them and skips its cycle if the marks are already pushed. A hidden tab never syncs.
  - **Backoff from outcome plus code.** `offline` waits for the `online` event; `error` with code `network` (a `rate` or `server` error) backs off 30 s, 1 m, 2 m, 5 m, 10 m, then 15 m (`Retry-After` wins, at most 1 h); `quota` (`drive-full`) and `local-full` retry hourly; `access-removed`, `newer-layout`, `account-mismatch` and `erased` stop automatic syncing until the user acts; Sync now resets the backoff.
  - **Sign out keeps** local data, `syncIndex` and the account binding, so the same account comes back without a sheet; a different account asks first (§7.10).
  - **Download policy default** is `onOpen` when the browser says mobile, or the screen is under 768 px with a coarse pointer, and `all` otherwise. `local-full` switches it to `onOpen`.
  - **Additive service surface** (the S0 signatures are unchanged): `signIn({ mode })` for the "Sign in in this window" fallback, and the stores `signInError`, `signInRedirectOffer`, `firstSyncError`, `syncElsewhere` and `syncDeviceId`. `window.__spinnerSync` (e2e) now exposes only the stores and `expireTokenForTest`.
- **Refinements to the above (sync.md rev 2 to 3.1, §16; recorded at S6):**
  - **Merge is a fold, not a pairwise merge (N2, N3).** The engine folds the whole set of entries for a key (every lib file, the local base and the local candidate): equivalent entries (same fingerprint and deleted flag) collapse into the lowest HLC with their version vectors joined; the maximal elements under strict vv dominance are kept; the winner is an edit over a delete, then the higher HLC; every other maximal live entry becomes a conflicted copy. No entry is mutated. `seen` (the join of all folded vvs) is kept locally and never published.
  - **Persistent counter (N1, S-B).** `vv[self]` comes from `syncMeta.vvCounter`, which survives re-seed, Replace, account switch, erase and delete-all. It is reserved in a transaction before the lib upload, so a crash leaves gaps and never reuses a value. On start it is raised to the maximum `vv[self]` seen anywhere.
  - **Conflict copies are named by content (S-A, open question 19).** A copy has id `<id-base>-<hex6>` and name `"<name> (conflict <hex6>)"`, where `hex6` is the first six hex digits of the losing version's fingerprint, so every device builds the same copy and there are no copies of copies. The device names appear only in the notice. A definition keeps its own strategy inline, so a conflicted strategy copy needs no action (open question 21).
  - **Re-seed keeps the index (rev 3).** A missing own lib file (GC'd as stale after 180 days, or deleted by hand) is rewritten from `syncIndex` with `vvCounter` kept. It is not a reset, because a reset turned stale records into false copies and lost new edits. One accepted case remains (open question 22).
  - **Tombstone GC (rev 3, hardened at S6).** A tombstone is dropped when it is older than 30 days and every other lib file acknowledges it: the file holds it or a descendant, or lacks the key and its server-side `modifiedTime` is more than one day after the tombstone's wall time (the peer's own `writtenAt` is not trusted, because its clock may run ahead). A leftover tombstone is a harmless ~200 B.
  - **Runs (B3, B6, rev 3).** A downloaded run keeps `owner = meta.synced.from`. Runs imported from a file or the gallery are one shared entry with no owner, uploaded once. The GC keeps a bundle while any lib file holds a live entry for it, and re-uploads a missing bundle from any holder of the run. Other devices' paused, cancelled and errored runs show greyed (open question 20).
  - **Other rev 2 choices.** HLCs are minted from the edit time (`syncDirty.last`). Definitions merge `runIds` as a sorted union and `displayName` by `displayNameAt` (ties by HLC). Groups are whole-record, never unioned. Fingerprints exclude `updatedAt`. Unknown keys are preserved. The CSP lands in S0 and the whole e2e suite runs under it. The token is kept in localStorage with its expiry, and there is no amber nag when nothing is pending.
  - **Accepted limits recorded in sync.md §7.14 (S6):** an opaque (newer-version) key makes every no-change cycle re-download its files; a paused, cancelled or errored run's stub can take up to 5 minutes to sync; the `copies` set is kept across an account switch.
- **Integrity:** every download is verified (file sha256, recomputed `resultsDigest`, definition-id rehash) before one atomic write. Newer-format data is kept, never dropped.
- **Downloads:** every run is uploaded. Phones download a run when it is opened; desktops download everything in the background.
- **No `CORE_VERSION` bump.** The only contract change to existing types is the additive `RunMeta.synced?`.
- **Sync meta keep-lists (S2b review):**
  - `deleteAll` keeps `device`, `vvCounter`, `prefs`, `account`, `clock`, `files` and `copies`, and clears `conflicts` and `bundles` with the rest.
  - `resetLocalSyncState` (account switch or Replace) clears `files` and `bundles`, and keeps `device`, `vvCounter`, `copies` and `conflicts`.
  - Only `eraseRemote` also clears `copies`.
  - Accepted caveat: a kept `copies` set can suppress the same conflict copy recurring in a new account.
  - Engine facts: a no-change cycle makes 1 request (2 every 7 days for the lib refresh, and 2 while the listing lags the own lib). `rate` and `server` errors map to outcome `error` with code `network`; an IndexedDB quota error maps to code `local-full`.
