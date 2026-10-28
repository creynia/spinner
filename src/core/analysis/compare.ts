// Compare (paired / Welch / Newcombe / CRN) and sweep (harness-data-analysis.md §13; docs/metrics.md).
import {
  Z95,
  type CompareMethod,
  type CompareResult,
  type DiffEstimate,
  type PairDiff,
  type RunMetrics,
  type SweepResult,
} from '../contracts/analysis';
import { ENDED_BY, type RunData } from '../contracts/run';
import { domainOf, type Domain } from './domain';
import { runMetrics, type MetricsOptions } from './metrics';
import { histogramFD, meanSd, newcombe } from './stats';

const level = 0.95 as const;

/** Paired iff seed, gameVersion and coreVersion are all equal (metrics.md section 13). */
export function isPaired(a: RunData, b: RunData): boolean {
  return (
    a.definition.run.seed === b.definition.run.seed &&
    a.meta.gameVersion === b.meta.gameVersion &&
    a.meta.coreVersion === b.meta.coreVersion
  );
}

function ci(value: number, se: number) {
  return { lo: value - Z95 * se, hi: value + Z95 * se, level };
}

/** Difference of means B - A over the given per-session values. */
export function diffMeans(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  method: CompareMethod,
): DiffEstimate {
  if (method === 'paired') {
    const n = Math.min(a.length, b.length);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = b[i]! - a[i]!;
    if (n < 2) {
      const v = n === 1 ? d[0]! : 0;
      return { value: v, se: 0, ci: { lo: v, hi: v, level }, df: 0 };
    }
    const { mean, sd } = meanSd(d);
    const se = sd / Math.sqrt(n);
    return { value: mean, se, ci: ci(mean, se), df: n - 1 };
  }
  const A = meanSd(a);
  const B = meanSd(b);
  const pa = (A.sd * A.sd) / A.n;
  const pb = (B.sd * B.sd) / B.n;
  const se = Math.sqrt(pa + pb);
  const value = B.mean - A.mean;
  const den = (pa * pa) / (A.n - 1) + (pb * pb) / (B.n - 1);
  const out: DiffEstimate = { value, se, ci: ci(value, se) };
  if (den > 0) out.df = (pa + pb) ** 2 / den;
  return out;
}

function corr(x: ArrayLike<number>, y: ArrayLike<number>, n: number): number {
  const X = meanSd(Array.prototype.slice.call(x, 0, n));
  const Y = meanSd(Array.prototype.slice.call(y, 0, n));
  if (!(X.sd > 0) || !(Y.sd > 0)) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i]! - X.mean) * (y[i]! - Y.mean);
  return s / ((n - 1) * X.sd * Y.sd);
}

function indicator(D: Domain, pred: (i: number) => boolean): Float64Array {
  const out = new Float64Array(D.n);
  for (let i = 0; i < D.n; i++) out[i] = pred(i) ? 1 : 0;
  return out;
}

function probDiff(
  A: Float64Array,
  B: Float64Array,
  method: CompareMethod,
): DiffEstimate & { discordant?: [number, number] } {
  if (method === 'paired') {
    const n = Math.min(A.length, B.length);
    let b01 = 0;
    let c10 = 0;
    for (let i = 0; i < n; i++) {
      if (B[i] === 1 && A[i] === 0) b01++;
      else if (A[i] === 1 && B[i] === 0) c10++;
    }
    return { ...diffMeans(A, B, 'paired'), discordant: [b01, c10] };
  }
  const kA = A.reduce((s, v) => s + v, 0);
  const kB = B.reduce((s, v) => s + v, 0);
  const pA = kA / A.length;
  const pB = kB / B.length;
  return {
    value: pB - pA,
    se: Math.sqrt((pA * (1 - pA)) / A.length + (pB * (1 - pB)) / B.length),
    ci: newcombe(kB, B.length, kA, A.length),
  };
}

/** Realized-edge difference e_B - e_A (null if either run wagered nothing). */
function edgeDiff(a: Domain, b: Domain, method: CompareMethod): DiffEstimate | null {
  const nA = method === 'paired' ? Math.min(a.n, b.n) : a.n;
  const nB = method === 'paired' ? Math.min(a.n, b.n) : b.n;
  const stats = (D: Domain, n: number) => {
    let W = 0;
    let L = 0;
    let V = 0;
    for (let i = 0; i < n; i++) {
      W += D.t.wagered[i]!;
      L -= D.t.net[i]!;
      V += D.t.variance[i]!;
    }
    return { W, L, V, e: W > 0 ? L / W : NaN, wbar: n ? W / n : 0 };
  };
  const sa = stats(a, nA);
  const sb = stats(b, nB);
  if (!(sa.W > 0) || !(sb.W > 0)) return null;
  const value = sb.e - sa.e;
  let se: number;
  if (method === 'paired') {
    const n = nA;
    const u = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const lb = -b.t.net[i]!;
      const la = -a.t.net[i]!;
      u[i] = (lb - sb.e * b.t.wagered[i]!) / sb.wbar - (la - sa.e * a.t.wagered[i]!) / sa.wbar;
    }
    se = meanSd(u).sd / Math.sqrt(n);
  } else {
    se = Math.sqrt(sa.V / (sa.W * sa.W) + sb.V / (sb.W * sb.W));
  }
  return { value, se, ci: ci(value, se) };
}

const SESSION_KEYS = ['bankroll', 'maxRounds', 'stopWin', 'stopLoss', 'roundsPerHour'] as const;

/** B minus A, paired by session index when the pairing rule holds, otherwise Welch / Newcombe. */
export function pairDiff(a: RunData, b: RunData): PairDiff {
  const method: CompareMethod = isPaired(a, b) ? 'paired' : 'welch';
  const Da = domainOf(a);
  const Db = domainOf(b);
  const n = method === 'paired' ? Math.min(Da.n, Db.n) : Db.n;
  const va = (f: (i: number) => number, m: number) => {
    const out = new Float64Array(m);
    for (let i = 0; i < m; i++) out[i] = f(i);
    return out;
  };
  const mA = method === 'paired' ? n : Da.n;
  const mB = method === 'paired' ? n : Db.n;
  const col = (
    D: Domain,
    key: 'net' | 'expectedLoss' | 'wagered' | 'roundsPlayed' | 'maxDrawdown',
    m: number,
  ) => va((i) => D.t[key][i]!, m);
  const mean = (key: Parameters<typeof col>[1]) =>
    diffMeans(col(Da, key, mA), col(Db, key, mB), method);

  const pred = {
    ahead: (D: Domain) => (i: number) => D.t.net[i]! > 0,
    bust: (D: Domain) => (i: number) => D.t.endedBy[i] === ENDED_BY.bust,
    stopWin: (D: Domain) => (i: number) => D.t.endedBy[i] === ENDED_BY['stop-win'],
    stopLoss: (D: Domain) => (i: number) => D.t.endedBy[i] === ENDED_BY['stop-loss'],
  };
  const ind = (k: keyof typeof pred) => {
    const x = indicator({ ...Da, n: mA }, pred[k](Da));
    const y = indicator({ ...Db, n: mB }, pred[k](Db));
    return probDiff(x, y, method);
  };

  const notes: string[] = [];
  if (SESSION_KEYS.some((k) => a.definition.session[k] !== b.definition.session[k]))
    notes.push('session configs differ');
  if (method === 'welch') notes.push('unpaired (Welch): seeds or versions differ');
  const probabilities = {
    ahead: ind('ahead'),
    bust: ind('bust'),
    stopWin: ind('stopWin'),
    stopLoss: ind('stopLoss'),
  };
  if (method === 'paired') {
    for (const p of Object.values(probabilities)) {
      const [x, y] = p.discordant ?? [0, 0];
      if (x + y < 10) {
        notes.push('few discordant pairs');
        break;
      }
    }
  }
  if (Math.min(mA, mB) < 30) notes.push('fewer than 30 sessions: intervals are approximate');

  const diff: PairDiff = {
    baseline: a.meta.runId,
    other: b.meta.runId,
    method,
    n,
    meanNet: mean('net'),
    meanExpectedLoss: mean('expectedLoss'),
    meanWagered: mean('wagered'),
    meanRounds: mean('roundsPlayed'),
    meanMaxDrawdown: mean('maxDrawdown'),
    realizedEdge: edgeDiff(Da, Db, method),
    probabilities,
    notes,
  };
  if (method === 'paired' && n >= 2) {
    const x = col(Da, 'net', n);
    const y = col(Db, 'net', n);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = y[i]! - x[i]!;
    const vA = meanSd(x).sd ** 2;
    const vB = meanSd(y).sd ** 2;
    diff.crn = {
      rho: corr(x, y, n),
      varianceReduction: vA + vB > 0 ? 1 - meanSd(d).sd ** 2 / (vA + vB) : 0,
    };
  }
  return diff;
}

export function compareRuns(runs: RunData[], opts: MetricsOptions = {}): CompareResult {
  if (runs.length < 2 || runs.length > 6) throw new RangeError('compare takes 2 to 6 runs');
  if (runs.some((r) => r.meta.gameId !== runs[0]!.meta.gameId))
    throw new Error('compare needs runs of the same game');
  const metrics = runs.map((r) => runMetrics(r, opts));
  const diffs = runs.slice(1).map((r) => pairDiff(runs[0]!, r));
  // One bin grid computed on the pooled net values.
  const doms = runs.map(domainOf);
  const total = doms.reduce((s, D) => s + D.n, 0);
  const pooled = new Float64Array(total);
  let o = 0;
  for (const D of doms) {
    pooled.set(D.t.net, o);
    o += D.n;
  }
  const h = histogramFD(pooled);
  const counts = doms.map((D) => {
    const c = new Uint32Array(h.counts.length);
    for (let i = 0; i < D.n; i++) {
      const b = Math.min(c.length - 1, Math.max(0, Math.floor((D.t.net[i]! - h.lo) / h.width)));
      c[b]!++;
    }
    return c;
  });
  return {
    runIds: runs.map((r) => r.meta.runId),
    metrics,
    diffs,
    sharedHistogram: { lo: h.lo, width: h.width, counts },
  };
}

export function sweepResult(
  path: string,
  values: unknown[],
  runs: RunData[],
  opts: MetricsOptions = {},
): SweepResult {
  if (values.length !== runs.length) throw new RangeError('sweep needs one run per value');
  const points = runs.map((r, i) => {
    const metrics: RunMetrics = runMetrics(r, opts);
    return { value: values[i], runId: r.meta.runId, metrics };
  });
  const adjacent = runs.slice(1).map((r, i) => pairDiff(runs[i]!, r));
  const nums = values.every((v) => typeof v === 'number') ? values : null;
  let xScale: SweepResult['xScale'] = 'categorical';
  if (nums) {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    xScale = lo > 0 && hi / lo >= 20 ? 'log' : 'linear';
  }
  return { path, points, adjacent, xScale };
}
