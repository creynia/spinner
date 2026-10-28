// Summary table layout: column specs, allocation, buffers and row extraction
// (harness-data-analysis.md §3.1; contracts/run.ts).
import type {
  ColumnSpec,
  Dtype,
  RunLabels,
  SummaryColumn,
  SummaryRow,
  SummaryTable,
} from '../contracts/run';
import { ENDED_BY, ENDED_BY_STRATEGY_BASE, type EndedBy } from '../contracts/run';

/** Schema v1 column order; the wire order of `batch-done.columns`. */
export const COLUMN_ORDER: readonly SummaryColumn[] = [
  'final',
  'net',
  'peak',
  'trough',
  'maxDrawdown',
  'roundsPlayed',
  'roundsWagered',
  'wagered',
  'expectedLoss',
  'variance',
  'endedBy',
  'stopStage',
  'rejected',
  'deferred',
  'adjusted',
  'anomalies',
  'maxExposure',
  'stageRounds',
  'catWagered',
  'catNet',
];

const DTYPES: Record<SummaryColumn, Dtype> = {
  final: 'i32',
  net: 'i32',
  peak: 'i32',
  trough: 'i32',
  maxDrawdown: 'i32',
  roundsPlayed: 'i32',
  roundsWagered: 'i32',
  wagered: 'f64i',
  expectedLoss: 'f64',
  variance: 'f64',
  endedBy: 'u8',
  stopStage: 'u8',
  rejected: 'u16',
  deferred: 'u16',
  adjusted: 'u16',
  anomalies: 'u16',
  maxExposure: 'i32',
  stageRounds: 'i32',
  catWagered: 'f64i',
  catNet: 'f64i',
};

export function columnSpecs(stages: number, categories: number): ColumnSpec[] {
  return COLUMN_ORDER.map((name) => ({
    name,
    dtype: DTYPES[name],
    width:
      name === 'stageRounds' ? stages : name === 'catWagered' || name === 'catNet' ? categories : 1,
  }));
}

export type TypedArray = Int32Array | Uint8Array | Uint16Array | Float64Array;

export function allocColumn(dtype: Dtype, length: number): TypedArray {
  switch (dtype) {
    case 'i32':
      return new Int32Array(length);
    case 'u8':
      return new Uint8Array(length);
    case 'u16':
      return new Uint16Array(length);
    default:
      return new Float64Array(length);
  }
}

/** Reinterpret a transferred buffer as the column's typed array. */
export function viewColumn(dtype: Dtype, buf: ArrayBuffer): TypedArray {
  switch (dtype) {
    case 'i32':
      return new Int32Array(buf);
    case 'u8':
      return new Uint8Array(buf);
    case 'u16':
      return new Uint16Array(buf);
    default:
      return new Float64Array(buf);
  }
}

export function allocSummary(specs: readonly ColumnSpec[], sessions: number): SummaryTable {
  const t: Record<string, unknown> = { sessions };
  for (const s of specs) t[s.name] = allocColumn(s.dtype, sessions * s.width);
  return t as unknown as SummaryTable;
}

/** The table's buffers in `specs` order (the `batch-done.columns` payload). */
export function summaryBuffers(table: SummaryTable, specs: readonly ColumnSpec[]): ArrayBuffer[] {
  return specs.map(
    (s) => (table as unknown as Record<string, TypedArray>)[s.name]!.buffer as ArrayBuffer,
  );
}

export function column(table: SummaryTable, name: SummaryColumn): TypedArray {
  return (table as unknown as Record<string, TypedArray>)[name]!;
}

export function endedByLabel(code: number, reasons: readonly string[]): EndedBy {
  switch (code) {
    case ENDED_BY.rounds:
      return 'rounds';
    case ENDED_BY.bust:
      return 'bust';
    case ENDED_BY['stop-win']:
      return 'stop-win';
    case ENDED_BY['stop-loss']:
      return 'stop-loss';
    case ENDED_BY.error:
      return 'error';
    default:
      return `strategy:${reasons[code - ENDED_BY_STRATEGY_BASE] ?? '?'}`;
  }
}

/** One session's summary as a plain object (samples, Watch). */
export function summaryRow(
  t: SummaryTable,
  at: number,
  index: number,
  labels: RunLabels,
): SummaryRow {
  const S = labels.stages.length;
  const C = labels.categories.length;
  const stageRounds: number[] = [];
  for (let s = 0; s < S; s++) stageRounds.push(t.stageRounds[at * S + s]!);
  const catWagered: number[] = [];
  const catNet: number[] = [];
  for (let c = 0; c < C; c++) {
    catWagered.push(t.catWagered[at * C + c]!);
    catNet.push(t.catNet[at * C + c]!);
  }
  return {
    index,
    final: t.final[at]!,
    net: t.net[at]!,
    peak: t.peak[at]!,
    trough: t.trough[at]!,
    maxDrawdown: t.maxDrawdown[at]!,
    roundsPlayed: t.roundsPlayed[at]!,
    roundsWagered: t.roundsWagered[at]!,
    wagered: t.wagered[at]!,
    expectedLoss: t.expectedLoss[at]!,
    variance: t.variance[at]!,
    endedBy: endedByLabel(t.endedBy[at]!, labels.reasons),
    stopStage: labels.stages[t.stopStage[at]!] ?? '?',
    rejected: t.rejected[at]!,
    deferred: t.deferred[at]!,
    adjusted: t.adjusted[at]!,
    anomalies: t.anomalies[at]!,
    maxExposure: t.maxExposure[at]!,
    stageRounds,
    catWagered,
    catNet,
  };
}
