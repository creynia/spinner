import type { RunData } from '../contracts/run';
import { ENDED_BY, ENDED_BY_STRATEGY_BASE } from '../contracts/run';
import { formatDollarsExact } from '../money';

const NAMES = Object.fromEntries(Object.entries(ENDED_BY).map(([k, v]) => [v, k])) as Record<
  number,
  string
>;

function cell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Float money (expected loss, sd): dollars with 4 decimals. */
const money4 = (cents: number): string => (cents / 100).toFixed(4);

/**
 * `<slug>-<runId8>.summaries.csv` (harness-data-analysis.md §10.3): RFC 4180, UTF-8 without BOM,
 * CRLF, a header row. Integer cents become exact dollars (`-12.50`, never through floats).
 * `adjusted` and `anomalies` (reconciliation R4) follow `deferred`.
 */
export function summariesCsv(data: RunData): string {
  const { summary: s, meta } = data;
  const { stages, categories, reasons } = meta.labels;
  const S = stages.length;
  const C = categories.length;
  const header = [
    'session',
    'final',
    'net',
    'peak',
    'trough',
    'max_drawdown',
    'rounds_played',
    'rounds_wagered',
    'wagered',
    'expected_loss',
    'sd',
    'luck_z',
    'ended_by',
    'stop_stage',
    'rejected',
    'deferred',
    'adjusted',
    'anomalies',
    'max_exposure',
    ...stages.map((x) => `rounds_in:${x}`),
    ...categories.map((x) => `wagered:${x}`),
    ...categories.map((x) => `net:${x}`),
  ].map(cell);
  const lines = [header.join(',')];
  for (let i = 0; i < data.sessions; i++) {
    const v = s.variance[i] as number;
    const e = s.expectedLoss[i] as number;
    const net = s.net[i] as number;
    const eb = s.endedBy[i] as number;
    const endedBy =
      eb >= ENDED_BY_STRATEGY_BASE
        ? `strategy:${reasons[eb - ENDED_BY_STRATEGY_BASE] ?? eb}`
        : (NAMES[eb] ?? String(eb));
    const row: string[] = [
      String(i),
      formatDollarsExact(s.final[i] as number),
      formatDollarsExact(net),
      formatDollarsExact(s.peak[i] as number),
      formatDollarsExact(s.trough[i] as number),
      formatDollarsExact(s.maxDrawdown[i] as number),
      String(s.roundsPlayed[i]),
      String(s.roundsWagered[i]),
      formatDollarsExact(s.wagered[i] as number),
      money4(e),
      money4(Math.sqrt(v)),
      v > 0 ? ((net + e) / Math.sqrt(v)).toFixed(4) : '',
      cell(endedBy),
      cell(stages[s.stopStage[i] as number] ?? String(s.stopStage[i])),
      String(s.rejected[i]),
      String(s.deferred[i]),
      String(s.adjusted[i]),
      String(s.anomalies[i]),
      formatDollarsExact(s.maxExposure[i] as number),
    ];
    for (let j = 0; j < S; j++) row.push(String(s.stageRounds[i * S + j]));
    for (let j = 0; j < C; j++) row.push(formatDollarsExact(s.catWagered[i * C + j] as number));
    for (let j = 0; j < C; j++) row.push(formatDollarsExact(s.catNet[i * C + j] as number));
    lines.push(row.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
