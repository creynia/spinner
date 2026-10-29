// The `RunSink` the harness writes through (contracts/run.ts; reconciliation R2): every flush is
// one atomic transaction over `runs` + `runParts`; compaction is one transaction over the six
// result stores. A storage failure (quota, blocked, closed) degrades to memory instead of failing.
import type { DefinitionRecord } from '../contracts/experiment';
import type {
  ChunkStats,
  ColumnSpec,
  RunData,
  RunMeta,
  RunPart,
  RunSink,
  SampleSession,
} from '../contracts/run';

import {
  allocate,
  assembleChunkStats,
  dims,
  own,
  sliceChunkStats,
  sliceTable,
  sortedSamples,
  tableFrom,
  wrapBuffer,
  columnsOf,
  type TypedArray,
} from './columns';
import {
  boundRange,
  createMemoryBackend,
  isQuotaError,
  type Backend,
  type StoreName,
} from './backend';
import { mergeDisplayName, type StoredRunData } from './definitions';
import { resultsDigest } from './digest';

export interface StoreRunSink extends RunSink {
  /** Where writes go now: `'memory'` after a storage failure (the run continues in memory). */
  readonly storage: 'idb' | 'memory';
  /** Called once when a write failed and the sink moved to memory. */
  onFallback(cb: (reason: { quota: boolean; error: unknown }) => void): void;
  /** The backend in use (the memory copy after a fallback). */
  readonly backend: Backend;
}

interface SummaryRecord {
  v: 1;
  runId: string;
  sessions: number;
  columns: { name: string; dtype: string; width: number; data: TypedArray }[];
}
interface CheckpointRecord {
  v: 1;
  runId: string;
  schedule: Int32Array;
  equity: Int32Array;
}
interface BreakdownRecord {
  v: 1;
  runId: string;
  chunkSize: number;
  chunks: RunData['chunkStats'];
}
interface SampleRecord {
  v: 1;
  runId: string;
  samples: SampleSession[];
}

const RESULT_STORES: StoreName[] = [
  'runs',
  'runParts',
  'summaries',
  'checkpoints',
  'breakdowns',
  'samples',
];

const partRange = (runId: string): IDBKeyRange => boundRange([runId, 0], [runId, Infinity]);

async function partsOf(backend: Backend, runId: string): Promise<RunPart[]> {
  const parts = await backend.getAll<RunPart>('runParts', undefined, partRange(runId));
  return parts.sort((a, b) => a.firstChunk - b.firstChunk);
}

// ---------------------------------------------------------------- load

function fromParts(meta: RunMeta, parts: RunPart[]): Omit<RunData, 'definition' | 'meta'> {
  const N = meta.prefixSessions;
  const { K, C, S } = dims(meta.schedule, meta.labels);
  const chunks = Math.ceil(N / meta.chunkSize);
  const cols = new Map<string, TypedArray>();
  for (const spec of meta.columns) cols.set(spec.name, allocate(spec.dtype, N * spec.width));
  const equity = new Int32Array(N * K);
  const stats: ChunkStats[] = [];
  const samples: SampleSession[] = [];
  for (const p of parts) {
    if (p.firstSession >= N) continue;
    const rows = Math.min(p.count, N - p.firstSession);
    meta.columns.forEach((spec: ColumnSpec, i) => {
      const src = wrapBuffer(spec.dtype, p.columns[i] as ArrayBuffer);
      (cols.get(spec.name) as TypedArray).set(
        src.subarray(0, rows * spec.width),
        p.firstSession * spec.width,
      );
    });
    equity.set(new Int32Array(p.checkpoints).subarray(0, rows * K), p.firstSession * K);
    stats.push(...p.chunks);
    samples.push(...p.samples);
  }
  return {
    sessions: N,
    summary: tableFrom(N, meta.columns, (n) => cols.get(n)),
    checkpoints: { schedule: Int32Array.from(meta.schedule), equity },
    chunkStats: assembleChunkStats(stats, chunks, K, C, S),
    samples: sortedSamples(samples, N),
  };
}

/** Everything durable for a run, prefix applied; `null` when the run (or its definition) is unknown. */
export async function loadRun(backend: Backend, runId: string): Promise<RunData | null> {
  const data = await loadRunOf(backend, runId);
  if (!data) return null;
  const rec = await backend.get<DefinitionRecord>('definitions', data.meta.definitionId);
  if (!rec?.displayName && !rec?.displayNameAt) return data;
  const withName: StoredRunData = {
    ...data,
    ...(rec.displayName ? { displayName: rec.displayName } : {}),
    ...(rec.displayNameAt ? { displayNameAt: rec.displayNameAt } : {}),
  };
  return withName;
}

async function loadRunOf(backend: Backend, runId: string): Promise<RunData | null> {
  const meta = await backend.get<RunMeta>('runs', runId);
  if (!meta) return null;
  const def = await backend.get<DefinitionRecord>('definitions', meta.definitionId);
  if (!def) return null;
  const summaries = await backend.get<SummaryRecord>('summaries', runId);
  if (!summaries) {
    return { meta, definition: def.definition, ...fromParts(meta, await partsOf(backend, runId)) };
  }
  const [cp, bd, sm] = await Promise.all([
    backend.get<CheckpointRecord>('checkpoints', runId),
    backend.get<BreakdownRecord>('breakdowns', runId),
    backend.get<SampleRecord>('samples', runId),
  ]);
  if (!cp || !bd || !sm) return null;
  const stored = summaries.sessions;
  const N = Math.min(meta.prefixSessions, stored);
  const { K, C, S } = dims(cp.schedule, meta.labels);
  const byName = new Map(summaries.columns.map((c) => [c.name, c.data]));
  let table = tableFrom(stored, meta.columns, (n) => byName.get(n));
  let equity = cp.equity;
  let chunkStats = bd.chunks;
  if (N < stored) {
    table = sliceTable(table, meta.columns, N);
    equity = equity.slice(0, N * K);
    chunkStats = sliceChunkStats(chunkStats, Math.ceil(N / meta.chunkSize), K, C, S, N);
  }
  return {
    meta,
    definition: def.definition,
    sessions: N,
    summary: table,
    checkpoints: { schedule: cp.schedule, equity },
    chunkStats,
    samples: sortedSamples(sm.samples, N),
  };
}

// ---------------------------------------------------------------- write

/**
 * One transaction: `summaries`, `checkpoints`, `breakdowns`, `samples`, the final `RunMeta`
 * (with `resultsDigest`), the definition record's `runIds`, and the deletion of every `runPart`.
 */
export async function writeCompacted(
  backend: Backend,
  data: RunData,
  meta: RunMeta,
  origin?: DefinitionRecord['origin'],
): Promise<RunMeta> {
  const digest = meta.resultsDigest ?? (await resultsDigest({ ...data, meta }));
  const finalMeta: RunMeta = { ...meta, resultsDigest: digest, storage: backend.kind };
  const partKeys = await backend.getAllKeys('runParts', partRange(meta.runId));
  const existing = await backend.get<DefinitionRecord>('definitions', meta.definitionId);
  const cols = columnsOf(data.summary);
  await backend.tx([...RESULT_STORES, 'definitions'], 'readwrite', (t) => {
    t.put('runs', finalMeta);
    t.put('summaries', {
      v: 1,
      runId: meta.runId,
      sessions: data.sessions,
      columns: meta.columns.map((spec) => ({
        name: spec.name,
        dtype: spec.dtype,
        width: spec.width,
        data: own(cols[spec.name]),
      })),
    } satisfies SummaryRecord);
    t.put('checkpoints', {
      v: 1,
      runId: meta.runId,
      schedule: own(data.checkpoints.schedule),
      equity: own(data.checkpoints.equity),
    } satisfies CheckpointRecord);
    t.put('breakdowns', {
      v: 1,
      runId: meta.runId,
      chunkSize: meta.chunkSize,
      chunks: data.chunkStats,
    } satisfies BreakdownRecord);
    t.put('samples', { v: 1, runId: meta.runId, samples: data.samples } satisfies SampleRecord);
    for (const k of partKeys) t.delete('runParts', k);
    if (!existing) {
      const { displayName, displayNameAt } = data as StoredRunData;
      t.put('definitions', {
        v: 1,
        id: meta.definitionId,
        definition: data.definition,
        ...(displayName && displayName !== data.definition.name ? { displayName } : {}),
        ...(displayNameAt ? { displayNameAt } : {}),
        createdAt: meta.createdAt,
        updatedAt: meta.createdAt,
        origin: origin ?? (meta.imported ? 'import' : 'user'),
        runIds: [meta.runId],
      } satisfies DefinitionRecord);
    } else {
      const merged = mergeDisplayName(existing, data as StoredRunData) ?? existing;
      if (merged !== existing || !existing.runIds.includes(meta.runId)) {
        t.put('definitions', {
          ...merged,
          runIds: existing.runIds.includes(meta.runId)
            ? existing.runIds
            : [...existing.runIds, meta.runId],
        });
      }
    }
  });
  return finalMeta;
}

async function copyRun(from: Backend, to: Backend, runId: string): Promise<void> {
  const meta = await from.get<RunMeta>('runs', runId);
  if (!meta) return;
  const def = await from.get<DefinitionRecord>('definitions', meta.definitionId);
  const parts = await partsOf(from, runId);
  const [sm, cp, bd, sa] = await Promise.all([
    from.get<SummaryRecord>('summaries', runId),
    from.get<CheckpointRecord>('checkpoints', runId),
    from.get<BreakdownRecord>('breakdowns', runId),
    from.get<SampleRecord>('samples', runId),
  ]);
  await to.tx([...RESULT_STORES, 'definitions'], 'readwrite', (t) => {
    t.put('runs', { ...meta, storage: 'memory' });
    if (def) t.put('definitions', def);
    for (const p of parts) t.put('runParts', p);
    if (sm) t.put('summaries', sm);
    if (cp) t.put('checkpoints', cp);
    if (bd) t.put('breakdowns', bd);
    if (sa) t.put('samples', sa);
  });
}

/**
 * The `RunSink` for the harness. Flushes are serialized and coalesced (a flush requested while
 * one runs is merged into the next transaction); a failed transaction moves the sink to an
 * in-memory copy of the run (`storage` becomes `'memory'`, `onFallback` fires) and the call
 * succeeds there, so the run continues (harness-data-analysis.md §7).
 */
export function createRunSink(backend: Backend): StoreRunSink {
  let current = backend;
  let chain: Promise<unknown> = Promise.resolve();
  let scheduled = false;
  const pending: {
    part: RunPart;
    meta: RunMeta;
    resolve: () => void;
    reject: (e: unknown) => void;
  }[] = [];
  const listeners: ((r: { quota: boolean; error: unknown }) => void)[] = [];

  async function degrade(runIds: string[], error: unknown): Promise<void> {
    const mem = createMemoryBackend();
    for (const runId of runIds) {
      try {
        await copyRun(current, mem, runId);
      } catch {
        // what was already committed stays in the old backend; analyze what the memory copy holds
      }
    }
    current = mem;
    for (const l of listeners) l({ quota: isQuotaError(error), error });
  }

  /**
   * Runs `op`; on ANY failure of a persistent backend (quota, blocked, closed connection, even a
   * DataCloneError) the sink moves to an in-memory copy of the runs involved and retries there, so
   * a run is never lost to a storage problem. A failure in memory is rethrown.
   */
  async function guarded(runIds: string[], op: (b: Backend) => Promise<void>): Promise<void> {
    try {
      await op(current);
    } catch (e) {
      if (current.kind === 'memory') throw e;
      await degrade(runIds, e);
      await op(current);
    }
  }

  async function drain(): Promise<void> {
    scheduled = false;
    const items = pending.splice(0);
    if (items.length === 0) return;
    // one transaction; the last meta of each run goes with that run's parts
    const lastMeta = new Map<string, RunMeta>();
    for (const it of items) lastMeta.set(it.meta.runId, it.meta);
    try {
      await guarded([...lastMeta.keys()], (b) =>
        b.tx(['runs', 'runParts'], 'readwrite', (t) => {
          for (const it of items) if (it.part.chunkCount > 0) t.put('runParts', it.part);
          for (const m of lastMeta.values()) t.put('runs', { ...m, storage: b.kind });
        }),
      );
      for (const it of items) it.resolve();
    } catch (e) {
      for (const it of items) it.reject(e);
    }
  }

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn);
    chain = p.catch(() => undefined);
    return p;
  };

  return {
    get storage() {
      return current.kind;
    },
    get backend() {
      return current;
    },
    onFallback(cb) {
      listeners.push(cb);
    },
    flush(part, meta) {
      return new Promise<void>((resolve, reject) => {
        pending.push({ part, meta, resolve, reject });
        if (!scheduled) {
          scheduled = true;
          chain = chain.then(drain);
        }
      });
    },
    compact(data, meta) {
      return enqueue(() =>
        guarded([meta.runId], async (b) => {
          await writeCompacted(b, data, meta);
        }),
      );
    },
    load(runId) {
      return enqueue(() => loadRun(current, runId));
    },
  };
}
