/**
 * Worker protocol v1 (harness-data-analysis.md §5.1, moved here by reconciliation R1). FROZEN.
 * Imports nothing outside `contracts/`.
 *
 * - `init` compiles the strategy once per worker per run, keyed by `runKey`; a `batch` for another
 *   `runKey` is answered with `error{code:'stale-run'}`.
 * - On boot the main thread sends `ping`; a `pong` whose protocol, core version or game version
 *   differs from the page's means a stale service-worker cache ("App updated, reload").
 * - There is no `cancel` message: pause = stop dispatching, cancel = `terminate()`.
 * - Transports: `worker` (a module Worker) and `inthread` (the same handler through a microtask hop;
 *   Vitest in node, and the browser when `Worker` is missing).
 */
import type { NormalizedDefinition } from './experiment';
import type { ChunkStats, ColumnSpec, RunLabels, SampleSession, SummaryRow } from './run';
import type { Diagnostic } from './strategy';
import type { SessionTrace } from './strategy-trace';

export const SIM_PROTOCOL = 1 as const;

export type ToSim =
  | { t: 'ping' }
  | {
      t: 'init';
      runKey: string;
      definition: NormalizedDefinition;
      schedule: Int32Array;
      chunkSize: number;
      sessions: number;
    }
  | {
      t: 'batch';
      runKey: string;
      batchId: number;
      firstChunk: number;
      chunkCount: number;
      traceIndices: number[];
    }
  /** Watch / re-simulate: full trace of one session. */
  | {
      t: 'simulate';
      reqId: number;
      definition: NormalizedDefinition;
      index: number;
      schedule?: Int32Array;
    }
  | { t: 'dispose' };

export type FromSim =
  | { t: 'pong'; protocol: number; coreVersion: string; game: { id: string; version: string } }
  | { t: 'ready'; runKey: string; labels: RunLabels; columns: ColumnSpec[] }
  | { t: 'init-error'; runKey: string; errors: Diagnostic[] }
  | {
      t: 'batch-done';
      runKey: string;
      batchId: number;
      firstChunk: number;
      chunkCount: number;
      firstSession: number;
      count: number;
      /** One per ColumnSpec, `count x width` elements, transferred. */
      columns: ArrayBuffer[];
      /** Int32 count x K, transferred. */
      checkpoints: ArrayBuffer;
      chunks: ChunkStats[];
      samples: SampleSession[];
      /** `performance.now()` around the compute loop only. */
      elapsedMs: number;
    }
  | { t: 'simulated'; reqId: number; row: SummaryRow; checkpoints: Int32Array; trace: SessionTrace }
  | {
      t: 'error';
      runKey?: string;
      batchId?: number;
      reqId?: number;
      code: string;
      message: string;
    };

export interface SimTransport {
  readonly mode: 'worker' | 'inthread';
  post(msg: ToSim, transfer?: Transferable[]): void;
  onMessage(fn: (msg: FromSim) => void): () => void;
  terminate(): void;
}
