// The session loop and batch runner (harness-data-analysis.md §3, §14.3; strategy.md §3, §11.1).
//
// Per round, in order: observe -> `rt.step` -> reconcile -> bust test -> apply -> analytic expected
// loss and variance of the reconciled layout -> `playRound` -> tallies -> stops. The hot path
// reuses the engine RNG, the observation, the step output and every accumulator; nothing is
// allocated per round except what the plugin itself returns. The trace is built only for sample
// and simulated sessions.
import type { GamePlugin, Layout, RoundOutcome } from '../contracts/game';
import type { NormalizedDefinition } from '../contracts/experiment';
import {
  ENDED_BY,
  ENDED_BY_STRATEGY_BASE,
  type ChunkStats,
  type ColumnSpec,
  type RunLabels,
  type SampleSession,
  type SessionError,
  type SummaryRow,
  type SummaryTable,
} from '../contracts/run';
import type {
  Observation,
  SessionFacts,
  StepOutput,
  StrategyMemory,
  StrategyRuntime,
  TraceSink,
} from '../contracts/strategy';
import type { SessionTrace, TraceWindow } from '../contracts/strategy-trace';
import { sessionRng } from '../rng';
import { allocSummary, columnSpecs, summaryBuffers, summaryRow } from './columns';

type AnyPlugin = GamePlugin<unknown, unknown, unknown, unknown>;

const I32_MAX = 2147483647;
const I32_MIN = -2147483648;
const U16_MAX = 65535;

/** Caps of a stored sample trace (harness-data-analysis.md §5.6). */
export const SAMPLE_TRACE_MAX_ROUNDS = 2000;
export const SAMPLE_TRACE_MAX_BYTES = 512 * 1024;

export interface RunnerInit {
  plugin: AnyPlugin;
  rules: unknown;
  definition: NormalizedDefinition;
  runtime: StrategyRuntime;
  schedule: Int32Array;
  chunkSize: number;
  sessions: number;
}

export interface BatchOutput {
  firstSession: number;
  count: number;
  table: SummaryTable;
  columns: ArrayBuffer[];
  checkpoints: Int32Array;
  chunks: ChunkStats[];
  samples: SampleSession[];
  elapsedMs: number;
}

export interface SimulatedSession {
  row: SummaryRow;
  checkpoints: Int32Array;
  trace: SessionTrace;
}

interface BetInfo {
  /** Category index, or -1 when the bet is not in the catalog. */
  cat: number;
  /** Expected loss per cent staked (positive), from `ev.betEdge`. */
  loss: number;
  /** An imprisoned stake: its wager was counted when it was first placed. */
  prison: boolean;
}

const nowMs: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/** Labels fixed at compile time (stages, categories, sorted stop reasons). */
export function buildLabels(
  plugin: AnyPlugin,
  rules: unknown,
  runtime: StrategyRuntime,
): RunLabels {
  const categories: string[] = [];
  for (const entry of plugin.bets.catalog(rules)) {
    if (!categories.includes(entry.category)) categories.push(entry.category);
  }
  return {
    stages: [...runtime.stageIds],
    categories,
    reasons: [...runtime.stopReasons],
  };
}

function newChunkStats(chunk: number, K: number, C: number, S: number): ChunkStats {
  return {
    chunk,
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
}

function chunkBuffers(c: ChunkStats): ArrayBuffer[] {
  return [
    c.expCum.buffer,
    c.catExpected.buffer,
    c.stageWagered.buffer,
    c.stageNet.buffer,
    c.stageExpected.buffer,
    c.transitions.buffer,
  ] as ArrayBuffer[];
}

/** Buffers of a batch result, for the transfer list. */
export function batchTransferList(out: BatchOutput): ArrayBuffer[] {
  const list = [...out.columns, out.checkpoints.buffer as ArrayBuffer];
  for (const c of out.chunks) list.push(...chunkBuffers(c));
  return list;
}

interface Tracer {
  windows: TraceWindow[];
  limit: number;
  truncated: boolean;
  cur: TraceWindow | null;
}

export class BatchRunner {
  readonly specs: ColumnSpec[];
  readonly labels: RunLabels;
  private readonly plugin: AnyPlugin;
  private readonly rules: unknown;
  private readonly runtime: StrategyRuntime;
  private readonly mem: StrategyMemory;
  private readonly schedule: Int32Array;
  private readonly K: number;
  private readonly S: number;
  private readonly C: number;
  private readonly chunkSize: number;
  private readonly sessions: number;
  private readonly runSeed: number;
  private readonly bankroll: number;
  private readonly maxRounds: number;
  private readonly stopWin: number | undefined;
  private readonly stopLoss: number | undefined;
  private readonly reasonIndex = new Map<string, number>();
  private readonly betInfos = new Map<string, BetInfo>();
  private readonly catIndex = new Map<string, number>();
  private readonly engine = sessionRng(0, 0, 'engine');
  // Reused per-window objects.
  private readonly facts: SessionFacts;
  private readonly obs: Observation;
  private readonly out: StepOutput;
  private readonly sink: TraceSink;
  private tracer: Tracer | null = null;

  constructor(init: RunnerInit) {
    const { plugin, rules, definition, runtime } = init;
    this.plugin = plugin;
    this.rules = rules;
    this.runtime = runtime;
    this.schedule = init.schedule;
    this.K = init.schedule.length;
    this.chunkSize = init.chunkSize;
    this.sessions = init.sessions;
    this.runSeed = definition.run.seed;
    this.bankroll = definition.session.bankroll;
    this.maxRounds = definition.session.maxRounds;
    this.stopWin = definition.session.stopWin;
    this.stopLoss = definition.session.stopLoss;
    this.labels = buildLabels(plugin, rules, runtime);
    this.S = this.labels.stages.length;
    this.C = this.labels.categories.length;
    this.specs = columnSpecs(this.S, this.C);
    this.labels.reasons.forEach((r, j) => this.reasonIndex.set(r, j));
    this.labels.categories.forEach((c, j) => this.catIndex.set(c, j));
    for (const entry of plugin.bets.catalog(rules)) {
      this.betInfos.set(entry.id, this.makeInfo(entry.id, entry.category, false));
    }
    this.mem = runtime.createMemory();
    this.facts = {
      start: this.bankroll,
      bankroll: this.bankroll,
      equity: this.bankroll,
      net: 0,
      peak: this.bankroll,
      drawdown: 0,
      wagered: 0,
      roundsWagered: 0,
      lastNet: 0,
      exposure: 0,
    };
    this.obs = { window: 0, session: this.facts, table: [], last: null, state: undefined };
    this.out = { stage: 0, desired: [], acts: [], stop: null, error: null };
    this.sink = {
      window: (rec) => {
        if (this.tracer) this.tracer.cur = rec;
      },
    };
  }

  private makeInfo(id: string, category: string, prison: boolean): BetInfo {
    const cat = this.catIndex.get(category) ?? -1;
    let loss = 0;
    const e = this.plugin.ev.betEdge(id, this.rules);
    if (e) loss = -(Number(e.edge.num) / Number(e.edge.den));
    return { cat, loss, prison };
  }

  private betInfo(id: string): BetInfo {
    let info = this.betInfos.get(id);
    if (info) return info;
    let base = id;
    let prison = false;
    if (base.startsWith('prison:')) {
      prison = true;
      base = base.slice(7);
    }
    const known = this.betInfos.get(base);
    if (known) info = { cat: known.cat, loss: known.loss, prison };
    else {
      // A parameterised id the catalog does not list: fall back to its family prefix.
      const family = base.split(':')[0]!;
      const fam = this.betInfos.get(family);
      info = fam
        ? { cat: fam.cat, loss: fam.loss, prison }
        : { cat: this.catIndex.get(family) ?? -1, loss: 0, prison };
    }
    this.betInfos.set(id, info);
    return info;
  }

  /** Run `chunkCount` consecutive chunks. `traceIndices` are the sample sessions to trace. */
  runBatch(firstChunk: number, chunkCount: number, traceIndices: readonly number[]): BatchOutput {
    const t0 = nowMs();
    const firstSession = firstChunk * this.chunkSize;
    const endSession = Math.min(this.sessions, (firstChunk + chunkCount) * this.chunkSize);
    const count = Math.max(0, endSession - firstSession);
    const table = allocSummary(this.specs, count);
    const checkpoints = new Int32Array(count * this.K);
    const chunks: ChunkStats[] = [];
    const samples: SampleSession[] = [];
    const traceSet = new Set(traceIndices);
    for (let c = 0; c < chunkCount; c++) {
      const chunk = firstChunk + c;
      const lo = chunk * this.chunkSize;
      const hi = Math.min(this.sessions, lo + this.chunkSize);
      const cs = newChunkStats(chunk, this.K, this.C, this.S);
      for (let index = lo; index < hi; index++) {
        const traced = traceSet.has(index);
        if (traced) {
          this.tracer = {
            windows: [],
            limit: SAMPLE_TRACE_MAX_ROUNDS,
            truncated: false,
            cur: null,
          };
        }
        this.runSession(index, index - firstSession, table, checkpoints, cs);
        if (traced) {
          const tr = this.tracer!;
          this.tracer = null;
          samples.push(this.finishSample(index, index - firstSession, table, tr));
        }
      }
      chunks.push(cs);
    }
    return {
      firstSession,
      count,
      table,
      columns: summaryBuffers(table, this.specs),
      checkpoints,
      chunks,
      samples,
      elapsedMs: nowMs() - t0,
    };
  }

  private finishSample(index: number, at: number, table: SummaryTable, tr: Tracer): SampleSession {
    let windows = tr.windows;
    let truncated = tr.truncated;
    if (JSON.stringify(windows).length > SAMPLE_TRACE_MAX_BYTES) {
      // Keep the longest prefix that fits (binary search on the window count).
      let lo = 0;
      let hi = windows.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (JSON.stringify(windows.slice(0, mid)).length <= SAMPLE_TRACE_MAX_BYTES) lo = mid;
        else hi = mid - 1;
      }
      windows = windows.slice(0, lo);
      truncated = true;
    }
    return { index, row: summaryRow(table, at, index, this.labels), trace: windows, truncated };
  }

  /** Re-simulate one session with its full trace (Watch). */
  simulate(index: number): SimulatedSession {
    const table = allocSummary(this.specs, 1);
    const checkpoints = new Int32Array(this.K);
    const cs = newChunkStats(0, this.K, this.C, this.S);
    this.tracer = { windows: [], limit: Infinity, truncated: false, cur: null };
    try {
      this.runSession(index, 0, table, checkpoints, cs);
      const trace = this.tracer.windows;
      return { row: summaryRow(table, 0, index, this.labels), checkpoints, trace };
    } finally {
      this.tracer = null;
    }
  }

  private runSession(
    index: number,
    o: number,
    table: SummaryTable,
    ckpt: Int32Array,
    cs: ChunkStats,
  ): void {
    const plugin = this.plugin;
    const runtime = this.runtime;
    const mem = this.mem;
    const obs = this.obs;
    const facts = this.facts;
    const out = this.out;
    const sched = this.schedule;
    const K = this.K;
    const S = this.S;
    const C = this.C;
    const bankroll0 = this.bankroll;
    const maxRounds = this.maxRounds;
    const stopWin = this.stopWin;
    const stopLoss = this.stopLoss;
    const tracer = this.tracer;
    const sink = this.sink;
    const stageRounds = table.stageRounds;
    const catWagered = table.catWagered;
    const catNet = table.catNet;
    const ckBase = o * K;

    const rng = sessionRng(this.runSeed, index, 'engine', this.engine);
    runtime.reset(mem);
    let state = plugin.createState({ rules: this.rules, rng, bankroll: bankroll0 });

    let equity = bankroll0;
    let peak = bankroll0;
    let trough = bankroll0;
    let maxDrawdown = 0;
    let wagered = 0;
    let roundsWagered = 0;
    let expectedLoss = 0;
    let variance = 0;
    let rejected = 0;
    let deferred = 0;
    let adjusted = 0;
    let anomalies = 0;
    let maxExposure = 0;
    let stage = 0;
    let rounds = 0;
    let lastNet = 0;
    let ended: number = ENDED_BY.rounds;
    let errorInfo: SessionError | null = null;
    let last: RoundOutcome | null = null;
    let ci = 1;

    // Checkpoint 0 is the bankroll with no expected loss yet.
    ckpt[ckBase] = bankroll0;
    // expCum[0] += 0: nothing to add.

    obs.last = null;
    facts.bankroll = bankroll0;
    facts.equity = bankroll0;
    facts.net = 0;
    facts.peak = bankroll0;
    facts.drawdown = 0;
    facts.wagered = 0;
    facts.roundsWagered = 0;
    facts.lastNet = 0;
    facts.exposure = 0;

    try {
      for (let w = 0; w < maxRounds; w++) {
        const tableNow: Layout = plugin.layoutOf(state);
        let exposure = 0;
        for (let i = 0; i < tableNow.length; i++) exposure += tableNow[i]!.amount;
        obs.window = w;
        obs.table = tableNow;
        obs.last = last;
        obs.state = plugin.visible(state);
        facts.equity = equity;
        facts.bankroll = equity - exposure;
        facts.net = equity - bankroll0;
        facts.peak = peak;
        facts.drawdown = peak - equity;
        facts.wagered = wagered;
        facts.roundsWagered = roundsWagered;
        facts.lastNet = lastNet;
        facts.exposure = exposure;

        out.stop = null;
        out.error = null;
        (out as StepOutput & { anomalies?: number }).anomalies = 0;
        if (tracer) tracer.cur = null;
        runtime.step(mem, obs, out, tracer ? sink : undefined);
        const so = out; // fresh reference: `step` mutated what we narrowed above
        anomalies += (so as StepOutput & { anomalies?: number }).anomalies ?? 0;

        const prevStage = stage;
        stage = so.stage;
        if (stage !== prevStage) cs.transitions[prevStage * S + stage]!++;

        let rec: TraceWindow | null = null;
        if (tracer) {
          rec = tracer.cur ?? synthWindow(w, runtime.stageIds[prevStage] ?? '?');
          rec.equity = equity;
        }

        if (so.stop !== null) {
          const j = this.reasonIndex.get(so.stop);
          if (j === undefined) {
            ended = ENDED_BY.error;
            errorInfo = {
              index,
              code: 'unknown-stop-reason',
              message: `strategy stopped with unlisted reason "${so.stop}"`,
            };
          } else ended = ENDED_BY_STRATEGY_BASE + j;
          if (tracer && rec) this.pushWindow(tracer, rec);
          break;
        }
        if (so.error !== null) {
          ended = ENDED_BY.error;
          errorInfo = { index, code: so.error.code, message: so.error.message };
          if (tracer && rec) this.pushWindow(tracer, rec);
          break;
        }

        const reconciled = plugin.reconcile(state, so.desired, so.acts);
        const rj = reconciled.rejected;
        const dj = reconciled.deferred;
        rejected += rj.length;
        deferred += dj.length;
        adjusted += reconciled.adjusted.length;
        for (let i = 0; i < rj.length; i++) {
          const code = rj[i]!.reason;
          cs.rejectedByReason[code] = (cs.rejectedByReason[code] ?? 0) + 1;
        }
        for (let i = 0; i < dj.length; i++) {
          const code = dj[i]!.reason;
          cs.deferredByReason[code] = (cs.deferredByReason[code] ?? 0) + 1;
        }
        if (tracer && rec) {
          rec.reconcile = {
            actions: reconciled.actions.length,
            deferred: dj.map((d) => ({ bet: d.entry.bet, reason: d.reason })),
            rejected: rj.map((d) => ({ bet: d.entry.bet, reason: d.reason })),
            adjusted: reconciled.adjusted.map((a) => ({
              bet: a.entry.bet,
              to: a.to,
              reason: a.reason,
            })),
          };
        }

        if (!reconciled.affordable && so.desired.length > 0 && tableNow.length === 0) {
          ended = ENDED_BY.bust;
          if (tracer && rec) {
            rec.bust = true;
            this.pushWindow(tracer, rec);
          }
          break;
        }

        const actions = reconciled.actions;
        for (let i = 0; i < actions.length; i++) {
          const r = plugin.apply(state, actions[i]);
          if (!r.ok) {
            throw new HarnessSessionError(
              'apply-rejected',
              `plugin rejected its own reconciled action: ${r.code}: ${r.message}`,
            );
          }
          state = r.state;
        }

        const placed = plugin.layoutOf(state);
        let exp = 0;
        for (let i = 0; i < placed.length; i++) exp += placed[i]!.amount;
        if (exp > maxExposure) maxExposure = exp;

        let el = 0;
        let vr = 0;
        if (placed.length > 0) {
          const view = plugin.visible(state);
          el = plugin.ev.expectedLossPerRound(view);
          vr = plugin.ev.variancePerRound(view);
        }

        const played = plugin.playRound(state);
        state = played.state;
        const outcome = played.outcome;
        last = outcome;
        rounds++;

        expectedLoss += el;
        variance += vr;
        stageRounds[o * S + stage]!++;
        cs.stageExpected[stage]! += el;
        cs.stageWagered[stage]! += outcome.wagered;
        cs.stageNet[stage]! += outcome.net;
        wagered += outcome.wagered;
        if (outcome.wagered > 0) roundsWagered++;
        lastNet = outcome.net;

        const res = outcome.resolutions;
        for (let i = 0; i < res.length; i++) {
          const r = res[i]!;
          if (r.result === 'stays') continue;
          const info = this.betInfo(r.bet);
          if (info.cat < 0) continue;
          catNet[o * C + info.cat]! += r.profit;
          if (!info.prison) {
            catWagered[o * C + info.cat]! += r.amount;
            cs.catExpected[info.cat]! += r.amount * info.loss;
          }
        }

        equity = plugin.equity(state);
        if (equity > I32_MAX || equity < I32_MIN) {
          ended = ENDED_BY.error;
          errorInfo = {
            index,
            code: 'equity-overflow',
            message: `equity ${equity} left the int32 cents range`,
          };
          if (tracer && rec) this.pushWindow(tracer, rec);
          break;
        }
        if (equity > peak) peak = equity;
        if (equity < trough) trough = equity;
        if (peak - equity > maxDrawdown) maxDrawdown = peak - equity;

        if (tracer && rec) {
          rec.outcome = {
            summary: outcome.summary,
            net: outcome.net,
            resolutions: res.map((r) => ({ bet: r.bet, result: r.result, profit: r.profit })),
          };
          rec.equity = equity;
          this.pushWindow(tracer, rec);
        }

        if (ci < K && sched[ci] === rounds) {
          ckpt[ckBase + ci] = equity;
          cs.expCum[ci]! += expectedLoss;
          ci++;
        }

        if (stopWin !== undefined && equity - bankroll0 >= stopWin) {
          ended = ENDED_BY['stop-win'];
          break;
        }
        if (stopLoss !== undefined && bankroll0 - equity >= stopLoss) {
          ended = ENDED_BY['stop-loss'];
          break;
        }
      }
    } catch (e) {
      ended = ENDED_BY.error;
      errorInfo =
        e instanceof HarnessSessionError
          ? { index, code: e.code, message: e.message }
          : {
              index,
              code: 'session-exception',
              message: e instanceof Error ? e.message : String(e),
            };
    }

    // Money in the pocket: the remaining checkpoints carry the final equity and total expected loss.
    for (; ci < K; ci++) {
      ckpt[ckBase + ci] = equity;
      cs.expCum[ci]! += expectedLoss;
    }
    if (errorInfo) cs.errors.push(errorInfo);

    table.final[o] = equity;
    table.net[o] = equity - bankroll0;
    table.peak[o] = peak;
    table.trough[o] = trough;
    table.maxDrawdown[o] = maxDrawdown;
    table.roundsPlayed[o] = rounds;
    table.roundsWagered[o] = roundsWagered;
    table.wagered[o] = wagered;
    table.expectedLoss[o] = expectedLoss;
    table.variance[o] = variance;
    table.endedBy[o] = ended;
    table.stopStage[o] = stage;
    table.rejected[o] = rejected > U16_MAX ? U16_MAX : rejected;
    table.deferred[o] = deferred > U16_MAX ? U16_MAX : deferred;
    table.adjusted[o] = adjusted > U16_MAX ? U16_MAX : adjusted;
    table.anomalies[o] = anomalies > U16_MAX ? U16_MAX : anomalies;
    table.maxExposure[o] = maxExposure;
  }

  private pushWindow(tracer: Tracer, rec: TraceWindow): void {
    if (tracer.windows.length < tracer.limit) tracer.windows.push(rec);
    else tracer.truncated = true;
  }
}

class HarnessSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function synthWindow(w: number, stage: string): TraceWindow {
  return { w, stage, obs: {}, prog: {}, fired: [], effects: [], desired: [], equity: 0 };
}
