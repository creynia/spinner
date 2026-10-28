import type { JSX } from 'preact';
import { chartHeight, plotBox, RefLine, XAxis, YAxis } from './Axes';
import type { Tick } from './Axes';
import { ChartFrame, ChartSvg, dashFor, seriesColor } from './ChartFrame';
import type { LegendItem, TooltipSpec } from './ChartFrame';
import {
  downsampleIndices,
  extent,
  finiteOr,
  linearScale,
  logScale,
  logTicks,
  nearestIndex,
  niceDomain,
  niceTicks,
  tickCountFor,
} from './geom/scale';
import type { Scale } from './geom/scale';
import { bandPath, linePath } from './geom/shapes';
import { useCursor, useElementWidth } from './hooks';

export interface LineBandSeries {
  id: string;
  label: string;
  y: ArrayLike<number>;
  /** optional interval band around the line */
  lo?: ArrayLike<number>;
  hi?: ArrayLike<number>;
  bandLabel?: string;
}
export interface LineBandRef {
  y: number;
  label: string;
  dash?: string;
  stroke?: string;
}
export interface LineBandProps {
  title: string;
  summary: string;
  x: ArrayLike<number>;
  /** 'categorical' places points at indices and labels ticks with `xLabels` */
  xKind: 'linear' | 'log' | 'categorical';
  xLabels?: string[];
  xFmt: (x: number, i: number) => string;
  xAxisLabel: string;
  yFmt: (y: number) => string;
  yAxisFmt?: (y: number) => string;
  series: LineBandSeries[];
  refs?: LineBandRef[];
  /** fix the y domain (e.g. [0, 1] for probabilities) */
  yDomain?: [number, number];
  class?: string;
}

/** Lines with optional interval bands: convergence (running mean + CI) and sweeps. */
export function LineBand(props: LineBandProps): JSX.Element {
  const { x: xs, series, xKind } = props;
  const n = xs.length;
  const yFmt = finiteOr(props.yFmt);
  const yAxisFmt = finiteOr(props.yAxisFmt ?? props.yFmt);
  const { ref, width } = useElementWidth();
  const height = chartHeight(width);
  const arrays: ArrayLike<number>[] = [];
  for (const s of series) arrays.push(s.y, ...(s.lo ? [s.lo] : []), ...(s.hi ? [s.hi] : []));
  const e = extent(...arrays, ...(props.refs ?? []).map((r) => [r.y])) ?? [0, 1];
  const [y0, y1] = props.yDomain ?? niceDomain(e[0], e[1], 5);
  const yTicks = niceTicks(y0, y1, 5).map((v) => ({ v, label: yAxisFmt(v) }));
  const maxLabel = yTicks.reduce((m, t) => Math.max(m, t.label.length), 4);
  const box = plotBox(width, height, maxLabel);
  const y = linearScale(y0, y1, box.bottom, box.top);
  let x: Scale;
  let xTicks: Tick[];
  const xe = extent(xs) ?? [0, 1];
  if (xKind === 'log') {
    const lo = Math.max(xe[0], 1e-9);
    x = logScale(lo, Math.max(xe[1], lo * 1.0001), box.left, box.right);
    xTicks = logTicks(lo, xe[1])
      .filter((_, i, a) => a.length <= Math.max(2, Math.floor(box.width / 70)) || i % 2 === 0)
      .map((v) => ({ v, label: props.xFmt(v, -1) }));
  } else if (xKind === 'categorical') {
    x = linearScale(-0.4, Math.max(0, n - 1) + 0.4, box.left, box.right);
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(box.width / 64))));
    xTicks = Array.from({ length: n }, (_, i) => i)
      .filter((i) => i % step === 0)
      .map((i) => ({ v: i, label: props.xLabels?.[i] ?? String(i) }));
  } else {
    x = linearScale(xe[0], xe[1], box.left, box.right);
    xTicks = niceTicks(xe[0], xe[1], tickCountFor(box.width, 80)).map((v) => ({
      v,
      label: props.xFmt(v, -1),
    }));
  }
  const idx = downsampleIndices(n, Math.max(8, Math.round(box.width / 2)));
  const px = idx.map((i) => x(xs[i]!));
  const cur = useCursor(idx.length, (p) => nearestIndex(px, p));
  const ci = cur.index;
  let tooltip: TooltipSpec | null = null;
  if (ci !== null && ci < idx.length) {
    const i = idx[ci]!;
    tooltip = {
      x: px[ci]!,
      title: `${props.xAxisLabel}: ${props.xFmt(xs[i]!, i)}`,
      lines: series.flatMap((s) => {
        const l = [`${s.label} ${yFmt(s.y[i]!)}`];
        if (s.lo && s.hi)
          l.push(`${s.bandLabel ?? 'interval'} ${yFmt(s.lo[i]!)} to ${yFmt(s.hi[i]!)}`);
        return l;
      }),
    };
  }
  const legend: LegendItem[] = series.flatMap((s, i) => [
    { label: s.label, color: i, dash: dashFor(i) },
    ...(s.lo && s.hi
      ? [
          {
            label: s.bandLabel ?? `${s.label} interval`,
            color: i,
            swatch: 'band' as const,
            opacity: 0.18,
          },
        ]
      : []),
  ]);
  const table = {
    columns: [
      props.xAxisLabel,
      ...series.flatMap((s) => [
        s.label,
        ...(s.lo && s.hi ? [`${s.label} low`, `${s.label} high`] : []),
      ]),
    ],
    rows: downsampleIndices(n, 48).map((i) => [
      props.xFmt(xs[i]!, i),
      ...series.flatMap((s) => [
        yFmt(s.y[i]!),
        ...(s.lo && s.hi ? [yFmt(s.lo[i]!), yFmt(s.hi[i]!)] : []),
      ]),
    ]),
  };
  const markers = n <= 40;
  return (
    <ChartFrame
      title={props.title}
      summary={props.summary}
      table={table}
      legend={legend}
      plotRef={ref}
      tooltip={tooltip}
      class={props.class ?? 'sp-lineband'}
    >
      {n === 0 ? null : (
        <ChartSvg width={width} height={height} svgProps={cur.svgProps}>
          <YAxis box={box} scale={y} ticks={yTicks} />
          <XAxis box={box} scale={x} ticks={xTicks} label={props.xAxisLabel} />
          {(props.refs ?? []).map((r, i) => (
            <RefLine
              key={r.label}
              box={box}
              orientation="h"
              at={y(r.y)}
              label={r.label}
              dash={r.dash}
              stroke={r.stroke}
              labelRow={i}
            />
          ))}
          {series.map((s, i) =>
            s.lo && s.hi ? (
              <path
                key={`b${s.id}`}
                class="sp-band"
                data-series={s.id}
                d={bandPath(
                  idx.map((k) => x(xs[k]!)),
                  idx.map((k) => y(s.lo![k]!)),
                  idx.map((k) => y(s.hi![k]!)),
                )}
                fill={seriesColor(i)}
                fill-opacity="0.18"
                stroke={seriesColor(i)}
                stroke-opacity="0.35"
                stroke-width="1"
                stroke-dasharray="2 3"
              />
            ) : null,
          )}
          {series.map((s, i) => (
            <path
              key={s.id}
              class="sp-line"
              data-series={s.id}
              d={linePath(
                idx.map((k) => x(xs[k]!)),
                idx.map((k) => y(s.y[k]!)),
              )}
              fill="none"
              stroke={seriesColor(i)}
              stroke-width="2.5"
              stroke-dasharray={dashFor(i)}
              stroke-linejoin="round"
            />
          ))}
          {markers
            ? series.map((s, i) =>
                idx.map((k) => (
                  <circle
                    key={`${s.id}${k}`}
                    class="sp-point"
                    cx={x(xs[k]!)}
                    cy={y(s.y[k]!)}
                    r="3.5"
                    fill={seriesColor(i)}
                    stroke="var(--surface, #fff)"
                    stroke-width="1"
                  />
                )),
              )
            : null}
          {ci !== null && ci < idx.length ? (
            <line
              x1={px[ci]}
              x2={px[ci]}
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
