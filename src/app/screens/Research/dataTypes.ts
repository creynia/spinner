// Shape of data.json (docs/research/app-plan.md §5), written by scripts/research/app-data.ts.
// Types only, no imports: the script keeps its own copy and data.test.ts checks the JSON against this one.

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
  /** Share of sessions that ended on the strategy's cap (`strategy:cap-*`). */
  capRate: number;
  wagerMean: number;
  edgeRealized: number;
  roundsMean: number;
  medianAheadUntil: number | null;
  medianPeak: { round: number; net: number };
}

/** Equity-path quantiles of the net (cents) at `rounds`; p25 and p75 are dropped when the file is over budget. */
export interface PathSeries {
  rounds: number[];
  p10: number[];
  p25?: number[];
  p50: number[];
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
  /** Result files used. */
  generatedFrom: string[];
  /** Key: "<file>:<id>". */
  rows: Record<string, RowStats>;
  /** Same keys as `rows`, only for the rows a chart draws. */
  paths: Record<string, PathSeries>;
  curve: CurvePoint[];
  candidates: Candidate[];
}
