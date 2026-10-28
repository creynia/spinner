// The run controller (harness-data-analysis.md §5.3-§5.5, §6, §7): dispatches batches to the pool,
// merges results by index, flushes through the `RunSink`, and implements pause / cancel / resume
// from the chunk bitmap. The harness never imports the store (architecture.md §3).
import type { GamePlugin } from '../contracts/game';
import type { NormalizedDefinition } from '../contracts/experiment';
import { SIM_PROTOCOL, type FromSim, type SimTransport } from '../contracts/protocol';
import {
  BATCH_TARGET_MS,
  FLUSH_EVERY_BATCHES,
  FLUSH_EVERY_MS,
  type ColumnSpec,
  type RunController,
  type RunData,
  type RunLabels,
  type RunMeta,
  type RunPart,
  type RunProgress,
  type RunSink,
  type RunStatus,
  type SampleSession,
} from '../contracts/run';
import { CORE_VERSION } from '../contracts/version';
import { RunAccumulator, bitGet, bitSet, bitmapBytes } from './accumulator';
import { limitForTail, updateBatchSize } from './batching';
import { acquireRunLock, defaultLocks, type LockManagerLike, type RunLock } from './lock';
import type { PoolLease, SimPool } from './pool';
import { checkpointSchedule, chunkSizeFor, sampleIndices } from './schedule';

type AnyPlugin = GamePlugin<unknown, unknown, unknown, unknown>;

/** Per-run budget of serialized sample traces (harness-data-analysis.md §5.6). */
export const RUN_TRACE_MAX_BYTES = 8 * 1024 * 1024;
const MAX_IN_FLIGHT = 2;
const MAX_VISIBILITY = 50;

export class RunControllerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RunControllerError';
  }
}

export interface RunControllerOptions {
  definition: NormalizedDefinition;
  plugin: AnyPlugin;
  pool: SimPool;
  sink: RunSink;
  runId?: string;
  /** From core/experiment (sha256 ids). Fallbacks keep the controller usable without them. */
  keys?: { definitionId: string; simKey: string; runKey: string };
  appVersion?: string;
  /** `resultsDigest` lives in core/store; the app injects it. Set into `meta` before `compact`. */
  digest?: (data: RunData) => Promise<string>;
  env?: { cores?: number; ua?: string };
  /** Web Locks; `undefined` = `navigator.locks` when present; `null` = never lock. */
  locks?: LockManagerLike | null;
  /** Fixed chunks per batch (tests); otherwise adaptive to ~250 ms. */
  forceBatchChunks?: number;
  batchTargetMs?: number;
  flushEveryBatches?: number;
  flushEveryMs?: number;
  /** Monotonic ms clock (default `performance.now`). */
  now?: () => number;
  /** ISO timestamp source (default `new Date().toISOString()`). */
  iso?: () => string;
  warn?: (message: string) => void;
}

/** A `RunController` plus the hooks the app wires to page lifecycle events. */
export interface HarnessRunController extends RunController {
  readonly status: RunStatus;
  /** Resolves with the next status in which the run is not executing (paused, done, ...). */
  settled(): Promise<RunStatus>;
  /** Commit everything merged so far (call on `visibilitychange -> hidden`, `pagehide`, `freeze`). */
  flush(): Promise<void>;
  /** Append to `meta.visibility` (capped at 50). */
  noteVisibility(state: 'visible' | 'hidden'): void;
  readonly meta: RunMeta | null;
  readonly error: { code: string; message: string } | null;
}

interface WorkerState {
  index: number;
  transport: SimTransport;
  off: () => void;
  ready: boolean;
  rate: number | undefined;
  k: number;
  inflight: Map<number, InFlight>;
}
interface InFlight {
  batchId: number;
  firstChunk: number;
  chunkCount: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const clock = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

function randomSuffix(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * 32)];
  return s;
}

function sessionsInBitmap(bitmap: Uint8Array, chunks: number, chunkSize: number, sessions: number) {
  let completed = 0;
  let prefix = 0;
  let inPrefix = true;
  for (let c = 0; c < chunks; c++) {
    if (bitGet(bitmap, c)) {
      completed += Math.min(chunkSize, sessions - c * chunkSize);
      if (inPrefix) prefix = c + 1;
    } else inPrefix = false;
  }
  return { completed, prefix: Math.min(sessions, prefix * chunkSize) };
}

export function createRunController(opts: RunControllerOptions): HarnessRunController {
  const { definition, plugin, pool, sink } = opts;
  const now = opts.now ?? clock;
  const iso = opts.iso ?? ((): string => new Date().toISOString());
  const warn = opts.warn ?? ((m: string): void => void console.warn(m));
  const target = opts.batchTargetMs ?? BATCH_TARGET_MS;
  const flushEveryBatches = opts.flushEveryBatches ?? FLUSH_EVERY_BATCHES;
  const flushEveryMs = opts.flushEveryMs ?? FLUSH_EVERY_MS;
  const locks = opts.locks === null ? undefined : (opts.locks ?? defaultLocks());

  const sessions = definition.run.sessions;
  const maxRounds = definition.session.maxRounds;
  const chunkSize = chunkSizeFor(maxRounds);
  const chunks = Math.ceil(sessions / chunkSize);
  const schedule = checkpointSchedule(maxRounds, sessions, definition.run.checkpointSchedule);
  const sampleIdx = sampleIndices(sessions, definition.run.sampleSessions);

  const keys = opts.keys ?? { definitionId: '', simKey: '', runKey: '' };
  const runId =
    opts.runId ?? `${keys.definitionId ? keys.definitionId.slice(0, 16) : 'run'}-${randomSuffix()}`;
  const runKey = keys.runKey || `${runId}:${CORE_VERSION}:${plugin.version}`;

  let status: RunStatus = 'queued';
  let meta: RunMeta | null = null;
  let acc: RunAccumulator | null = null;
  let labels: RunLabels | null = null;
  let specs: ColumnSpec[] | null = null;
  let lastError: { code: string; message: string } | null = null;

  // Execution state.
  let lease: PoolLease | null = null;
  let lock: RunLock | null = null;
  let workers: WorkerState[] = [];
  let chunkState = new Uint8Array(chunks); // 0 missing, 1 in flight, 2 merged
  const attempts = new Uint8Array(chunks);
  let cursor = 0;
  let nextBatchId = 1;
  let wantPause = false;
  let epoch = 0; // bumped on every execution so stale callbacks are ignored
  let resumeLoad: RunData | null = null;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((e: unknown) => void) | null = null;
  let readyCount = 0;
  let pauseWaiters: (() => void)[] = [];
  let settleWaiters: ((s: RunStatus) => void)[] = [];
  let segmentStart = 0;
  let sampleBytes = 0;
  let finishing = false;

  // Flush pipeline.
  let pending: RunPart[] = [];
  let durable = new Uint8Array(bitmapBytes(chunks));
  let flushChain: Promise<void> = Promise.resolve();
  let storageOk = true;
  let batchesSinceFlush = 0;
  let lastFlushAt = 0;

  // Progress.
  const listeners = new Set<(p: RunProgress) => void>();
  let sps = 0;
  let winStart = 0;
  let winSessions = 0;
  let runStartAt = 0;
  let runStartSessions = 0;

  // ------------------------------------------------------------------ meta and progress

  function snapshotMeta(): RunMeta {
    const m = meta!;
    const { completed, prefix } = sessionsInBitmap(durable, chunks, chunkSize, sessions);
    return {
      ...m,
      bitmap: durable.slice(),
      completedSessions: completed,
      prefixSessions: prefix,
      resumes: m.resumes.slice(),
      visibility: m.visibility.slice(),
      timing: { ...m.timing },
      device: { ...m.device },
    };
  }

  function progress(): RunProgress {
    const done = acc ? acc.completedSessions() : 0;
    const remaining = sessions - done;
    let rate = sps;
    if (rate === 0 && done > runStartSessions) {
      const dt = now() - runStartAt;
      if (dt > 0) rate = ((done - runStartSessions) / dt) * 1000;
    }
    return {
      runId,
      status,
      completedSessions: done,
      prefixSessions: acc ? acc.prefixSessions() : 0,
      sessions,
      sessionsPerSec: rate,
      etaMs: status === 'running' && rate > 0 ? (remaining / rate) * 1000 : null,
      workers: workers.length,
    };
  }

  function notify(): void {
    if (listeners.size === 0) return;
    const p = progress();
    for (const fn of [...listeners]) fn(p);
  }

  function setStatus(s: RunStatus): void {
    status = s;
    if (meta) meta.status = s;
  }

  // ------------------------------------------------------------------ flushing

  async function doFlush(): Promise<void> {
    const parts = pending;
    pending = [];
    if (!storageOk || !meta) return;
    try {
      if (parts.length === 0) {
        await sink.flush(emptyPart(), snapshotMeta());
        return;
      }
      parts.sort((a, b) => a.firstChunk - b.firstChunk);
      for (const p of parts) {
        for (let c = 0; c < p.chunkCount; c++) bitSet(durable, p.firstChunk + c);
        await sink.flush(p, snapshotMeta());
      }
    } catch (e) {
      // QuotaExceeded or any sink failure: keep going in memory; what committed stays consistent.
      storageOk = false;
      meta.storage = 'memory';
      warn(`run ${runId}: storage failed, continuing in memory: ${String(e)}`);
    }
  }

  function emptyPart(): RunPart {
    return {
      runId,
      firstChunk: 0,
      chunkCount: 0,
      firstSession: 0,
      count: 0,
      columns: [],
      checkpoints: new ArrayBuffer(0),
      chunks: [],
      samples: [],
    };
  }

  function requestFlush(): Promise<void> {
    batchesSinceFlush = 0;
    lastFlushAt = now();
    flushChain = flushChain.then(doFlush);
    return flushChain;
  }

  // ------------------------------------------------------------------ workers

  function attach(w: WorkerState, myEpoch: number): void {
    w.off = w.transport.onMessage((msg) => {
      if (myEpoch !== epoch) return;
      onMessage(w, msg);
    });
  }

  function initWorker(w: WorkerState): void {
    w.ready = false;
    w.transport.post({ t: 'ping' });
    w.transport.post({
      t: 'init',
      runKey,
      definition,
      schedule,
      chunkSize,
      sessions,
    });
  }

  function onMessage(w: WorkerState, msg: FromSim): void {
    switch (msg.t) {
      case 'pong':
        if (
          msg.protocol !== SIM_PROTOCOL ||
          msg.coreVersion !== CORE_VERSION ||
          msg.game.id !== plugin.id ||
          msg.game.version !== plugin.version
        ) {
          fail('stale-app', 'App updated, reload');
        }
        return;
      case 'ready':
        if (msg.runKey !== runKey) return;
        if (!labels) {
          labels = msg.labels;
          specs = msg.columns;
        }
        w.ready = true;
        readyCount++;
        if (readyResolve) {
          if (readyCount === workers.length) {
            const r = readyResolve;
            readyResolve = null;
            readyReject = null;
            r();
          }
        } else pump(); // a restarted worker is back
        return;
      case 'init-error': {
        const first = msg.errors[0];
        fail('init-error', first ? `${first.code}: ${first.message}` : 'worker init failed');
        return;
      }
      case 'batch-done':
        onBatchDone(w, msg);
        return;
      case 'error':
        if (msg.batchId !== undefined) {
          const b = w.inflight.get(msg.batchId);
          if (b) crashed(w, `${msg.code}: ${msg.message}`);
        } else if (msg.runKey === undefined || msg.runKey === runKey) {
          crashed(w, `${msg.code}: ${msg.message}`);
        }
        return;
      default:
        return;
    }
  }

  function clearInflight(w: WorkerState): void {
    for (const b of w.inflight.values()) {
      if (b.timer !== null) clearTimeout(b.timer);
      for (let c = 0; c < b.chunkCount; c++) {
        if (chunkState[b.firstChunk + c] === 1) chunkState[b.firstChunk + c] = 0;
      }
      cursor = Math.min(cursor, b.firstChunk);
    }
    w.inflight.clear();
  }

  /** A worker failed: restart it and re-dispatch its batches once; a second failure ends the run. */
  function crashed(w: WorkerState, why: string): void {
    if (status !== 'running' || !lease) return;
    for (const b of w.inflight.values()) {
      for (let c = 0; c < b.chunkCount; c++) {
        if ((attempts[b.firstChunk + c] ?? 0) >= 2) {
          fail('worker-crash', `batch failed twice: ${why}`);
          return;
        }
      }
    }
    w.off();
    clearInflight(w);
    w.transport = lease.replace(w.index);
    w.k = 1;
    w.rate = undefined;
    readyCount = Math.max(0, readyCount - 1);
    attach(w, epoch);
    initWorker(w);
  }

  function sampleTraceBytes(s: SampleSession): number {
    return s.trace.length === 0 ? 0 : JSON.stringify(s.trace).length;
  }

  function budgetSamples(samples: SampleSession[]): SampleSession[] {
    return samples.map((s) => {
      const bytes = sampleTraceBytes(s);
      if (sampleBytes + bytes > RUN_TRACE_MAX_BYTES) return { ...s, trace: [], truncated: true };
      sampleBytes += bytes;
      return s;
    });
  }

  function onBatchDone(w: WorkerState, msg: Extract<FromSim, { t: 'batch-done' }>): void {
    const b = w.inflight.get(msg.batchId);
    if (!b || !acc || msg.runKey !== runKey) return;
    if (b.timer !== null) clearTimeout(b.timer);
    w.inflight.delete(msg.batchId);
    const samples = sampleIdx.length > 0 ? budgetSamples(msg.samples) : msg.samples;
    const part: RunPart = {
      runId,
      firstChunk: msg.firstChunk,
      chunkCount: msg.chunkCount,
      firstSession: msg.firstSession,
      count: msg.count,
      columns: msg.columns,
      checkpoints: msg.checkpoints,
      chunks: msg.chunks,
      samples,
    };
    acc.mergePart(part);
    for (let c = 0; c < msg.chunkCount; c++) chunkState[msg.firstChunk + c] = 2;
    pending.push(part);
    batchesSinceFlush++;

    const next = updateBatchSize(w.rate, msg.chunkCount, msg.elapsedMs, target);
    w.rate = next.rate;
    w.k = next.k;

    const t = now();
    winSessions += msg.count;
    if (t - winStart >= 1000) {
      const inst = winSessions / ((t - winStart) / 1000);
      sps = sps === 0 ? inst : 0.3 * inst + 0.7 * sps;
      winStart = t;
      winSessions = 0;
    }
    if (batchesSinceFlush >= flushEveryBatches || t - lastFlushAt >= flushEveryMs) {
      void requestFlush();
    }
    notify();
    pump();
  }

  // ------------------------------------------------------------------ dispatch

  function missingChunks(): number {
    let n = 0;
    for (let c = 0; c < chunks; c++) if (chunkState[c] === 0) n++;
    return n;
  }

  function pump(): void {
    if (status !== 'running' || !lease) return;
    if (!wantPause) {
      for (const w of workers) {
        if (!w.ready) continue;
        while (w.inflight.size < MAX_IN_FLIGHT) {
          if (!dispatch(w)) break;
        }
      }
    }
    let busy = false;
    for (const w of workers) if (w.inflight.size > 0 || !w.ready) busy = true;
    if (busy) return;
    if (wantPause) void settlePaused();
    else if (missingChunks() === 0) void finish();
  }

  function dispatch(w: WorkerState): boolean {
    while (cursor < chunks && chunkState[cursor] !== 0) cursor++;
    if (cursor >= chunks) return false;
    const remaining = missingChunks();
    const k = opts.forceBatchChunks ?? limitForTail(w.k, remaining, workers.length);
    const first = cursor;
    let n = 0;
    while (n < k && first + n < chunks && chunkState[first + n] === 0) n++;
    const batchId = nextBatchId++;
    for (let c = 0; c < n; c++) {
      chunkState[first + c] = 1;
      attempts[first + c] = (attempts[first + c] ?? 0) + 1;
    }
    const lo = first * chunkSize;
    const hi = Math.min(sessions, (first + n) * chunkSize);
    const traceIndices = sampleIdx.filter((i) => i >= lo && i < hi);
    const expectedMs = w.rate ? n / w.rate : 10_000;
    const entry: InFlight = { batchId, firstChunk: first, chunkCount: n, timer: null };
    entry.timer = setTimeout(
      () => {
        if (w.inflight.has(batchId)) crashed(w, 'no batch-done within the allowed time');
      },
      Math.max(10_000, 40 * expectedMs),
    );
    w.inflight.set(batchId, entry);
    w.transport.post({
      t: 'batch',
      runKey,
      batchId,
      firstChunk: first,
      chunkCount: n,
      traceIndices,
    });
    return true;
  }

  // ------------------------------------------------------------------ lifecycle

  function releaseResources(terminate: boolean): void {
    epoch++;
    for (const w of workers) {
      w.off();
      for (const b of w.inflight.values()) if (b.timer !== null) clearTimeout(b.timer);
      w.inflight.clear();
    }
    if (terminate) lease?.terminateAll();
    lease?.release();
    lease = null;
    workers = [];
    if (lock?.status === 'held') lock.release();
    lock = null;
  }

  function endSegment(): void {
    if (meta) meta.timing.elapsedMs += Math.max(0, now() - segmentStart);
  }

  function settle(): void {
    const waiters = settleWaiters;
    settleWaiters = [];
    for (const fn of waiters) fn(status);
    const pw = pauseWaiters;
    pauseWaiters = [];
    for (const fn of pw) fn();
    notify();
  }

  async function settlePaused(): Promise<void> {
    if (status !== 'running') return;
    endSegment();
    setStatus('paused');
    releaseResources(false);
    wantPause = false;
    await requestFlush();
    settle();
  }

  function fail(code: string, message: string): void {
    if (status === 'done' || status === 'cancelled' || status === 'error') return;
    lastError = { code, message };
    const rej = readyReject;
    readyResolve = null;
    readyReject = null;
    endSegment();
    setStatus('error');
    if (meta) meta.error = lastError;
    releaseResources(true);
    wantPause = false;
    void requestFlush().then(() => settle());
    rej?.(new RunControllerError(code, message));
  }

  async function finish(): Promise<void> {
    if (status !== 'running' || !acc || !meta || finishing) return;
    finishing = true;
    const m = meta;
    endSegment();
    // Everything is merged: make the bitmap complete and commit the remaining parts.
    await requestFlush();
    if (status !== 'running') {
      finishing = false;
      return;
    }
    m.timing.finishedAt = iso();
    setStatus('done');
    durable.fill(0);
    for (let c = 0; c < chunks; c++) bitSet(durable, c);
    releaseResources(false);
    const final = snapshotMeta();
    const data = acc.toRunData(final, definition);
    try {
      if (opts.digest) final.resultsDigest = await opts.digest(data);
      if (storageOk) await sink.compact(data, final);
    } catch (e) {
      storageOk = false;
      m.storage = 'memory';
      warn(`run ${runId}: compaction failed, results stay in memory: ${String(e)}`);
    }
    if (final.resultsDigest) m.resultsDigest = final.resultsDigest;
    settle();
  }

  function buildMeta(): RunMeta {
    return {
      v: 1,
      runId,
      definitionId: keys.definitionId,
      simKey: keys.simKey,
      runKey,
      gameId: plugin.id,
      gameVersion: plugin.version,
      coreVersion: CORE_VERSION,
      appVersion: opts.appVersion ?? '0',
      createdAt: iso(),
      status: 'queued',
      sessions,
      completedSessions: 0,
      prefixSessions: 0,
      chunkSize,
      chunks,
      bitmap: new Uint8Array(bitmapBytes(chunks)),
      schedule,
      labels: { stages: [], categories: [], reasons: [] },
      columns: [],
      storage: 'idb',
      device: {
        cores:
          opts.env?.cores ??
          (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator
            ?.hardwareConcurrency ??
          1,
        workers: pool.size,
        ua: opts.env?.ua ?? '',
      },
      timing: { elapsedMs: 0 },
      resumes: [],
      visibility: [],
    };
  }

  /** Lease, lock, init the workers, then dispatch. Resolves when the workers are initialised. */
  async function execute(mode: 'fresh' | 'resume'): Promise<void> {
    const myEpoch = ++epoch;
    wantPause = false;
    finishing = false;
    lastError = null;
    // The lock first: a run executing in another tab must not be touched.
    const got = await acquireRunLock(runId, locks);
    if (got.status === 'busy') {
      throw new RunControllerError('locked-elsewhere', 'running in another tab');
    }
    if (got.status === 'unsupported')
      warn('Web Locks unavailable: two tabs could run the same run');
    lock = got;
    const l = await pool.lease();
    if (myEpoch !== epoch) {
      l.release();
      if (lock?.status === 'held') lock.release();
      lock = null;
      throw new RunControllerError('superseded', 'run was cancelled while queued');
    }
    lease = l;

    setStatus('running');
    segmentStart = now();
    runStartAt = segmentStart;
    winStart = segmentStart;
    winSessions = 0;
    sps = 0;
    meta!.timing.startedAt ??= iso();
    if (mode === 'resume') {
      meta!.resumes.push({
        at: iso(),
        completedSessions: acc
          ? acc.completedSessions()
          : sessionsInBitmap(durable, chunks, chunkSize, sessions).completed,
      });
    }

    chunkState = new Uint8Array(chunks);
    if (acc) for (let c = 0; c < chunks; c++) if (acc.done[c] === 1) chunkState[c] = 2;
    attempts.fill(0);
    cursor = 0;
    readyCount = 0;

    workers = l.workers.map((transport, index) => ({
      index,
      transport,
      off: () => undefined,
      ready: false,
      rate: undefined,
      k: 1,
      inflight: new Map<number, InFlight>(),
    }));
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    for (const w of workers) {
      attach(w, myEpoch);
      initWorker(w);
    }
    notify();
    await ready;
    if (myEpoch !== epoch) return;
    if (!acc) {
      acc = new RunAccumulator(sessions, chunkSize, specs!, labels!, schedule);
      meta!.labels = labels!;
      meta!.columns = specs!;
      if (resumeLoad) {
        acc.loadFrom(resumeLoad);
        resumeLoad = null;
        for (let c = 0; c < chunks; c++) if (acc.done[c] === 1) chunkState[c] = 2;
      }
      sampleBytes = acc.sampleList().reduce((n, s) => n + sampleTraceBytes(s), 0);
    }
    runStartSessions = acc.completedSessions();
    // Persist "running" (and, for a fresh run, the run's existence) before any batch lands.
    void requestFlush();
    pump();
  }

  // ------------------------------------------------------------------ public API

  const controller: HarnessRunController = {
    runId,
    get status() {
      return status;
    },
    get meta() {
      return meta ? snapshotMeta() : null;
    },
    get error() {
      return lastError;
    },

    async start(): Promise<void> {
      if (status === 'paused' || status === 'cancelled' || status === 'error') {
        return controller.resume();
      }
      if (status !== 'queued' || meta)
        throw new RunControllerError('bad-state', `cannot start a ${status} run`);
      meta = buildMeta();
      await execute('fresh').catch((e) => {
        if (status === 'queued') meta = null;
        throw e;
      });
    },

    async pause(): Promise<void> {
      if (status !== 'running') return;
      wantPause = true;
      const paused = new Promise<void>((resolve) => pauseWaiters.push(resolve));
      pump();
      await paused;
    },

    async resume(): Promise<void> {
      if (status === 'running' || status === 'done') return;
      if (!meta) {
        const data = await sink.load(runId);
        if (!data) throw new RunControllerError('unknown-run', `no stored run ${runId}`);
        if (data.meta.coreVersion !== CORE_VERSION || data.meta.gameVersion !== plugin.version) {
          throw new RunControllerError(
            'version-mismatch',
            'made with an older version: analyze what was completed, or run again',
          );
        }
        meta = { ...data.meta, bitmap: data.meta.bitmap.slice() };
        durable = data.meta.bitmap.slice();
        resumeLoad = data;
        if (data.meta.status === 'done') {
          setStatus('done');
          return;
        }
      }
      meta.error = undefined;
      meta.interrupted = undefined;
      await execute('resume').catch((e) => {
        throw e;
      });
    },

    async cancel(): Promise<void> {
      if (status === 'done' || status === 'cancelled') return;
      if (status === 'running') {
        endSegment();
        setStatus('cancelled');
        releaseResources(true); // terminate every worker, discard in-flight results
        wantPause = false;
        if (readyReject) {
          const rej = readyReject;
          readyResolve = null;
          readyReject = null;
          rej(new RunControllerError('cancelled', 'run cancelled'));
        }
      } else {
        epoch++; // a run still queued behind another one never starts
        setStatus('cancelled');
      }
      await requestFlush();
      settle();
    },

    subscribe(fn): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    snapshot(): RunData {
      if (!acc || !meta) throw new RunControllerError('not-started', 'run has not started');
      return acc.toRunData(snapshotMetaForData(), definition);
    },

    settled(): Promise<RunStatus> {
      return new Promise((resolve) => settleWaiters.push(resolve));
    },

    flush(): Promise<void> {
      return requestFlush();
    },

    noteVisibility(state): void {
      if (!meta) return;
      meta.visibility.push({ at: iso(), state });
      if (meta.visibility.length > MAX_VISIBILITY) meta.visibility.shift();
    },
  };

  function snapshotMetaForData(): RunMeta {
    const m = snapshotMeta();
    if (acc) {
      m.bitmap = acc.bitmap();
      m.completedSessions = acc.completedSessions();
      m.prefixSessions = acc.prefixSessions();
    }
    m.status = status;
    return m;
  }

  return controller;
}
