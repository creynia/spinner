import type { JSX } from 'preact';
import type { Survival } from '../../contracts/analysis';
import { chartHeight, plotBox, XAxis, YAxis } from './Axes';
import { ChartFrame, ChartSvg, dashFor, seriesColor } from './ChartFrame';
import type { LegendItem, TooltipSpec } from './ChartFrame';
import {
  downsampleIndices,
  formatAxisCount,
  formatShare,
  linearScale,
  nearestIndex,
  niceTicks,
  tickCountFor,
} from './geom/scale';
import { stepPath } from './geom/shapes';
import { survivalSummary } from './geom/summary';
import { useCursor, useElementWidth } from './hooks';

export interface SurvivalChartProps {
  survival: Survival;
  title: string;
  /** also draw the cumulative share ended for each reason (dashed) */
  showIncidence?: boolean;
}

const REASON_LABEL: Record<string, string> = {
  bust: 'Ended: bust',
  'stop-win': 'Ended: stop-win',
  'stop-loss': 'Ended: stop-loss',
  strategy: 'Ended: strategy stop',
  error: 'Ended: error',
  rounds: 'Ended: round limit',
};

export function SurvivalChart({
  survival: s,
  title,
  showIncidence = true,
}: SurvivalChartProps): JSX.Element {
  const { ref, width } = useElementWidth();
  const height = chartHeight(width);
  const box = plotBox(width, height, 4);
  const len = s.alive.length;
  const maxR = Math.max(1, s.maxRounds);
  const x = linearScale(0, maxR, box.left, box.right);
  const y = linearScale(0, 1, box.bottom, box.top);
  const idx = downsampleIndices(len, Math.max(8, Math.round(box.width)));
  const xs = idx.map((i) => x(i));
  const reasons = showIncidence
    ? (Object.keys(s.incidence) as (keyof Survival['incidence'])[]).filter(
        (k) => s.incidence[k]?.length,
      )
    : [];
  const yTicks = niceTicks(0, 1, 4).map((v) => ({ v, label: formatShare(v) }));
  const xTicks = niceTicks(0, maxR, tickCountFor(box.width, 84)).map((v) => ({
    v,
    label: formatAxisCount(v),
  }));
  const pxAll = idx.map((i) => x(i));
  const cur = useCursor(idx.length, (px) => nearestIndex(pxAll, px));
  const ci = cur.index;
  let tooltip: TooltipSpec | null = null;
  if (ci !== null && ci < idx.length) {
    const r = idx[ci]!;
    tooltip = {
      x: pxAll[ci]!,
      title: `Round ${r.toLocaleString('en-US')}`,
      lines: [
        `still playing ${formatShare(s.alive[r]!)}`,
        ...reasons.map((k) => `${REASON_LABEL[k] ?? k} ${formatShare(s.incidence[k]![r] ?? 0)}`),
      ],
    };
  }
  const legend: LegendItem[] = [
    { label: 'Still playing', color: 0 },
    ...reasons.map((k, i) => ({
      label: REASON_LABEL[k] ?? k,
      color: 1 + (i % 5),
      dash: dashFor(1 + (i % 5)),
    })),
  ];
  const table = {
    columns: ['Round', 'Still playing', ...reasons.map((k) => REASON_LABEL[k] ?? k)],
    rows: downsampleIndices(len, 40).map((r) => [
      r.toLocaleString('en-US'),
      formatShare(s.alive[r]!),
      ...reasons.map((k) => formatShare(s.incidence[k]![r] ?? 0)),
    ]),
  };
  return (
    <ChartFrame
      title={title}
      summary={survivalSummary(s)}
      table={table}
      legend={legend}
      plotRef={ref}
      tooltip={tooltip}
      class="sp-survival"
    >
      {len === 0 ? null : (
        <ChartSvg width={width} height={height} svgProps={cur.svgProps}>
          <YAxis box={box} scale={y} ticks={yTicks} />
          <XAxis box={box} scale={x} ticks={xTicks} label="Rounds" />
          {reasons.map((k, i) => (
            <path
              key={k}
              class="sp-incidence"
              data-reason={k}
              d={stepPath(
                xs,
                idx.map((r) => y(s.incidence[k]![r] ?? 0)),
              )}
              fill="none"
              stroke={seriesColor(1 + (i % 5))}
              stroke-width="2"
              stroke-dasharray={dashFor(1 + (i % 5))}
            />
          ))}
          <path
            class="sp-alive"
            d={stepPath(
              xs,
              idx.map((r) => y(s.alive[r]!)),
            )}
            fill="none"
            stroke={seriesColor(0)}
            stroke-width="2.5"
          />
          {s.medianRounds !== null ? (
            <g class="sp-median-mark">
              <line
                x1={x(s.medianRounds)}
                x2={x(s.medianRounds)}
                y1={y(0.5)}
                y2={box.bottom}
                stroke="var(--chart-text)"
                stroke-dasharray="2 3"
              />
              <circle cx={x(s.medianRounds)} cy={y(0.5)} r="4" fill={seriesColor(0)} />
              <text
                class="sp-halo"
                x={x(s.medianRounds) + (x(s.medianRounds) > (box.left + box.right) / 2 ? -6 : 6)}
                y={y(0.5) - 6}
                text-anchor={x(s.medianRounds) > (box.left + box.right) / 2 ? 'end' : 'start'}
              >
                half ended by round {s.medianRounds.toLocaleString('en-US')}
              </text>
            </g>
          ) : null}
          {ci !== null && ci < idx.length ? (
            <line
              x1={pxAll[ci]}
              x2={pxAll[ci]}
              y1={box.top}
              y2={box.bottom}
              stroke="var(--chart-text)"
              stroke-opacity="0.5"
            />
          ) : null}
          <rect
            class="sp-hit"
            x={box.left}
            y={box.top}
            width={box.width}
            height={box.height}
            {...cur.hitProps}
          />
        </ChartSvg>
      )}
    </ChartFrame>
  );
}
