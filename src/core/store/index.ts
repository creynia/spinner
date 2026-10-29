// core/store: IndexedDB wrapper with memory fallback, stores, export/import, RunSink
// (owner: core-store). `resultsDigest` and the bundle codec live here (reconciliation R3).
export {
  boundRange,
  createIdbBackend,
  createMemoryBackend,
  DB_VERSION,
  isQuotaError,
  openStore,
  STORE_DEFS,
  STORE_NAMES,
  V1_STORE_NAMES,
  DB_UPGRADES,
  type Backend,
  type OpenFailure,
  type OpenOptions,
  type OpenResult,
  type StoreName,
  type TxOps,
  type TxReader,
} from './backend';
export {
  assembleChunkStats,
  SUMMARY_COLUMN_DEFS,
  summaryColumnSpecs,
  type TypedArray,
} from './columns';
export { decodeArray, encodeArray, type EncodedArray, type Encoding } from './codec';
export { resultsDigest } from './digest';
export {
  APP_ID,
  buildRunBundle,
  decodeRunBundle,
  encodeRunBundle,
  encodeRunBundleWithDigest,
  GALLERY_TRIM,
  RUN_MIGRATIONS,
  runFileName,
  slugify,
  trimRunData,
  trimSamples,
  trimSchedule,
  type DecodeOptions,
  type RunBundleV1,
} from './bundle';
export { summariesCsv } from './csv';
export {
  GALLERY_FORMAT,
  GALLERY_MAX_BUNDLE_BYTES,
  GALLERY_MAX_TOTAL_BYTES,
  galleryIndexJson,
  type GalleryEntry,
  type GalleryIndexV1,
} from './gallery';
export { createRunSink, loadRun, writeCompacted, type StoreRunSink } from './sink';
export { createRepo, type ImportResult, type Repo } from './repo';
// Chip layouts (layouts.md §5.2); stubs until WP-L2.
export {
  allocLayoutId,
  decodeLayoutFile,
  encodeLayoutFile,
  LayoutFileError,
  layoutHash,
  type LayoutFileErrorCode,
} from './layouts';
