// An in-memory `RunSink` for tests (and for the memory-backend fallback shape). Parts are cloned
// on the way in, like IndexedDB does, so a controller cannot alias what it committed.
import type { NormalizedDefinition } from '../contracts/experiment';
import type { RunData, RunMeta, RunPart, RunSink } from '../contracts/run';
import { RunAccumulator } from '../harness/accumulator';

interface Stored {
  meta: RunMeta;
  acc: RunAccumulator | null;
}

export interface MemorySink extends RunSink {
  /** Number of `flush` calls, empty ones included. */
  flushes: number;
  compacted: number;
  /** Throw from `flush` once this many calls have succeeded (a quota failure). */
  failAfterFlushes: number | undefined;
  metaOf(runId: string): RunMeta | undefined;
  /** A deep copy of the committed state: what a crash at this moment would leave behind. */
  clone(): MemorySink;
}

export function createMemorySink(
  definition: NormalizedDefinition,
  runs: Map<string, Stored> = new Map(),
): MemorySink {
  const ensure = (meta: RunMeta, st: Stored | undefined): Stored => {
    const stored = st ?? { meta, acc: null };
    stored.meta = meta;
    if (!stored.acc && meta.columns.length > 0) {
      stored.acc = new RunAccumulator(
        meta.sessions,
        meta.chunkSize,
        meta.columns,
        meta.labels,
        meta.schedule,
      );
    }
    return stored;
  };

  const sink: MemorySink = {
    flushes: 0,
    compacted: 0,
    failAfterFlushes: undefined,
    flush(part: RunPart, meta: RunMeta): Promise<void> {
      if (sink.failAfterFlushes !== undefined && sink.flushes >= sink.failAfterFlushes) {
        const e = new Error('quota exceeded');
        e.name = 'QuotaExceededError';
        return Promise.reject(e);
      }
      sink.flushes++;
      const m = structuredClone(meta);
      const st = ensure(m, runs.get(m.runId));
      runs.set(m.runId, st);
      if (part.chunkCount > 0 && st.acc) st.acc.mergePart(structuredClone(part));
      return Promise.resolve();
    },
    compact(data: RunData, meta: RunMeta): Promise<void> {
      sink.compacted++;
      const m = structuredClone(meta);
      const st = ensure(m, runs.get(m.runId));
      runs.set(m.runId, st);
      st.acc?.loadFrom(structuredClone(data));
      return Promise.resolve();
    },
    load(runId: string): Promise<RunData | null> {
      const st = runs.get(runId);
      if (!st) return Promise.resolve(null);
      if (!st.acc) return Promise.reject(new Error('memory sink: run has no data yet'));
      return Promise.resolve(
        st.acc.toRunData(structuredClone(st.meta), definition, { copy: true }),
      );
    },
    metaOf: (runId) => runs.get(runId)?.meta,
    clone(): MemorySink {
      const copy = new Map<string, Stored>();
      for (const [id, st] of runs) {
        copy.set(id, { meta: structuredClone(st.meta), acc: st.acc ? st.acc.clone() : null });
      }
      return createMemorySink(definition, copy);
    },
  };
  return sink;
}
