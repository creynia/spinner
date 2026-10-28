// Pure statistical primitives (docs/metrics.md §1-§6): type-7 quantiles, Wilson, Newcombe, mean/SD/
// skew, Freedman-Diaconis histogram. No DOM, no imports outside contracts.
import { Z95, type Histogram, type Interval } from '../contracts/analysis';

const level = 0.95 as const;

/** Hyndman-Fan type 7 (linear interpolation), `sorted` ascending (decisions.md A1). */
export function quantile7(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const h = (n - 1) * p;
  const j = Math.floor(h);
  if (j + 1 >= n) return sorted[n - 1]!;
  return sorted[j]! + (h - j) * (sorted[j + 1]! - sorted[j]!);
}

/** 1-indexed order-statistic ranks of the distribution-free quantile CI (metrics.md §1). */
export function quantileRanks(n: number, p: number, z: number = Z95): { l: number; u: number } {
  const half = z * Math.sqrt(n * p * (1 - p));
  return {
    l: Math.max(1, Math.floor(n * p - half)),
    u: Math.min(n, Math.ceil(n * p + half) + 1),
  };
}

export function quantileCI(sorted: ArrayLike<number>, p: number, z: number = Z95): Interval {
  const { l, u } = quantileRanks(sorted.length, p, z);
  return { lo: sorted[l - 1]!, hi: sorted[u - 1]!, level };
}

/** Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z: number = Z95): Interval {
  if (n <= 0) return { lo: 0, hi: 1, level };
  const p = k / n;
  const z2 = z * z;
  const d = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / d;
  const half = (z / d) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half), level };
}

/** Newcombe hybrid score interval for p1 - p2 (k1/n1 minus k2/n2). */
export function newcombe(
  k1: number,
  n1: number,
  k2: number,
  n2: number,
  z: number = Z95,
): Interval {
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const w1 = wilson(k1, n1, z);
  const w2 = wilson(k2, n2, z);
  const d = p1 - p2;
  return {
    lo: d - Math.sqrt((p1 - w1.lo) ** 2 + (w2.hi - p2) ** 2),
    hi: d + Math.sqrt((w1.hi - p1) ** 2 + (p2 - w2.lo) ** 2),
    level,
  };
}

/** Mean and sample SD (two-pass; n = 1 gives sd 0). */
export function meanSd(xs: ArrayLike<number>): { mean: number; sd: number; n: number } {
  const n = xs.length;
  if (n === 0) return { mean: NaN, sd: NaN, n: 0 };
  let s = 0;
  for (let i = 0; i < n; i++) s += xs[i]!;
  const mean = s / n;
  if (n === 1) return { mean, sd: 0, n };
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i]! - mean;
    ss += d * d;
  }
  return { mean, sd: Math.sqrt(ss / (n - 1)), n };
}

/** Adjusted Fisher-Pearson skew G1; null when n < 3 or sd = 0. */
export function skewness(xs: ArrayLike<number>, mean?: number, sd?: number): number | null {
  const n = xs.length;
  if (n < 3) return null;
  if (mean === undefined || sd === undefined) ({ mean, sd } = meanSd(xs));
  if (!(sd > 0)) return null;
  let s = 0;
  for (let i = 0; i < n; i++) s += ((xs[i]! - mean) / sd) ** 3;
  return (n / ((n - 1) * (n - 2))) * s;
}

/** Sorted Float64Array copy (numeric sort). */
export function sortedCopy(xs: ArrayLike<number>): Float64Array {
  const a = Float64Array.from(xs);
  a.sort();
  return a;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

const MANTISSAS = [1, 2, 2.5, 5];
const clean = (x: number) => Number(x.toPrecision(12));

/** Smallest m*10^k >= x (m in {1,2,2.5,5}); k >= 0 when `integer`. Strictly greater when `strict`. */
function niceUp(x: number, integer: boolean, strict = false): number {
  const e0 = integer ? 0 : Math.floor(Math.log10(x)) - 1;
  for (let e = e0; e < e0 + 400; e++) {
    for (const m of MANTISSAS) {
      const c = clean(m * 10 ** e);
      if (strict ? c > x * (1 + 1e-9) : c >= x * (1 - 1e-12)) return c;
    }
  }
  return x;
}
/** Largest nice value strictly below x, or null. */
function nicePrev(x: number, integer: boolean): number | null {
  let best: number | null = null;
  const e0 = integer ? 0 : Math.floor(Math.log10(x)) - 2;
  for (let e = e0; e <= Math.ceil(Math.log10(x)) + 1; e++)
    for (const m of MANTISSAS) {
      const c = clean(m * 10 ** e);
      if (c < x * (1 - 1e-9)) best = c;
    }
  return best;
}

/**
 * Freedman-Diaconis histogram with nice-width snapping; zero is always a bin edge (metrics.md §6).
 * Integer data uses the gcd granularity; `integer: false` (floats) skips it.
 */
export function histogramFD(
  values: ArrayLike<number>,
  opts: {
    integer?: boolean;
    maxBins?: number;
    markers?: Histogram['markers'];
    /** Ascending Float64Array copy of `values`, to avoid sorting again. */
    sorted?: Float64Array;
  } = {},
): Histogram {
  const n = values.length;
  const markers = opts.markers ?? {};
  const maxBins = opts.maxBins ?? 120;
  const integer = opts.integer ?? true;
  if (n === 0)
    return { lo: 0, width: 1, counts: new Uint32Array(1), zeroBin: 0, markers: { ...markers } };
  const sorted = opts.sorted ?? sortedCopy(values);
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  const iqr = quantile7(sorted, 0.75) - quantile7(sorted, 0.25);
  let h0 = 2 * iqr * n ** (-1 / 3);
  if (!(h0 > 0)) h0 = 3.49 * meanSd(sorted).sd * n ** (-1 / 3);
  const finish = (lo: number, width: number, count: number): Histogram => {
    const counts = new Uint32Array(count);
    for (let i = 0; i < n; i++) {
      const b = Math.min(count - 1, Math.max(0, Math.floor((values[i]! - lo) / width)));
      counts[b]!++;
    }
    const zb = -lo / width;
    const zeroBin = zb >= 0 && zb < count && Number.isInteger(clean(zb)) ? clean(zb) : null;
    return { lo, width, counts, zeroBin, markers: { ...markers } };
  };
  if (!(h0 > 0)) return finish(min, 1, 1);

  let g = 0;
  if (integer) {
    g = 0;
    for (let i = 0; i < n; i++) g = gcd(g, Math.abs(values[i]! - values[0]!));
    if (g === 0) g = 1;
  }
  const roundG = (h: number) => (g > 0 ? Math.ceil(clean(h / g)) * g : h);
  const layout = (h: number) => {
    const lo = Math.floor(clean(min / h)) * h;
    return { lo, bins: Math.floor(clean((max - lo) / h)) + 1 };
  };

  let base = niceUp(h0, integer);
  let h = roundG(base);
  let L = layout(h);
  while (L.bins > maxBins) {
    base = niceUp(base, integer, true);
    h = roundG(base);
    L = layout(h);
  }
  // Too coarse because rounding up to the granularity raised the width, or the snapped width
  // exceeds h0 by more than 1.5x: step back down.
  if (L.bins < 5 && g > 0 && (h > base || h > 1.5 * h0)) {
    let b = base;
    for (;;) {
      const prev = nicePrev(b, integer);
      if (prev === null || prev < g) break;
      const h2 = roundG(prev);
      const L2 = layout(h2);
      if (L2.bins > maxBins) break;
      b = prev;
      h = h2;
      L = L2;
      if (L.bins >= 5) break;
    }
  }
  return finish(L.lo, h, L.bins);
}
