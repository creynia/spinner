// Scatter (docs/design/research.md §5.2): points in groups (shape and colour) with an optional curve
// drawn behind them. In a ChartFrame, so the data table is the accessible path; the SVG has no cursor.
import type { JSX } from 'preact';
import { ChartFrame, ChartSvg, type TableSpec } from '@core/ui';
import { chartHeight, niceTicks, scaleLinear, seriesColor, useWidth } from './kit';

export type ScatterShape = 'circle' | 'square' | 'triangle' | 'diamond';

export interface ScatterGroup {
  id: string;
  label: string;
  shape: ScatterShape;
  /** colour 1 to 6 (`--chart-1` to `--chart-6`) */
  color: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface ScatterProps {
  title: string;
  /** one computed sentence, announced with the title */
  summary: string;
  points: { id: string; x: number; y: number; group: string }[];
  groups: ScatterGroup[];
  xDomain: [number, number];
  yDomain: [number, number];
  /** a curve behind the points, sampled 100 times over `xDomain`, labelled at x = `labelAt` */
  curve?: { label: string; f(x: number): number; labelAt: number };
  /** tick values; default: round ticks inside the domain */
  xTicks?: number[];
  yTicks?: number[];
  xLabel: string;
  yLabel: string;
  xFmt(v: number): string;
  yFmt(v: number): string;
  table: TableSpec;
}

const LEFT = 56;
const RIGHT = 12;
const TOP = 14;

function Mark({
  shape,
  x,
  y,
  color,
}: {
  shape: ScatterShape;
  x: number;
  y: number;
  color: string;
}): JSX.Element {
  const paint = { fill: color, stroke: 'var(--surface)', 'stroke-width': 1 };
  switch (shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={4} {...paint} />;
    case 'square':
      return <rect x={x - 3.5} y={y - 3.5} width={7} height={7} {...paint} />;
    case 'triangle':
      return (
        <path d={`M${x} ${y - 4.5}L${x + 4.5} ${y + 3.5}L${x - 4.5} ${y + 3.5}Z`} {...paint} />
      );
    case 'diamond':
      return (
        <rect
          x={x - 3.5}
          y={y - 3.5}
          width={7}
          height={7}
          transform={`rotate(45 ${x} ${y})`}
          {...paint}
        />
      );
  }
}

export function Scatter(props: ScatterProps): JSX.Element {
  const { ref, width } = useWidth();
  const height = chartHeight(width);
  const [x0, x1] = props.xDomain;
  const [y0, y1] = props.yDomain;
  const left = LEFT;
  const right = width - RIGHT;
  const bottom = height - 44;
  const x = scaleLinear(x0, x1, left, right);
  const y = scaleLinear(y0, y1, bottom, TOP);
  const xTicks = props.xTicks ?? niceTicks(x0, x1, Math.max(2, Math.floor((right - left) / 70)));
  const yTicks = props.yTicks ?? niceTicks(y0, y1, 4);
  const byId = new Map(props.groups.map((g) => [g.id, g]));
  const last = props.groups[props.groups.length - 1];
  const inside = props.points.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
  const { curve } = props;
  const curvePath = curve
    ? Array.from({ length: 100 }, (_, i) => {
        const v = x0 + ((x1 - x0) * i) / 99;
        return `${i === 0 ? 'M' : 'L'}${x(v).toFixed(1)} ${y(curve.f(v)).toFixed(1)}`;
      }).join('')
    : '';
  const labelX = curve ? Math.min(x(curve.labelAt) + 8, right - 4) : 0;
  const labelY = curve ? y(curve.f(curve.labelAt)) - 10 : 0;

  return (
    <ChartFrame
      title={props.title}
      summary={props.summary}
      table={props.table}
      plotRef={ref}
      class="sp-scatter"
    >
      <ChartSvg width={width} height={height}>
        <g class="sp-hticks">
          {yTicks.map((v) => (
            <g key={v}>
              <line class="sp-grid" x1={left} x2={right} y1={y(v)} y2={y(v)} />
              <text
                class="sp-axis-text"
                x={left - 6}
                y={y(v)}
                text-anchor="end"
                dominant-baseline="central"
              >
                {props.yFmt(v)}
              </text>
            </g>
          ))}
        </g>
        <g class="sp-vticks">
          {xTicks.map((v) => (
            <text key={v} class="sp-axis-text" x={x(v)} y={bottom + 16} text-anchor="middle">
              {props.xFmt(v)}
            </text>
          ))}
        </g>
        <line class="sp-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
        <text class="sp-axis-text" x={(left + right) / 2} y={height - 6} text-anchor="middle">
          {props.xLabel}
        </text>
        <text
          class="sp-axis-text"
          transform={`translate(12 ${(TOP + bottom) / 2}) rotate(-90)`}
          text-anchor="middle"
        >
          {props.yLabel}
        </text>
        {curve ? (
          <g class="sp-scatter-curve">
            <path d={curvePath} fill="none" stroke="var(--chart-1)" stroke-width="2.5" />
            <text class="sp-halo" x={labelX} y={labelY} text-anchor="start">
              {curve.label}
            </text>
          </g>
        ) : null}
        {inside.map((p) => {
          const g = byId.get(p.group) ?? last;
          if (!g) return null;
          return (
            <g key={p.id} class="sp-scatter-point" data-id={p.id} data-group={g.id}>
              <Mark shape={g.shape} x={x(p.x)} y={y(p.y)} color={seriesColor(g.color)} />
            </g>
          );
        })}
      </ChartSvg>
      <ul class="sp-chart__legend" aria-label="Legend">
        {curve ? (
          <li>
            <svg width="28" height="12" overflow="visible" aria-hidden="true" focusable="false">
              <line x1="1" x2="27" y1="6" y2="6" stroke="var(--chart-1)" stroke-width="2.5" />
            </svg>
            <span>{curve.label}</span>
          </li>
        ) : null}
        {props.groups.map((g) => (
          <li key={g.id}>
            <svg width="28" height="12" overflow="visible" aria-hidden="true" focusable="false">
              <Mark shape={g.shape} x={14} y={6} color={seriesColor(g.color)} />
            </svg>
            <span>{g.label}</span>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}

/** The scatter group of a curve point's family: "E3 ..." martingale, "E4" outside or inside, "E6". */
export function curveGroup(family: string): string {
  if (family.startsWith('E3')) return 'e3';
  if (family.startsWith('E4')) {
    return /^E4 (dozen|two-dozens)\b/.test(family) ? 'e4-out' : 'e4-in';
  }
  return 'e6';
}
