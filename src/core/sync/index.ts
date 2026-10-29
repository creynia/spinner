// core/sync: the sync engine and its pure parts (docs/design/sync.md §4.4). Game-agnostic; imports
// only contracts, experiment and store. Stubs from WP-S0 until S2a/S2b/S2c replace the bodies.
// Append exports only.
export { createClock, cmpHlc, hlcDevice, hlcWall, type HlcClock } from './hlc';
export { entryOf, fingerprintValue, SUPPORTED_V, verifyEntry } from './fingerprint';
export { concurrent, descends } from './vv';
export {
  copyOf,
  equivalent,
  foldEntries,
  joinDef,
  resolve,
  type Folded,
  type Resolution,
} from './merge';
export { decodeLib, encodeLib, LIB_NAME, ROOT_NAME, runBundleName } from './libfile';
export {
  createSyncEngine,
  type DownloadRunOptions,
  type SyncBackend,
  type SyncEngine,
  type SyncEngineDeps,
} from './engine';
export { createMemoryRemote, type MemoryRemoteOptions } from './memory-remote';
export { type SyncCtx } from './ctx';
export { downloadRun, evictRun, uploadPendingRuns } from './runs';
export { runGc } from './gc';
export { beginFirst, previewFirst, reseed } from './first';
export { eraseRemote, resetLocalSyncState } from './erase';
export { LibFileError, LIB_MAX_BYTES, type LibFileErrorCode } from './libfile';
