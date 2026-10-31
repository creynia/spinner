// Data pipeline for the in-app Research screen (docs/research/app-plan.md §5): reads the research
// results (docs/research/results/*.json), the E5 ladder table (docs/research/briefs/E5.md) and the
// candidate strategy documents (scripts/research/candidates/*.json) and writes the small JSON the
// screen draws, src/app/screens/Research/data.json. Deterministic: same inputs, same bytes.
// Launched through `sim.mjs --app-data`.
//   npm run research:app-data [-- --out <path>]
// The interfaces below mirror src/app/screens/Research/dataTypes.ts (scripts cannot import from
// src/app); data.test.ts checks the generated JSON against the app's copy.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PathPoint, Report } from './run';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const RESULTS = join(ROOT, 'docs/research/results');
const E5 = join(ROOT, 'docs/research/briefs/E5.md');
const CANDIDATES = join(here, 'candidates');
const OUT = join(ROOT, 'src/app/screens/Research/data.json');

/** Size budget of the generated file (app-plan §4), bytes. */
export const BUDGET_BYTES = 150 * 1024;

export interface RowStats {
  file: string;
  id: string;
  sessions: number;
  bankroll: number;
  maxRounds: number;
  mean: number;
  meanCI: [number, number];
  median: number;
  medianCI: [number, number];
  sd: number;
  p10: number;
  p90: number;
  cvar5: number;
  pWin: number;
  pBust: number;
  capRate: number;
  wagerMean: number;
  edgeRealized: number;
  roundsMean: number;
  medianAheadUntil: number | null;
  medianPeak: { round: number; net: number };
}

export interface PathSeries {
  rounds: number[];
  p10: number[];
  /** Dropped first when the file is over budget. */
  p25?: number[];
  p50: number[];
  /** Dropped first when the file is over budget. */
  p75?: number[];
  p90: number[];
  mean: number[];
  ahead: number[];
}

export interface CurvePoint {
  id: string;
  family: string;
  x: number;
  neverCapped: number;
  k: number;
}

export interface Candidate {
  id: string;
  file: string;
  name: string;
  strategy: unknown;
  rules: unknown;
  session: unknown;
  rows: string[];
}

export interface ResearchData {
  generatedFrom: string[];
  rows: Record<string, RowStats>;
  paths: Record<string, PathSeries>;
  curve: CurvePoint[];
  candidates: Candidate[];
}

/** Result files whose every report goes into `rows`, in the order of app-plan §3. */
export const ROW_FILES = [
  'observations',
  'e1-spread',
  'e3a-levels',
  'e3b-lengths',
  'e4-corner',
  'e4-dozen',
  'e4-sixline',
  'e4-straights25',
  'e4-straights35',
  'e4-two-dozens',
  'e6-full',
  'e7-c9',
  'e7-c9-holdout',
  'e7-c9-seed3',
  'e7-mart',
  'e7b-mart-L7stop',
  'e8-american',
  'e8-length',
  'e8-partage',
  'e8-br10k',
  'e8-seed3',
  'e7-a1',
  'e7-b3',
];

/** Result files whose reports also get an equity-path series. */
export const PATH_FILES = [
  'observations',
  'e1-spread',
  'e3a-levels',
  'e6-full',
  'e7-c9',
  'e7-mart',
  'e8-length',
  'e8-seed3',
  'e8-american',
];

/** Ledger rows of each candidate (app-plan §5, "all four seeds" for the no-stop ladders). */
export const CANDIDATE_ROWS: Record<string, string[]> = {
  'c9-streets-to12-stack-cashout.json': [
    'e7-c9:e7-c9-W20-SLhalf',
    'e7-c9-holdout:e7-c9-W20-SLhalf@1',
    'e7-c9-holdout:e7-c9-W20-SLhalf@2',
    'e7-c9-seed3:e7-c9-W20-SLhalf@3',
  ],
  'c9-streets-to12-stack.json': [
    'e6-full:c9-streets-to12-stack@20261031',
    'e6-full:c9-streets-to12-stack@1',
    'e6-full:c9-streets-to12-stack@2',
    'e8-seed3:c9-streets-to12-stack@3',
  ],
  'b3-two-streets-l29.json': [
    'e6-full:b3-two-streets-l29@20261031',
    'e6-full:b3-two-streets-l29@1',
    'e6-full:b3-two-streets-l29@2',
    'e8-seed3:b3-two-streets-l29@3',
  ],
};

/** Table rules the candidates need: a $1 outside minimum and a $1 inside total (cents). */
const CANDIDATE_RULES = {
  preset: 'european',
  overrides: { limits: { outside: { min: 100 }, inside: { minTotal: 100 } } },
};
const CANDIDATE_SESSION = { bankroll: 500000, maxRounds: 500 };

const MAX_POINTS = 60;
const HEAD_ROUNDS = 50;
const HEAD_POINTS = 15;

const int = (v: number): number => Math.round(v);
const dec = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** Always 0 for -0 so the output has no "-0". */
const clean = (v: number): number => (Object.is(v, -0) ? 0 : v);

/** Row statistics of one report; money in integer cents, shares to four decimals. */
export function toRowStats(file: string, r: Report): RowStats {
  let capped = 0;
  for (const [key, n] of Object.entries(r.endedBy)) {
    if (key.startsWith('strategy:cap')) capped += n;
  }
  const ci = (v: [number, number]): [number, number] => [clean(int(v[0])), clean(int(v[1]))];
  return {
    file,
    id: r.id,
    sessions: r.sessions,
    bankroll: r.bankroll,
    maxRounds: r.maxRounds,
    mean: clean(int(r.net.mean)),
    meanCI: ci(r.net.meanCI),
    median: clean(int(r.net.median)),
    medianCI: ci(r.net.medianCI),
    sd: int(r.net.sd),
    p10: clean(int(r.net.q.p10)),
    p90: clean(int(r.net.q.p90)),
    cvar5: clean(int(r.net.cvar5)),
    pWin: dec(r.pWin.p, 4),
    pBust: dec(r.pBust, 4),
    capRate: dec(capped / r.sessions, 4),
    wagerMean: int(r.wagered.mean),
    edgeRealized: clean(dec(r.edge.realized, 5)),
    roundsMean: dec(r.rounds.mean, 1),
    medianAheadUntil: r.medianAheadUntil,
    medianPeak: { round: r.medianPeak.round, net: clean(int(r.medianPeak.net)) },
  };
}

/** `m` indices out of `n`, evenly spaced, always including the first and the last. */
function spread(n: number, m: number): number[] {
  if (n <= m) return Array.from({ length: n }, (_, i) => i);
  if (m <= 1) return [0];
  const out = new Set<number>();
  for (let i = 0; i < m; i += 1) out.add(Math.round((i * (n - 1)) / (m - 1)));
  return [...out].sort((a, b) => a - b);
}

/**
 * Down-sample a path to at most `maxPoints` points: round 0, the points up to round 50 thinned
 * to about 15, the rest thinned evenly, and always the last round.
 */
export function downsample(path: readonly PathPoint[], maxPoints = MAX_POINTS): PathPoint[] {
  if (path.length <= maxPoints) return [...path];
  const head = path.filter((p) => p.round <= HEAD_ROUNDS);
  const tail = path.filter((p) => p.round > HEAD_ROUNDS);
  const headCount = Math.min(HEAD_POINTS, head.length, Math.max(2, Math.floor(maxPoints / 4)));
  const headPicked = spread(head.length, headCount).map((i) => head[i]!);
  const tailPicked = spread(tail.length, maxPoints - headPicked.length).map((i) => tail[i]!);
  return [...headPicked, ...tailPicked];
}

/** Equity-path series of one report; money in integer cents, `ahead` to three decimals. */
export function toPathSeries(r: Report, maxPoints = MAX_POINTS, withQuartiles = true): PathSeries {
  const pts = downsample(r.path, maxPoints);
  const money = (pick: (p: PathPoint) => number): number[] => pts.map((p) => clean(int(pick(p))));
  const series: PathSeries = {
    rounds: pts.map((p) => p.round),
    p10: money((p) => p.p10),
    p50: money((p) => p.p50),
    p90: money((p) => p.p90),
    mean: money((p) => p.mean),
    ahead: pts.map((p) => dec(p.ahead, 3)),
  };
  if (withQuartiles) {
    // Key order: p25 and p75 sit between their neighbours in the written file.
    return {
      rounds: series.rounds,
      p10: series.p10,
      p25: money((p) => p.p25),
      p50: series.p50,
      p75: money((p) => p.p75),
      p90: series.p90,
      mean: series.mean,
      ahead: series.ahead,
    };
  }
  return series;
}

/** Cells of one markdown table line. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * The curve points of the E5 table (section 1, "Every ladder"): id, family, x, never-capped share
 * and k = qB/(1−q). Rows without an x are skipped (recovers: false), and so are the two kinds of
 * row the brief leaves out of its fit of 53 ladders: censored cash-out rows (`d-*`, their share
 * is a stop-win rate, not a 500-spin share) and rows marked "·" (a share already counted by
 * their twin or their full row).
 */
export function parseCurve(markdown: string): CurvePoint[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^##\s+1\.\s+Every ladder/.test(l));
  if (start < 0) throw new Error('E5.md: section "1. Every ladder" not found');
  const out: CurvePoint[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^##\s/.test(line)) break;
    if (!line.startsWith('|')) continue;
    const c = cells(line);
    if (c.length < 9 || c[0] === 'id' || /^:?-+:?$/.test(c[0]!)) continue;
    const [id, family, , , , , kCell, xCell, capCell] = c as [string, string, ...string[]];
    if (xCell === '—' || xCell === undefined || kCell === undefined || capCell === undefined) {
      continue;
    }
    if (id.startsWith('d-') || capCell.includes('·')) continue;
    const x = Number(xCell);
    const k = Number(kCell);
    const neverCapped = Number.parseFloat(capCell);
    if (![x, k, neverCapped].every(Number.isFinite)) {
      throw new Error(`E5.md: cannot parse row "${id}"`);
    }
    out.push({ id, family, x, neverCapped, k });
  }
  return out;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export interface Inputs {
  /** File basename without `.json` -> its reports. */
  results: Record<string, Report[]>;
  e5: string;
  /** File basename (with `.json`) -> candidate strategy document. */
  candidates: Record<string, { id: string; name: string }>;
}

/** How much path detail goes into the file; `SHAPES` lists them from fullest to leanest. */
export interface Shape {
  points: number;
  /** Keep p25/p75. */
  quartiles: boolean;
  /** Keep paths of the e6-full rows on the holdout seeds (1 and 2). */
  extraSeeds: boolean;
}

export const SHAPES: Shape[] = [
  { points: MAX_POINTS, quartiles: true, extraSeeds: true },
  { points: MAX_POINTS, quartiles: false, extraSeeds: true },
  { points: 40, quartiles: false, extraSeeds: true },
  { points: 40, quartiles: false, extraSeeds: false },
  { points: 30, quartiles: false, extraSeeds: false },
];

/** An e6-full row on a holdout seed: its stats are listed, the chapters draw the reporting seed. */
const isExtraSeed = (key: string): boolean => /^e6-full:.*@(1|2)$/.test(key);

/** Pure assembly of the document from the parsed inputs. */
export function build(inputs: Inputs, shape: Shape = SHAPES[0]!): ResearchData {
  const rows: Record<string, RowStats> = {};
  const paths: Record<string, PathSeries> = {};
  for (const file of ROW_FILES) {
    const reports = inputs.results[file];
    if (!reports) throw new Error(`results file missing: ${file}.json`);
    for (const r of reports) {
      const key = `${file}:${r.id}`;
      rows[key] = toRowStats(file, r);
      if (PATH_FILES.includes(file) && (shape.extraSeeds || !isExtraSeed(key))) {
        paths[key] = toPathSeries(r, shape.points, shape.quartiles);
      }
    }
  }
  const sorted = <T>(rec: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const candidates: Candidate[] = Object.keys(inputs.candidates)
    .sort()
    .map((file) => {
      const doc = inputs.candidates[file]!;
      const keys = CANDIDATE_ROWS[file];
      if (!keys) throw new Error(`no ledger rows listed for candidate ${file}`);
      for (const key of keys) {
        if (!(key in rows)) throw new Error(`candidate ${file}: row ${key} not found`);
      }
      return {
        id: doc.id,
        file,
        name: doc.name,
        strategy: doc,
        rules: CANDIDATE_RULES,
        session: CANDIDATE_SESSION,
        rows: keys,
      };
    });
  return {
    generatedFrom: ROW_FILES.map((f) => `${f}.json`).sort(),
    rows: sorted(rows),
    paths: sorted(paths),
    curve: parseCurve(inputs.e5),
    candidates,
  };
}

/** Serialise compactly with a trailing newline. */
export function serialize(data: ResearchData): string {
  return `${JSON.stringify(data)}\n`;
}

/** Build the document and shrink it until it fits the budget (`SHAPES`, fullest first). */
export function buildWithinBudget(inputs: Inputs): { data: ResearchData; bytes: number } {
  let bytes = 0;
  for (const shape of SHAPES) {
    const data = build(inputs, shape);
    bytes = Buffer.byteLength(serialize(data));
    if (bytes <= BUDGET_BYTES) return { data, bytes };
  }
  throw new Error(`data.json is ${bytes} bytes, over the ${BUDGET_BYTES} byte budget`);
}

function loadInputs(): Inputs {
  const results: Record<string, Report[]> = {};
  for (const file of ROW_FILES) results[file] = readJson<Report[]>(join(RESULTS, `${file}.json`));
  const candidates: Inputs['candidates'] = {};
  for (const file of readdirSync(CANDIDATES).filter((f) => f.endsWith('.json'))) {
    candidates[file] = readJson<{ id: string; name: string }>(join(CANDIDATES, file));
  }
  return { results, e5: readFileSync(E5, 'utf8'), candidates };
}

export function main(args: string[]): void {
  let out = OUT;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out') out = resolve(args[(i += 1)] ?? '');
    else throw new Error(`unknown option ${args[i]}`);
  }
  const { data, bytes } = buildWithinBudget(loadInputs());
  writeFileSync(out, serialize(data));
  const points = Object.values(data.paths).reduce((n, p) => n + p.rounds.length, 0);
  console.log(
    `${basename(out)}: ${bytes} bytes, ${Object.keys(data.rows).length} rows, ` +
      `${Object.keys(data.paths).length} paths (${points} points), ${data.curve.length} curve points, ` +
      `${data.candidates.length} candidates`,
  );
}
