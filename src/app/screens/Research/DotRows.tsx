// Dot-and-range rows (docs/design/research.md §5.1): one row per item, an optional range bar
// (p10 to p90) and one mark per series (median circle, mean diamond, ...). Horizontal like `Bars`.
// The data table of ChartFrame is the accessible path; the SVG itself has no cursor.
import type { JSX } from 'preact';
import { ChartFrame, ChartSvg, type TableSpec } from '@core/ui';
import { niceDomain, niceTicks, scaleLinear, seriesColor, tickCountFor, useWidth } from './kit';

export interface DotSeries {
  id: string;
  label: string;
  shape: 'circle' | 'square' | 'diamond' | 'tick';
  /** colour 1 to 6 (`--chart-1` to `--chart-6`); a `tick` is always drawn in `--chart-text` */
  color: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface DotRow {
  id: string;
  label: string;
  /** the bar behind the marks, in domain units (p10 to p90) */
  range?: [number, number];
  /** series id -> value; `null` or a missing id draws nothing for that series on this row */
  values: Record<string, number | null>;
}

export interface DotRowsProps {
  title: string;
  /** one computed sentence, announced with the title */
  summary: string;
  series: DotSeries[];
  rows: DotRow[];
  /** x domain; default: the extent of every value and range, widened to nice ticks */
  domain?: [number, number];
  /** a value above this is drawn as a right-pointing triangle at the axis end with "<clampAt>+" */
  clampAt?: number;
  /** when set, draws the zero line (`--zero`) with this halo label, e.g. "Break-even" */
  zeroLine?: string;
  /** full-precision text for a value */
  fmt(v: number): string;
  axisFmt(v: number): string;
  /** x axis title, e.g. "Result after 500 spins" */
  axisLabel: string;
  /** every plotted value, same order as `rows` */
  table: TableSpec;
  /** legend text of the range bar; default "Range" (only shown when a row has a range) */
  rangeLabel?: string;
}

const PITCH = 36;
const TOP = 8;

function Mark({
  shape,
  x,
  y,
  color,
}: {
  shape: DotSeries['shape'];
  x: number;
  y: number;
  color: string;
}): JSX.Element {
  const paint = { fill: color, stroke: 'var(--surface)', 'stroke-width': 1 };
  switch (shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={5} {...paint} />;
    case 'square':
      return <rect x={x - 4.5} y={y - 4.5} width={9} height={9} {...paint} />;
    case 'diamond':
      return (
        <rect
          x={x - 4}
          y={y - 4}
          width={8}
          height={8}
          transform={`rotate(45 ${x} ${y})`}
          {...paint}
        />
      );
    case 'tick':
      return <line x1={x} x2={x} y1={y - 8} y2={y + 8} stroke={color} stroke-width={2} />;
  }
}

/** Colour of a series: ticks use the chart text colour, the rest their series token. */
const colorOf = (s: DotSeries): string =>
  s.shape === 'tick' ? 'var(--chart-text)' : seriesColor(s.color);

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

export function DotRows(props: DotRowsProps): JSX.Element {
  const { rows, series, clampAt } = props;
  const { ref, width } = useWidth();
  const n = rows.length;
  const chars = rows.reduce((m, r) => Math.max(m, r.label.length), 4);
  const left = Math.min(Math.round(width * 0.4), Math.max(70, chars * 7 + 12));
  const right = width - 16;
  const svgH = TOP + n * PITCH + 34;
  const bottom = TOP + n * PITCH;

  let [d0, d1] = props.domain ?? [0, 0];
  if (!props.domain) {
    const all: number[] = [];
    for (const r of rows) {
      if (r.range) all.push(...r.range);
      for (const v of Object.values(r.values)) if (v !== null && Number.isFinite(v)) all.push(v);
    }
    if (clampAt !== undefined) all.push(clampAt);
    if (props.zeroLine !== undefined) all.push(0);
    [d0, d1] = all.length ? niceDomain(Math.min(...all), Math.max(...all), 4) : [0, 1];
  }
  const x = scaleLinear(d0, d1, left, right);
  const px = (v: number): number => Math.min(right, Math.max(left, x(v)));
  const ticks = niceTicks(d0, d1, tickCountFor(right - left, 80));
  const hasRange = rows.some((r) => r.range);
  const zeroX = props.zeroLine !== undefined && d0 <= 0 && d1 >= 0 ? x(0) : null;

  return (
    <ChartFrame
      title={props.title}
      summary={props.summary}
      table={props.table}
      plotRef={ref}
      class="sp-dotrows"
    >
      {n === 0 ? null : (
        <ChartSvg width={width} height={svgH}>
          <g class="sp-vticks">
            {ticks.map((v) => (
              <g key={v}>
                <line class="sp-grid" x1={x(v)} x2={x(v)} y1={TOP} y2={bottom} />
                <text class="sp-axis-text" x={x(v)} y={bottom + 16} text-anchor="middle">
                  {props.axisFmt(v)}
                </text>
              </g>
            ))}
          </g>
          <text class="sp-axis-text" x={(left + right) / 2} y={svgH - 2} text-anchor="middle">
            {props.axisLabel}
          </text>
          {zeroX !== null ? (
            <g class="sp-zero">
              <line
                x1={zeroX}
                x2={zeroX}
                y1={TOP}
                y2={bottom}
                stroke="var(--zero)"
                stroke-width="1.5"
              />
              <text
                class="sp-halo"
                x={zeroX + (zeroX > right - 80 ? -4 : 4)}
                y={TOP + 6}
                text-anchor={zeroX > right - 80 ? 'end' : 'start'}
                dominant-baseline="central"
              >
                {props.zeroLine}
              </text>
            </g>
          ) : null}
          {rows.map((r, i) => {
            const cy = TOP + i * PITCH + PITCH / 2;
            return (
              <g key={r.id} class="sp-dotrow" data-row={r.id}>
                <text x={left - 8} y={cy} text-anchor="end" dominant-baseline="central">
                  {truncate(r.label, Math.floor((left - 12) / 6.8))}
                </text>
                {r.range ? (
                  <rect
                    class="sp-dotrange"
                    data-row={r.id}
                    x={px(Math.min(...r.range))}
                    y={cy - 3}
                    width={Math.max(1, px(Math.max(...r.range)) - px(Math.min(...r.range)))}
                    height={6}
                    fill="var(--band-inner)"
                    stroke="var(--chart-1)"
                  />
                ) : null}
                {series.map((s) => {
                  const v = r.values[s.id];
                  if (v === null || v === undefined || !Number.isFinite(v)) return null;
                  const clamped = clampAt !== undefined && v > clampAt;
                  if (clamped) {
                    const tx = px(clampAt);
                    return (
                      <g key={s.id} class="sp-dotclamp" data-row={r.id} data-series={s.id}>
                        <path
                          d={`M${tx - 8} ${cy - 6}L${tx + 2} ${cy}L${tx - 8} ${cy + 6}Z`}
                          fill={colorOf(s)}
                          stroke="var(--surface)"
                          stroke-width="1"
                        />
                        <text
                          class="sp-halo"
                          x={tx - 12}
                          y={cy}
                          text-anchor="end"
                          dominant-baseline="central"
                        >
                          {`${props.axisFmt(clampAt)}+`}
                        </text>
                      </g>
                    );
                  }
                  return (
                    <g key={s.id} class="sp-dotmark" data-row={r.id} data-series={s.id}>
                      <Mark shape={s.shape} x={px(v)} y={cy} color={colorOf(s)} />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </ChartSvg>
      )}
      <ul class="sp-chart__legend" aria-label="Legend">
        {hasRange ? (
          <li>
            <svg width="28" height="12" overflow="visible" aria-hidden="true" focusable="false">
              <rect
                x="1"
                y="3"
                width="26"
                height="6"
                fill="var(--band-inner)"
                stroke="var(--chart-1)"
              />
            </svg>
            <span>{props.rangeLabel ?? 'Range'}</span>
          </li>
        ) : null}
        {series.map((s) => (
          <li key={s.id}>
            <svg width="28" height="12" overflow="visible" aria-hidden="true" focusable="false">
              <Mark shape={s.shape} x={14} y={6} color={colorOf(s)} />
            </svg>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}
