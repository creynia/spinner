/** Pure geometry: input arrays + scales -> SVG path strings and rect lists. No DOM. */
import type { FanChart } from '../../../contracts/analysis';
import type { Scale } from './scale';

const r = (v: number): number => Math.round(v * 10) / 10;

/** "M x y L x y …"; non-finite points break the line into several subpaths. */
export function linePath(xs: ArrayLike<number>, ys: ArrayLike<number>): string {
  let d = '';
  let pen = false;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${r(x)} ${r(y)}`;
    pen = true;
  }
  return d;
}

/**
 * Closed band between `lo` (forward) and `hi` (back), all in pixels. Non-finite points split the
 * band into one polygon per run of points where x, lo and hi are all finite; empty if none.
 */
export function bandPath(
  xs: ArrayLike<number>,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
): string {
  const n = Math.min(xs.length, lo.length, hi.length);
  let d = '';
  let start = -1;
  const flush = (end: number): void => {
    if (start < 0) return;
    for (let i = start; i < end; i++) d += `${i === start ? 'M' : 'L'}${r(xs[i]!)} ${r(lo[i]!)}`;
    for (let i = end - 1; i >= start; i--) d += `L${r(xs[i]!)} ${r(hi[i]!)}`;
    d += 'Z';
    start = -1;
  };
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(xs[i]!) && Number.isFinite(lo[i]!) && Number.isFinite(hi[i]!)) {
      if (start < 0) start = i;
    } else flush(i);
  }
  flush(n);
  return d;
}

/** Step-after path (survival): holds each y until the next x. */
export function stepPath(xs: ArrayLike<number>, ys: ArrayLike<number>): string {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return '';
  let d = `M${r(xs[0]!)} ${r(ys[0]!)}`;
  for (let i = 1; i < n; i++) d += `H${r(xs[i]!)}V${r(ys[i]!)}`;
  return d;
}

export interface Rect {
  i: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
}

export interface BinInfo {
  i: number;
  lo: number;
  hi: number;
  count: number;
}
export function binInfo(
  h: { lo: number; width: number; counts: ArrayLike<number> },
  i: number,
): BinInfo {
  return { i, lo: h.lo + i * h.width, hi: h.lo + (i + 1) * h.width, count: h.counts[i] ?? 0 };
}

/** One rect per non-empty bin, with a 1 px gap between neighbours (never negative width). */
export function histogramRects(
  h: { lo: number; width: number; counts: ArrayLike<number> },
  x: Scale,
  y: Scale,
): Rect[] {
  const out: Rect[] = [];
  const base = y(0);
  for (let i = 0; i < h.counts.length; i++) {
    const c = h.counts[i]!;
    if (c <= 0) continue;
    const x0 = x(h.lo + i * h.width);
    const x1 = x(h.lo + (i + 1) * h.width);
    const top = y(c);
    out.push({
      i,
      x: r(x0),
      y: r(top),
      w: r(Math.max(1, x1 - x0 - 1)),
      h: r(Math.max(0, base - top)),
      value: c,
    });
  }
  return out;
}

/** Outline of a histogram as one step path (for overlays); empty bins draw along the baseline. */
export function histogramOutline(
  h: { lo: number; width: number; counts: ArrayLike<number> },
  x: Scale,
  y: Scale,
): string {
  const n = h.counts.length;
  if (n === 0) return '';
  let d = `M${r(x(h.lo))} ${r(y(0))}`;
  for (let i = 0; i < n; i++) {
    d += `V${r(y(h.counts[i]!))}H${r(x(h.lo + (i + 1) * h.width))}`;
  }
  return `${d}V${r(y(0))}`;
}

export interface FanPaths {
  outer: string;
  inner: string;
  median: string;
  expected: string;
  mean: string;
  xs: number[];
}
/** All paths of a fan chart; `idx` selects checkpoints (downsampling), default all. */
export function fanPaths(fan: FanChart, x: Scale, y: Scale, idx?: number[]): FanPaths {
  const ix = idx ?? Array.from({ length: fan.rounds.length }, (_, i) => i);
  const xs = ix.map((i) => x(fan.rounds[i]!));
  const col = (a: ArrayLike<number>): number[] => ix.map((i) => y(a[i]!));
  return {
    xs,
    outer: bandPath(xs, col(fan.p5), col(fan.p95)),
    inner: bandPath(xs, col(fan.p25), col(fan.p75)),
    median: linePath(xs, col(fan.p50)),
    expected: linePath(xs, col(fan.expected)),
    mean: linePath(xs, col(fan.mean)),
  };
}

/** Rects for a bar chart. Horizontal bars grow along x from the zero line; vertical along y. */
export function barRects(
  values: ArrayLike<number>,
  valueScale: Scale,
  opts: { orientation: 'horizontal' | 'vertical'; start: number; size: number; gap?: number },
): Rect[] {
  const n = values.length;
  const gap = opts.gap ?? 8;
  const band = n > 0 ? opts.size / n : 0;
  const thick = Math.max(2, band - gap);
  const zero = valueScale(0);
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    const p = valueScale(v);
    const lo = Math.min(zero, p);
    const len = Math.abs(p - zero);
    const off = opts.start + i * band + (band - thick) / 2;
    out.push(
      opts.orientation === 'horizontal'
        ? { i, x: r(lo), y: r(off), w: r(len), h: r(thick), value: v }
        : { i, x: r(off), y: r(lo), w: r(thick), h: r(len), value: v },
    );
  }
  return out;
}
