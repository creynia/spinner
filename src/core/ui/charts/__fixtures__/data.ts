/** Deterministic fixture data shaped like analysis outputs (tests and the dev gallery only). */
import type {
  Breakdown,
  Convergence,
  FanChart,
  Histogram,
  Proportion,
  RunMetrics,
  Survival,
  SweepResult,
} from '../../../contracts/analysis';

function bell(bins: number, centre: number, sd: number, total: number): Uint32Array {
  const out = new Uint32Array(bins);
  let sum = 0;
  const w: number[] = [];
  for (let i = 0; i < bins; i++) {
    const z = (i - centre) / sd;
    const v =
      Math.exp(-0.5 * z * z) * (1 + 0.5 * Math.exp(-0.5 * ((i - centre * 0.4) / (sd * 0.5)) ** 2));
    w.push(v);
    sum += v;
  }
  for (let i = 0; i < bins; i++) out[i] = Math.round((w[i]! / sum) * total);
  return out;
}

/** 24 bins of $50 from -$600; zero at bin 12 edge; expected net -$140. */
export function histogramFixture(shift = 0): Histogram {
  const counts = bell(24, 9.5 + shift, 4.5, 10000);
  return {
    lo: -60000,
    width: 5000,
    counts,
    zeroBin: 12,
    markers: { zero: 0, expected: -14000, mean: -13200 + shift * 5000 },
  };
}

export function fanFixture(points = 33, rounds = 500): FanChart {
  const mk = (f: (t: number) => number): Float64Array =>
    Float64Array.from({ length: points }, (_, i) => f(i / (points - 1)));
  const r = Int32Array.from({ length: points }, (_, i) => Math.round((i / (points - 1)) * rounds));
  const spread = (k: number) => (t: number) => -14000 * t + k * 22000 * Math.sqrt(t);
  return {
    rounds: r,
    p5: mk(spread(-1.645)),
    p25: mk(spread(-0.674)),
    p50: mk(spread(0)),
    p75: mk(spread(0.674)),
    p95: mk(spread(1.645)),
    mean: mk((t) => -14500 * t),
    expected: mk((t) => -14000 * t),
    alive: mk((t) => 1 - 0.3 * t),
  };
}

export function survivalFixture(maxRounds = 500): Survival {
  const len = maxRounds + 1;
  const alive = Float64Array.from({ length: len }, (_, r) =>
    Math.max(0.12, 1 - (r / maxRounds) ** 1.6 * 0.88),
  );
  const bust = Float64Array.from({ length: len }, (_, r) => (1 - alive[r]!) * 0.55);
  const stopLoss = Float64Array.from({ length: len }, (_, r) => (1 - alive[r]!) * 0.3);
  const stopWin = Float64Array.from({ length: len }, (_, r) => (1 - alive[r]!) * 0.15);
  return {
    maxRounds,
    alive,
    incidence: { bust, 'stop-loss': stopLoss, 'stop-win': stopWin },
    medianRounds: 372,
  };
}

export function convergenceFixture(points = 24): Convergence {
  const n = Int32Array.from({ length: points }, (_, i) =>
    Math.round(10 ** (1 + (i / (points - 1)) * 3)),
  );
  const mean = Float64Array.from(n, (m, i) => -14000 + (9000 * Math.sin(i * 1.7)) / Math.sqrt(m));
  const hw = Float64Array.from(n, (m) => 120000 / Math.sqrt(m));
  const lo = Float64Array.from(mean, (v, i) => v - hw[i]!);
  const hi = Float64Array.from(mean, (v, i) => v + hw[i]!);
  const p = Float64Array.from(n, (m, i) => 0.12 + (0.08 * Math.sin(i)) / Math.sqrt(m / 10));
  const pw = Float64Array.from(n, (m) => 1 / Math.sqrt(m));
  const pa = Float64Array.from(n, () => 0.4);
  return {
    n,
    mean,
    lo,
    hi,
    pBust: p,
    pBustLo: Float64Array.from(p, (v, i) => Math.max(0, v - pw[i]!)),
    pBustHi: Float64Array.from(p, (v, i) => Math.min(1, v + pw[i]!)),
    pAhead: pa,
    pAheadLo: Float64Array.from(pa, (v, i) => v - pw[i]!),
    pAheadHi: Float64Array.from(pa, (v, i) => v + pw[i]!),
    target: { meanHalfWidth: 1500, pHalfWidth: 0.01 },
    suggested: { forMean: 20000, forBust: 9000 },
    bigEnough: false,
  };
}

function prop(k: number, n: number): Proportion {
  const p = k / n;
  const h = 1.96 * Math.sqrt((p * (1 - p)) / n);
  return { k, n, p, ci: { lo: Math.max(0, p - h), hi: Math.min(1, p + h), level: 0.95 } };
}

/** Only the fields the sweep chart reads are real; the rest is cast away. */
export function sweepFixture(kind: 'linear' | 'categorical' = 'linear'): SweepResult {
  const values =
    kind === 'linear'
      ? [1000, 2500, 5000, 10000, 25000]
      : ['flat', 'martingale', 'fibonacci', 'dalembert'];
  const points = values.map((value, i) => {
    const scale = kind === 'linear' ? (value as number) / 2500 : 1 + i * 0.7;
    const metrics = {
      n: 1000,
      of: 1000,
      net: {
        mean: { value: -14000 * scale },
        q: { p10: -50000 * scale, p90: 18000 * scale },
      },
      probabilities: { bust: prop(Math.min(900, Math.round(20 * scale ** 1.8)), 1000) },
    } as unknown as RunMetrics;
    return { value, runId: `r${i}`, metrics };
  });
  return {
    path: 'strategy.unit',
    points,
    adjacent: [],
    xScale: kind === 'linear' ? 'log' : 'categorical',
  };
}

export function breakdownFixture(): Breakdown {
  const cat = (id: string, wagered: number, net: number, expected: number) => ({
    id,
    wagered,
    net,
    expected,
    realizedEdge: null,
    analyticEdge: null,
  });
  return {
    categories: [
      cat('red-black', 5_200_000, -180_000, 140_000),
      cat('dozens', 2_000_000, 64_000, 54_000),
      cat('straight', 600_000, -22_000, 16_000),
      cat('voisins du zéro', 900_000, -31_000, 24_000),
    ],
    stages: [
      {
        id: 'martingale',
        rounds: 4200,
        roundShare: 0.7,
        wagered: 6_000_000,
        net: -210_000,
        expected: 160_000,
        entries: 900,
        stops: 0,
      },
      {
        id: 'recover',
        rounds: 1800,
        roundShare: 0.3,
        wagered: 2_700_000,
        net: 51_000,
        expected: 74_000,
        entries: 400,
        stops: 12,
      },
    ],
    transitions: [],
    rejected: { total: 0, byReason: {}, sessionsWithRejections: prop(0, 100) },
    deferred: { total: 0, byReason: {} },
    errors: { total: 0, first: [] },
  };
}

export const equityFixture = (): number[] =>
  Array.from(
    { length: 60 },
    (_, i) => 500000 - 3000 * i + Math.round(9000 * Math.sin(i / 3) + 6000 * Math.sin(i * 1.3)),
  );
