// Fixture builder for analysis tests: a RunData assembled from per-session arrays.
import type { NormalizedDefinition } from '../contracts/experiment';
import { ENDED_BY, type RunData, type RunMeta } from '../contracts/run';

export interface FixtureSession {
  net: number;
  expectedLoss?: number;
  variance?: number;
  wagered?: number;
  roundsPlayed?: number;
  roundsWagered?: number;
  endedBy?: number;
  maxDrawdown?: number;
  maxExposure?: number;
  trough?: number;
  rejected?: number;
  stopStage?: number;
  stageRounds?: number[];
  catWagered?: number[];
  catNet?: number[];
  /** Equity at each checkpoint (absolute, including bankroll). */
  equity?: number[];
}

export interface FixtureOpts {
  bankroll?: number;
  maxRounds?: number;
  roundsPerHour?: number;
  seed?: number;
  runId?: string;
  gameVersion?: string;
  coreVersion?: string;
  schedule?: number[];
  stages?: string[];
  categories?: string[];
  reasons?: string[];
  chunkSize?: number;
  status?: RunMeta['status'];
  bitmap?: number[];
  prefixSessions?: number;
  expCum?: number[][];
  stopWin?: number;
}

export function makeRun(rows: FixtureSession[], o: FixtureOpts = {}): RunData {
  const n = rows.length;
  const B = o.bankroll ?? 10000;
  const stages = o.stages ?? ['main'];
  const categories = o.categories ?? ['red'];
  const S = stages.length;
  const C = categories.length;
  const schedule = Int32Array.from(o.schedule ?? [0, o.maxRounds ?? 100]);
  const K = schedule.length;
  const chunkSize = o.chunkSize ?? Math.max(n, 1);
  const chunks = Math.ceil(n / chunkSize);
  const t = {
    sessions: n,
    final: new Int32Array(n),
    net: new Int32Array(n),
    peak: new Int32Array(n),
    trough: new Int32Array(n),
    maxDrawdown: new Int32Array(n),
    roundsPlayed: new Int32Array(n),
    roundsWagered: new Int32Array(n),
    wagered: new Float64Array(n),
    expectedLoss: new Float64Array(n),
    variance: new Float64Array(n),
    endedBy: new Uint8Array(n),
    stopStage: new Uint8Array(n),
    rejected: new Uint16Array(n),
    deferred: new Uint16Array(n),
    adjusted: new Uint16Array(n),
    anomalies: new Uint16Array(n),
    maxExposure: new Int32Array(n),
    stageRounds: new Int32Array(n * S),
    catWagered: new Float64Array(n * C),
    catNet: new Float64Array(n * C),
  };
  const equity = new Int32Array(n * K);
  rows.forEach((r, i) => {
    const rp = r.roundsPlayed ?? o.maxRounds ?? 100;
    t.net[i] = r.net;
    t.final[i] = B + r.net;
    t.peak[i] = Math.max(B, B + r.net);
    t.trough[i] = r.trough ?? Math.min(B, B + r.net);
    t.maxDrawdown[i] = r.maxDrawdown ?? 0;
    t.roundsPlayed[i] = rp;
    t.roundsWagered[i] = r.roundsWagered ?? rp;
    t.wagered[i] = r.wagered ?? rp * 100;
    t.expectedLoss[i] = r.expectedLoss ?? 0;
    t.variance[i] = r.variance ?? 0;
    t.endedBy[i] = r.endedBy ?? ENDED_BY.rounds;
    t.stopStage[i] = r.stopStage ?? 0;
    t.rejected[i] = r.rejected ?? 0;
    t.maxExposure[i] = r.maxExposure ?? 0;
    for (let s = 0; s < S; s++) t.stageRounds[i * S + s] = r.stageRounds?.[s] ?? (s === 0 ? rp : 0);
    for (let c = 0; c < C; c++) {
      t.catWagered[i * C + c] = r.catWagered?.[c] ?? (c === 0 ? t.wagered[i] : 0);
      t.catNet[i * C + c] = r.catNet?.[c] ?? (c === 0 ? r.net : 0);
    }
    for (let k = 0; k < K; k++) equity[i * K + k] = r.equity?.[k] ?? B + r.net;
  });
  const bm = new Uint8Array(Math.ceil(chunks / 8));
  for (let c = 0; c < chunks; c++)
    if (!o.bitmap || o.bitmap.includes(c)) bm[c >> 3]! |= 1 << (c & 7);
  const meta = {
    v: 1,
    runId: o.runId ?? 'run-a',
    gameId: 'roulette',
    gameVersion: o.gameVersion ?? '1',
    coreVersion: o.coreVersion ?? '1',
    status: o.status ?? 'done',
    sessions: n,
    completedSessions: n,
    prefixSessions: o.prefixSessions ?? n,
    chunkSize,
    chunks,
    bitmap: bm,
    schedule,
    labels: { stages, categories, reasons: o.reasons ?? [] },
  } as unknown as RunMeta;
  const definition = {
    session: {
      bankroll: B,
      maxRounds: o.maxRounds ?? 100,
      roundsPerHour: o.roundsPerHour ?? 40,
      stopWin: o.stopWin,
    },
    run: { sessions: n, seed: o.seed ?? 1, checkpointSchedule: 'auto', sampleSessions: 0 },
  } as unknown as NormalizedDefinition;
  const expCum = new Float64Array(chunks * K);
  if (o.expCum) o.expCum.forEach((row, c) => expCum.set(row, c * K));
  return {
    meta,
    definition,
    sessions: n,
    summary: t,
    checkpoints: { schedule, equity },
    chunkStats: {
      chunks,
      expCum,
      catExpected: new Float64Array(chunks * C),
      stageWagered: new Float64Array(chunks * S),
      stageNet: new Float64Array(chunks * S),
      stageExpected: new Float64Array(chunks * S),
      transitions: new Int32Array(chunks * S * S),
      rejectedByReason: Array.from({ length: chunks }, () => ({})),
      deferredByReason: Array.from({ length: chunks }, () => ({})),
      errors: [],
      errorCount: 0,
    },
    samples: [],
  };
}
