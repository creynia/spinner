// The core barrel: non-UI modules only (UI is `@core/ui`; `core/testing` is deliberately absent so
// test fakes never reach a production bundle). Append exports only (architecture.md §11.2).
// Contracts are importable individually as `@core/contracts/<file>`; the type files are re-exported
// here for convenience.
export * from './contracts/game';
export * from './contracts/facts';
export * from './contracts/strategy';
export * from './contracts/strategy-trace';
export * from './contracts/experiment';
export * from './contracts/run';
export * from './contracts/protocol';
export * from './contracts/analysis';
export * from './contracts/version';
export * from './contracts/layout';
export * from './contracts/sync';
export * from './money';
export * from './rng';
export * from './strategy';
export * from './experiment';
export * from './harness';
export * from './store';
export * from './analysis';
export * from './sync';
