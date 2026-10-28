import type { JSX } from 'preact';
import type { Histogram as HistogramData } from '../../contracts/analysis';
import { formatMoney } from '../../money';
import { chartHeight, plotBox, RefLine, XAxis, YAxis } from './Axes';
import { ChartFrame, ChartSvg, dashFor, seriesColor } from './ChartFrame';
import type { LegendItem, TooltipSpec } from './ChartFrame';
import {
  formatAxisCount,
  formatAxisMoney,
  formatShare,
  linearScale,
  niceDomain,
  integerTicks,
  niceTicks,
  tickCountFor,
} from './geom/scale';
import { histogramOutline } from './geom/shapes';
import { histogramQuantileBin, totalCount } from './geom/summary';
import { useCursor, useElementWidth } from './hooks';

export interface OverlaySeries {
  id: string;
  label: string;
  counts: ArrayLike<number>;
}
export interface OverlayHistogramProps {
  /** `CompareResult.sharedHistogram` fields: all series share the same bins */
  lo: number;
  width: number;
  series: OverlaySeries[];
  markers?: HistogramData['markers'];
  title: string;
  fmt?: (cents: number) => string;
  axisFmt?: (cents: number) => string;
}

/** Compare: one outline per run on shared bins, distinguished by colour and dash pattern. */
export function OverlayHistogram(props: OverlayHistogramProps): JSX.Element {
  const fmt = props.fmt ?? ((c: number) => formatMoney(c));
  const axisFmt = props.axisFmt ?? formatAxisMoney;
  const { lo, width: bw, series } = props;
  const bins = series.reduce((m, s) => Math.max(m, s.counts.length), 0);
  const { ref, width } = useElementWidth();
  const height = chartHeight(width, 0.5);
  const box = plotBox(width, height, 5);
  const xMax = lo + bins * bw;
  const x = linearScale(lo, xMax, box.left, box.right);
  let maxC = 0;
  for (const s of series)
    for (let i = 0; i < s.counts.length; i++) maxC = Math.max(maxC, s.counts[i]!);
  const [, yTop] = niceDomain(0, Math.max(1, maxC), 4);
  const y = linearScale(0, yTop, box.bottom, box.top);
  const yTicks = integerTicks(0, yTop, 4).map((v) => ({ v, label: formatAxisCount(v) }));
  const xTicks = niceTicks(lo, xMax, tickCountFor(box.width, 80)).map((v) => ({
    v,
    label: axisFmt(v),
  }));
  const cur = useCursor(bins, (px) =>
    bins === 0
      ? null
      : Math.max(0, Math.min(bins - 1, Math.floor((px - box.left) / (box.width / bins)))),
  );
  const ci = cur.index;
  let tooltip: TooltipSpec | null = null;
  if (ci !== null && ci < bins) {
    tooltip = {
      x: x(lo + (ci + 0.5) * bw),
      title: `${fmt(lo + ci * bw)} to ${fmt(lo + (ci + 1) * bw)}`,
      lines: series.map((s) => {
        const t = totalCount(s.counts);
        const c = s.counts[ci] ?? 0;
        return `${s.label}: ${c.toLocaleString('en-US')}${t ? ` (${formatShare(c / t)})` : ''}`;
      }),
    };
  }
  const legend: LegendItem[] = series.map((s, i) => ({
    label: s.label,
    color: i,
    dash: dashFor(i),
  }));
  const medians = series.map((s) => {
    const b = histogramQuantileBin({ lo, width: bw, counts: s.counts }, 0.5);
    return `${s.label} about ${fmt(lo + (b + 0.5) * bw)}`;
  });
  const summary =
    `${series.length} runs on shared bins. Middle session by run: ${medians.join('; ')}.` +
    (props.markers?.zero !== undefined
      ? props.markers.zero >= lo && props.markers.zero <= lo + bins * bw
        ? ` The zero line is at ${fmt(props.markers.zero)}.`
        : ` The zero line (${fmt(props.markers.zero)}) lies outside the plotted range.`
      : '');
  const table = {
    columns: ['Range', ...series.map((s) => s.label)],
    rows: Array.from({ length: bins }, (_, i) => [
      `${fmt(lo + i * bw)} to ${fmt(lo + (i + 1) * bw)}`,
      ...series.map((s) => s.counts[i] ?? 0),
    ]),
  };
  const { zero, expected } = props.markers ?? {};
  return (
    <ChartFrame
      title={props.title}
      summary={summary}
      table={table}
      legend={legend}
      plotRef={ref}
      tooltip={tooltip}
      class="sp-overlay"
    >
      {bins === 0 ? null : (
        <ChartSvg width={width} height={height} svgProps={cur.svgProps}>
          <YAxis box={box} scale={y} ticks={yTicks} />
          <XAxis box={box} scale={x} ticks={xTicks} label="Net result per session" />
          {series.map((s, i) => (
            <path
              key={s.id}
              class="sp-outline"
              data-series={s.id}
              d={histogramOutline({ lo, width: bw, counts: s.counts }, x, y)}
              fill={seriesColor(i)}
              fill-opacity={i === 0 ? 0.12 : 0}
              stroke={seriesColor(i)}
              stroke-width="2"
              stroke-dasharray={dashFor(i)}
              stroke-linejoin="round"
            />
          ))}
          {expected !== undefined && expected >= lo && expected <= xMax ? (
            <RefLine
              box={box}
              orientation="v"
              at={x(expected)}
              label={`expected ${fmt(expected)}`}
              dash="8 4"
              stroke="var(--line-expected)"
              labelRow={1}
            />
          ) : null}
          {zero !== undefined && zero >= lo && zero <= xMax ? (
            <RefLine box={box} orientation="v" at={x(zero)} label={`zero ${fmt(zero)}`} />
          ) : null}
          {ci !== null && ci < bins ? (
            <line
              x1={x(lo + (ci + 0.5) * bw)}
              x2={x(lo + (ci + 0.5) * bw)}
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
