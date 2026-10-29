/**
 * Run data contract (harness-data-analysis.md §16.2) with reconciliation R1 (protocol moved to
 * `protocol.ts`), R2 (`RunSink`), R3 (`resultsDigest` and the bundle codec live in `core/store`),
 * R4 (summary columns `adjusted` and `anomalies`; the playbook's `endedRound` is `roundsPlayed`)
 * and S3 (sorted stop reasons) applied. FROZEN. Imports nothing outside `contracts/`.
 *
 * Function signatures of the modules that implement this contract (stubbed in WP0):
 *   core/harness: checkpointSchedule(maxRounds, sessions, spec: 'auto' | number[]): Int32Array
 *                 chunkSizeFor(maxRounds: number): number
 *                 sampleIndices(sessions: number, samples: number): number[]
 *   core/store:   resultsDigest(data: RunData): Promise<string>
 *                 encodeRunBundle(data: RunData, opts?: { gzip?: boolean; trimForGallery?: boolean }): Promise<Uint8Array>
 *                 decodeRunBundle(bytes: Uint8Array, gameId: string): Promise<{ data: RunData } | { error: string }>
 *                 summariesCsv(data: RunData): string
 */
import type { Cents } from './game';
import type { DefinitionId, NormalizedDefinition } from './experiment';
import type { SessionTrace } from './strategy-trace';

export const RUN_FORMAT = 'casino-lab-run' as const;
export const RUN_FORMAT_VERSION = 1 as const;
export const SUMMARY_SCHEMA = 1 as const;

export type Dtype = 'i32' | 'u8' | 'u16' | 'f64' | 'f64i';
export interface ColumnSpec {
  name: SummaryColumn;
  dtype: Dtype;
  /** 1, or S (stages) / C (categories) for the wide columns. */
  width: number;
}

/** Schema v1 column names (harness-data-analysis.md §3.1; `adjusted` and `anomalies` are R4). */
export type SummaryColumn =
  | 'final'
  | 'net'
  | 'peak'
  | 'trough'
  | 'maxDrawdown'
  | 'roundsPlayed'
  | 'roundsWagered'
  | 'wagered'
  | 'expectedLoss'
  | 'variance'
  | 'endedBy'
  | 'stopStage'
  | 'rejected'
  | 'deferred'
  | 'adjusted'
  | 'anomalies'
  | 'maxExposure'
  | 'stageRounds'
  | 'catWagered'
  | 'catNet';

/** `endedBy` codes below 16; `16 + j` is `strategy:<RunLabels.reasons[j]>`. */
export const ENDED_BY = { rounds: 0, bust: 1, 'stop-win': 2, 'stop-loss': 3, error: 4 } as const;
export const ENDED_BY_STRATEGY_BASE = 16;
export type EndedBy = 'rounds' | 'bust' | 'stop-win' | 'stop-loss' | 'error' | `strategy:${string}`;

/**
 * Label arrays fixed at compile time: `stages` in definition order, `categories` in plugin catalog
 * order, `reasons` = `StrategyRuntime.stopReasons`, **sorted** (reconciliation S3), at most 200.
 */
export interface RunLabels {
  stages: string[];
  categories: string[];
  reasons: string[];
}

/** Struct of arrays, length = sessions x width. */
export interface SummaryTable {
  sessions: number;
  final: Int32Array;
  net: Int32Array;
  peak: Int32Array;
  trough: Int32Array;
  maxDrawdown: Int32Array;
  roundsPlayed: Int32Array;
  roundsWagered: Int32Array;
  wagered: Float64Array;
  expectedLoss: Float64Array;
  variance: Float64Array;
  endedBy: Uint8Array;
  stopStage: Uint8Array;
  rejected: Uint16Array;
  deferred: Uint16Array;
  /** Reconcile adjustments (clamped, reduced, rounded), saturating (R4). */
  adjusted: Uint16Array;
  /** Strategy anomalies: null amounts, null `set`, null bases (strategy.md §18.2; R4), saturating. */
  anomalies: Uint16Array;
  maxExposure: Int32Array;
  /** sessions x S, session-major. */
  stageRounds: Int32Array;
  /** sessions x C. */
  catWagered: Float64Array;
  /** sessions x C. */
  catNet: Float64Array;
}

export interface SummaryRow {
  index: number;
  final: Cents;
  net: Cents;
  peak: Cents;
  trough: Cents;
  maxDrawdown: Cents;
  roundsPlayed: number;
  roundsWagered: number;
  wagered: Cents;
  expectedLoss: number;
  variance: number;
  endedBy: EndedBy;
  stopStage: string;
  rejected: number;
  deferred: number;
  adjusted: number;
  anomalies: number;
  maxExposure: Cents;
  stageRounds: number[];
  catWagered: Cents[];
  catNet: Cents[];
}

export interface CheckpointSketch {
  schedule: Int32Array;
  /** sessions x K, session-major. */
  equity: Int32Array;
}

export interface SessionError {
  index: number;
  code: string;
  message: string;
}

export interface ChunkStats {
  chunk: number;
  /** K. */
  expCum: Float64Array;
  /** C. */
  catExpected: Float64Array;
  /** S. */
  stageWagered: Float64Array;
  stageNet: Float64Array;
  stageExpected: Float64Array;
  /** S x S. */
  transitions: Int32Array;
  rejectedByReason: Record<string, number>;
  deferredByReason: Record<string, number>;
  errors: SessionError[];
}

/** All chunks, struct of arrays (chunks x width), as stored in `breakdowns`. */
export interface ChunkStatsColumns {
  chunks: number;
  expCum: Float64Array;
  catExpected: Float64Array;
  stageWagered: Float64Array;
  stageNet: Float64Array;
  stageExpected: Float64Array;
  transitions: Int32Array;
  rejectedByReason: Record<string, number>[];
  deferredByReason: Record<string, number>[];
  errors: SessionError[];
  errorCount: number;
}

export interface SampleSession {
  index: number;
  row: SummaryRow;
  trace: SessionTrace;
  truncated: boolean;
}

export type RunStatus = 'queued' | 'running' | 'paused' | 'done' | 'cancelled' | 'error';

export interface RunMeta {
  v: 1;
  runId: string;
  definitionId: DefinitionId;
  simKey: string;
  runKey: string;
  gameId: string;
  gameVersion: string;
  coreVersion: string;
  appVersion: string;
  createdAt: string;
  status: RunStatus;
  interrupted?: boolean;
  sessions: number;
  /** Durable (committed) count. */
  completedSessions: number;
  /** Analysis domain N' (harness-data-analysis.md §6.5). */
  prefixSessions: number;
  chunkSize: number;
  chunks: number;
  /** Bit c set iff chunk c is durable; LSB-first within a byte. */
  bitmap: Uint8Array;
  schedule: Int32Array;
  labels: RunLabels;
  columns: ColumnSpec[];
  storage: 'idb' | 'memory';
  device: { cores: number; workers: number; ua: string };
  timing: { startedAt?: string; finishedAt?: string; elapsedMs: number };
  resumes: { at: string; completedSessions: number }[];
  /** Capped at 50. `state` is the DOM `DocumentVisibilityState`, spelled out so contracts need no DOM lib. */
  visibility: { at: string; state: 'visible' | 'hidden' }[];
  /** When done (or on import). */
  resultsDigest?: string;
  error?: { code: string; message: string };
  imported?: {
    appVersion: string;
    importedAt: string;
    fileSha256: string;
    trimmed: boolean;
    partial: boolean;
  };
  /** Set on a run downloaded from the sync remote (sync.md §4.1); additive. */
  synced?: { from: string; fromName: string; at: string };
}

/** One batch's worth of results as committed by the sink. */
export interface RunPart {
  runId: string;
  firstChunk: number;
  chunkCount: number;
  firstSession: number;
  count: number;
  columns: ArrayBuffer[];
  checkpoints: ArrayBuffer;
  chunks: ChunkStats[];
  samples: SampleSession[];
}

/**
 * The harness writes through this and never imports the store (architecture.md §3; reconciliation
 * R2). `core/store` implements it; the app wires them in `app/services/runs.ts`. Each call commits
 * atomically (the harness doc §6.2 describes the flush schedule; the sink owns the transaction).
 */
export interface RunSink {
  /** Commit one part and the updated meta (bitmap, counts) atomically. */
  flush(part: RunPart, meta: RunMeta): Promise<void>;
  /** On completion: write the compacted run (all parts merged) and the final meta. */
  compact(data: RunData, meta: RunMeta): Promise<void>;
  /** Everything durable for a run, prefix applied; `null` when the run is unknown. */
  load(runId: string): Promise<RunData | null>;
}

export interface RunProgress {
  runId: string;
  status: RunStatus;
  completedSessions: number;
  prefixSessions: number;
  sessions: number;
  sessionsPerSec: number;
  etaMs: number | null;
  workers: number;
  storageBytes?: number;
}

export interface RunController {
  readonly runId: string;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  subscribe(fn: (p: RunProgress) => void): () => void;
  /** Current in-memory data for live preview (prefix only). */
  snapshot(): RunData;
}

/** Everything the analysis reads; prefix already applied (`sessions` = N). */
export interface RunData {
  meta: RunMeta;
  definition: NormalizedDefinition;
  sessions: number;
  summary: SummaryTable;
  checkpoints: CheckpointSketch;
  chunkStats: ChunkStatsColumns;
  samples: SampleSession[];
}

// Constants (harness-data-analysis.md §4, §5)
/** sessions x K <= this for 'auto'. */
export const CHECKPOINT_BUDGET_VALUES = 4_194_304;
export const CHUNK_ROUNDS = 16_384;
export const BATCH_TARGET_MS = 250;
export const FLUSH_EVERY_BATCHES = 16;
export const FLUSH_EVERY_MS = 2000;
export const MAX_SESSIONS = 100_000;
export const MAX_ROUNDS = 100_000;
