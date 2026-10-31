// Headless experiment runner for the strategy research loop (docs/research/plan.md).
//
// Runs one or more experiment specs through the real strategy compiler, the real roulette plugin
// and the real harness on this thread, and reports the numbers the research questions need:
// the distribution of final net, the realized edge against the analytic expectation, how sessions
// ended, and the quantile path of equity over the session (so "the median is above break-even
// until spin N" is a number, not an impression). Launched by `sim.mjs` through Vite's module
// runner so the `@core` / `@game` aliases and extensionless imports resolve like in the app.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GamePlugin, Json } from '@core/contracts/game';
import type { ExperimentDefinition, NormalizedDefinition } from '@core/contracts/experiment';
import { ENDED_BY, ENDED_BY_STRATEGY_BASE } from '@core/contracts/run';
import { normalizeDefinition } from '@core/experiment';
import { buildRunner, checkpointSchedule, chunkSizeFor } from '@core/harness';
import { compileStrategy } from '@core/strategy';
import { meanSd, quantile7, quantileCI, wilson } from '@core/analysis';

const sortedCopy = (xs: ArrayLike<number>): Float64Array => Float64Array.from(xs).sort();
import { roulette } from '@game/roulette';

const plugin = roulette as unknown as GamePlugin<unknown, unknown, unknown, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const PRESETS = resolve(here, '../../src/game/roulette/presets');

export type RulesInput = string | { preset: string; overrides: Record<string, Json> };

/** One experiment of a spec file. `strategy` is a strategy document or `"preset:<id>"`. */
export interface ExperimentSpec {
  id: string;
  strategy: unknown;
  rules?: RulesInput;
  session?: { bankroll?: number; maxRounds?: number; stopWin?: number; stopLoss?: number };
  run?: { sessions?: number; seed?: number };
  /** Spin spacing of the equity path (default: every 10 spins, plus a dense head). */
  pathEvery?: number;
}

export interface SpecFile {
  defaults?: Omit<ExperimentSpec, 'id' | 'strategy'>;
  experiments: ExperimentSpec[];
}

export interface PathPoint {
  round: number;
  mean: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  /** Share of sessions whose equity is above the starting bankroll at this round. */
  ahead: number;
}

export interface Report {
  id: string;
  sessions: number;
  bankroll: number;
  maxRounds: number;
  unit: number;
  elapsedMs: number;
  net: {
    mean: number;
    meanCI: [number, number];
    sd: number;
    median: number;
    medianCI: [number, number];
    q: Record<'p1' | 'p5' | 'p10' | 'p25' | 'p75' | 'p90' | 'p95' | 'p99', number>;
    min: number;
    max: number;
    /** Mean of the worst 5% of sessions. */
    cvar5: number;
  };
  /** P(net > 0) with its Wilson interval. */
  pWin: { p: number; lo: number; hi: number };
  pBust: number;
  endedBy: Record<string, number>;
  rounds: { mean: number; median: number };
  wagered: { mean: number; perRound: number };
  /** Realized mean net per cent wagered, and the analytic value the engine attributes to the bets placed. */
  edge: { realized: number; analytic: number; expectedLossMean: number };
  maxDrawdown: { mean: number; median: number; p90: number };
  path: PathPoint[];
  /** Last round at which the median equity path is above the starting bankroll (null: never). */
  medianAheadUntil: number | null;
  /** Best median net along the path and where it happens. */
  medianPeak: { round: number; net: number };
  /** Last round at which more than half of the sessions are ahead (null: never). */
  aheadHorizon: number | null;
}

export function loadPreset(id: string): unknown {
  return JSON.parse(readFileSync(join(PRESETS, `${id}.json`), 'utf8'));
}

function strategyOf(s: unknown): unknown {
  if (typeof s === 'string') {
    if (!s.startsWith('preset:')) throw new Error(`strategy must be a document or "preset:<id>"`);
    return loadPreset(s.slice(7));
  }
  return s;
}

export function toDefinition(
  spec: ExperimentSpec,
  defaults: SpecFile['defaults'] = {},
): NormalizedDefinition {
  const session = { ...defaults.session, ...spec.session };
  const run = { ...defaults.run, ...spec.run };
  const doc: ExperimentDefinition = {
    schema: 1,
    name: spec.id,
    game: { id: 'roulette', rules: (spec.rules ?? defaults.rules ?? 'european') as never },
    strategy: strategyOf(spec.strategy) as never,
    session: {
      bankroll: session.bankroll ?? 500_000,
      maxRounds: session.maxRounds ?? 500,
      ...(session.stopWin !== undefined ? { stopWin: session.stopWin } : {}),
      ...(session.stopLoss !== undefined ? { stopLoss: session.stopLoss } : {}),
    },
    run: { sessions: run.sessions ?? 2000, seed: run.seed ?? 20261031, sampleSessions: 0 },
  } as ExperimentDefinition;
  const r = normalizeDefinition(doc, { plugin: roulette, resolveStrategyRef: () => undefined });
  if (!r.ok)
    throw new Error(`${spec.id}: ${r.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  return r.definition;
}

function pathRounds(maxRounds: number, every: number): number[] {
  const set = new Set<number>([0, maxRounds]);
  for (let r = 1; r <= Math.min(50, maxRounds); r++) set.add(r);
  for (let r = every; r <= maxRounds; r += every) set.add(r);
  return [...set].sort((a, b) => a - b);
}

function endedLabel(code: number, reasons: readonly string[]): string {
  for (const [k, v] of Object.entries(ENDED_BY)) if (v === code) return k;
  return `strategy:${reasons[code - ENDED_BY_STRATEGY_BASE] ?? code}`;
}

/** Run a definition to completion on this thread and summarise it. */
export function runOne(def: NormalizedDefinition, id: string, every = 10): Report {
  const N = def.run.sessions;
  const maxRounds = def.session.maxRounds;
  const schedule = checkpointSchedule(maxRounds, N, pathRounds(maxRounds, every));
  const K = schedule.length;
  const runner = buildRunner(plugin, def, schedule, chunkSizeFor(maxRounds), N, compileStrategy);
  const chunks = Math.ceil(N / runner.chunkSize);

  const net = new Float64Array(N);
  const wagered = new Float64Array(N);
  const expLoss = new Float64Array(N);
  const rounds = new Float64Array(N);
  const dd = new Float64Array(N);
  const ended = new Map<string, number>();
  const ckpt = new Int32Array(N * K);
  const t0 = performance.now();
  for (let c = 0; c < chunks; c += 8) {
    const n = Math.min(8, chunks - c);
    const out = runner.runBatch(c, n, []);
    const t = out.table;
    for (let i = 0; i < out.count; i++) {
      const g = out.firstSession + i;
      net[g] = t.net[i]!;
      wagered[g] = t.wagered[i]!;
      expLoss[g] = t.expectedLoss[i]!;
      rounds[g] = t.roundsPlayed[i]!;
      dd[g] = t.maxDrawdown[i]!;
      const label = endedLabel(t.endedBy[i]!, runner.labels.reasons);
      ended.set(label, (ended.get(label) ?? 0) + 1);
    }
    ckpt.set(out.checkpoints.subarray(0, out.count * K), out.firstSession * K);
  }
  const elapsedMs = performance.now() - t0;

  const sorted = sortedCopy(net);
  const ms = meanSd(net);
  const z = 1.959963984540054;
  const se = ms.sd / Math.sqrt(N);
  const q = (p: number) => quantile7(sorted, p);
  const mq = (p: number): [number, number] => {
    const ci = quantileCI(sorted, p);
    return [ci.lo, ci.hi];
  };
  const worst = Math.max(1, Math.floor(N * 0.05));
  let cv = 0;
  for (let i = 0; i < worst; i++) cv += sorted[i]!;
  let wins = 0;
  let wSum = 0;
  let eSum = 0;
  let rSum = 0;
  for (let i = 0; i < N; i++) {
    if (net[i]! > 0) wins++;
    wSum += wagered[i]!;
    eSum += expLoss[i]!;
    rSum += rounds[i]!;
  }
  const w = wilson(wins, N);
  const bankroll = def.session.bankroll;

  const path: PathPoint[] = [];
  const col = new Float64Array(N);
  let medianAheadUntil: number | null = null;
  let aheadHorizon: number | null = null;
  const medianPeak = { round: 0, net: 0 };
  for (let k = 0; k < K; k++) {
    let sum = 0;
    let ahead = 0;
    for (let i = 0; i < N; i++) {
      const v = ckpt[i * K + k]! - bankroll;
      col[i] = v;
      sum += v;
      if (v > 0) ahead++;
    }
    const s = sortedCopy(col);
    const pt: PathPoint = {
      round: schedule[k]!,
      mean: sum / N,
      p10: quantile7(s, 0.1),
      p25: quantile7(s, 0.25),
      p50: quantile7(s, 0.5),
      p75: quantile7(s, 0.75),
      p90: quantile7(s, 0.9),
      ahead: ahead / N,
    };
    path.push(pt);
    if (pt.p50 > 0) medianAheadUntil = pt.round;
    if (pt.ahead > 0.5) aheadHorizon = pt.round;
    if (pt.p50 > medianPeak.net) {
      medianPeak.net = pt.p50;
      medianPeak.round = pt.round;
    }
  }
  const ddSorted = sortedCopy(dd);
  const rSorted = sortedCopy(rounds);
  return {
    id,
    sessions: N,
    bankroll,
    maxRounds,
    unit: def.strategy.unit,
    elapsedMs: Math.round(elapsedMs),
    net: {
      mean: ms.mean,
      meanCI: [ms.mean - z * se, ms.mean + z * se],
      sd: ms.sd,
      median: q(0.5),
      medianCI: mq(0.5),
      q: {
        p1: q(0.01),
        p5: q(0.05),
        p10: q(0.1),
        p25: q(0.25),
        p75: q(0.75),
        p90: q(0.9),
        p95: q(0.95),
        p99: q(0.99),
      },
      min: sorted[0]!,
      max: sorted[N - 1]!,
      cvar5: cv / worst,
    },
    pWin: { p: wins / N, lo: w.lo, hi: w.hi },
    pBust: (ended.get('bust') ?? 0) / N,
    endedBy: Object.fromEntries([...ended.entries()].sort((a, b) => b[1] - a[1])),
    rounds: { mean: rSum / N, median: quantile7(rSorted, 0.5) },
    wagered: { mean: wSum / N, perRound: rSum ? wSum / rSum : 0 },
    edge: {
      realized: wSum ? ms.mean / (wSum / N) : 0,
      analytic: wSum ? -eSum / wSum : 0,
      expectedLossMean: eSum / N,
    },
    maxDrawdown: {
      mean: meanSd(dd).mean,
      median: quantile7(ddSorted, 0.5),
      p90: quantile7(ddSorted, 0.9),
    },
    path,
    medianAheadUntil,
    medianPeak,
    aheadHorizon,
  };
}

const $ = (c: number): string => {
  const d = c / 100;
  const s = Math.abs(d) >= 1000 ? d.toFixed(0) : d.toFixed(2);
  return (d < 0 ? '-$' : '$') + s.replace('-', '');
};
const pct = (p: number): string => `${(100 * p).toFixed(1)}%`;

/** One line per experiment, for a terminal. */
export function formatLine(r: Report): string {
  return [
    r.id.padEnd(28),
    `mean ${$(r.net.mean)}`.padEnd(16),
    `median ${$(r.net.median)}`.padEnd(18),
    `p10 ${$(r.net.q.p10)}`.padEnd(16),
    `win ${pct(r.pWin.p)}`.padEnd(11),
    `bust ${pct(r.pBust)}`.padEnd(11),
    `edge ${(100 * r.edge.realized).toFixed(2)}% (${(100 * r.edge.analytic).toFixed(2)}%)`.padEnd(
      24,
    ),
    `wager/spin ${$(r.wagered.perRound)}`.padEnd(20),
    `median>0 until ${r.medianAheadUntil ?? '-'}`.padEnd(20),
    `>50% ahead until ${r.aheadHorizon ?? '-'}`.padEnd(24),
    `peak ${$(r.medianPeak.net)}@${r.medianPeak.round}`,
  ].join(' ');
}

function usage(): never {
  console.error(
    'usage: node scripts/research/sim.mjs <spec.json> [--sessions N] [--spins N] [--bankroll CENTS] [--seed N] [--out report.json] [--only id,id]',
  );
  process.exit(2);
}

export async function main(argv: string[]): Promise<void> {
  const args = [...argv];
  const file = args.shift();
  if (!file || file.startsWith('--')) usage();
  const opt: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i];
    const v = args[i + 1];
    if (!k?.startsWith('--') || v === undefined) usage();
    opt[k.slice(2)] = v;
  }
  const spec = JSON.parse(readFileSync(resolve(file), 'utf8')) as SpecFile;
  const defaults: NonNullable<SpecFile['defaults']> = { ...spec.defaults };
  defaults.session = { ...defaults.session };
  defaults.run = { ...defaults.run };
  if (opt.sessions) defaults.run.sessions = Number(opt.sessions);
  if (opt.seed) defaults.run.seed = Number(opt.seed);
  if (opt.spins) defaults.session.maxRounds = Number(opt.spins);
  if (opt.bankroll) defaults.session.bankroll = Number(opt.bankroll);
  const only = opt.only ? new Set(opt.only.split(',')) : null;
  const reports: Report[] = [];
  for (const e of spec.experiments) {
    if (only && !only.has(e.id)) continue;
    // Command-line overrides win over the experiment's own values.
    const merged: ExperimentSpec = {
      ...e,
      session: {
        ...e.session,
        ...(opt.spins ? { maxRounds: Number(opt.spins) } : {}),
        ...(opt.bankroll ? { bankroll: Number(opt.bankroll) } : {}),
      },
      run: {
        ...e.run,
        ...(opt.sessions ? { sessions: Number(opt.sessions) } : {}),
        ...(opt.seed ? { seed: Number(opt.seed) } : {}),
      },
    };
    const def = toDefinition(merged, defaults);
    const r = runOne(def, e.id, e.pathEvery ?? defaults.pathEvery ?? 10);
    reports.push(r);
    console.log(formatLine(r));
  }
  if (opt.out) {
    writeFileSync(resolve(opt.out), JSON.stringify(reports, null, 1));
    console.log(`wrote ${reports.length} report(s) to ${opt.out}`);
  }
}
