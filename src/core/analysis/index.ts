// core/analysis: metrics, quantiles, intervals, fan, survival, compare, sweep (owner: core-analysis).
// WP0 ships throwing stubs with the signatures of harness-data-analysis.md §16.3.
import type {
  CompareResult,
  Convergence,
  FanChart,
  Histogram,
  Interval,
  RunMetrics,
  Survival,
  SweepResult,
} from '../contracts/analysis';
import type { EndedBy, RunData } from '../contracts/run';

/** Hyndman-Fan type 7 (linear interpolation), `sorted` ascending (decisions.md A1). */
export function quantile7(_sorted: ArrayLike<number>, _p: number): number {
  throw new Error('TODO(core-analysis)');
}
export function quantileCI(_sorted: ArrayLike<number>, _p: number, _z?: number): Interval {
  throw new Error('TODO(core-analysis)');
}
export function wilson(_k: number, _n: number, _z?: number): Interval {
  throw new Error('TODO(core-analysis)');
}
export function newcombe(
  _k1: number,
  _n1: number,
  _k2: number,
  _n2: number,
  _z?: number,
): Interval {
  throw new Error('TODO(core-analysis)');
}
export function meanSd(_xs: ArrayLike<number>): { mean: number; sd: number; n: number } {
  throw new Error('TODO(core-analysis)');
}
export function histogramFD(
  _values: ArrayLike<number>,
  _opts?: { integer?: boolean; maxBins?: number; markers?: Histogram['markers'] },
): Histogram {
  throw new Error('TODO(core-analysis)');
}
export function runMetrics(_d: RunData): RunMetrics {
  throw new Error('TODO(core-analysis)');
}
export function fanChart(_d: RunData, _opts?: { live?: boolean; maxPoints?: number }): FanChart {
  throw new Error('TODO(core-analysis)');
}
export function survival(_d: RunData): Survival {
  throw new Error('TODO(core-analysis)');
}
export function convergence(_d: RunData, _targets?: Partial<Convergence['target']>): Convergence {
  throw new Error('TODO(core-analysis)');
}
export function compareRuns(_runs: RunData[]): CompareResult {
  throw new Error('TODO(core-analysis)');
}
export function sweepResult(_path: string, _values: unknown[], _runs: RunData[]): SweepResult {
  throw new Error('TODO(core-analysis)');
}
export function representativeSessions(_d: RunData): {
  best: number;
  worst: number;
  median: number;
} {
  throw new Error('TODO(core-analysis)');
}
export function endedByLabel(_code: number, _reasons: string[]): EndedBy {
  throw new Error('TODO(core-analysis)');
}
