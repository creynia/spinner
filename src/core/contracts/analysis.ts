/**
 * Analysis outputs (harness-data-analysis.md §16.3, metrics in §11-§13). FROZEN. Imports nothing
 * outside `contracts/`. Quantiles are Hyndman-Fan type 7 everywhere (decisions.md A1); the "median
 * session" for Watch is rank floor((N-1)/2).
 *
 * Function signatures of `src/core/analysis` (pure, no DOM; stubbed in WP0, owned by core-analysis):
 *   quantile7(sorted: ArrayLike<number>, p: number): number
 *   quantileCI(sorted: ArrayLike<number>, p: number, z?: number): Interval
 *   wilson(k: number, n: number, z?: number): Interval
 *   newcombe(k1: number, n1: number, k2: number, n2: number, z?: number): Interval
 *   meanSd(xs: ArrayLike<number>): { mean: number; sd: number; n: number }
 *   histogramFD(values: ArrayLike<number>, opts?: { integer?: boolean; maxBins?: number; markers?: Histogram['markers'] }): Histogram
 *   runMetrics(d: RunData): RunMetrics
 *   fanChart(d: RunData, opts?: { live?: boolean; maxPoints?: number }): FanChart
 *   survival(d: RunData): Survival
 *   convergence(d: RunData, targets?: Partial<Convergence['target']>): Convergence
 *   compareRuns(runs: RunData[]): CompareResult
 *   sweepResult(path: string, values: unknown[], runs: RunData[]): SweepResult
 *   representativeSessions(d: RunData): { best: number; worst: number; median: number }
 *   endedByLabel(code: number, reasons: string[]): EndedBy
 */
import type { Cents } from './game';
import type { EndedBy } from './run';

export const Z95 = 1.959963984540054;
export const MIN_N_FOR_CI = 30;

export interface Interval {
  lo: number;
  hi: number;
  level: 0.95;
}
export interface Estimate {
  value: number;
  se?: number;
  ci?: Interval;
} // ci absent when N < 30
export interface Proportion {
  k: number;
  n: number;
  p: number;
  ci: Interval;
} // Wilson, always
export type QuantileKey = 'p1' | 'p5' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p95' | 'p99';
export interface Distribution {
  n: number;
  mean: Estimate;
  sd: number;
  skew: number | null;
  min: number;
  max: number;
  q: Record<QuantileKey, number>;
  medianCI?: Interval;
  histogram: Histogram;
}
export interface Histogram {
  lo: number;
  width: number;
  counts: Uint32Array;
  zeroBin: number | null;
  markers: { zero?: number; expected?: number; mean?: number };
}

export interface RunMetrics {
  n: number;
  of: number; // prefix N and total sessions
  net: Distribution;
  probabilities: {
    ahead: Proportion;
    even: Proportion;
    behind: Proportion;
    bust: Proportion;
    stopWin: Proportion;
    stopLoss: Proportion;
    cap: Proportion;
    error: Proportion;
    strategy: Record<string, Proportion>;
  };
  expected: {
    meanExpectedLoss: number;
    meanRealizedLoss: Estimate;
    expectedNetLine: number;
    luckZ: number | null;
    luckLabel: 'ordinary' | 'mild' | 'unusual' | 'very-unusual' | null;
    sessionZ: Histogram | null;
  };
  edge: {
    realized: Estimate | null;
    analytic: number | null;
    expectedLossPerRound: number;
    perWageredRound: number;
    per100: number;
    perHour: number;
    perSession: number;
    costOfPlayPerHour: number;
    realizedLossPerHour: Estimate | null;
  };
  volatility: {
    sdSession: number;
    sdRoundAnalytic: number;
    sdRoundEmpirical: number;
    sdHour: number;
    sdPer100: number;
    signalRatio: number | null;
    spreadRatio: number | null;
  };
  drawdown: Distribution & { pHalfBankroll: Proportion; pFullBankroll: Proportion };
  exposure: Distribution & { pAtTableMax: Proportion | null };
  trough: Distribution;
  length: Distribution & { satOutShare: number; hours: Estimate };
  breakdown: Breakdown;
  representative: { best: number; worst: number; median: number }; // session indices
}

export interface Breakdown {
  categories: {
    id: string;
    wagered: Cents;
    net: Cents;
    expected: number;
    realizedEdge: number | null;
    analyticEdge: number | null;
  }[];
  stages: {
    id: string;
    rounds: number;
    roundShare: number;
    wagered: Cents;
    net: Cents;
    expected: number;
    entries: number;
    stops: number;
  }[];
  transitions: { from: string; to: string; count: number }[];
  rejected: { total: number; byReason: Record<string, number>; sessionsWithRejections: Proportion };
  deferred: { total: number; byReason: Record<string, number> };
  errors: { total: number; first: { index: number; code: string; message: string }[] };
}

export interface FanChart {
  rounds: Int32Array; // schedule
  p5: Float64Array;
  p25: Float64Array;
  p50: Float64Array;
  p75: Float64Array;
  p95: Float64Array;
  mean: Float64Array;
  expected: Float64Array;
  alive: Float64Array; // net cents; alive as a share
}
export interface Survival {
  maxRounds: number;
  alive: Float64Array; // S(r), r = 0..maxRounds
  incidence: Partial<
    Record<'bust' | 'stop-win' | 'stop-loss' | 'strategy' | 'error' | 'rounds', Float64Array>
  >;
  medianRounds: number | null;
}
export interface Convergence {
  n: Int32Array;
  mean: Float64Array;
  lo: Float64Array;
  hi: Float64Array;
  pBust: Float64Array;
  pBustLo: Float64Array;
  pBustHi: Float64Array;
  pAhead: Float64Array;
  pAheadLo: Float64Array;
  pAheadHi: Float64Array;
  target: { meanHalfWidth: number; pHalfWidth: number };
  suggested: { forMean: number; forBust: number };
  bigEnough: boolean;
}

export type CompareMethod = 'paired' | 'welch';
export interface DiffEstimate {
  value: number;
  se: number;
  ci: Interval;
  df?: number;
}
export interface PairDiff {
  baseline: string;
  other: string;
  method: CompareMethod;
  n: number;
  crn?: { rho: number; varianceReduction: number };
  meanNet: DiffEstimate;
  meanExpectedLoss: DiffEstimate;
  meanWagered: DiffEstimate;
  meanRounds: DiffEstimate;
  meanMaxDrawdown: DiffEstimate;
  realizedEdge: DiffEstimate | null;
  probabilities: Record<
    'ahead' | 'bust' | 'stopWin' | 'stopLoss',
    DiffEstimate & { discordant?: [number, number] }
  >;
  notes: string[]; // e.g. 'session configs differ', 'few discordant pairs'
}
export interface CompareResult {
  runIds: string[];
  metrics: RunMetrics[];
  diffs: PairDiff[];
  sharedHistogram: { lo: number; width: number; counts: Uint32Array[] };
}

export interface SweepPoint {
  value: unknown;
  runId: string;
  metrics: RunMetrics;
}
export interface SweepResult {
  path: string;
  points: SweepPoint[];
  adjacent: PairDiff[];
  xScale: 'categorical' | 'linear' | 'log';
}
