/**
 * Core version (decisions.md Reconciliation R5; architecture.md §5.1.6).
 *
 * Lives in `contracts/` (importable by every core module) instead of a `src/core/version.ts`.
 * Semver. It participates in `runKey`/`simKey`/`resultsDigest` (harness-data-analysis.md §2, §8.3),
 * the worker `pong` (contracts/protocol.ts) and run bundles. The orchestrator bumps it whenever a
 * contract, or any output that feeds run ids, changes.
 */
export const CORE_VERSION = '0.1.0';
