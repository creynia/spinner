// core/analysis: metrics, quantiles, intervals, fan, survival, compare, sweep (owner: core-analysis).
// Pure functions, no DOM. Definitions in docs/metrics.md.
export {
  quantile7,
  quantileCI,
  quantileRanks,
  wilson,
  newcombe,
  meanSd,
  skewness,
  histogramFD,
} from './stats';
export { completedPrefix, domainSize } from './domain';
export {
  runMetrics,
  representativeSessions,
  endedByLabel,
  distribution,
  proportion,
  meanEstimate,
} from './metrics';
export type { MetricsOptions } from './metrics';
export {
  fanChart,
  survival,
  convergence,
  convergenceGrid,
  suggestedForMean,
  suggestedForProbability,
  survivalWilson,
} from './fan';
export { compareRuns, sweepResult, pairDiff, isPaired, diffMeans } from './compare';
