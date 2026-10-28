/** One-sentence-ish text summaries computed from chart data (screen readers and the caption). */
import type { Convergence, FanChart, Histogram, Survival } from '../../../contracts/analysis';
import { finiteOr, formatShare, plural } from './scale';
import { binInfo } from './shapes';

export interface HistLike {
  lo: number;
  width: number;
  counts: ArrayLike<number>;
}
export type MoneyFmt = (cents: number) => string;

export function totalCount(counts: ArrayLike<number>): number {
  let t = 0;
  for (let i = 0; i < counts.length; i++) t += counts[i]!;
  return t;
}

/** Bin range holding the cumulative `q` share (bin granularity). */
export function histogramQuantileBin(h: HistLike, q: number): number {
  const total = totalCount(h.counts);
  let acc = 0;
  for (let i = 0; i < h.counts.length; i++) {
    acc += h.counts[i]!;
    if (acc >= total * q) return i;
  }
  return Math.max(0, h.counts.length - 1);
}

export function modalBin(h: HistLike): number {
  let best = 0;
  for (let i = 1; i < h.counts.length; i++) if (h.counts[i]! > h.counts[best]!) best = i;
  return best;
}

/** Share of sessions in bins lying entirely at or below `value`. */
export function shareBelow(h: HistLike, value: number): number {
  const total = totalCount(h.counts);
  if (total === 0) return 0;
  let acc = 0;
  for (let i = 0; i < h.counts.length; i++)
    if (h.lo + (i + 1) * h.width <= value + 1e-9) acc += h.counts[i]!;
  return acc / total;
}

export function histogramSummary(h: Histogram, fmt: MoneyFmt, noun = 'sessions'): string {
  const total = totalCount(h.counts);
  if (total === 0 || h.counts.length === 0) return `No ${noun} to show yet.`;
  const one = noun.replace(/s$/, '');
  const m = binInfo(h, modalBin(h));
  const med = binInfo(h, histogramQuantileBin(h, 0.5));
  const xMin = h.lo;
  const xMax = h.lo + h.counts.length * h.width;
  const parts = [
    `${plural(total, one, noun)} in ${plural(h.counts.length, 'bin')}.`,
    `The tallest bin runs ${fmt(m.lo)} to ${fmt(m.hi)} (${formatShare(m.count / total)} of ${noun}).`,
    `The middle ${one} falls in ${fmt(med.lo)} to ${fmt(med.hi)}.`,
  ];
  const z = h.markers.zero;
  if (z !== undefined) {
    if (z >= xMax)
      parts.push(`All ${noun} ended below the zero line (${fmt(z)}); it is beyond the right edge.`);
    else if (z <= xMin)
      parts.push(`All ${noun} ended above the zero line (${fmt(z)}); it is beyond the left edge.`);
    else
      parts.push(
        `About ${formatShare(shareBelow(h, z))} of ${noun} end below the zero line (${fmt(z)}).`,
      );
  }
  const e = h.markers.expected;
  if (e !== undefined)
    parts.push(
      e < xMin || e > xMax
        ? `The expected net line (${fmt(e)}) lies outside the plotted range.`
        : `The expected net line is at ${fmt(e)}.`,
    );
  return parts.join(' ');
}

export function fanSummary(fan: FanChart, fmt: MoneyFmt): string {
  const n = fan.rounds.length;
  if (n === 0) return 'No checkpoints to show yet.';
  const l = n - 1;
  return (
    `After ${plural(fan.rounds[l]!, 'round')} the median session is at ${fmt(fan.p50[l]!)}; ` +
    `90% of sessions are between ${fmt(fan.p5[l]!)} and ${fmt(fan.p95[l]!)}, and the middle half between ` +
    `${fmt(fan.p25[l]!)} and ${fmt(fan.p75[l]!)}. The expected path ends at ${fmt(fan.expected[l]!)}.`
  );
}

export function survivalSummary(s: Survival): string {
  const last = s.alive.length - 1;
  if (last < 0) return 'No survival data yet.';
  const parts = [
    `${formatShare(s.alive[last]!)} of sessions are still playing at round ${s.maxRounds.toLocaleString('en-US')}.`,
    s.medianRounds === null
      ? 'More than half of sessions are still playing at the end.'
      : `Half of sessions have ended by round ${s.medianRounds.toLocaleString('en-US')}.`,
  ];
  const labels: Record<string, string> = {
    bust: 'bust',
    'stop-win': 'stop-win',
    'stop-loss': 'stop-loss',
    strategy: 'strategy stop',
    error: 'error',
    rounds: 'round limit',
  };
  const ends = Object.entries(s.incidence)
    .filter(([, a]) => a && a.length > 0)
    .map(([k, a]) => `${labels[k] ?? k} ${formatShare(a[a.length - 1]!)}`);
  if (ends.length) parts.push(`By the end: ${ends.join(', ')}.`);
  return parts.join(' ');
}

export type ConvergenceMetric = 'mean' | 'bust' | 'ahead';
export function convergenceSummary(
  c: Convergence,
  metric: ConvergenceMetric,
  fmt: MoneyFmt,
): string {
  const l = c.n.length - 1;
  if (l < 0) return 'No sessions yet.';
  const pick = {
    mean: [c.mean, c.lo, c.hi],
    bust: [c.pBust, c.pBustLo, c.pBustHi],
    ahead: [c.pAhead, c.pAheadLo, c.pAheadHi],
  }[metric];
  const f = finiteOr((v: number): string => (metric === 'mean' ? fmt(v) : formatShare(v)));
  const name = metric === 'mean' ? 'mean net' : metric === 'bust' ? 'P(bust)' : 'P(ahead)';
  const lo = pick[1]![l]!;
  const hi = pick[2]![l]!;
  const after = `After ${plural(c.n[l]!, 'session')} the ${name} is ${f(pick[0]![l]!)}`;
  if (!Number.isFinite(lo) || !Number.isFinite(hi))
    return `${after}. The interval is not available below 30 sessions.`;
  const half = (hi - lo) / 2;
  const tail =
    metric === 'mean'
      ? c.bigEnough
        ? 'The run is big enough for the target precision.'
        : `About ${c.suggested.forMean.toLocaleString('en-US')} sessions would reach the target precision.`
      : metric === 'bust' && !c.bigEnough
        ? `About ${c.suggested.forBust.toLocaleString('en-US')} sessions would reach the target precision.`
        : '';
  return `${after} (95% interval ${f(lo)} to ${f(hi)}, half-width ${f(half)}). ${tail}`.trim();
}
