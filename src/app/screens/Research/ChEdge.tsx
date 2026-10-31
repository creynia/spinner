// Chapter 1, Every dollar costs the same: the three E1 layouts as dots on a range. The range is the
// middle 80 % of sessions (p10 to p90), the circle the typical session, the diamond the average.
import { DotRows, type DotRow } from './DotRows';
import type { Chapter } from './content';
import { row } from './data';
import { axisMoney, money } from './kit';

const BETS = [
  { id: 'red', label: 'Red', key: 'e1-spread:e1-red' },
  { id: 'red-dozen', label: 'Red + a dozen', key: 'e1-spread:e1-red12-dozen3-13' },
  { id: 'straights', label: '25 numbers', key: 'e1-spread:e1-straights25' },
] as const;

export function ChEdge(_props: { chapter: Chapter }) {
  const stats = BETS.map((b) => ({ b, r: row(b.key) }));
  const rows: DotRow[] = stats.map(({ b, r }) => ({
    id: b.id,
    label: b.label,
    range: [r.p10, r.p90],
    values: { median: r.median, mean: r.mean },
  }));
  const means = stats.map(({ r }) => r.mean);
  const first = stats[0]!;
  const last = stats[stats.length - 1]!;
  const summary =
    `All three bets lose about the same on average (${money(Math.max(...means))} to ${money(Math.min(...means))}), ` +
    `but the middle 80 % of sessions runs from ${money(first.r.p10)} to ${money(first.r.p90)} on ${first.b.label.toLowerCase()} ` +
    `and from ${money(last.r.p10)} to ${money(last.r.p90)} on ${last.b.label}.`;
  return (
    <DotRows
      title="Result after 500 spins"
      summary={summary}
      series={[
        { id: 'median', label: 'Typical session', shape: 'circle', color: 1 },
        { id: 'mean', label: 'Average', shape: 'diamond', color: 2 },
      ]}
      rows={rows}
      zeroLine="Break-even"
      fmt={money}
      axisFmt={axisMoney}
      axisLabel="Result after 500 spins"
      rangeLabel="Middle 80 % of sessions"
      table={{
        columns: ['Bet', 'Average', 'Typical', '10th pct', '90th pct', 'SD'],
        rows: stats.map(({ b, r }) => [
          b.label,
          money(r.mean),
          money(r.median),
          money(r.p10),
          money(r.p90),
          money(r.sd),
        ]),
      }}
    />
  );
}
