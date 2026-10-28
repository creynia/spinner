import type { JSX } from 'preact';
import type { Histogram as HistogramData } from '../../contracts/analysis';
import { formatMoney } from '../../money';
import { chartHeight, plotBox, RefLine, XAxis, YAxis } from './Axes';
import { ChartFrame, ChartSvg, seriesColor } from './ChartFrame';
import type { TooltipSpec } from './ChartFrame';
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
import { binInfo, histogramRects } from './geom/shapes';
import { histogramSummary, totalCount } from './geom/summary';
import { useCursor, useElementWidth } from './hooks';

export interface HistogramProps {
  histogram: HistogramData;
  title: string;
  /** money formatter for tooltips, summary and table (cents in); default `formatMoney` */
  fmt?: (cents: number) => string;
  /** compact axis formatter; default dollars */
  axisFmt?: (cents: number) => string;
  /** what the counted things are called, default "sessions" */
  noun?: string;
  xLabel?: string;
}

export function Histogram(props: HistogramProps): JSX.Element {
  const { histogram: h, title } = props;
  const fmt = props.fmt ?? ((c: number) => formatMoney(c));
  const axisFmt = props.axisFmt ?? formatAxisMoney;
  const noun = props.noun ?? 'sessions';
  const { ref, width } = useElementWidth();
  const height = chartHeight(width, 0.5);
  const bins = h.counts.length;
  const total = totalCount(h.counts);
  const box = plotBox(width, height, 5);
  const xMin = h.lo;
  const xMax = h.lo + bins * h.width;
  const x = linearScale(xMin, xMax, box.left, box.right);
  let maxC = 0;
  for (let i = 0; i < bins; i++) maxC = Math.max(maxC, h.counts[i]!);
  const [, yTop] = niceDomain(0, Math.max(1, maxC), 4);
  const y = linearScale(0, yTop, box.bottom, box.top);
  const yTicks = integerTicks(0, yTop, 4).map((v) => ({ v, label: formatAxisCount(v) }));
  const xTicks = niceTicks(xMin, xMax, tickCountFor(box.width, 80)).map((v) => ({
    v,
    label: axisFmt(v),
  }));
  const rects = histogramRects(h, x, y);
  const centers = Array.from({ length: bins }, (_, i) => x(xMin + (i + 0.5) * h.width));
  const cur = useCursor(bins, (px) => {
    if (bins === 0) return null;
    return Math.max(0, Math.min(bins - 1, Math.floor((px - box.left) / (box.width / bins))));
  });
  const ci = cur.index;
  let tooltip: TooltipSpec | null = null;
  if (ci !== null && ci < bins) {
    const b = binInfo(h, ci);
    tooltip = {
      x: centers[ci]!,
      title: `${fmt(b.lo)} to ${fmt(b.hi)}`,
      lines: [
        `${b.count.toLocaleString('en-US')} ${noun}${total ? ` (${formatShare(b.count / total)})` : ''}`,
      ],
    };
  }
  const { zero, expected, mean } = h.markers;
  const inside = (v: number | undefined): v is number => v !== undefined && v >= xMin && v <= xMax;
  const xz = inside(zero) ? x(zero) : null;
  const xe = inside(expected) ? x(expected) : null;
  const xm = inside(mean) ? x(mean) : null;
  const close = xz !== null && xe !== null && Math.abs(xz - xe) < 120;
  const table = {
    columns: ['Range', `Number of ${noun}`, 'Share'],
    rows: Array.from({ length: bins }, (_, i) => {
      const b = binInfo(h, i);
      return [`${fmt(b.lo)} to ${fmt(b.hi)}`, b.count, total ? formatShare(b.count / total) : '0%'];
    }),
  };
  return (
    <ChartFrame
      title={title}
      summary={histogramSummary(h, fmt, noun)}
      table={table}
      plotRef={ref}
      tooltip={tooltip}
      class="sp-histogram"
    >
      {bins === 0 || total === 0 ? null : (
        <ChartSvg width={width} height={height} svgProps={cur.svgProps}>
          <YAxis box={box} scale={y} ticks={yTicks} />
          <g class="sp-bars" fill={seriesColor(0)} fill-opacity="0.75">
            {rects.map((r) => (
              <rect key={r.i} x={r.x} y={r.y} width={r.w} height={r.h} data-bin={r.i} />
            ))}
          </g>
          <XAxis
            box={box}
            scale={x}
            ticks={xTicks}
            label={props.xLabel ?? 'Net result per session'}
          />
          {xm !== null ? (
            <RefLine
              box={box}
              orientation="v"
              at={xm}
              label={`mean ${fmt(mean!)}`}
              dash="2 3"
              stroke="var(--chart-3)"
              labelRow={close ? 2 : 1}
            />
          ) : null}
          {xe !== null ? (
            <RefLine
              box={box}
              orientation="v"
              at={xe}
              label={`expected ${fmt(expected!)}`}
              dash="8 4"
              stroke="var(--line-expected)"
              labelRow={close ? 1 : 0}
            />
          ) : null}
          {xz !== null ? (
            <RefLine box={box} orientation="v" at={xz} label={`zero ${fmt(zero!)}`} />
          ) : null}
          {ci !== null && ci < bins ? (
            <line
              x1={centers[ci]}
              x2={centers[ci]}
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
