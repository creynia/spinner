// Chapter 4: for each placement, how long the typical session stays ahead with the right growth
// factor, with doubling, and the horizon the formula predicts (n½ = ln 2 / (q·p), from the row's meta).
import type { JSX } from 'preact';
import { DotRows, type DotRow, type DotSeries } from './DotRows';
import type { Chapter } from './content';
import { row } from './data';
import { spins } from './kit';

interface Placement {
  id: string;
  label: string;
  /** keys of the right-factor row (with the stop at the cap) and the doubling row */
  right: string;
  doubling: string;
}

const standard = (p: string, label: string): Placement => ({
  id: p,
  label,
  right: `e4-${p}:e4-${p}-g-stop`,
  doubling: `e4-${p}:e4-${p}-x2`,
});

export const PLACEMENTS: readonly Placement[] = [
  standard('dozen', 'Dozen'),
  {
    id: 'dozen-u5',
    label: 'Dozen, $5 base',
    right: 'e4-dozen:e4-dozen-g-u5-stop',
    doubling: 'e4-dozen:e4-dozen-x2-u5',
  },
  standard('two-dozens', 'Two dozens'),
  standard('sixline', 'Six-line'),
  standard('corner', 'Corner'),
  standard('straights25', '25 numbers'),
  standard('straights35', '35 numbers'),
];

const SERIES: DotSeries[] = [
  { id: 'right', label: 'Right growth factor', shape: 'circle', color: 1 },
  { id: 'doubling', label: 'Doubling', shape: 'square', color: 2 },
  { id: 'predicted', label: 'Predicted n½', shape: 'tick', color: 1 },
];

/** The spin at which the formula says half the sessions have lost the ladder: ln 2 / (q·p). */
export function predictedHalfLife(meta: Record<string, number> | null): number | null {
  if (!meta || !(meta.q! > 0) || !(meta.p! > 0)) return null;
  const n = Math.LN2 / (meta.q! * meta.p!);
  return Number.isFinite(n) ? n : null;
}

const ahead = (v: number | null): string => (v === null ? 'never' : v >= 500 ? '500+' : spins(v));
const factor = (g: number | undefined): string =>
  g === undefined ? '-' : `×${Number(g.toFixed(2))}`;

export function ChPlacement(_props: { chapter: Chapter }): JSX.Element {
  const items = PLACEMENTS.map((p) => {
    const right = row(p.right);
    const dbl = row(p.doubling);
    return {
      p,
      right,
      dbl,
      n: predictedHalfLife(right.meta),
    };
  });
  const rows: DotRow[] = items.map(({ p, right, dbl, n }) => ({
    id: p.id,
    label: p.label,
    values: { right: right.medianAheadUntil, doubling: dbl.medianAheadUntil, predicted: n },
  }));
  const atLeast = items.filter(
    (i) => (i.right.medianAheadUntil ?? 0) >= (i.dbl.medianAheadUntil ?? 0),
  ).length;
  const dozen = items[0]!;
  const summary =
    `On a dozen the typical session stays ahead until spin ${ahead(dozen.right.medianAheadUntil)} ` +
    `with the right growth factor (${factor(dozen.right.meta?.g)}) and ${ahead(dozen.dbl.medianAheadUntil)} ` +
    `with doubling. The right factor lasts at least as long as doubling in ${atLeast} of ${items.length} rows; ` +
    `each tick marks the horizon the formula predicts.`;

  return (
    <DotRows
      title="How long the typical session stays ahead, by placement"
      summary={summary}
      series={SERIES}
      rows={rows}
      domain={[0, 500]}
      clampAt={500}
      fmt={(v) => spins(Math.round(v))}
      axisFmt={(v) => String(v)}
      axisLabel="Spins the typical session stays ahead"
      table={{
        caption: 'Spins the typical session stays ahead, by placement',
        columns: [
          'Placement',
          'Growth factor',
          'Right factor (spins ahead)',
          'Doubling (spins ahead)',
          'Predicted n½ (spins)',
        ],
        rows: items.map(({ p, right, dbl, n }) => [
          p.label,
          factor(right.meta?.g),
          ahead(right.medianAheadUntil),
          ahead(dbl.medianAheadUntil),
          n === null ? '-' : spins(Math.round(n)),
        ]),
      }}
    />
  );
}
