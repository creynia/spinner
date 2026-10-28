/** Pure scale, tick and formatting helpers for the SVG charts (architecture.md §7). No DOM. */

export interface Scale {
  (v: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  invert(px: number): number;
}

/** Linear map domain -> range. A zero-width domain maps everything to the range midpoint. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const span = d1 - d0;
  const f = (v: number): number =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0);
  const s = f as unknown as {
    domain: [number, number];
    range: [number, number];
    invert: Scale['invert'];
  };
  s.domain = [d0, d1];
  s.range = [r0, r1];
  s.invert = (px: number) => (r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * span);
  return f as unknown as Scale;
}

/** Base-10 log map; the domain must be positive (values <= 0 clamp to the lower bound). */
export function logScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const a = Math.log10(Math.max(d0, Number.MIN_VALUE));
  const b = Math.log10(Math.max(d1, Number.MIN_VALUE));
  const lin = linearScale(a, b, r0, r1);
  const f = ((v: number) => lin(Math.log10(Math.max(v, d0)))) as unknown as {
    domain: [number, number];
    range: [number, number];
    invert: Scale['invert'];
  };
  f.domain = [d0, d1];
  f.range = [r0, r1];
  f.invert = (px: number) => 10 ** lin.invert(px);
  return f as unknown as Scale;
}

function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const m = raw / base;
  const nice = m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10;
  return nice * base;
}

function clean(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(v.toFixed(Math.min(decimals, 12))) + 0; // + 0 turns -0 into 0
}

/** Round "1-2-5" ticks inside [min, max], roughly `count` of them (at least 2 unless degenerate). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min > max) [min, max] = [max, min];
  if (min === max) return [min];
  const step = niceStep((max - min) / Math.max(1, count));
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(clean(i * step, step));
  return out;
}

/** Domain widened to the nearest tick steps, for axes that should end on a tick. */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    return [min - pad, max + pad];
  }
  const step = niceStep((max - min) / Math.max(1, count));
  return [
    clean(Math.floor(min / step + 1e-9) * step, step),
    clean(Math.ceil(max / step - 1e-9) * step, step),
  ];
}

/** Decade ticks (1, 2, 5 inside when the range is narrow) for a log axis. */
export function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max >= min)) return [];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const mults = hi - lo <= 2 ? [1, 2, 5] : [1];
  const out: number[] = [];
  for (let e = lo; e <= hi; e++)
    for (const m of mults) {
      const v = m * 10 ** e;
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) out.push(v);
    }
  return out;
}

/** How many ticks fit in `px` pixels at `gap` pixels apiece (>= 2). */
export function tickCountFor(px: number, gap: number): number {
  return Math.max(2, Math.floor(px / gap));
}

const UNITS: [number, string][] = [
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k'],
];

/** For a >= 999.5: 1234 -> "1.2k", 999_600 -> "1M" (round first, then pick the unit). */
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

/** Compact money for axis labels: "-$300", "$1.2k", "-$1k", "$1M". Input in cents. */
export function formatAxisMoney(cents: number): string {
  if (!Number.isFinite(cents)) return '\u2013';
  const a = Math.abs(cents / 100);
  let body: string;
  if (a >= 999.5) body = compact(a);
  else if (a >= 10) body = String(Math.round(a));
  else {
    const r = Math.round(a * 100) / 100;
    body = Number.isInteger(r) ? String(r) : r.toFixed(2);
  }
  const zero = body === '0';
  return `${cents < 0 && !zero ? '-' : ''}$${body}`;
}

/** Compact count: 950, 1.2k, 10k, 2.5M. */
export function formatAxisCount(n: number): string {
  if (!Number.isFinite(n)) return '\u2013';
  const a = Math.abs(n);
  const body = a >= 999.5 ? compact(a) : String(Math.round(a));
  return `${n < 0 && body !== '0' ? '-' : ''}${body}`;
}

/** "12%" / "0.4%" / "<0.1%" from a 0..1 share; "\u2013" when not a number. */
export function formatShare(p: number): string {
  if (!Number.isFinite(p)) return '\u2013';
  const pct = p * 100;
  if (pct === 0) return '0%';
  if (Math.abs(pct) < 0.1) return pct < 0 ? '>-0.1%' : '<0.1%';
  if (Math.abs(pct) < 1) return `${Number(pct.toFixed(1))}%`;
  return `${Math.round(pct)}%`;
}

/** Wrap a formatter so non-finite input prints an en dash instead of "$NaN". */
export function finiteOr(fmt: (v: number) => string): (v: number) => string {
  return (v) => (Number.isFinite(v) ? fmt(v) : '\u2013');
}

/** "1 session" / "2 sessions". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : pluralForm}`;
}

/** Whole-number ticks only (counts). */
export function integerTicks(min: number, max: number, count = 4): number[] {
  return niceTicks(min, max, count).filter(Number.isInteger);
}

/** Evenly spread indices 0..n-1, at most `max` of them, always including the last. */
export function downsampleIndices(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n <= max || max < 2) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  const step = (n - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(Math.round(i * step));
  return out;
}

/** Index of the entry of ascending `pxs` nearest to `px`, or null for an empty array. */
export function nearestIndex(pxs: ArrayLike<number>, px: number): number | null {
  const n = pxs.length;
  if (n === 0) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pxs[mid]! < px) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(pxs[lo - 1]! - px) <= Math.abs(pxs[lo]! - px)) lo -= 1;
  return lo;
}

/** Min and max over several arrays, ignoring non-finite values; null when nothing is finite. */
export function extent(...arrays: ArrayLike<number>[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays)
    for (let i = 0; i < a.length; i++) {
      const v = a[i]!;
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  return lo <= hi ? [lo, hi] : null;
}

/** Truncate a label to `max` characters with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}
