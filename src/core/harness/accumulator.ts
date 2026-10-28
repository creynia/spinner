// In-memory run data: the full-size summary table, checkpoint matrix and chunk stats that batches
// are merged into, the chunk bitmap, and the prefix view the analysis reads
// (harness-data-analysis.md §5.4, §6.5). Used by the run controller and by test sinks.
import type { NormalizedDefinition } from '../contracts/experiment';
import type {
  ChunkStats,
  ChunkStatsColumns,
  ColumnSpec,
  RunData,
  RunLabels,
  RunMeta,
  SampleSession,
  SessionError,
  SummaryTable,
} from '../contracts/run';
import { allocSummary, column, viewColumn, type TypedArray } from './columns';

export const MAX_STORED_ERRORS = 100;

export function bitmapBytes(chunks: number): number {
  return (chunks + 7) >> 3;
}
export function bitGet(bitmap: Uint8Array, c: number): boolean {
  return (bitmap[c >> 3]! & (1 << (c & 7))) !== 0;
}
export function bitSet(bitmap: Uint8Array, c: number): void {
  bitmap[c >> 3] = bitmap[c >> 3]! | (1 << (c & 7));
}

/** Chunk stats as struct of arrays for the first `count` chunks (missing chunks are zeros). */
export function buildChunkStatsColumns(
  chunks: readonly (ChunkStats | undefined)[],
  count: number,
  K: number,
  C: number,
  S: number,
): ChunkStatsColumns {
  const cols: ChunkStatsColumns = {
    chunks: count,
    expCum: new Float64Array(count * K),
    catExpected: new Float64Array(count * C),
    stageWagered: new Float64Array(count * S),
    stageNet: new Float64Array(count * S),
    stageExpected: new Float64Array(count * S),
    transitions: new Int32Array(count * S * S),
    rejectedByReason: [],
    deferredByReason: [],
    errors: [],
    errorCount: 0,
  };
  for (let c = 0; c < count; c++) {
    const cs = chunks[c];
    if (!cs) {
      cols.rejectedByReason.push({});
      cols.deferredByReason.push({});
      continue;
    }
    cols.expCum.set(cs.expCum, c * K);
    cols.catExpected.set(cs.catExpected, c * C);
    cols.stageWagered.set(cs.stageWagered, c * S);
    cols.stageNet.set(cs.stageNet, c * S);
    cols.stageExpected.set(cs.stageExpected, c * S);
    cols.transitions.set(cs.transitions, c * S * S);
    cols.rejectedByReason.push(cs.rejectedByReason);
    cols.deferredByReason.push(cs.deferredByReason);
    cols.errorCount += cs.errors.length;
    for (const e of cs.errors) if (cols.errors.length < MAX_STORED_ERRORS) cols.errors.push(e);
  }
  return cols;
}

export class RunAccumulator {
  readonly chunks: number;
  readonly K: number;
  readonly table: SummaryTable;
  readonly equity: Int32Array;
  readonly chunkStats: (ChunkStats | undefined)[];
  readonly done: Uint8Array;
  private readonly samples = new Map<number, SampleSession>();

  constructor(
    readonly sessions: number,
    readonly chunkSize: number,
    readonly specs: readonly ColumnSpec[],
    readonly labels: RunLabels,
    readonly schedule: Int32Array,
  ) {
    this.chunks = Math.ceil(sessions / chunkSize);
    this.K = schedule.length;
    this.table = allocSummary(specs, sessions);
    this.equity = new Int32Array(sessions * this.K);
    this.chunkStats = new Array<ChunkStats | undefined>(this.chunks).fill(undefined);
    this.done = new Uint8Array(this.chunks);
  }

  /** Index-addressed merge of one batch. Arrival order never matters. */
  mergePart(part: {
    firstChunk: number;
    chunkCount: number;
    firstSession: number;
    count: number;
    columns: ArrayBuffer[];
    checkpoints: ArrayBuffer;
    chunks: ChunkStats[];
    samples: SampleSession[];
  }): void {
    this.specs.forEach((spec, i) => {
      const dst = column(this.table, spec.name);
      const src = viewColumn(spec.dtype, part.columns[i]!);
      dst.set(src, part.firstSession * spec.width);
    });
    this.equity.set(new Int32Array(part.checkpoints), part.firstSession * this.K);
    for (const cs of part.chunks) this.chunkStats[cs.chunk] = cs;
    for (const s of part.samples) this.samples.set(s.index, s);
    for (let c = 0; c < part.chunkCount; c++) this.done[part.firstChunk + c] = 1;
  }

  /** A deep copy (typed arrays copied; chunk stats and samples are immutable once merged). */
  clone(): RunAccumulator {
    const c = new RunAccumulator(
      this.sessions,
      this.chunkSize,
      this.specs,
      this.labels,
      this.schedule,
    );
    for (const spec of this.specs) {
      column(c.table, spec.name).set(column(this.table, spec.name), 0);
    }
    c.equity.set(this.equity);
    c.done.set(this.done);
    this.chunkStats.forEach((cs, i) => (c.chunkStats[i] = cs));
    for (const s of this.samples.values()) c.samples.set(s.index, s);
    return c;
  }

  /** Replace a sample (the controller trims traces over the per-run budget). */
  setSample(s: SampleSession): void {
    this.samples.set(s.index, s);
  }

  /** Chunk index of the first chunk not yet merged (the length of the completed prefix). */
  prefixChunks(): number {
    let c = 0;
    while (c < this.chunks && this.done[c] === 1) c++;
    return c;
  }

  prefixSessions(): number {
    return Math.min(this.sessions, this.prefixChunks() * this.chunkSize);
  }

  completedSessions(): number {
    let n = 0;
    for (let c = 0; c < this.chunks; c++) {
      if (this.done[c] === 1) n += Math.min(this.chunkSize, this.sessions - c * this.chunkSize);
    }
    return n;
  }

  bitmap(): Uint8Array {
    const b = new Uint8Array(bitmapBytes(this.chunks));
    for (let c = 0; c < this.chunks; c++) if (this.done[c] === 1) bitSet(b, c);
    return b;
  }

  /**
   * Load a stored run: every chunk whose bit is set in `data.meta.bitmap` and whose sessions the
   * data holds (`RunData` has the analysis prefix applied, so later chunks may be absent).
   */
  loadFrom(data: RunData): void {
    const n = data.sessions;
    const have = Math.min(n, this.sessions);
    for (const spec of this.specs) {
      const src = column(data.summary, spec.name);
      const dst = column(this.table, spec.name);
      dst.set(src.subarray(0, have * spec.width), 0);
    }
    this.equity.set(data.checkpoints.equity.subarray(0, have * this.K), 0);
    const { K, labels } = this;
    const C = labels.categories.length;
    const S = labels.stages.length;
    const cols = data.chunkStats;
    for (let c = 0; c < this.chunks; c++) {
      const end = Math.min(this.sessions, (c + 1) * this.chunkSize);
      if (!bitGet(data.meta.bitmap, c) || end > have || c >= cols.chunks) continue;
      this.chunkStats[c] = {
        chunk: c,
        expCum: cols.expCum.slice(c * K, (c + 1) * K),
        catExpected: cols.catExpected.slice(c * C, (c + 1) * C),
        stageWagered: cols.stageWagered.slice(c * S, (c + 1) * S),
        stageNet: cols.stageNet.slice(c * S, (c + 1) * S),
        stageExpected: cols.stageExpected.slice(c * S, (c + 1) * S),
        transitions: cols.transitions.slice(c * S * S, (c + 1) * S * S),
        rejectedByReason: cols.rejectedByReason[c] ?? {},
        deferredByReason: cols.deferredByReason[c] ?? {},
        errors: cols.errors.filter((e) => e.index >= c * this.chunkSize && e.index < end),
      };
      this.done[c] = 1;
    }
    for (const s of data.samples) this.samples.set(s.index, s);
  }

  sampleList(limit = this.sessions): SampleSession[] {
    return [...this.samples.values()]
      .filter((s) => s.index < limit)
      .sort((a, b) => a.index - b.index);
  }

  /** Errors of merged chunks, in index order (for tests and the run screen). */
  allErrors(): SessionError[] {
    const out: SessionError[] = [];
    for (const cs of this.chunkStats) if (cs) out.push(...cs.errors);
    return out;
  }

  /** The analysis view: the completed prefix only (harness-data-analysis.md §6.5). */
  toRunData(
    meta: RunMeta,
    definition: NormalizedDefinition,
    opts: { copy?: boolean } = {},
  ): RunData {
    const n = this.prefixSessions();
    const pc = this.prefixChunks();
    const view = <T extends TypedArray>(a: T, width: number): T => {
      const v = a.subarray(0, n * width) as T;
      return (opts.copy ? v.slice() : v) as T;
    };
    const summary: Record<string, unknown> = { sessions: n };
    for (const spec of this.specs) {
      summary[spec.name] = view(column(this.table, spec.name), spec.width);
    }
    return {
      meta,
      definition,
      sessions: n,
      summary: summary as unknown as SummaryTable,
      checkpoints: { schedule: this.schedule, equity: view(this.equity, this.K) },
      chunkStats: buildChunkStatsColumns(
        this.chunkStats,
        pc,
        this.K,
        this.labels.categories.length,
        this.labels.stages.length,
      ),
      samples: this.sampleList(n),
    };
  }
}
