// Chapter 5: the share of sessions that never lost the ladder against x = p·S/B for every ladder in
// data.curve, in four groups, under the ceiling e^(−x). The sharper form e^(−k·x) (D6) is in the summary.
import type { JSX } from 'preact';
import type { Chapter } from './content';
import { data } from './data';
import { pct1 } from './kit';
import { Scatter, curveGroup, type ScatterGroup } from './Scatter';
import './chapters-4-6.css';

export const CURVE_GROUPS: ScatterGroup[] = [
  { id: 'e3', label: 'Martingale on red', shape: 'circle', color: 2 },
  { id: 'e4-out', label: 'Outside bets', shape: 'square', color: 3 },
  { id: 'e4-in', label: 'Inside bets', shape: 'triangle', color: 4 },
  { id: 'e6', label: 'Shapes (widen, stack, mix)', shape: 'diamond', color: 5 },
];

const X_MAX = 2.5;
const ceiling = (x: number): number => Math.exp(-x);

/** Plain-words name of a curve point's group. */
const groupLabel = (family: string): string =>
  CURVE_GROUPS.find((g) => g.id === curveGroup(family))?.label ?? '';

export function ChCurve(_props: { chapter: Chapter }): JSX.Element {
  const all = data.curve;
  const shown = all.filter((c) => c.x <= X_MAX);
  const hidden = all.length - shown.length;
  const below = all.filter((c) => c.neverCapped <= ceiling(c.x) + 0.005).length;
  const rms = Math.sqrt(
    all.reduce((s, c) => s + (c.neverCapped - Math.exp(-c.k * c.x)) ** 2, 0) / all.length,
  );
  const hiddenTop = Math.max(0, ...all.filter((c) => c.x > X_MAX).map((c) => c.neverCapped));
  const summary =
    `${all.length} ladders: ${shown.length} are drawn, and ${hidden} with x above ${X_MAX} ` +
    `(none above ${pct1(hiddenTop)}) are in the table only. ` +
    `${below} of ${all.length} sit on or under the ceiling e^(−x). The sharper form e^(−k·x), ` +
    `with k from the table, misses the measured share by ${(rms * 100).toFixed(1)} points (root mean square).`;

  return (
    <Scatter
      title="Share of sessions that never lost the ladder, by ladder"
      summary={summary}
      points={shown.map((c) => ({
        id: c.id,
        x: c.x,
        y: c.neverCapped,
        group: curveGroup(c.family),
      }))}
      groups={CURVE_GROUPS}
      xDomain={[0, X_MAX]}
      yDomain={[0, 1]}
      xTicks={[0, 0.5, 1, 1.5, 2, 2.5]}
      yTicks={[0, 0.25, 0.5, 0.75, 1]}
      curve={{ label: 'e^(−x): the ceiling', f: ceiling, labelAt: 1.2 }}
      xLabel="Session length ÷ ladder cost (x)"
      yLabel="Share never capped"
      xFmt={(v) => v.toFixed(2)}
      yFmt={(v) => `${Math.round(v * 100)}%`}
      table={{
        caption: 'Never-capped share by ladder',
        columns: ['Ladder', 'Group', 'x', 'Never capped', 'e^(−x)', 'k'],
        rows: all.map((c) => [
          c.id,
          groupLabel(c.family),
          c.x.toFixed(2),
          pct1(c.neverCapped),
          pct1(ceiling(c.x)),
          c.k.toFixed(2),
        ]),
      }}
    />
  );
}
