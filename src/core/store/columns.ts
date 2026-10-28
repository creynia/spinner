import type {
  ChunkStats,
  ChunkStatsColumns,
  ColumnSpec,
  Dtype,
  RunLabels,
  SampleSession,
  SummaryColumn,
  SummaryTable,
} from '../contracts/run';

export type TypedArray = Int32Array | Uint8Array | Uint16Array | Float64Array;

/** Schema v1 summary columns in storage order (harness-data-analysis.md §3.1; R4). */
export const SUMMARY_COLUMN_DEFS: { name: SummaryColumn; dtype: Dtype; wide?: 'S' | 'C' }[] = [
  { name: 'final', dtype: 'i32' },
  { name: 'net', dtype: 'i32' },
  { name: 'peak', dtype: 'i32' },
  { name: 'trough', dtype: 'i32' },
  { name: 'maxDrawdown', dtype: 'i32' },
  { name: 'roundsPlayed', dtype: 'i32' },
  { name: 'roundsWagered', dtype: 'i32' },
  { name: 'wagered', dtype: 'f64i' },
  { name: 'expectedLoss', dtype: 'f64' },
  { name: 'variance', dtype: 'f64' },
  { name: 'endedBy', dtype: 'u8' },
  { name: 'stopStage', dtype: 'u8' },
  { name: 'rejected', dtype: 'u16' },
  { name: 'deferred', dtype: 'u16' },
  { name: 'adjusted', dtype: 'u16' },
  { name: 'anomalies', dtype: 'u16' },
  { name: 'maxExposure', dtype: 'i32' },
  { name: 'stageRounds', dtype: 'i32', wide: 'S' },
  { name: 'catWagered', dtype: 'f64i', wide: 'C' },
  { name: 'catNet', dtype: 'f64i', wide: 'C' },
];

/** The `RunMeta.columns` for a run with `S` stages and `C` categories. */
export function summaryColumnSpecs(S: number, C: number): ColumnSpec[] {
  return SUMMARY_COLUMN_DEFS.map((c) => ({
    name: c.name,
    dtype: c.dtype,
    width: c.wide === 'S' ? S : c.wide === 'C' ? C : 1,
  }));
}

export function bytesPerValue(dtype: Dtype): number {
  return dtype === 'u8' ? 1 : dtype === 'u16' ? 2 : dtype === 'i32' ? 4 : 8;
}

export function allocate(dtype: Dtype, length: number): TypedArray {
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

export function wrapBuffer(dtype: Dtype, buf: ArrayBuffer): TypedArray {
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

/** A view that owns exactly its bytes (structured clone copies the whole underlying buffer). */
export function own<T extends TypedArray>(a: T): T {
  return a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : (a.slice() as T);
}

export function columnsOf(table: SummaryTable): Record<SummaryColumn, TypedArray> {
  return table;
}

/** Builds a `SummaryTable` from named columns; missing or mis-sized columns throw. */
export function tableFrom(
  sessions: number,
  specs: ColumnSpec[],
  get: (name: SummaryColumn) => TypedArray | undefined,
): SummaryTable {
  const out: Record<string, unknown> = { sessions };
  for (const spec of specs) {
    const a = get(spec.name);
    if (!a || a.length !== sessions * spec.width) {
      throw new Error(`summary column ${spec.name} has the wrong length`);
    }
    out[spec.name] = a;
  }
  return out as unknown as SummaryTable;
}

/** The first `n` sessions of a table, as arrays that own their buffers. */
export function sliceTable(table: SummaryTable, specs: ColumnSpec[], n: number): SummaryTable {
  if (n === table.sessions) return table;
  const cols = columnsOf(table);
  const out: Record<string, unknown> = { sessions: n };
  for (const spec of specs) out[spec.name] = cols[spec.name].slice(0, n * spec.width);
  return out as unknown as SummaryTable;
}

/** Little-endian bytes of a typed array, whatever the host byte order. */
export function leBytes(a: TypedArray): Uint8Array {
  const size = a.BYTES_PER_ELEMENT;
  const view = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  if (size === 1 || new Uint8Array(new Uint16Array([1]).buffer)[0] === 1) return view;
  const out = new Uint8Array(view.length);
  for (let i = 0; i < view.length; i += size) {
    for (let j = 0; j < size; j++) out[i + j] = view[i + size - 1 - j] as number;
  }
  return out;
}

// ---------------------------------------------------------------- chunk stats

/** Assembles per-chunk stats (any order) into the stored column form, chunks 0..chunks-1. */
export function assembleChunkStats(
  stats: ChunkStats[],
  chunks: number,
  K: number,
  C: number,
  S: number,
): ChunkStatsColumns {
  const out: ChunkStatsColumns = {
    chunks,
    expCum: new Float64Array(chunks * K),
    catExpected: new Float64Array(chunks * C),
    stageWagered: new Float64Array(chunks * S),
    stageNet: new Float64Array(chunks * S),
    stageExpected: new Float64Array(chunks * S),
    transitions: new Int32Array(chunks * S * S),
    rejectedByReason: Array.from({ length: chunks }, () => ({})),
    deferredByReason: Array.from({ length: chunks }, () => ({})),
    errors: [],
    errorCount: 0,
  };
  const all = [];
  for (const s of stats) {
    if (s.chunk < 0 || s.chunk >= chunks) continue;
    out.expCum.set(s.expCum, s.chunk * K);
    out.catExpected.set(s.catExpected, s.chunk * C);
    out.stageWagered.set(s.stageWagered, s.chunk * S);
    out.stageNet.set(s.stageNet, s.chunk * S);
    out.stageExpected.set(s.stageExpected, s.chunk * S);
    out.transitions.set(s.transitions, s.chunk * S * S);
    out.rejectedByReason[s.chunk] = { ...s.rejectedByReason };
    out.deferredByReason[s.chunk] = { ...s.deferredByReason };
    out.errorCount += s.errors.length;
    all.push(...s.errors);
  }
  all.sort((a, b) => a.index - b.index);
  out.errors = all.slice(0, 100);
  return out;
}

export function sliceChunkStats(
  c: ChunkStatsColumns,
  chunks: number,
  K: number,
  C: number,
  S: number,
  sessions: number,
): ChunkStatsColumns {
  if (chunks === c.chunks) return c;
  const errors = c.errors.filter((e) => e.index < sessions);
  return {
    chunks,
    expCum: c.expCum.slice(0, chunks * K),
    catExpected: c.catExpected.slice(0, chunks * C),
    stageWagered: c.stageWagered.slice(0, chunks * S),
    stageNet: c.stageNet.slice(0, chunks * S),
    stageExpected: c.stageExpected.slice(0, chunks * S),
    transitions: c.transitions.slice(0, chunks * S * S),
    rejectedByReason: c.rejectedByReason.slice(0, chunks),
    deferredByReason: c.deferredByReason.slice(0, chunks),
    errors,
    errorCount: c.errorCount === c.errors.length ? errors.length : c.errorCount,
  };
}

export function dims(
  schedule: ArrayLike<number>,
  labels: RunLabels,
): { K: number; C: number; S: number } {
  return { K: schedule.length, C: labels.categories.length, S: labels.stages.length };
}

export function sortedSamples(samples: SampleSession[], n: number): SampleSession[] {
  return samples.filter((s) => s.index < n).sort((a, b) => a.index - b.index);
}
