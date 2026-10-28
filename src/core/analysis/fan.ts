// Fan chart, exact survival and convergence (harness-data-analysis.md §11.11, §12; docs/metrics.md).
import {
  MIN_N_FOR_CI,
  Z95,
  type Convergence,
  type FanChart,
  type Survival,
} from '../contracts/analysis';
import { ENDED_BY, ENDED_BY_STRATEGY_BASE, type RunData } from '../contracts/run';
import { chunkColumnSums, domainOf } from './domain';
import { wilson } from './stats';

type Cause = 'bust' | 'stop-win' | 'stop-loss' | 'strategy' | 'error' | 'rounds';
const causeOf = (code: number): Cause =>
  code >= ENDED_BY_STRATEGY_BASE
    ? 'strategy'
    : code === ENDED_BY.bust
      ? 'bust'
      : code === ENDED_BY['stop-win']
        ? 'stop-win'
        : code === ENDED_BY['stop-loss']
          ? 'stop-loss'
          : code === ENDED_BY.error
            ? 'error'
            : 'rounds';

/** Exact survival from roundsPlayed / endedBy: S(r) = share that completed at least r rounds. */
export function survival(d: RunData): Survival {
  const { n, t, maxRounds } = domainOf(d);
  const size = maxRounds + 1;
  const cnt = new Float64Array(size);
  const by = new Map<Cause, Float64Array>();
  for (let i = 0; i < n; i++) {
    const r = Math.min(t.roundsPlayed[i]!, maxRounds);
    cnt[r]!++;
    const k = causeOf(t.endedBy[i]!);
    let arr = by.get(k);
    if (!arr) by.set(k, (arr = new Float64Array(size)));
    arr[r]!++;
  }
  const alive = new Float64Array(size);
  let done = 0;
  let medianRounds: number | null = null;
  for (let r = 0; r < size; r++) {
    alive[r] = n > 0 ? 1 - done / n : 1;
    if (medianRounds === null && n > 0 && alive[r]! <= 0.5) medianRounds = r;
    done += cnt[r]!;
  }
  const incidence: Survival['incidence'] = {};
  for (const [k, arr] of by) {
    let cum = 0;
    for (let r = 0; r < size; r++) {
      cum += arr[r]!;
      arr[r] = cum / n;
    }
    incidence[k] = arr;
  }
  return { maxRounds, alive, incidence, medianRounds };
}

function pickIndices(K: number, maxPoints: number | undefined): number[] {
  if (!maxPoints || K <= maxPoints) return Array.from({ length: K }, (_, i) => i);
  if (maxPoints < 2) return [K - 1];
  const out = new Set<number>();
  for (let j = 0; j < maxPoints; j++) out.add(Math.round((j * (K - 1)) / (maxPoints - 1)));
  return [...out].sort((a, b) => a - b);
}

/** Fan percentiles of net by checkpoint, the mean, the analytic expected line and the alive share. */
export function fanChart(d: RunData, opts: { live?: boolean; maxPoints?: number } = {}): FanChart {
  const D = domainOf(d);
  const { n, K, schedule, equity, bankroll: B, nChunks } = D;
  const idx = pickIndices(K, opts.maxPoints ?? (opts.live ? 24 : undefined));
  const m = idx.length;
  const out: FanChart = {
    rounds: new Int32Array(m),
    p5: new Float64Array(m),
    p25: new Float64Array(m),
    p50: new Float64Array(m),
    p75: new Float64Array(m),
    p95: new Float64Array(m),
    mean: new Float64Array(m),
    expected: new Float64Array(m),
    alive: new Float64Array(m),
  };
  const expCum = chunkColumnSums(D.chunks.expCum, K, nChunks);
  const surv = survival(d).alive;
  const col = new Float64Array(n);
  const q = (p: number) => {
    const h = (n - 1) * p;
    const j = Math.floor(h);
    return j + 1 >= n ? col[n - 1]! : col[j]! + (h - j) * (col[j + 1]! - col[j]!);
  };
  for (let o = 0; o < m; o++) {
    const c = idx[o]!;
    const r = schedule[c]!;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = equity[i * K + c]! - B;
      col[i] = v;
      sum += v;
    }
    col.sort();
    out.rounds[o] = r;
    if (n > 0) {
      out.p5[o] = q(0.05);
      out.p25[o] = q(0.25);
      out.p50[o] = q(0.5);
      out.p75[o] = q(0.75);
      out.p95[o] = q(0.95);
      out.mean[o] = sum / n;
      out.expected[o] = -expCum[c]! / n;
    }
    out.alive[o] = surv[Math.min(r, D.maxRounds)] ?? 1;
  }
  return out;
}

/** Sessions needed for a mean half-width: ceil((z s / h)^2). */
export function suggestedForMean(sd: number, halfWidth: number): number {
  return Math.ceil(((Z95 * sd) / halfWidth) ** 2);
}
/** Sessions needed for a probability half-width, with p~ = max(p, 1/N). */
export function suggestedForProbability(p: number, n: number, halfWidth: number): number {
  const pt = Math.max(p, 1 / n);
  return Math.ceil((Z95 * Z95 * pt * (1 - pt)) / (halfWidth * halfWidth));
}

/** The convergence grid n_j = ceil(N^(j/199)), deduplicated, N included (display only: Math.pow). */
export function convergenceGrid(N: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < 200; j++) {
    const v = Math.min(N, Math.max(1, Math.ceil(Math.pow(N, j / 199))));
    if (out[out.length - 1] !== v) out.push(v);
  }
  if (N >= 1 && out[out.length - 1] !== N) out.push(N);
  return out;
}

export function convergence(d: RunData, targets: Partial<Convergence['target']> = {}): Convergence {
  const D = domainOf(d);
  const { n, t } = D;
  const grid = convergenceGrid(n);
  const g = grid.length;
  const o: Convergence = {
    n: Int32Array.from(grid),
    mean: new Float64Array(g),
    lo: new Float64Array(g),
    hi: new Float64Array(g),
    pBust: new Float64Array(g),
    pBustLo: new Float64Array(g),
    pBustHi: new Float64Array(g),
    pAhead: new Float64Array(g),
    pAheadLo: new Float64Array(g),
    pAheadHi: new Float64Array(g),
    target: { meanHalfWidth: 0, pHalfWidth: targets.pHalfWidth ?? 0.01 },
    suggested: { forMean: 0, forBust: 0 },
    bigEnough: false,
  };
  let mean = 0;
  let m2 = 0;
  let bust = 0;
  let ahead = 0;
  let gi = 0;
  for (let i = 0; i < n && gi < g; i++) {
    const x = t.net[i]!;
    const k = i + 1;
    const delta = x - mean;
    mean += delta / k;
    m2 += delta * (x - mean);
    if (t.endedBy[i] === ENDED_BY.bust) bust++;
    if (x > 0) ahead++;
    if (k === grid[gi]) {
      const sd = k > 1 ? Math.sqrt(m2 / (k - 1)) : 0;
      o.mean[gi] = mean;
      if (k >= MIN_N_FOR_CI) {
        o.lo[gi] = mean - (Z95 * sd) / Math.sqrt(k);
        o.hi[gi] = mean + (Z95 * sd) / Math.sqrt(k);
      } else {
        o.lo[gi] = o.hi[gi] = NaN;
      }
      o.pBust[gi] = bust / k;
      const wb = wilson(bust, k);
      o.pBustLo[gi] = wb.lo;
      o.pBustHi[gi] = wb.hi;
      o.pAhead[gi] = ahead / k;
      const wa = wilson(ahead, k);
      o.pAheadLo[gi] = wa.lo;
      o.pAheadHi[gi] = wa.hi;
      gi++;
    }
  }
  // Suggested counts use the final mean/SD (metrics.md section 11).
  const sd = n > 1 ? Math.sqrt(m2 / (n - 1)) : 0;
  let sumE = 0;
  for (let i = 0; i < n; i++) sumE += t.expectedLoss[i]!;
  const meanE = n ? sumE / n : 0;
  const hStar = targets.meanHalfWidth ?? Math.max(100, 0.1 * Math.abs(meanE));
  o.target.meanHalfWidth = hStar;
  const pBust = n ? bust / n : 0;
  o.suggested = {
    forMean: suggestedForMean(sd, hStar),
    forBust: suggestedForProbability(pBust, Math.max(n, 1), o.target.pHalfWidth),
  };
  const wb = wilson(bust, n);
  o.bigEnough =
    n >= MIN_N_FOR_CI &&
    (Z95 * sd) / Math.sqrt(n) <= hStar &&
    (wb.hi - wb.lo) / 2 <= o.target.pHalfWidth;
  return o;
}
