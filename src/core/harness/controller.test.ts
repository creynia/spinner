import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FromSim, SimTransport } from '../contracts/protocol';
import type { RunData, RunProgress } from '../contracts/run';
import { CORE_VERSION } from '../contracts/version';
import {
  STAGED_COIN,
  coin,
  coinDefinition,
  coinPool,
  coinRun,
  compileTestStrategy,
  createMemorySink,
  digestRunData,
  runCoinToEnd,
} from '../testing';
import { RunControllerError } from './controller';
import { createInThreadTransport } from './transport';
import { createPool } from './pool';
import { RunAccumulator } from './accumulator';
import { bitGet } from './accumulator';
import { simulate } from './simulate';
import { limitForTail, updateBatchSize } from './batching';
import { acquireRunLock, type LockManagerLike } from './lock';

const def = coinDefinition({
  strategy: STAGED_COIN,
  sessions: 2000,
  maxRounds: 100,
  bankroll: 5000,
  seed: 7,
});

let baseline: { digest: string; data: RunData } | null = null;
async function base(): Promise<{ digest: string; data: RunData }> {
  if (!baseline) {
    const data = await runCoinToEnd(def, { workers: 1, batchChunks: 64 });
    baseline = { digest: digestRunData(data), data };
  }
  return baseline;
}

afterEach(() => vi.useRealTimers());

describe('determinism (harness doc §2, §14.2.4)', () => {
  it('the baseline run is complete, with samples, and the sink holds the compacted result', async () => {
    const { data } = await base();
    expect(data.sessions).toBe(2000);
    expect(data.meta.status).toBe('done');
    expect(data.meta.chunks).toBe(Math.ceil(2000 / 64));
    expect(data.samples).toHaveLength(24);
    expect(data.chunkStats.chunks).toBe(32);
    expect(Array.from(data.meta.bitmap.slice(0, 3))).toEqual([255, 255, 255]);
  });

  for (const workers of [1, 2, 4]) {
    for (const batchChunks of [1, 3, 64, undefined]) {
      it(`${workers} worker(s), batches of ${batchChunks ?? 'adaptive'} chunk(s) are byte-identical`, async () => {
        const data = await runCoinToEnd(def, { workers, batchChunks });
        expect(digestRunData(data)).toBe((await base()).digest);
      });
    }
  }

  it('two separate runs of the same definition are byte-identical (timeout hop too)', async () => {
    const pool = coinPool(2, 'timeout');
    const data = await runCoinToEnd(def, { pool, batchChunks: 5, runId: 'again' });
    pool.terminate();
    expect(digestRunData(data)).toBe((await base()).digest);
  });

  it('a different seed gives different results', async () => {
    const data = await runCoinToEnd({ ...def, run: { ...def.run, seed: 8 } }, { workers: 2 });
    expect(digestRunData(data)).not.toBe((await base()).digest);
  });

  it('sample traces equal an independent re-simulation of the same index (Watch)', async () => {
    const { data } = await base();
    const pool = coinPool(1);
    for (const s of [data.samples[0]!, data.samples[9]!, data.samples[23]!]) {
      const sim = await simulate(pool, def, s.index);
      expect(sim.row).toEqual(s.row);
      expect(sim.trace).toEqual(s.trace);
    }
    pool.terminate();
  });
});

describe('resume from a partial bitmap', () => {
  it('pause, then a new controller resumes from the sink and finishes identically', async () => {
    const run1 = coinRun(def, {
      workers: 3,
      batchChunks: 1,
      controller: { flushEveryBatches: 2 },
    });
    let paused = false;
    run1.controller.subscribe((p) => {
      if (!paused && p.completedSessions >= 600) {
        paused = true;
        void run1.controller.pause();
      }
    });
    const pausedP = run1.controller.settled();
    await run1.controller.start();
    expect(await pausedP).toBe('paused');
    const meta = run1.sink.metaOf('run-test')!;
    expect(meta.status).toBe('paused');
    expect(meta.completedSessions).toBeGreaterThanOrEqual(600);
    expect(meta.completedSessions).toBeLessThan(2000);

    const run2 = coinRun(def, { workers: 1, batchChunks: 7, sink: run1.sink });
    const done = run2.controller.settled();
    await run2.controller.resume();
    expect(await done).toBe('done');
    const data = await run1.sink.load('run-test');
    expect(digestRunData(data!)).toBe((await base()).digest);
    expect(data!.meta.resumes).toHaveLength(1);
    expect(data!.meta.resumes[0]!.completedSessions).toBeGreaterThan(0);
  });

  it('a crash at an arbitrary point (a copy of the sink mid-run) resumes identically', async () => {
    const live = coinRun(def, { workers: 4, batchChunks: 1, controller: { flushEveryBatches: 1 } });
    let crashed: ReturnType<typeof createMemorySink> | null = null;
    live.controller.subscribe((p) => {
      if (!crashed && p.completedSessions >= 700) crashed = live.sink.clone();
    });
    const finished = live.controller.settled();
    await live.controller.start();
    await finished;
    expect(crashed).not.toBeNull();
    const partial = await crashed!.load('run-test');
    expect(partial!.sessions).toBeLessThan(2000);
    // The meta of a crash holds whatever was last committed; the run was `running`.
    expect(partial!.meta.status).toBe('running');

    const resumed = coinRun(def, { workers: 2, batchChunks: 3, sink: crashed! });
    const done = resumed.controller.settled();
    await resumed.controller.resume();
    expect(await done).toBe('done');
    const data = await crashed!.load('run-test');
    expect(digestRunData(data!)).toBe((await base()).digest);
  });

  it('refuses to resume a run made with another core or game version', async () => {
    const run1 = coinRun(def, { workers: 1, batchChunks: 1 });
    run1.controller.subscribe((p) => {
      if (p.completedSessions >= 128) void run1.controller.pause();
    });
    const pausedP = run1.controller.settled();
    await run1.controller.start();
    await pausedP;
    const stored = run1.sink.metaOf('run-test')!;
    expect(stored.coreVersion).toBe(CORE_VERSION);
    stored.coreVersion = '0.0.1';
    const run2 = coinRun(def, { sink: run1.sink });
    await expect(run2.controller.resume()).rejects.toMatchObject({ code: 'version-mismatch' });
    await expect(coinRun(def, { runId: 'nope' }).controller.resume()).rejects.toMatchObject({
      code: 'unknown-run',
    });
  });
});

describe('pause and cancel', () => {
  it('pause flushes, stops dispatching, and resume on the same controller finishes identically', async () => {
    const run = coinRun(def, { workers: 2, batchChunks: 2 });
    let asked = false;
    run.controller.subscribe((p) => {
      if (!asked && p.status === 'running' && p.completedSessions >= 500) {
        asked = true;
        void run.controller.pause();
      }
    });
    const pausedP = run.controller.settled();
    await run.controller.start();
    expect(await pausedP).toBe('paused');
    const flushesAtPause = run.sink.flushes;
    expect(run.controller.status).toBe('paused');
    await new Promise((r) => setTimeout(r, 20));
    expect(run.sink.flushes).toBe(flushesAtPause); // nothing dispatched, nothing flushed
    const snap = run.controller.snapshot();
    expect(snap.sessions).toBe(snap.meta.prefixSessions);
    expect(snap.sessions % 64).toBe(0);

    const done = run.controller.settled();
    await run.controller.resume();
    expect(await done).toBe('done');
    const data = await run.sink.load('run-test');
    expect(digestRunData(data!)).toBe((await base()).digest);
  });

  it('cancel keeps a consistent state: committed chunks match the full run, no later writes', async () => {
    const full = (await base()).data;
    const run = coinRun(def, { workers: 3, batchChunks: 1, controller: { flushEveryBatches: 3 } });
    let cancelled = false;
    run.controller.subscribe((p) => {
      if (!cancelled && p.completedSessions >= 800) {
        cancelled = true;
        void run.controller.cancel();
      }
    });
    const settled = run.controller.settled();
    await run.controller.start();
    expect(await settled).toBe('cancelled');
    expect(run.controller.status).toBe('cancelled');
    const meta = run.sink.metaOf('run-test')!;
    expect(meta.status).toBe('cancelled');
    expect(meta.completedSessions).toBeGreaterThanOrEqual(800);
    expect(meta.completedSessions).toBeLessThan(2000);

    // Every chunk whose bit is set holds exactly the rows of the uninterrupted run.
    const stored = (await run.sink.load('run-test'))!;
    const prefix = stored.sessions;
    expect(prefix).toBe(meta.prefixSessions);
    expect(Array.from(stored.summary.final)).toEqual(
      Array.from(full.summary.final.slice(0, prefix)),
    );
    expect(Array.from(stored.summary.stageRounds)).toEqual(
      Array.from(full.summary.stageRounds.slice(0, prefix * 3)),
    );
    for (let c = 0; c < meta.chunks; c++) {
      if (bitGet(meta.bitmap, c)) {
        // durable chunk c is a prefix chunk or recoverable on resume
        expect(c).toBeLessThan(meta.chunks);
      }
    }
    const flushes = run.sink.flushes;
    await new Promise((r) => setTimeout(r, 30));
    expect(run.sink.flushes).toBe(flushes); // in-flight results were discarded, not written

    // "Continue" from the cancelled state finishes identically.
    const done = run.controller.settled();
    await run.controller.start(); // start on a cancelled controller continues
    expect(await done).toBe('done');
    expect(digestRunData((await run.sink.load('run-test'))!)).toBe((await base()).digest);
  });

  it('cancel while queued behind another run never starts it', async () => {
    const pool = coinPool(1);
    const a = coinRun(def, { pool, batchChunks: 1, runId: 'a' });
    const b = coinRun(def, { pool, batchChunks: 1, runId: 'b' });
    const aDone = a.controller.settled();
    await a.controller.start();
    const bStart = b.controller.start();
    await b.controller.cancel();
    await expect(bStart).rejects.toMatchObject({ code: 'superseded' });
    expect(b.controller.status).toBe('cancelled');
    await aDone;
    expect(a.controller.status).toBe('done');
    pool.terminate();
  });

  it('runs queue FIFO on the pool: the second run starts only after the first has merged everything', async () => {
    const pool = coinPool(2);
    const small = coinDefinition({ sessions: 128, maxRounds: 50 });
    const a = coinRun(small, { pool, runId: 'a' });
    const b = coinRun(small, { pool, runId: 'b' });
    let aCompletedWhenBStarted = -1;
    b.controller.subscribe((p) => {
      if (p.status === 'running' && aCompletedWhenBStarted < 0) {
        aCompletedWhenBStarted = a.controller.snapshot().sessions;
      }
    });
    const aDone = a.controller.settled();
    const bDone = b.controller.settled();
    await Promise.all([a.controller.start(), b.controller.start()]);
    await Promise.all([aDone, bDone]);
    expect(aCompletedWhenBStarted).toBe(128);
    expect(a.controller.status).toBe('done');
    expect(b.controller.status).toBe('done');
    pool.terminate();
  });
});

describe('failure handling', () => {
  function crashingPool(times: number): ReturnType<typeof createPool> {
    let left = times;
    return createPool({
      size: 2,
      spawn: (): SimTransport => {
        const inner = createInThreadTransport(coin, {
          compile: compileTestStrategy,
          hop: 'microtask',
        });
        const listeners = new Set<(m: FromSim) => void>();
        inner.onMessage((m) => listeners.forEach((f) => f(m)));
        return {
          mode: 'inthread',
          post(msg, tr) {
            if (msg.t === 'batch' && left > 0) {
              left--;
              queueMicrotask(() =>
                listeners.forEach((f) =>
                  f({
                    t: 'error',
                    runKey: msg.runKey,
                    batchId: msg.batchId,
                    code: 'boom',
                    message: 'x',
                  }),
                ),
              );
              return;
            }
            inner.post(msg, tr);
          },
          onMessage(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
          terminate() {
            listeners.clear();
            inner.terminate();
          },
        };
      },
    });
  }

  it('a crashed batch is re-dispatched once on a fresh worker and the result is unchanged', async () => {
    const pool = crashingPool(2);
    const data = await runCoinToEnd(def, { pool, batchChunks: 4 });
    expect(digestRunData(data)).toBe((await base()).digest);
    pool.terminate();
  });

  it('the same batch failing twice puts the run in error with its data kept', async () => {
    const pool = crashingPool(1000);
    const run = coinRun(def, { pool, batchChunks: 4 });
    const settled = run.controller.settled();
    await run.controller.start();
    expect(await settled).toBe('error');
    expect(run.controller.error).toMatchObject({ code: 'worker-crash' });
    expect(run.sink.metaOf('run-test')).toMatchObject({
      status: 'error',
      error: { code: 'worker-crash' },
    });
    pool.terminate();
  });

  it('a strategy that does not compile fails start() with init-error', async () => {
    const pool = createPool({
      size: 1,
      spawn: () =>
        createInThreadTransport(coin, {
          hop: 'microtask',
          compile: () => {
            throw new Error('bad strategy');
          },
        }),
    });
    const run = coinRun(def, { pool });
    await expect(run.controller.start()).rejects.toBeInstanceOf(RunControllerError);
    expect(run.controller.status).toBe('error');
    expect(run.controller.error).toMatchObject({ code: 'init-error' });
    pool.terminate();
  });

  it('a stale worker (other game version) stops the run with "App updated, reload"', async () => {
    const stale = { ...coin, version: '9.9.9' };
    const pool = createPool({
      size: 1,
      spawn: () =>
        createInThreadTransport(stale, { compile: compileTestStrategy, hop: 'microtask' }),
    });
    const run = coinRun(def, { pool });
    await expect(run.controller.start()).rejects.toMatchObject({ code: 'stale-app' });
    expect(run.controller.error?.message).toBe('App updated, reload');
    pool.terminate();
  });

  it('a storage failure keeps the run going in memory; nothing already committed is lost', async () => {
    const sink = createMemorySink(def);
    sink.failAfterFlushes = 3;
    const run = coinRun(def, {
      workers: 2,
      batchChunks: 1,
      sink,
      controller: { flushEveryBatches: 1 },
    });
    const settled = run.controller.settled();
    await run.controller.start();
    expect(await settled).toBe('done');
    expect(run.controller.meta!.storage).toBe('memory');
    expect(sink.compacted).toBe(0);
    expect(digestRunData(run.controller.snapshot())).toBe((await base()).digest);
  });

  it('injects the results digest into the final meta before compaction', async () => {
    const run = coinRun(coinDefinition({ sessions: 64, maxRounds: 10 }), {
      controller: { digest: (d) => Promise.resolve(`digest-${d.sessions}`) },
    });
    const settled = run.controller.settled();
    await run.controller.start();
    await settled;
    expect(run.sink.metaOf('run-test')!.resultsDigest).toBe('digest-64');
    expect(run.controller.meta!.resultsDigest).toBe('digest-64');
  });
});

describe('progress', () => {
  it('reports monotone completed sessions, ends with done at 100%, and the throughput is finite', async () => {
    const run = coinRun(def, { workers: 2, batchChunks: 2 });
    const seen: RunProgress[] = [];
    run.controller.subscribe((p) => seen.push(p));
    const settled = run.controller.settled();
    await run.controller.start();
    await settled;
    expect(seen.length).toBeGreaterThan(5);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.completedSessions).toBeGreaterThanOrEqual(seen[i - 1]!.completedSessions);
    }
    const last = seen.at(-1)!;
    expect(last).toMatchObject({
      status: 'done',
      completedSessions: 2000,
      prefixSessions: 2000,
      sessions: 2000,
    });
    expect(seen.every((p) => Number.isFinite(p.sessionsPerSec))).toBe(true);
    expect(seen.some((p) => p.workers === 2)).toBe(true);
  });

  it('batches are sized to the target: first batch 1 chunk, then round(T * rate), tail shrinks', () => {
    expect(updateBatchSize(undefined, 1, 10, 250)).toEqual({ rate: 0.1, k: 25 });
    const second = updateBatchSize(0.1, 25, 125, 250);
    expect(second.rate).toBeCloseTo(0.15, 12);
    expect(second.k).toBe(38);
    expect(updateBatchSize(undefined, 1, 0, 250).k).toBe(64); // elapsed clamps to 1 ms
    expect(updateBatchSize(undefined, 1, 100_000, 250).k).toBe(1);
    expect(limitForTail(64, 100, 4)).toBe(12);
    expect(limitForTail(64, 3, 4)).toBe(1);
    expect(limitForTail(5, 1000, 4)).toBe(5);
  });
});

describe('two-tab lock (harness doc §6.4)', () => {
  function fakeLocks(): LockManagerLike & { held: Set<string> } {
    const held = new Set<string>();
    return {
      held,
      async request(name, _o, cb) {
        if (held.has(name)) return cb(null);
        held.add(name);
        try {
          return await cb({ name });
        } finally {
          held.delete(name);
        }
      },
    };
  }

  it('acquire is exclusive until released; busy and unsupported are reported', async () => {
    const locks = fakeLocks();
    const a = await acquireRunLock('r1', locks);
    expect(a.status).toBe('held');
    expect((await acquireRunLock('r1', locks)).status).toBe('busy');
    expect((await acquireRunLock('r2', locks)).status).toBe('held');
    if (a.status === 'held') a.release();
    await Promise.resolve();
    expect((await acquireRunLock('r1', locks)).status).toBe('held');
    expect((await acquireRunLock('r1', undefined)).status).toBe('unsupported');
  });

  it('a second tab cannot start a run another tab is executing; the lock frees on finish', async () => {
    const locks = fakeLocks();
    const small = coinDefinition({ sessions: 640, maxRounds: 200 });
    const pool1 = coinPool(1);
    const pool2 = coinPool(1);
    const tab1 = coinRun(small, {
      pool: pool1,
      runId: 'shared',
      batchChunks: 1,
      controller: { locks },
    });
    const tab2 = coinRun(small, { pool: pool2, runId: 'shared', controller: { locks } });
    const done = tab1.controller.settled();
    await tab1.controller.start();
    expect(locks.held.has('spinner:run:shared')).toBe(true);
    await expect(tab2.controller.start()).rejects.toMatchObject({ code: 'locked-elsewhere' });
    expect(tab2.controller.status).toBe('queued');
    await done;
    await Promise.resolve();
    expect(locks.held.size).toBe(0);
    pool1.terminate();
    pool2.terminate();
  });
});

describe('pool', () => {
  it('terminates idle workers after 60 s and respawns them on demand', async () => {
    vi.useFakeTimers();
    let spawned = 0;
    let terminated = 0;
    const pool = createPool({
      size: 3,
      spawn: () => {
        spawned++;
        const t = createInThreadTransport(coin, { compile: compileTestStrategy });
        return { ...t, terminate: () => (terminated++, t.terminate()) };
      },
    });
    const lease = await pool.lease();
    expect(spawned).toBe(3);
    lease.release();
    vi.advanceTimersByTime(59_000);
    expect(terminated).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect(terminated).toBe(3);
    const again = await pool.lease();
    expect(spawned).toBe(6);
    again.terminateAll();
    again.release();
    pool.terminate();
  });

  it('hands the pool to the waiting lease in order and keeps aux separate', async () => {
    const pool = coinPool(2);
    const first = await pool.lease();
    const order: number[] = [];
    const p2 = pool.lease().then((l) => (order.push(2), l));
    const p3 = pool.lease().then((l) => (order.push(3), l));
    await Promise.resolve();
    expect(order).toEqual([]);
    expect(pool.aux()).not.toBe(first.workers[0]);
    first.release();
    const second = await p2;
    expect(order).toEqual([2]);
    second.release();
    (await p3).release();
    expect(order).toEqual([2, 3]);
    pool.terminate();
  });
});

describe('RunAccumulator (analysis domain of an incomplete run, harness doc §6.5)', () => {
  it('analyses only the longest completed prefix, whatever order chunks arrive in', async () => {
    const data = (await base()).data;
    const acc = new RunAccumulator(
      2000,
      64,
      data.meta.columns,
      data.meta.labels,
      data.meta.schedule,
    );
    const part = (c: number) => {
      const lo = c * 64;
      const n = Math.min(64, 2000 - lo);
      const K = data.meta.schedule.length;
      return {
        firstChunk: c,
        chunkCount: 1,
        firstSession: lo,
        count: n,
        columns: data.meta.columns.map((spec) => {
          const col = (data.summary as unknown as Record<string, Int32Array>)[spec.name]!;
          return col.slice(lo * spec.width, (lo + n) * spec.width).buffer;
        }),
        checkpoints: data.checkpoints.equity.slice(lo * K, (lo + n) * K).buffer,
        chunks: [],
        samples: [],
      };
    };
    acc.mergePart(part(2));
    expect(acc.prefixSessions()).toBe(0);
    acc.mergePart(part(0));
    expect(acc.prefixSessions()).toBe(64);
    expect(acc.completedSessions()).toBe(128);
    acc.mergePart(part(1));
    expect(acc.prefixSessions()).toBe(192);
    const view = acc.toRunData(data.meta, def);
    expect(view.sessions).toBe(192);
    expect(view.summary.final.length).toBe(192);
    expect(Array.from(view.summary.final)).toEqual(Array.from(data.summary.final.slice(0, 192)));
  });
});
