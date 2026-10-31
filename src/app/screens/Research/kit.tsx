// Shared helpers of the Research screen. `@core/ui` exports ChartFrame, ChartSvg, DataTable and
// Legend (use those from there) but not the chart internals (useElementWidth, scales, ticks,
// axis formats, seriesColor), and the lint boundary forbids importing `@core/ui/charts`. The
// small pure helpers below mirror `charts/hooks.ts` and `charts/geom/scale.ts` behaviour.
import type { ComponentChildren, JSX, Ref } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { formatMoney } from '@core';

// ---------------------------------------------------------------- measuring

/** Measures the container width (ResizeObserver) so SVG charts lay out at real pixels. */
export function useWidth(fallback = 640): { ref: Ref<HTMLDivElement>; width: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = (): void => {
      const w = el.clientWidth;
      if (w > 0) setWidth(Math.max(240, Math.round(w)));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return { ref, width };
}

/** Chart height for a measured width: clamp(220, 0.52 x width, 380). */
export const chartHeight = (width: number): number =>
  Math.round(Math.min(380, Math.max(220, width * 0.52)));

// ---------------------------------------------------------------- scales

/** Linear map domain -> range; a zero-width domain maps everything to the range midpoint. */
export function scaleLinear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  return (v) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0));
}

function niceStep(raw: number): number {
  const base = 10 ** Math.floor(Math.log10(raw));
  const m = raw / base;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * base;
}

function clean(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(v.toFixed(Math.min(decimals, 12))) + 0; // + 0 turns -0 into 0
}

/** Round "1-2-5" ticks inside [lo, hi], roughly `n` of them. */
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) return [lo];
  const step = niceStep((hi - lo) / Math.max(1, n));
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(clean(i * step, step));
  return out;
}

/** The domain widened to the nearest tick steps, so an axis can end on a tick. */
export function niceDomain(lo: number, hi: number, n = 5): [number, number] {
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    return [lo - pad, hi + pad];
  }
  const step = niceStep((hi - lo) / Math.max(1, n));
  return [
    clean(Math.floor(lo / step + 1e-9) * step, step),
    clean(Math.ceil(hi / step - 1e-9) * step, step),
  ];
}

/** How many ticks fit in `px` pixels at `gap` pixels apiece (at least 2). */
export const tickCountFor = (px: number, gap: number): number => Math.max(2, Math.floor(px / gap));

// ---------------------------------------------------------------- colours

/** Series colour `n` (1 to 6, `--chart-1` to `--chart-6`). The tokens exist inside `.sp-chart`. */
export const seriesColor = (n: number): string =>
  `var(--chart-${((((Math.round(n) - 1) % 6) + 6) % 6) + 1})`;

// ---------------------------------------------------------------- formats

/** "90.3%" from 0.9031. */
export const pct1 = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** Net amounts: "+$286", "-$46", "$0.00" (integer cents in; formatMoney shows cents under $1). */
export const money = (cents: number): string => formatMoney(cents, { sign: true });

/** Spin counts: "1,117". */
export const spins = (n: number): string => n.toLocaleString('en-US');

const UNITS: [number, string][] = [
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k'],
];

function compact(a: number): string {
  for (let i = 0; i < UNITS.length; i++) {
    const [size, suffix] = UNITS[i]!;
    if (a < size * 0.9995) continue;
    const x = a / size;
    const rounded = Number(x.toFixed(x >= 10 ? 0 : 1));
    if (rounded >= 1000 && i > 0)
      return `${Number((a / UNITS[i - 1]![0]).toFixed(1))}${UNITS[i - 1]![1]}`;
    return `${rounded}${suffix}`;
  }
  return String(Math.round(a));
}

/** Compact money for axis labels (cents in): "$0", "$500", "$1.5k", "-$5k". */
export function axisMoney(cents: number): string {
  if (!Number.isFinite(cents)) return '–';
  const a = Math.abs(cents / 100);
  let body: string;
  if (a >= 999.5) body = compact(a);
  else if (a >= 10) body = String(Math.round(a));
  else {
    const r = Math.round(a * 100) / 100;
    body = Number.isInteger(r) ? String(r) : r.toFixed(2);
  }
  return `${cents < 0 && body !== '0' ? '-' : ''}$${body}`;
}

// ---------------------------------------------------------------- math text

/** The end index (exclusive) of the script that starts at `i` (just after ^ or _), or -1. */
function scriptEnd(s: string, i: number): number {
  if (s[i] === '(') {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '(') depth++;
      else if (s[j] === ')' && --depth === 0) return j + 1;
    }
    return -1;
  }
  const m = /^-?[A-Za-z0-9]+/.exec(s.slice(i));
  return m ? i + m[0].length : -1;
}

/** `text` as nodes: `^x` / `^(...)` become sup, `_x` / `_(...)` become sub, the rest stays text. */
export function mathNodes(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '^' || c === '_') {
      const end = scriptEnd(text, i + 1);
      if (end > 0) {
        const raw = text.slice(i + 1, end);
        const inner = raw.startsWith('(') ? raw.slice(1, -1) : raw;
        if (plain) out.push(plain);
        plain = '';
        out.push(c === '^' ? <sup>{inner}</sup> : <sub>{inner}</sub>);
        i = end;
        continue;
      }
    }
    plain += c;
    i++;
  }
  if (plain) out.push(plain);
  return out;
}

/** Renders math prose or a formula without innerHTML: the only markup is sup and sub. */
export function MathText({ text }: { text: string }): JSX.Element {
  return <>{mathNodes(text)}</>;
}

// ---------------------------------------------------------------- tables

/** Scrolling, focusable region for a visible table (the `DataTable` pattern, own scroll box). */
export function TableWrap({
  label,
  children,
}: {
  /** accessible name of the region, e.g. "Typical and average session by strategy" */
  label: string;
  /** the `<table class="research-table">` */
  children: ComponentChildren;
}): JSX.Element {
  return (
    <div class="research-tablewrap" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- jumping

/** True when the reader asked for less motion. */
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scrolls chapter `id` (or, for `'top'`, the page heading) into view. With `focus` the chapter's h2
 * (the h1 for 'top') takes focus without a second scroll. Never touches the URL or remounts.
 */
export function jumpTo(id: string, opts: { focus: boolean }): void {
  const top = id === 'top';
  const section = document.getElementById(top ? 'research-top' : `chapter-${id}`);
  if (!section) return;
  section.scrollIntoView?.({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (!opts.focus) return;
  const heading = top ? section : document.getElementById(`chapter-${id}-h`);
  heading?.focus({ preventScroll: true });
}
