import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { RunData, RunMeta } from '../contracts/run';
import { splitIntoParts, makeRun } from './__fixtures__/synth';
import {
  createMemoryBackend,
  createRepo,
  createRunSink,
  loadRun,
  openStore,
  resultsDigest,
  STORE_NAMES,
  type Backend,
  type StoreName,
} from './index';

const backends: [string, () => Promise<Backend>][] = [
  ['memory', () => Promise.resolve(createMemoryBackend())],
  ['indexeddb', async () => (await openStore('t', { factory: new IDBFactory() })).backend],
];

const run = await makeRun({
  sessions: 40,
  maxRounds: 60,
  chunkSize: 8,
  samples: 5,
  checkpoints: 16,
});

function partialMeta(done: number): RunMeta {
  const chunks = Math.ceil(run.meta.sessions / run.meta.chunkSize);
  const bitmap = new Uint8Array(Math.ceil(chunks / 8));
  for (let c = 0; c < done; c++) bitmap[c >> 3] = (bitmap[c >> 3] ?? 0) | (1 << (c & 7));
  const completed = Math.min(run.sessions, done * run.meta.chunkSize);
  return {
    ...run.meta,
    status: 'running',
    completedSessions: completed,
    prefixSessions: completed,
    bitmap,
  };
}

async function seedDefinition(b: Backend): Promise<void> {
  await createRepo(b).putDefinition({
    v: 1,
    id: run.meta.definitionId,
    definition: run.definition,
    createdAt: run.meta.createdAt,
    updatedAt: run.meta.createdAt,
    origin: 'user',
    runIds: [],
  });
}

async function everything(b: Backend, runId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const s of STORE_NAMES) {
    out[s] = (await b.getAll<Record<string, unknown>>(s)).filter(
      (r) => r.runId === runId || (s === 'runs' && r.runId === runId),
    ).length;
  }
  return out;
}

describe.each(backends)('RunSink on %s', (_n, make) => {
  it('flushes parts atomically with the meta and loads the prefix of a partial run', async () => {
    const b = await make();
    await seedDefinition(b);
    const sink = createRunSink(b);
    const parts = splitIntoParts(run, 2); // 3 parts: chunks 0-1, 2-3, 4
    await sink.flush(parts[0]!, partialMeta(2));
    await sink.flush(parts[2]!, partialMeta(2)); // chunk 4 arrives before chunks 2-3
    const meta = await b.get<RunMeta>('runs', run.meta.runId);
    expect(meta?.status).toBe('running');
    expect(meta?.storage).toBe(b.kind);
    // the analysis domain is the longest completed prefix: 2 chunks = 16 sessions
    const partial = (await sink.load(run.meta.runId)) as RunData;
    expect(partial.sessions).toBe(16);
    expect(partial.summary.net).toEqual(run.summary.net.slice(0, 16));
    expect(partial.checkpoints.equity).toEqual(run.checkpoints.equity.slice(0, 16 * 16));
    expect(partial.chunkStats.chunks).toBe(2);
    expect(partial.samples.every((s) => s.index < 16)).toBe(true);
    await sink.flush(parts[1]!, { ...partialMeta(5), completedSessions: 40, prefixSessions: 40 });
    const full = (await sink.load(run.meta.runId)) as RunData;
    expect(full.sessions).toBe(40);
    expect(full.summary).toEqual(run.summary);
    expect(full.checkpoints.equity).toEqual(run.checkpoints.equity);
    expect(full.chunkStats).toEqual(run.chunkStats);
    expect(full.samples).toEqual(run.samples);
    expect(await resultsDigest(full)).toBe(await resultsDigest(run));
  });

  it('compacts: results land in the six stores and the parts are deleted', async () => {
    const b = await make();
    await seedDefinition(b);
    const sink = createRunSink(b);
    for (const p of splitIntoParts(run, 2)) await sink.flush(p, partialMeta(5));
    expect((await everything(b, run.meta.runId)).runParts).toBe(3);
    await sink.compact(run, run.meta);
    const counts = await everything(b, run.meta.runId);
    expect(counts).toMatchObject({
      runs: 1,
      runParts: 0,
      summaries: 1,
      checkpoints: 1,
      breakdowns: 1,
      samples: 1,
    });
    const loaded = (await sink.load(run.meta.runId)) as RunData;
    expect(loaded.meta.status).toBe('done');
    expect(loaded.meta.resultsDigest).toBe(await resultsDigest(run));
    expect(loaded.summary).toEqual(run.summary);
    expect(loaded.samples).toEqual(run.samples);
    const def = await createRepo(b).getDefinition(run.meta.definitionId);
    expect(def?.runIds).toEqual([run.meta.runId]);
  });

  it('applies the prefix when loading a compacted run whose analysis domain is shorter', async () => {
    const b = await make();
    await seedDefinition(b);
    const sink = createRunSink(b);
    await sink.compact(run, { ...run.meta, prefixSessions: 16, completedSessions: 16 });
    const loaded = (await sink.load(run.meta.runId)) as RunData;
    expect(loaded.sessions).toBe(16);
    expect(loaded.summary.sessions).toBe(16);
    expect(loaded.summary.catNet.length).toBe(16 * run.meta.labels.categories.length);
    expect(loaded.checkpoints.equity.length).toBe(16 * 16);
    expect(loaded.chunkStats.chunks).toBe(2);
  });

  it('returns null for an unknown run, and for a run whose definition is missing', async () => {
    const b = await make();
    const sink = createRunSink(b);
    expect(await sink.load('nope')).toBeNull();
    await sink.flush(splitIntoParts(run, 5)[0]!, partialMeta(5));
    expect(await loadRun(b, run.meta.runId)).toBeNull();
  });

  it('coalesces flushes requested while one is running into one transaction', async () => {
    const inner = await make();
    let txs = 0;
    const counting: Backend = {
      ...inner,
      kind: inner.kind,
      get: inner.get.bind(inner),
      getAll: inner.getAll.bind(inner),
      getAllKeys: inner.getAllKeys.bind(inner),
      tx: (s, m, f) => {
        txs++;
        return inner.tx(s, m, f);
      },
    };
    const sink = createRunSink(counting);
    const parts = splitIntoParts(run, 1);
    await Promise.all(parts.map((p) => sink.flush(p, partialMeta(5))));
    expect(txs).toBe(1);
    expect((await inner.getAllKeys('runParts')).length).toBe(5);
  });

  it('deletes a run everywhere in one transaction and unlinks definitions and groups', async () => {
    const b = await make();
    await seedDefinition(b);
    const repo = createRepo(b);
    const sink = createRunSink(b);
    await sink.compact(run, run.meta);
    await sink.flush(splitIntoParts(run, 5)[0]!, partialMeta(5)); // a leftover part
    await repo.putGroup({
      v: 1,
      id: 'g',
      kind: 'compare',
      name: 'g',
      runIds: [run.meta.runId, 'other'],
      createdAt: 'x',
      updatedAt: 'y',
    });
    await repo.deleteRun(run.meta.runId);
    expect(await everything(b, run.meta.runId)).toEqual(
      Object.fromEntries(STORE_NAMES.map((s) => [s, 0])),
    );
    expect((await repo.getDefinition(run.meta.definitionId))?.runIds).toEqual([]);
    expect((await repo.listGroups())[0]?.runIds).toEqual(['other']);
  });

  it('lists runs newest first and settings round trip', async () => {
    const b = await make();
    const repo = createRepo(b);
    await repo.putRun({ ...run.meta, runId: 'a-1', createdAt: '2026-01-01' });
    await repo.putRun({ ...run.meta, runId: 'a-2', createdAt: '2026-02-01' });
    expect((await repo.listRuns()).map((r) => r.runId)).toEqual(['a-2', 'a-1']);
    expect((await repo.listRunsOfDefinition(run.meta.definitionId)).length).toBe(2);
    expect(await repo.getSetting('theme')).toBeUndefined();
    await repo.setSetting('theme', { mode: 'dark' });
    expect(await repo.getSetting('theme')).toEqual({ mode: 'dark' });
  });
});

/** Fails the k-th transaction (1-based) and every one after it with a `QuotaExceededError`. */
function quotaBackend(inner: Backend, failFrom: number): Backend & { calls: () => number } {
  let n = 0;
  return {
    kind: 'idb', // pretend to be persistent: a memory backend cannot degrade further
    get: inner.get.bind(inner),
    getAll: inner.getAll.bind(inner),
    getAllKeys: inner.getAllKeys.bind(inner),
    tx(stores: StoreName[], mode, fn) {
      n++;
      if (mode === 'readwrite' && n >= failFrom) {
        return Promise.reject(new DOMException('disk full', 'QuotaExceededError'));
      }
      return inner.tx(stores, mode, fn);
    },
    update: inner.update.bind(inner),
    calls: () => n,
  };
}

describe.each(backends)('quota errors on %s', (_n, make) => {
  it('moves the run to memory, keeps already committed parts, and finishes the run', async () => {
    const inner = await make();
    await seedDefinition(inner);
    const faulty = quotaBackend(inner, 3);
    const sink = createRunSink(faulty);
    const seen: boolean[] = [];
    sink.onFallback((r) => seen.push(r.quota));
    const parts = splitIntoParts(run, 1);
    await sink.flush(parts[0]!, partialMeta(1)); // tx 1 ok
    await sink.flush(parts[1]!, partialMeta(2)); // tx 2 ok
    expect(sink.storage).toBe('idb');
    await sink.flush(parts[2]!, partialMeta(3)); // tx 3 hits the quota: degrade
    expect(sink.storage).toBe('memory');
    expect(seen).toEqual([true]);
    await sink.flush(parts[3]!, partialMeta(4));
    await sink.flush(parts[4]!, partialMeta(5));
    const mid = (await sink.load(run.meta.runId)) as RunData;
    expect(mid.sessions).toBe(40);
    expect(mid.summary).toEqual(run.summary);
    await sink.compact(run, run.meta);
    const done = (await sink.load(run.meta.runId)) as RunData;
    expect(done.meta.storage).toBe('memory');
    expect(await resultsDigest(done)).toBe(await resultsDigest(run));
    // what was committed before the quota hit is untouched and consistent
    const committed = await inner.get<RunMeta>('runs', run.meta.runId);
    expect(committed?.status).toBe('running');
    expect(committed?.completedSessions).toBe(16);
    expect((await inner.getAllKeys('runParts')).length).toBe(2);
  });

  it('a quota error at the very first write still lets the run complete', async () => {
    const inner = await make();
    await seedDefinition(inner);
    const sink = createRunSink(quotaBackend(inner, 1));
    for (const p of splitIntoParts(run, 2)) await sink.flush(p, partialMeta(5));
    await sink.compact(run, run.meta);
    expect(sink.storage).toBe('memory');
    expect((await sink.load(run.meta.runId))?.sessions).toBe(40);
  });
});

describe('sink failure modes', () => {
  it('does not leave a half-written flush when a transaction throws mid-way', async () => {
    const b = createMemoryBackend();
    const poisoned = splitIntoParts(run, 5)[0]!;
    (poisoned as unknown as { columns: unknown[] }).columns = [() => 1]; // cannot be structured-cloned
    const sink = createRunSink(b);
    await sink.flush(poisoned, partialMeta(5)).catch(() => undefined);
    expect(await b.getAll('runs')).toEqual([]);
    expect(await b.getAll('runParts')).toEqual([]);
  });

  it('rethrows when the memory backend itself fails', async () => {
    const sink = createRunSink(createMemoryBackend());
    const bad = splitIntoParts(run, 5)[0]!;
    (bad as unknown as { columns: unknown[] }).columns = [() => 1];
    await expect(sink.flush(bad, partialMeta(5))).rejects.toBeDefined();
  });
});

describe('meta-only flush', () => {
  it('accepts an empty part: updates the run meta and stores no part', async () => {
    const b = createMemoryBackend();
    const sink = createRunSink(b);
    const empty = {
      ...splitIntoParts(run, 5)[0]!,
      chunkCount: 0,
      count: 0,
      columns: [],
      chunks: [],
      samples: [],
      checkpoints: new ArrayBuffer(0),
    };
    await sink.flush(empty, { ...partialMeta(0), status: 'paused' });
    expect((await b.get<RunMeta>('runs', run.meta.runId))?.status).toBe('paused');
    expect(await b.getAllKeys('runParts')).toEqual([]);
  });
});

describe('two runs on one sink', () => {
  it("commits each run's parts with that run's own meta in one transaction", async () => {
    const b = createMemoryBackend();
    const sink = createRunSink(b);
    const other = await makeRun({
      sessions: 40,
      maxRounds: 60,
      chunkSize: 8,
      samples: 5,
      checkpoints: 16,
      seed: 5,
    });
    const pa = splitIntoParts(run, 1);
    const pb = splitIntoParts(other, 1);
    const ma = partialMeta(2);
    const mb = {
      ...partialMeta(1),
      runId: other.meta.runId,
      definitionId: other.meta.definitionId,
    };
    // first flush occupies the queue; the next three coalesce into one transaction
    const first = sink.flush(pa[0]!, partialMeta(1));
    await Promise.all([first, sink.flush(pa[1]!, ma), sink.flush(pb[0]!, mb)]);
    expect((await b.get<RunMeta>('runs', run.meta.runId))?.completedSessions).toBe(
      ma.completedSessions,
    );
    expect((await b.get<RunMeta>('runs', other.meta.runId))?.completedSessions).toBe(
      mb.completedSessions,
    );
    expect((await b.getAllKeys('runParts')).length).toBe(3);
  });
});
