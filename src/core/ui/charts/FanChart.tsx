import type { JSX } from 'preact';
import type { FanChart as FanData } from '../../contracts/analysis';
import { formatMoney } from '../../money';
import { chartHeight, plotBox, RefLine, XAxis, YAxis } from './Axes';
import { ChartFrame, ChartSvg, dashFor, seriesColor } from './ChartFrame';
import type { LegendItem, TooltipSpec } from './ChartFrame';
import {
  downsampleIndices,
  extent,
  formatAxisCount,
  formatAxisMoney,
  linearScale,
  nearestIndex,
  niceDomain,
  niceTicks,
  tickCountFor,
} from './geom/scale';
import { fanPaths, linePath } from './geom/shapes';
import { fanSummary } from './geom/summary';
import { useCursor, useElementWidth } from './hooks';

export interface FanOverlay {
  id: string;
  label: string;
  rounds: ArrayLike<number>;
  p50: ArrayLike<number>;
}
export interface FanChartProps {
  fan: FanData;
  title: string;
  /** compare mode: extra runs drawn as median lines only */
  overlays?: FanOverlay[];
  /** label of the main run in compare mode */
  label?: string;
  fmt?: (cents: number) => string;
  axisFmt?: (cents: number) => string;
}

export function FanChart(props: FanChartProps): JSX.Element {
  const { fan, overlays = [] } = props;
  const fmt = props.fmt ?? ((c: number) => formatMoney(c));
  const axisFmt = props.axisFmt ?? formatAxisMoney;
  const { ref, width } = useElementWidth();
  const height = chartHeight(width);
  const n = fan.rounds.length;
  const box = plotBox(width, height, 6);
  const compare = overlays.length > 0;
  const ext = extent(fan.p5, fan.p95, fan.expected, [0], ...overlays.map((o) => o.p50)) ?? [-1, 1];
  const [y0, y1] = niceDomain(ext[0], ext[1], 5);
  const y = linearScale(y0, y1, box.bottom, box.top);
  const xMax = Math.max(
    fan.rounds[n - 1] ?? 1,
    ...overlays.map((o) => o.rounds[o.rounds.length - 1] ?? 0),
    1,
  );
  const x = linearScale(0, xMax, box.left, box.right);
  const idx = downsampleIndices(n, Math.max(8, Math.round(box.width / 2)));
  const paths = fanPaths(fan, x, y, idx);
  const yTicks = niceTicks(y0, y1, tickCountFor(box.height, 44)).map((v) => ({
    v,
    label: axisFmt(v),
  }));
  const xTicks = niceTicks(0, xMax, tickCountFor(box.width, 84)).map((v) => ({
    v,
    label: formatAxisCount(v),
  }));
  const pxAll = Array.from(fan.rounds, (r) => x(r));
  const cur = useCursor(n, (px) => nearestIndex(pxAll, px));
  const ci = cur.index;
  let tooltip: TooltipSpec | null = null;
  if (ci !== null && ci < n) {
    const lines = [
      `95th pct ${fmt(fan.p95[ci]!)}`,
      `75th pct ${fmt(fan.p75[ci]!)}`,
      `median ${fmt(fan.p50[ci]!)}`,
      `25th pct ${fmt(fan.p25[ci]!)}`,
      `5th pct ${fmt(fan.p5[ci]!)}`,
      `expected ${fmt(fan.expected[ci]!)}`,
    ];
    for (const o of overlays) {
      const j = nearestIndex(o.rounds, fan.rounds[ci]!);
      if (j !== null) lines.push(`${o.label} median ${fmt(o.p50[j]!)}`);
    }
    tooltip = { x: pxAll[ci]!, title: `Round ${fan.rounds[ci]!.toLocaleString('en-US')}`, lines };
  }
  const mainLabel = props.label ?? 'This run';
  const legend: LegendItem[] = compare
    ? [
        { label: `${mainLabel} median`, color: 0 },
        ...overlays.map((o, i) => ({
          label: `${o.label} median`,
          color: i + 1,
          dash: dashFor(i + 1),
        })),
        { label: 'Expected', color: 0, stroke: 'var(--chart-text)', dash: '3 4' },
      ]
    : [
        {
          label: '5th to 95th percentile',
          color: 0,
          swatch: 'band' as const,
          fill: 'var(--band-outer)',
        },
        {
          label: '25th to 75th percentile',
          color: 0,
          swatch: 'band' as const,
          under: 'var(--band-outer)',
          fill: 'var(--band-inner)',
        },
        { label: 'Median', color: 0 },
        { label: 'Expected (analytic)', color: 1, dash: '3 4' },
      ];
  const summary = compare
    ? `${fanSummary(fan, fmt)} Compared with ${overlays
        .map((o) => `${o.label} (median ${fmt(o.p50[o.p50.length - 1] ?? 0)} at the end)`)
        .join(', ')}.`
    : fanSummary(fan, fmt);
  const table = {
    columns: ['Round', '5th', '25th', 'Median', '75th', '95th', 'Expected'],
    rows: downsampleIndices(n, 48).map((i) => [
      fan.rounds[i]!.toLocaleString('en-US'),
      fmt(fan.p5[i]!),
      fmt(fan.p25[i]!),
      fmt(fan.p50[i]!),
      fmt(fan.p75[i]!),
      fmt(fan.p95[i]!),
      fmt(fan.expected[i]!),
    ]),
  };
  const last = paths.xs.length - 1;
  return (
    <ChartFrame
      title={props.title}
      summary={summary}
      table={table}
      legend={legend}
      plotRef={ref}
      tooltip={tooltip}
      class="sp-fan"
    >
      {n === 0 ? null : (
        <ChartSvg width={width} height={height} svgProps={cur.svgProps}>
          <YAxis box={box} scale={y} ticks={yTicks} />
          <XAxis box={box} scale={x} ticks={xTicks} label="Rounds" />
          {y0 < 0 && y1 > 0 ? (
            <RefLine
              box={box}
              orientation="h"
              at={y(0)}
              label={Math.abs(y(0) - y(fan.p50[n - 1] ?? 0)) < 16 ? '' : 'break-even'}
              strokeWidth={1}
            />
          ) : null}
          {!compare ? (
            <path class="sp-band-outer" d={paths.outer} fill="var(--band-outer)" />
          ) : null}
          {!compare ? (
            <path class="sp-band-inner" d={paths.inner} fill="var(--band-inner)" />
          ) : null}
          <path
            class="sp-expected"
            d={paths.expected}
            fill="none"
            stroke={compare ? 'var(--chart-text)' : 'var(--line-expected)'}
            stroke-width="2"
            stroke-dasharray="3 4"
          />
          {overlays.map((o, i) => {
            const oi = downsampleIndices(o.rounds.length, Math.max(8, Math.round(box.width / 2)));
            return (
              <path
                key={o.id}
                class="sp-overlay-median"
                data-series={o.id}
                d={linePath(
                  oi.map((k) => x(o.rounds[k]!)),
                  oi.map((k) => y(o.p50[k]!)),
                )}
                fill="none"
                stroke={seriesColor(i + 1)}
                stroke-width="2"
                stroke-dasharray={dashFor(i + 1)}
              />
            );
          })}
          <path
            class="sp-median"
            d={paths.median}
            fill="none"
            stroke="var(--line-median)"
            stroke-width="2.5"
          />
          {n === 1
            ? [fan.p5, fan.p25, fan.p50, fan.p75, fan.p95].map((a, k) => (
                <circle
                  key={k}
                  class="sp-point"
                  cx={pxAll[0]}
                  cy={y(a[0]!)}
                  r="4"
                  fill="var(--line-median)"
                />
              ))
            : null}
          {last >= 0 && !compare ? (
            <>
              <text
                class="sp-halo"
                x={paths.xs[last]! - 4}
                y={y(fan.p50[n - 1]!) - 6}
                text-anchor="end"
              >
                median
              </text>
            </>
          ) : null}
          {ci !== null && ci < n ? (
            <g class="sp-cursor">
              <line
                x1={pxAll[ci]}
                x2={pxAll[ci]}
                y1={box.top}
                y2={box.bottom}
                stroke="var(--chart-text)"
                stroke-opacity="0.5"
              />
              <circle
                cx={pxAll[ci]}
                cy={y(fan.p50[ci]!)}
                r="4"
                fill="var(--line-median)"
                stroke="var(--surface, #fff)"
                stroke-width="1.5"
              />
            </g>
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
