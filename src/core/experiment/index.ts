// core/experiment: canonical JSON, sha256 ids, migrate, normalize, share links (owner: core-store).
export { canonicalJson } from './canonical';
export { sha256Hex, sha256Pure, toHex, utf8Decode, utf8Encode } from './sha256';
export {
  base64Decode,
  base64Encode,
  base64UrlEncode,
  compressBytes,
  decompressBytes,
  hasCompression,
  isGzip,
  type CompressionFormat,
} from './bytes';
export {
  crockfordBase32,
  definitionId,
  newRunId,
  RUN_ID_PATTERN,
  runId8,
  runKey,
  simKey,
} from './ids';
export {
  DEFINITION_MIGRATIONS,
  DefinitionFormatError,
  migrateDefinition,
  migrateStrategy,
  runMigrations,
  STRATEGY_MIGRATIONS,
  type MigrationTable,
} from './migrate';
export { defaultStrategyHooks, LIMITS, normalizeDefinition, type StrategyHooks } from './normalize';
export {
  decodeShareLink,
  encodeShareLink,
  exportDefinitionFile,
  importDefinitionFile,
  SHARE_FALLBACK_NOTICE,
  SHARE_INFLATED_MAX_BYTES,
} from './share';
export { setPointer, sweepPathAllowed } from './pointer';
