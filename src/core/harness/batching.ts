// Adaptive batch sizing (harness-data-analysis.md §5.3): ~250 ms per batch, per worker.
export const MAX_BATCH_CHUNKS = 64;

/**
 * After `batch-done(k, elapsedMs)`: `r = k / max(elapsedMs, 1)` chunks per ms,
 * `rate = rate === undefined ? r : 0.5 * rate + 0.5 * r`, `next k = clamp(round(T * rate), 1, 64)`.
 */
export function updateBatchSize(
  prevRate: number | undefined,
  chunkCount: number,
  elapsedMs: number,
  targetMs: number,
): { rate: number; k: number } {
  const r = chunkCount / Math.max(elapsedMs, 1);
  const rate = prevRate === undefined ? r : 0.5 * prevRate + 0.5 * r;
  return { rate, k: Math.min(MAX_BATCH_CHUNKS, Math.max(1, Math.round(targetMs * rate))) };
}

/** Tail rule: `k = min(k, max(1, floor(remainingChunks / (2 * P))))`, so the last batches shrink. */
export function limitForTail(k: number, remainingChunks: number, workers: number): number {
  return Math.min(k, Math.max(1, Math.floor(remainingChunks / (2 * workers))));
}
