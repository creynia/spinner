# src/core

Game-agnostic core of the casino strategy lab. It imports nothing outside itself and is kept
extractable (architecture.md §5): relative imports only, own barrel, own tests next to the code.

Module map and the import matrix: `docs/design/architecture.md` §3 and §4.2.

| Module                                                        | Role                                                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/`                                                  | Frozen types and constants (game, facts, strategy, strategy-trace, experiment, run, protocol, analysis, version). Imports nothing. `CORE_VERSION` lives in `contracts/version.ts`. |
| `money/`                                                      | Integer-cent helpers, the exact bigint `Fraction`, money formatting.                                                                                                               |
| `rng/`                                                        | SplitMix64 seeding, `Xoshiro128ss`, the engine and strategy streams.                                                                                                               |
| `strategy/`, `experiment/`, `harness/`, `store/`, `analysis/` | Stubs in WP0; implemented by their WPs.                                                                                                                                            |
| `testing/`                                                    | `coin`, a fake `GamePlugin` for core tests. Tests only.                                                                                                                            |
| `ui/`                                                         | Preact components, including the `GameUi` interface.                                                                                                                               |

Status: stub (WP0). The extraction plan is in architecture.md §5.2.
