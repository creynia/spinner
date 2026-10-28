// Synthetic, roulette-shaped run data for the store tests: a Martingale on red (with a second
// stage that adds a dozen bet) over european single-zero odds, simulated with a small seeded PRNG.
// Realistic enough in entropy and shape to measure bundle sizes; not the real harness.
import type { NormalizedDefinition } from '../../contracts/experiment';
import type {
  ChunkStats,
  RunData,
  RunMeta,
  RunPart,
  SampleSession,
  SummaryRow,
} from '../../contracts/run';
import type { TraceWindow } from '../../contracts/strategy-trace';
import { definitionId, runKey, simKey } from '../../experiment';
import {
  allocate,
  assembleChunkStats,
  summaryColumnSpecs,
  tableFrom,
  type TypedArray,
} from '../columns';

export const GAME_VERSION = '0.1.0';
export const CORE_VER = '0.1.0';

/** The 12 roulette bet categories of game.md §3.1 (reconciliation A2). */
export const ROULETTE_CATEGORIES = [
  'straight',
  'split',
  'street',
  'trio',
  'corner',
  'basket',
  'sixline',
  'even-money',
  'dozen',
  'column',
  'call',
  'neighbours',
];

export interface SynthOptions {
  sessions: number;
  maxRounds: number;
  categories?: string[];
  chunkSize?: number;
  samples?: number;
  /** Trace windows kept per sample (the full session when omitted). */
  traceCap?: number;
  seed?: number;
  checkpoints?: number;
  name?: string;
  /** Stop at this profit (cents); `0` plays to the round cap or a bust. Default 30,000. */
  stopWin?: number;
  /** Pessimistic entropy: every round also bets a random unit amount on a random category. */
  allCategories?: boolean;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Dense head then even spacing, strictly increasing, ending at `maxRounds`. */
export function synthSchedule(maxRounds: number, K: number): Int32Array {
  if (maxRounds + 1 <= K) return Int32Array.from({ length: maxRounds + 1 }, (_, i) => i);
  const dense = Math.min(Math.floor(K / 3), maxRounds);
  const out: number[] = [];
  for (let i = 0; i <= dense; i++) out.push(i);
  const rest = K - out.length;
  for (let j = 1; j <= rest; j++) out.push(dense + Math.round((j * (maxRounds - dense)) / rest));
  return Int32Array.from(out);
}

const BANKROLL = 100_000;
const UNIT = 2500;
const TABLE_MAX = 500_000;

export async function makeRun(opts: SynthOptions): Promise<RunData> {
  const N = opts.sessions;
  const R = opts.maxRounds;
  const categories = opts.categories ?? ROULETTE_CATEGORIES;
  const C = categories.length;
  const evenMoney = Math.max(0, categories.indexOf('even-money'));
  const dozen = Math.max(0, categories.indexOf('dozen'));
  const stages = ['main', 'recover'];
  const S = stages.length;
  const chunkSize = opts.chunkSize ?? 32;
  const schedule = synthSchedule(R, opts.checkpoints ?? 128);
  const K = schedule.length;
  const rand = lcg(opts.seed ?? 1);
  const stopWin = opts.stopWin ?? 30_000;
  const reasons = ['target'];

  const definition: NormalizedDefinition = {
    schema: 1,
    name: opts.name ?? 'Synthetic Martingale',
    game: { id: 'roulette', rules: { preset: 'european', overrides: {} } },
    strategy: {
      schema: 1,
      id: 'synthetic',
      name: 'Synthetic',
      game: 'roulette',
      unit: UNIT,
      stages: [{ id: 'main', layout: [{ bet: 'red', amount: { units: 1 } }] }, { id: 'recover' }],
    },
    session: {
      bankroll: BANKROLL,
      maxRounds: R,
      ...(stopWin > 0 ? { stopWin } : {}),
      roundsPerHour: 40,
    },
    run: {
      sessions: N,
      seed: opts.seed ?? 1,
      checkpointSchedule: 'auto',
      sampleSessions: opts.samples ?? 24,
    },
  };
  const defId = await definitionId(definition);
  const specs = summaryColumnSpecs(S, C);
  const cols: Record<string, TypedArray> = {};
  for (const sp of specs) cols[sp.name] = allocate(sp.dtype, N * sp.width);
  const equity = new Int32Array(N * K);
  const chunks = Math.ceil(N / chunkSize);
  const stats: ChunkStats[] = [];
  const sampleWanted = new Set<number>();
  const nSamples = Math.min(opts.samples ?? 24, N);
  for (let i = 0; i < nSamples; i++) sampleWanted.add(Math.floor((i * N) / Math.max(1, nSamples)));
  const samples: SampleSession[] = [];

  for (let c = 0; c < chunks; c++) {
    const st: ChunkStats = {
      chunk: c,
      expCum: new Float64Array(K),
      catExpected: new Float64Array(C),
      stageWagered: new Float64Array(S),
      stageNet: new Float64Array(S),
      stageExpected: new Float64Array(S),
      transitions: new Int32Array(S * S),
      rejectedByReason: {},
      deferredByReason: {},
      errors: [],
    };
    for (let i = c * chunkSize; i < Math.min(N, (c + 1) * chunkSize); i++) {
      let eq = BANKROLL;
      let peak = eq;
      let trough = eq;
      let dd = 0;
      let wagered = 0;
      let expected = 0;
      let variance = 0;
      let level = 0;
      let played = 0;
      let wageredRounds = 0;
      let maxExp = 0;
      let endedBy = 0;
      let stage = 0;
      let rejected = 0;
      let adjusted = 0;
      const stageRounds = [0, 0];
      const catW = new Array<number>(C).fill(0);
      const catN = new Array<number>(C).fill(0);
      const wantTrace = sampleWanted.has(i);
      const trace: TraceWindow[] = [];
      let ck = 0;
      const cum: number[] = [];
      for (let r = 0; r <= R; r++) {
        while (ck < K && schedule[ck] === r) {
          equity[i * K + ck] = eq;
          cum[ck] = expected;
          st.expCum[ck] = (st.expCum[ck] as number) + expected;
          ck++;
        }
        if (r === R) break;
        if (stopWin > 0 && eq - BANKROLL >= stopWin) {
          endedBy = 2;
          break;
        }
        let stake = Math.min(UNIT * 2 ** level, TABLE_MAX);
        if (stake < UNIT) stake = UNIT;
        if (stake > eq) {
          if (eq >= UNIT) {
            stake = Math.floor(eq / UNIT) * UNIT;
            adjusted++;
          } else {
            endedBy = 1;
            break;
          }
        }
        stage = level >= 3 ? 1 : 0;
        const extra = stage === 1 && stake >= UNIT * 4 ? UNIT : 0;
        let spread = 0;
        let spreadCat = 0;
        let spreadWin = false;
        if (opts.allCategories) {
          spreadCat = Math.floor(rand() * C);
          spread = (1 + Math.floor(rand() * 4)) * 100;
          spreadWin = rand() * 37 < 18;
        }
        const total = stake + extra + spread;
        if (total > eq) rejected++;
        const win = rand() * 37 < 18;
        const dozenWin = rand() * 37 < 12;
        let net = win ? stake : -stake;
        if (extra) net += dozenWin ? 2 * extra : -extra;
        if (spread) net += spreadWin ? spread : -spread;
        const e = total / 37;
        expected += e;
        variance += total * total * 0.9993;
        wagered += total;
        wageredRounds++;
        catW[evenMoney] = (catW[evenMoney] as number) + stake;
        catN[evenMoney] = (catN[evenMoney] as number) + (win ? stake : -stake);
        if (spread) {
          catW[spreadCat] = (catW[spreadCat] as number) + spread;
          catN[spreadCat] = (catN[spreadCat] as number) + (spreadWin ? spread : -spread);
        }
        if (extra) {
          catW[dozen] = (catW[dozen] as number) + extra;
          catN[dozen] = (catN[dozen] as number) + (dozenWin ? 2 * extra : -extra);
        }
        st.stageWagered[stage] = (st.stageWagered[stage] as number) + total;
        st.stageNet[stage] = (st.stageNet[stage] as number) + net;
        st.stageExpected[stage] = (st.stageExpected[stage] as number) + e;
        stageRounds[stage] = (stageRounds[stage] as number) + 1;
        maxExp = Math.max(maxExp, total);
        const before = eq;
        eq += net;
        played++;
        level = win ? 0 : Math.min(level + 1, 7);
        peak = Math.max(peak, eq);
        trough = Math.min(trough, eq);
        dd = Math.max(dd, peak - eq);
        if (wantTrace && (opts.traceCap === undefined || trace.length < opts.traceCap)) {
          trace.push(traceWindow(r, stage, level, stake, win, before, eq));
        }
        if (eq < UNIT) {
          endedBy = 1;
          break;
        }
      }
      while (ck < K) {
        equity[i * K + ck] = eq;
        st.expCum[ck] = (st.expCum[ck] as number) + expected;
        ck++;
      }
      for (let j = 0; j < C; j++)
        st.catExpected[j] = (st.catExpected[j] as number) + (catW[j] as number) / 37;
      st.transitions[1] = (st.transitions[1] as number) + (stageRounds[1] ? 1 : 0);
      const set = (name: string, v: number, w = 0, width = 1): void => {
        (cols[name] as TypedArray)[i * width + w] = v;
      };
      set('final', eq);
      set('net', eq - BANKROLL);
      set('peak', peak);
      set('trough', trough);
      set('maxDrawdown', dd);
      set('roundsPlayed', played);
      set('roundsWagered', wageredRounds);
      set('wagered', wagered);
      set('expectedLoss', expected);
      set('variance', variance);
      set('endedBy', endedBy);
      set('stopStage', stage);
      set('rejected', rejected);
      set('adjusted', adjusted);
      set('maxExposure', maxExp);
      for (let j = 0; j < S; j++) set('stageRounds', stageRounds[j] as number, j, S);
      for (let j = 0; j < C; j++) {
        set('catWagered', catW[j] as number, j, C);
        set('catNet', catN[j] as number, j, C);
      }
      if (wantTrace) {
        const row: SummaryRow = {
          index: i,
          final: eq,
          net: eq - BANKROLL,
          peak,
          trough,
          maxDrawdown: dd,
          roundsPlayed: played,
          roundsWagered: wageredRounds,
          wagered,
          expectedLoss: expected,
          variance,
          endedBy: endedBy === 1 ? 'bust' : endedBy === 2 ? 'stop-win' : 'rounds',
          stopStage: stages[stage] as string,
          rejected,
          deferred: 0,
          adjusted,
          anomalies: 0,
          maxExposure: maxExp,
          stageRounds,
          catWagered: catW,
          catNet: catN,
        };
        samples.push({
          index: i,
          row,
          trace,
          truncated: opts.traceCap !== undefined && played > opts.traceCap,
        });
      }
    }
    stats.push(st);
  }

  const summary = tableFrom(N, specs, (n) => cols[n]);
  const bitmap = new Uint8Array(Math.ceil(chunks / 8)).fill(255);
  const meta: RunMeta = {
    v: 1,
    runId: `${defId.slice(0, 16)}-7k2m9qxd`,
    definitionId: defId,
    simKey: await simKey(definition, GAME_VERSION, CORE_VER),
    runKey: await runKey(defId, GAME_VERSION, CORE_VER),
    gameId: 'roulette',
    gameVersion: GAME_VERSION,
    coreVersion: CORE_VER,
    appVersion: '0.1.0',
    createdAt: '2026-10-28T12:00:00.000Z',
    status: 'done',
    sessions: N,
    completedSessions: N,
    prefixSessions: N,
    chunkSize,
    chunks,
    bitmap,
    schedule,
    labels: { stages, categories, reasons },
    columns: specs,
    storage: 'memory',
    device: { cores: 4, workers: 2, ua: 'test' },
    timing: {
      startedAt: '2026-10-28T12:00:00.000Z',
      finishedAt: '2026-10-28T12:00:09.000Z',
      elapsedMs: 9000,
    },
    resumes: [],
    visibility: [],
  };
  return {
    meta,
    definition,
    sessions: N,
    summary,
    checkpoints: { schedule, equity },
    chunkStats: assembleChunkStats(stats, chunks, K, C, S),
    samples,
  };
}

function traceWindow(
  w: number,
  stage: number,
  level: number,
  stake: number,
  win: boolean,
  before: number,
  after: number,
): TraceWindow {
  const number = Math.floor((w * 7919 + stake) % 37);
  return {
    w,
    stage: stage === 1 ? 'recover' : 'main',
    obs: { lossStreak: level, lastResult: win ? 'win' : 'loss', equity: before },
    prog: {
      mart: {
        fed: win ? 'win' : 'loss',
        state: { level },
        amount: Math.min(UNIT * 2 ** level, TABLE_MAX),
        ...(level >= 7 ? { events: ['cap' as const] } : {}),
      },
    },
    fired: ['double-after-loss'],
    effects: [
      {
        rule: 'double-after-loss',
        op: 'prog',
        detail: { prog: 'mart', do: win ? 'reset' : 'advance' },
      },
    ],
    desired: [{ bet: 'red', amount: stake, source: 'layout' }],
    reconcile: { actions: 1, deferred: [], rejected: [], adjusted: [] },
    outcome: {
      summary: { number, color: number === 0 ? 'green' : number % 2 ? 'red' : 'black' },
      net: after - before,
      resolutions: [{ bet: 'red', result: win ? 'win' : 'loss', profit: after - before }],
    },
    equity: after,
  };
}

/** Cuts finished run data into harness-style parts of `chunksPerPart` chunks each. */
export function splitIntoParts(data: RunData, chunksPerPart: number): RunPart[] {
  const { meta } = data;
  const K = meta.schedule.length;
  const C = meta.labels.categories.length;
  const S = meta.labels.stages.length;
  const cs = data.chunkStats;
  const cols = data.summary as unknown as Record<string, TypedArray>;
  const parts: RunPart[] = [];
  for (let c0 = 0; c0 < cs.chunks; c0 += chunksPerPart) {
    const nChunks = Math.min(chunksPerPart, cs.chunks - c0);
    const first = c0 * meta.chunkSize;
    const count = Math.min(data.sessions - first, nChunks * meta.chunkSize);
    const chunks: ChunkStats[] = [];
    for (let c = c0; c < c0 + nChunks; c++) {
      chunks.push({
        chunk: c,
        expCum: cs.expCum.slice(c * K, (c + 1) * K),
        catExpected: cs.catExpected.slice(c * C, (c + 1) * C),
        stageWagered: cs.stageWagered.slice(c * S, (c + 1) * S),
        stageNet: cs.stageNet.slice(c * S, (c + 1) * S),
        stageExpected: cs.stageExpected.slice(c * S, (c + 1) * S),
        transitions: cs.transitions.slice(c * S * S, (c + 1) * S * S),
        rejectedByReason: cs.rejectedByReason[c] ?? {},
        deferredByReason: cs.deferredByReason[c] ?? {},
        errors: cs.errors.filter((e) => Math.floor(e.index / meta.chunkSize) === c),
      });
    }
    parts.push({
      runId: meta.runId,
      firstChunk: c0,
      chunkCount: nChunks,
      firstSession: first,
      count,
      columns: meta.columns.map((spec) => {
        const a = (cols[spec.name] as TypedArray).slice(
          first * spec.width,
          (first + count) * spec.width,
        );
        return a.buffer;
      }),
      checkpoints: data.checkpoints.equity.slice(first * K, (first + count) * K).buffer,
      chunks,
      samples: data.samples.filter((s) => s.index >= first && s.index < first + count),
    });
  }
  return parts;
}
