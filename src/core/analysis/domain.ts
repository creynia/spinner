// The analysis domain of a run: the completed chunk prefix only (harness-data-analysis.md §6.5).
import type { ChunkStatsColumns, RunData, RunMeta, SummaryTable } from '../contracts/run';

/** Sessions 0..N'-1 where N' = chunkSize x (first chunk missing in the bitmap), capped at `sessions`. */
export function completedPrefix(meta: RunMeta): number {
  let c = 0;
  while (c < meta.chunks && ((meta.bitmap[c >> 3]! >> (c & 7)) & 1) === 1) c++;
  return Math.min(meta.sessions, c * meta.chunkSize);
}

/** N, the number of sessions every metric of this run uses. */
export function domainSize(d: RunData): number {
  const { meta } = d;
  let n = Math.min(d.sessions, d.summary.sessions, meta.prefixSessions);
  if (meta.status !== 'done') n = Math.min(n, completedPrefix(meta));
  return Math.max(0, n);
}

export interface Domain {
  n: number;
  /** Total sessions of the run. */
  of: number;
  S: number;
  C: number;
  K: number;
  nChunks: number;
  t: SummaryTable;
  chunks: ChunkStatsColumns;
  schedule: Int32Array;
  equity: Int32Array;
  bankroll: number;
  roundsPerHour: number;
  maxRounds: number;
}

/** Zero-copy view of the run restricted to its analysis domain (idempotent). */
export function domainOf(d: RunData): Domain {
  const n = domainSize(d);
  const s = d.summary;
  const S = d.meta.labels.stages.length;
  const C = d.meta.labels.categories.length;
  const schedule = d.checkpoints.schedule;
  const K = schedule.length;
  const t: SummaryTable = {
    sessions: n,
    final: s.final.subarray(0, n),
    net: s.net.subarray(0, n),
    peak: s.peak.subarray(0, n),
    trough: s.trough.subarray(0, n),
    maxDrawdown: s.maxDrawdown.subarray(0, n),
    roundsPlayed: s.roundsPlayed.subarray(0, n),
    roundsWagered: s.roundsWagered.subarray(0, n),
    wagered: s.wagered.subarray(0, n),
    expectedLoss: s.expectedLoss.subarray(0, n),
    variance: s.variance.subarray(0, n),
    endedBy: s.endedBy.subarray(0, n),
    stopStage: s.stopStage.subarray(0, n),
    rejected: s.rejected.subarray(0, n),
    deferred: s.deferred.subarray(0, n),
    adjusted: s.adjusted.subarray(0, n),
    anomalies: s.anomalies.subarray(0, n),
    maxExposure: s.maxExposure.subarray(0, n),
    stageRounds: s.stageRounds.subarray(0, n * S),
    catWagered: s.catWagered.subarray(0, n * C),
    catNet: s.catNet.subarray(0, n * C),
  };
  const size = d.meta.chunkSize > 0 ? d.meta.chunkSize : Math.max(1, n);
  return {
    n,
    of: d.meta.sessions,
    S,
    C,
    K,
    nChunks: Math.min(d.chunkStats.chunks, Math.ceil(n / size)),
    t,
    chunks: d.chunkStats,
    schedule,
    equity: d.checkpoints.equity,
    bankroll: d.definition.session.bankroll,
    roundsPerHour: d.definition.session.roundsPerHour,
    maxRounds: d.definition.session.maxRounds,
  };
}

/** Sum of column `j` (of `width`) of a chunks x width matrix over the first `nChunks` chunks. */
export function chunkColumnSums(m: Float64Array | Int32Array, width: number, nChunks: number) {
  const out = new Float64Array(width);
  for (let c = 0; c < nChunks; c++) for (let j = 0; j < width; j++) out[j]! += m[c * width + j]!;
  return out;
}
