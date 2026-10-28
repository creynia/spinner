// RunMetrics (harness-data-analysis.md §11; docs/metrics.md). Pure functions over the summary table,
// checkpoint matrix and chunk stats of the completed prefix.
import {
  MIN_N_FOR_CI,
  Z95,
  type Breakdown,
  type Distribution,
  type Estimate,
  type Histogram,
  type Proportion,
  type QuantileKey,
  type RunMetrics,
} from '../contracts/analysis';
import { ENDED_BY, ENDED_BY_STRATEGY_BASE, type EndedBy, type RunData } from '../contracts/run';
import { chunkColumnSums, domainOf, type Domain } from './domain';
import { histogramFD, meanSd, quantile7, quantileCI, skewness, sortedCopy, wilson } from './stats';

const QUANTILES: [QuantileKey, number][] = [
  ['p1', 0.01],
  ['p5', 0.05],
  ['p10', 0.1],
  ['p25', 0.25],
  ['p50', 0.5],
  ['p75', 0.75],
  ['p90', 0.9],
  ['p95', 0.95],
  ['p99', 0.99],
];

export interface MetricsOptions {
  /** Even-money table maximum in cents (from the plugin's resolved rules) for P(maxExposure >= max). */
  tableMax?: number;
}

/** Mean estimate: SE always, CI only from 30 sessions (metrics.md section 0). */
export function meanEstimate(mean: number, sd: number, n: number): Estimate {
  const se = n > 0 ? sd / Math.sqrt(n) : NaN;
  const e: Estimate = { value: mean, se };
  if (n >= MIN_N_FOR_CI) e.ci = { lo: mean - Z95 * se, hi: mean + Z95 * se, level: 0.95 };
  return e;
}

export function proportion(k: number, n: number): Proportion {
  return { k, n, p: n > 0 ? k / n : 0, ci: wilson(k, n) };
}

/** Distribution summary of one column (metrics.md sections 1, 2, 6). */
export function distribution(
  values: ArrayLike<number>,
  opts: { integer?: boolean; markers?: Histogram['markers'] } = {},
): Distribution {
  const n = values.length;
  const sorted = sortedCopy(values);
  const { mean, sd } = meanSd(sorted);
  const q = {} as Record<QuantileKey, number>;
  for (const [k, p] of QUANTILES) q[k] = quantile7(sorted, p);
  const out: Distribution = {
    n,
    mean: meanEstimate(mean, sd, n),
    sd,
    skew: skewness(sorted, mean, sd),
    min: n ? sorted[0]! : NaN,
    max: n ? sorted[n - 1]! : NaN,
    q,
    histogram: histogramFD(values, {
      integer: opts.integer ?? true,
      markers: { ...opts.markers, mean },
    }),
  };
  if (n >= MIN_N_FOR_CI) out.medianCI = quantileCI(sorted, 0.5);
  return out;
}

export function endedByLabel(code: number, reasons: string[]): EndedBy {
  switch (code) {
    case ENDED_BY.rounds:
      return 'rounds';
    case ENDED_BY.bust:
      return 'bust';
    case ENDED_BY['stop-win']:
      return 'stop-win';
    case ENDED_BY['stop-loss']:
      return 'stop-loss';
    case ENDED_BY.error:
      return 'error';
  }
  const j = code - ENDED_BY_STRATEGY_BASE;
  if (j >= 0 && j < reasons.length) return `strategy:${reasons[j]!}`;
  throw new RangeError(`unknown endedBy code ${code}`);
}

/** best = argmax net, worst = argmin net, median = rank floor((N-1)/2) by (net, index); ties: smallest index. */
export function representativeSessions(d: RunData): {
  best: number;
  worst: number;
  median: number;
} {
  const { n, t } = domainOf(d);
  if (n === 0) return { best: -1, worst: -1, median: -1 };
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const net = t.net;
  idx.sort((a, b) => net[a]! - net[b]! || a - b);
  let best = idx[n - 1]!;
  // Smallest index among equal maxima.
  for (let k = n - 1; k >= 0 && net[idx[k]!] === net[best]; k--) best = idx[k]!;
  return { best, worst: idx[0]!, median: idx[Math.floor((n - 1) / 2)]! };
}

function luckLabel(z: number): 'ordinary' | 'mild' | 'unusual' | 'very-unusual' {
  const a = Math.abs(z);
  return a < 1 ? 'ordinary' : a < 2 ? 'mild' : a < 3 ? 'unusual' : 'very-unusual';
}

function sumRecords(recs: Record<string, number>[], nChunks: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let c = 0; c < nChunks; c++)
    for (const [k, v] of Object.entries(recs[c] ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
}

function breakdown(d: RunData, D: Domain): Breakdown {
  const { n, S, C, nChunks, t, chunks } = D;
  const { stages, categories } = d.meta.labels;
  const catExp = chunkColumnSums(chunks.catExpected, C, nChunks);
  const stW = chunkColumnSums(chunks.stageWagered, S, nChunks);
  const stN = chunkColumnSums(chunks.stageNet, S, nChunks);
  const stE = chunkColumnSums(chunks.stageExpected, S, nChunks);
  const trans = chunkColumnSums(chunks.transitions, S * S, nChunks);

  const catW = new Float64Array(C);
  const catN = new Float64Array(C);
  const stR = new Float64Array(S);
  const stops = new Float64Array(S);
  let totalRounds = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < C; c++) {
      catW[c]! += t.catWagered[i * C + c]!;
      catN[c]! += t.catNet[i * C + c]!;
    }
    for (let s = 0; s < S; s++) stR[s]! += t.stageRounds[i * S + s]!;
    stops[t.stopStage[i]!]!++;
    totalRounds += t.roundsPlayed[i]!;
  }

  const entries = new Float64Array(S);
  const transitions: Breakdown['transitions'] = [];
  for (let a = 0; a < S; a++)
    for (let b = 0; b < S; b++) {
      const count = trans[a * S + b]!;
      if (count > 0) {
        transitions.push({ from: stages[a]!, to: stages[b]!, count });
        entries[b]! += count;
      }
    }
  if (S > 0) entries[0]! += n;

  let sessionsRej = 0;
  let errTotal = 0;
  for (let i = 0; i < n; i++) {
    if (t.rejected[i]! > 0) sessionsRej++;
    if (t.endedBy[i] === ENDED_BY.error) errTotal++;
  }
  const rejByReason = sumRecords(chunks.rejectedByReason, nChunks);
  const defByReason = sumRecords(chunks.deferredByReason, nChunks);
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

  return {
    categories: categories.map((id, c) => ({
      id,
      wagered: catW[c]!,
      net: catN[c]!,
      expected: catExp[c]!,
      realizedEdge: catW[c]! > 0 ? -catN[c]! / catW[c]! : null,
      analyticEdge: catW[c]! > 0 ? catExp[c]! / catW[c]! : null,
    })),
    stages: stages.map((id, s) => ({
      id,
      rounds: stR[s]!,
      roundShare: totalRounds > 0 ? stR[s]! / totalRounds : 0,
      wagered: stW[s]!,
      net: stN[s]!,
      expected: stE[s]!,
      entries: entries[s]!,
      stops: stops[s]!,
    })),
    transitions,
    rejected: {
      total: sum(rejByReason),
      byReason: rejByReason,
      sessionsWithRejections: proportion(sessionsRej, n),
    },
    deferred: { total: sum(defByReason), byReason: defByReason },
    errors: {
      total: errTotal,
      first: chunks.errors.filter((e) => e.index < n).slice(0, 100),
    },
  };
}

export function runMetrics(d: RunData, opts: MetricsOptions = {}): RunMetrics {
  const D = domainOf(d);
  const { n, t, bankroll: B, roundsPerHour: rph } = D;
  const reasons = d.meta.labels.reasons;

  let sumE = 0;
  let sumV = 0;
  let sumW = 0;
  let sumR = 0;
  let sumRw = 0;
  let sumNet = 0;
  let ahead = 0;
  let even = 0;
  let behind = 0;
  let dd2 = 0;
  let ddB = 0;
  let atMax = 0;
  let sumXE = 0;
  const byCode = new Float64Array(256);
  const zs: number[] = [];
  const half = B / 2;
  for (let i = 0; i < n; i++) {
    const x = t.net[i]!;
    sumNet += x;
    sumE += t.expectedLoss[i]!;
    sumV += t.variance[i]!;
    sumW += t.wagered[i]!;
    sumR += t.roundsPlayed[i]!;
    sumRw += t.roundsWagered[i]!;
    sumXE += x + t.expectedLoss[i]!;
    if (x > 0) ahead++;
    else if (x < 0) behind++;
    else even++;
    byCode[t.endedBy[i]!]!++;
    if (t.maxDrawdown[i]! >= half) dd2++;
    if (t.maxDrawdown[i]! >= B) ddB++;
    if (opts.tableMax !== undefined && t.maxExposure[i]! >= opts.tableMax) atMax++;
    if (t.variance[i]! > 0) zs.push((x + t.expectedLoss[i]!) / Math.sqrt(t.variance[i]!));
  }
  const meanE = n ? sumE / n : 0;
  const netD = distribution(t.net, { markers: { zero: 0, expected: -meanE } });
  const mean = netD.mean.value;
  const s = netD.sd;

  const rate = (code: number) => proportion(byCode[code]!, n);
  const strategy: Record<string, Proportion> = {};
  reasons.forEach((r, j) => (strategy[r] = rate(ENDED_BY_STRATEGY_BASE + j)));

  const Z = sumV > 0 ? sumXE / Math.sqrt(sumV) : null;
  const zsHist = zs.length ? histogramFD(Float64Array.from(zs), { integer: false }) : null;

  // Edge and cost of play (section 5).
  const eR = sumW > 0 ? -sumNet / sumW : null;
  const seR = sumW > 0 ? Math.sqrt(sumV) / sumW : NaN;
  const ell = sumR > 0 ? sumE / sumR : 0;
  const realizedEdge: Estimate | null =
    eR === null
      ? null
      : {
          value: eR,
          se: seR,
          ...(n >= MIN_N_FOR_CI && { ci: { lo: eR - Z95 * seR, hi: eR + Z95 * seR, level: 0.95 } }),
        };
  let realizedLossPerHour: Estimate | null = null;
  if (realizedEdge && sumR > 0) {
    const f = (sumW / sumR) * rph;
    realizedLossPerHour = {
      value: realizedEdge.value * f,
      se: seR * f,
      ...(realizedEdge.ci && {
        ci: { lo: realizedEdge.ci.lo * f, hi: realizedEdge.ci.hi * f, level: 0.95 },
      }),
    };
  }

  const sigmaR = sumR > 0 ? Math.sqrt(sumV / sumR) : 0;
  const meanR = n ? sumR / n : 0;

  const dd = distribution(t.maxDrawdown);
  const exp = distribution(t.maxExposure);
  const troughNet = new Int32Array(n);
  for (let i = 0; i < n; i++) troughNet[i] = t.trough[i]! - B;
  const len = distribution(t.roundsPlayed);
  const hoursMean = meanEstimate(len.mean.value / rph, len.sd / rph, n);

  const sorted = sortedCopy(t.net);
  const q10 = quantile7(sorted, 0.1);
  const q90 = quantile7(sorted, 0.9);

  return {
    n,
    of: D.of,
    net: netD,
    probabilities: {
      ahead: proportion(ahead, n),
      even: proportion(even, n),
      behind: proportion(behind, n),
      bust: rate(ENDED_BY.bust),
      stopWin: rate(ENDED_BY['stop-win']),
      stopLoss: rate(ENDED_BY['stop-loss']),
      cap: rate(ENDED_BY.rounds),
      error: rate(ENDED_BY.error),
      strategy,
    },
    expected: {
      meanExpectedLoss: meanE,
      meanRealizedLoss: meanEstimate(-mean, s, n),
      expectedNetLine: -meanE,
      luckZ: Z,
      luckLabel: Z === null ? null : luckLabel(Z),
      sessionZ: zsHist,
    },
    edge: {
      realized: realizedEdge,
      analytic: sumW > 0 ? sumE / sumW : null,
      expectedLossPerRound: ell,
      perWageredRound: sumRw > 0 ? sumE / sumRw : 0,
      per100: 100 * ell,
      perHour: ell * rph,
      perSession: meanE,
      costOfPlayPerHour: ell * rph,
      realizedLossPerHour,
    },
    volatility: {
      sdSession: s,
      sdRoundAnalytic: sigmaR,
      sdRoundEmpirical: meanR > 0 ? s / Math.sqrt(meanR) : 0,
      sdHour: sigmaR * Math.sqrt(rph),
      sdPer100: 10 * sigmaR,
      signalRatio: s > 0 ? mean / s : null,
      spreadRatio: meanE > 0 ? (q90 - q10) / meanE : null,
    },
    drawdown: { ...dd, pHalfBankroll: proportion(dd2, n), pFullBankroll: proportion(ddB, n) },
    exposure: {
      ...exp,
      pAtTableMax: opts.tableMax === undefined ? null : proportion(atMax, n),
    },
    trough: distribution(troughNet),
    length: {
      ...len,
      satOutShare: sumR > 0 ? 1 - sumRw / sumR : 0,
      hours: hoursMean,
    },
    breakdown: breakdown(d, D),
    representative: representativeSessions(d),
  };
}
