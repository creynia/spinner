# src/core

Game-agnostic core of the casino strategy lab: the strategy language and interpreter, the simulation harness, the analysis metrics, the store and export formats, and the shared UI kit and charts. A game (here, roulette in `src/game/roulette`) plugs in through the frozen `GamePlugin` contract; the app (`src/app`) wires it together.

## The rule: no imports from outside itself

Nothing under `src/core` may import from `src/app`, `src/game`, `src/workers`, `src/pwa` or `build/`. Inside core, imports are **relative only** (no `@core/...` aliases) and each module is entered through its own barrel; the allowed edges are the matrix in architecture.md §4.2. ESLint enforces this (`spinner/boundaries`) and `tests/build/layering.test.ts` proves the rule still fires. Tests live next to the code. Fixtures and fake games used by core tests live in `testing/`.

## Extraction plan: a chip

Moving core into its own repository (`creynia/casino-lab-core`, mounted as a git submodule at `src/core`) and refactoring the sibling apps onto it is a **chip**: it is done only when the user asks (decisions, 2026-10-28, "Shared core stays in this repo"). Until then core stays here, kept extractable by the rule above. When it is picked up, follow architecture.md §5.2: `git subtree split --prefix=src/core`, push to the new repo, add its own `package.json`, tsconfig, vitest and ESLint configs and CI, replace `src/core` with the submodule at a pinned SHA, and add `submodules: true` to every `actions/checkout`. Which other pieces move with it (`src/pwa`, `build/*`, configs) is decided by the shared-pieces audit (architecture.md §5.3), not here. See also `docs/design/shared-core.md`.

## Modules

Module map and the import matrix: `docs/design/architecture.md` §3 and §4.2.

| Module                                                        | Role                                                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/`                                                  | Frozen types and constants (game, facts, strategy, strategy-trace, experiment, run, protocol, analysis, version). Imports nothing. `CORE_VERSION` lives in `contracts/version.ts`. |
| `money/`                                                      | Integer-cent helpers, the exact bigint `Fraction`, money formatting.                                                                                                               |
| `rng/`                                                        | SplitMix64 seeding, `Xoshiro128ss`, the engine and strategy streams.                                                                                                               |
| `strategy/`, `experiment/`, `harness/`, `store/`, `analysis/` | Stubs in WP0; implemented by their WPs.                                                                                                                                            |
| `testing/`                                                    | `coin`, a fake `GamePlugin` for core tests. Tests only.                                                                                                                            |
| `ui/`                                                         | Preact components, including the `GameUi` interface.                                                                                                                               |
