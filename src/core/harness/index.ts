// core/harness: session loop, worker handler, in-thread transport, pool, batches, run controller
// (owner: core-harness; harness-data-analysis.md §2-§7, §14). The harness never imports the store:
// it writes through a `RunSink` (contracts/run.ts).
export {
  checkpointSchedule,
  chunkSizeFor,
  sampleIndices,
  autoCheckpointCount,
  HarnessConfigError,
} from './schedule';
export { COLUMN_ORDER, columnSpecs, summaryRow } from './columns';
export {
  BatchRunner,
  SAMPLE_TRACE_MAX_BYTES,
  SAMPLE_TRACE_MAX_ROUNDS,
  buildLabels,
  type BatchOutput,
  type RunnerInit,
  type SimulatedSession,
} from './session';
export {
  buildRunner,
  createWorkerHandler,
  type WorkerHandler,
  type WorkerHandlerOptions,
} from './handler';
export { createInThreadTransport, type InThreadOptions } from './transport';
export {
  MAX_POOL_SIZE,
  POOL_IDLE_MS,
  createPool,
  defaultPoolSize,
  type PoolLease,
  type SimPool,
} from './pool';
export {
  RUN_TRACE_MAX_BYTES,
  RunControllerError,
  createRunController,
  type HarnessRunController,
  type RunControllerOptions,
} from './controller';
export {
  RunAccumulator,
  bitGet,
  bitSet,
  bitmapBytes,
  buildChunkStatsColumns,
  MAX_STORED_ERRORS,
} from './accumulator';
export {
  acquireRunLock,
  defaultLocks,
  isRunLockedElsewhere,
  runLockName,
  type LockManagerLike,
  type RunLock,
} from './lock';
export { SimulateError, simulate, simulateOn, type SimulatedResult } from './simulate';
export { MAX_BATCH_CHUNKS, limitForTail, updateBatchSize } from './batching';
