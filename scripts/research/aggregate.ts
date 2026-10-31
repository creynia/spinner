// Aggregator for the research loop (docs/research/plan.md E5): one row per report found in
// docs/research/results/*.json (or the paths given), with x = p·S/B from the experiment's `meta`
// block so P(ahead at S) can be compared with e^(−x). Launched through `sim.mjs --aggregate`.
//   npm run research:aggregate [paths...] [--csv | --json]
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Report } from './run';

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS = resolve(here, '../../docs/research/results');

export interface Row {
  file: string;
  id: string;
  sessions: number;
  p: number | null;
  B: number | null;
  S: number;
  x: number | null;
  /** Share of sessions ahead at the last round of the path. */
  pAhead: number | null;
  /** e^(−x). */
  expNegX: number | null;
  median: number;
  mean: number;
  cvar5: number;
  bust: number;
  medianAheadUntil: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Pure row computation for one report; `meta.p` and `meta.B` are optional. */
export function toRow(file: string, r: Report): Row {
  const p = num(r.meta?.p);
  const B = num(r.meta?.B);
  const S = r.maxRounds;
  const x = p !== null && B !== null && B > 0 ? (p * S) / B : null;
  return {
    file,
    id: r.id,
    sessions: r.sessions,
    p,
    B,
    S,
    x,
    pAhead: r.path.length ? r.path[r.path.length - 1]!.ahead : null,
    expNegX: x === null ? null : Math.exp(-x),
    median: r.net.median,
    mean: r.net.mean,
    cvar5: r.net.cvar5,
    bust: r.pBust,
    medianAheadUntil: r.medianAheadUntil,
  };
}

const COLS: [keyof Row, string][] = [
  ['file', 'file'],
  ['id', 'id'],
  ['sessions', 'sessions'],
  ['p', 'p'],
  ['B', 'B'],
  ['S', 'S'],
  ['x', 'x=pS/B'],
  ['pAhead', 'P(ahead@S)'],
  ['expNegX', 'e^-x'],
  ['median', 'median@S'],
  ['mean', 'mean'],
  ['cvar5', 'CVaR5%'],
  ['bust', 'bust'],
  ['medianAheadUntil', 'medAheadUntil'],
];

const money = (c: number): string => {
  const d = c / 100;
  return (d < 0 ? '-$' : '$') + Math.abs(d).toFixed(Math.abs(d) >= 1000 ? 0 : 2);
};
const cell = (k: keyof Row, v: Row[keyof Row]): string => {
  if (v === null) return k === 'medianAheadUntil' ? '-' : '';
  if (typeof v === 'string') return v;
  if (k === 'median' || k === 'mean' || k === 'cvar5') return money(v);
  if (k === 'p' || k === 'x' || k === 'pAhead' || k === 'expNegX') return v.toFixed(4);
  if (k === 'bust') return `${(100 * v).toFixed(1)}%`;
  return String(v);
};

export function formatTable(rows: Row[]): string {
  const cells = rows.map((r) => COLS.map(([k]) => cell(k, r[k])));
  const head = COLS.map(([, h]) => h);
  const w = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]!.length)));
  const line = (c: string[]) =>
    c
      .map((s, i) => s.padEnd(w[i]!))
      .join('  ')
      .trimEnd();
  return [line(head), ...cells.map(line)].join('\n');
}

export function formatCsv(rows: Row[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const raw = (v: Row[keyof Row]) => (v === null ? '' : String(v));
  return [
    COLS.map(([k]) => k).join(','),
    ...rows.map((r) => COLS.map(([k]) => esc(raw(r[k]))).join(',')),
  ].join('\n');
}

export function rowsOf(paths: string[]): Row[] {
  const rows: Row[] = [];
  for (const f of paths) {
    const reports = JSON.parse(readFileSync(f, 'utf8')) as Report[];
    for (const r of Array.isArray(reports) ? reports : [reports]) rows.push(toRow(basename(f), r));
  }
  return rows;
}

export function main(argv: string[]): void {
  const flags = argv.filter((a) => a.startsWith('--'));
  const paths = argv.filter((a) => !a.startsWith('--')).map((a) => resolve(a));
  const bad = flags.filter((f) => f !== '--csv' && f !== '--json');
  if (bad.length || (flags.includes('--csv') && flags.includes('--json'))) {
    console.error('usage: npm run research:aggregate [paths...] [--csv | --json]');
    process.exit(2);
  }
  const files = paths.length
    ? paths
    : readdirSync(RESULTS)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => join(RESULTS, f));
  const rows = rowsOf(files);
  if (flags.includes('--json')) console.log(JSON.stringify(rows, null, 1));
  else if (flags.includes('--csv')) console.log(formatCsv(rows));
  else console.log(formatTable(rows));
}
