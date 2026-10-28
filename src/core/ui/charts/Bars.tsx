import type { JSX } from 'preact';
import type { Breakdown } from '../../contracts/analysis';
import { formatMoney } from '../../money';
import { ChartFrame, ChartSvg } from './ChartFrame';
import type { TooltipSpec } from './ChartFrame';
import {
  formatAxisMoney,
  linearScale,
  niceDomain,
  niceTicks,
  nearestIndex,
  tickCountFor,
  truncate,
} from './geom/scale';
import { barRects } from './geom/shapes';
import { useCursor, useElementWidth } from './hooks';

export interface BarRow {
  id: string;
  label: string;
  value: number;
  /** extra table/tooltip columns, same keys on every row */
  extra?: Record<string, string | number>;
}
export interface BarsProps {
  rows: BarRow[];
  title: string;
  /** what `value` is, for the axis and table header, e.g. "Net" */
  valueLabel: string;
  fmt?: (v: number) => string;
  axisFmt?: (v: number) => string;
  /** 'auto': horizontal below 520 px so labels fit, vertical above */
  orientation?: 'auto' | 'horizontal' | 'vertical';
  /** show a leading "+" on positive values (net amounts) */
  signed?: boolean;
}

export function Bars(props: BarsProps): JSX.Element {
  const { rows } = props;
  const fmt = props.fmt ?? ((v: number) => formatMoney(v, { sign: props.signed }));
  const axisFmt = props.axisFmt ?? formatAxisMoney;
  const { ref, width } = useElementWidth();
  const horizontal =
    props.orientation === 'vertical'
      ? false
      : props.orientation === 'horizontal'
        ? true
        : width < 520;
  const n = rows.length;
  const values = rows.map((r) => r.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const [d0, d1] = niceDomain(lo, hi === lo ? lo + 1 : hi, 4);
  const labelChars = rows.reduce((m, r) => Math.max(m, r.label.length), 4);
  let svgH: number;
  let left: number;
  let right = width - 12;
  let top = 8;
  let bottom: number;
  if (horizontal) {
    left = Math.min(Math.round(width * 0.4), Math.max(70, labelChars * 7 + 12));
    right = width - 64; // room for the value label
    svgH = top + n * 36 + 34;
    bottom = svgH - 30;
  } else {
    left = 56;
    top = 18;
    svgH = Math.round(Math.min(380, Math.max(240, width * 0.5)));
    bottom = svgH - 44;
  }
  const vs = horizontal ? linearScale(d0, d1, left, right) : linearScale(d0, d1, bottom, top);
  const rects = barRects(values, vs, {
    orientation: horizontal ? 'horizontal' : 'vertical',
    start: horizontal ? top : left,
    size: horizontal ? n * 36 : right - left,
    gap: horizontal ? 8 : Math.min(16, Math.max(6, (right - left) / n / 4)),
  });
  const ticks = niceTicks(
    d0,
    d1,
    tickCountFor(horizontal ? right - left : bottom - top, horizontal ? 80 : 44),
  ).map((v) => ({ v, label: axisFmt(v) }));
  const bandPx = horizontal ? 36 : n > 0 ? (right - left) / n : 0;
  const cur = useCursor(n, (px) => {
    if (n === 0) return null;
    return nearestIndex(
      rects.map((r) => (horizontal ? r.y + r.h / 2 : r.x + r.w / 2)),
      px,
    );
  });
  const extraKeys = rows[0]?.extra ? Object.keys(rows[0].extra) : [];
  const ci = cur.index;
  let tooltip: TooltipSpec | null = null;
  if (ci !== null && ci < n) {
    const r = rows[ci]!;
    tooltip = {
      x: horizontal ? width / 2 : rects[ci]!.x + rects[ci]!.w / 2,
      title: r.label,
      lines: [
        `${props.valueLabel} ${fmt(r.value)}`,
        ...extraKeys.map((k) => `${k} ${r.extra![k]}`),
      ],
    };
  }
  const biggest = n ? rows.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a)) : null;
  const summary =
    n === 0
      ? 'Nothing to show yet.'
      : `${props.valueLabel} for ${n} ${n === 1 ? 'item' : 'items'}; the largest is ${biggest!.label} at ${fmt(biggest!.value)}. ` +
        rows.map((r) => `${r.label} ${fmt(r.value)}`).join(', ') +
        '.';
  const table = {
    columns: ['Item', props.valueLabel, ...extraKeys],
    rows: rows.map((r) => [r.label, fmt(r.value), ...extraKeys.map((k) => r.extra![k]!)]),
  };
  const maxVertChars = Math.max(3, Math.floor(bandPx / 6.5));
  const zeroPx = vs(0);
  return (
    <ChartFrame
      title={props.title}
      summary={summary}
      table={table}
      plotRef={ref}
      tooltip={tooltip}
      class="sp-bars-chart"
    >
      {n === 0 ? null : (
        <ChartSvg width={width} height={svgH} svgProps={cur.svgProps}>
          <g class="sp-vticks">
            {ticks.map((t) =>
              horizontal ? (
                <g key={t.v}>
                  <line class="sp-grid" x1={vs(t.v)} x2={vs(t.v)} y1={top} y2={bottom} />
                  <text class="sp-axis-text" x={vs(t.v)} y={bottom + 16} text-anchor="middle">
                    {t.label}
                  </text>
                </g>
              ) : (
                <g key={t.v}>
                  <line class="sp-grid" x1={left} x2={right} y1={vs(t.v)} y2={vs(t.v)} />
                  <text
                    class="sp-axis-text"
                    x={left - 6}
                    y={vs(t.v)}
                    text-anchor="end"
                    dominant-baseline="central"
                  >
                    {t.label}
                  </text>
                </g>
              ),
            )}
          </g>
          {horizontal ? (
            <line
              x1={zeroPx}
              x2={zeroPx}
              y1={top}
              y2={bottom}
              stroke="var(--zero)"
              stroke-width="1.5"
            />
          ) : (
            <line
              x1={left}
              x2={right}
              y1={zeroPx}
              y2={zeroPx}
              stroke="var(--zero)"
              stroke-width="1.5"
            />
          )}
          {rects.map((r) => {
            const row = rows[r.i]!;
            const neg = r.value < 0;
            const label = fmt(r.value);
            return (
              <g key={row.id} class="sp-bar" data-id={row.id}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={Math.max(r.w, 1)}
                  height={Math.max(r.h, 1)}
                  fill={neg ? 'var(--chart-2)' : 'var(--chart-1)'}
                  fill-opacity={neg ? 0.8 : 0.85}
                  stroke={neg ? 'var(--chart-2)' : 'var(--chart-1)'}
                />
                {horizontal ? (
                  <>
                    <text
                      x={left - 8}
                      y={r.y + r.h / 2}
                      text-anchor="end"
                      dominant-baseline="central"
                    >
                      {truncate(row.label, Math.floor((left - 12) / 6.8))}
                    </text>
                    <text
                      class="sp-halo"
                      x={neg ? zeroPx + 4 : r.x + r.w + 4}
                      y={r.y + r.h / 2}
                      text-anchor="start"
                      dominant-baseline="central"
                    >
                      {label}
                    </text>
                  </>
                ) : (
                  <>
                    <text x={r.x + r.w / 2} y={bottom + 16} text-anchor="middle">
                      {truncate(row.label, maxVertChars)}
                    </text>
                    <text
                      class="sp-halo"
                      x={r.x + r.w / 2}
                      y={neg ? r.y + r.h + 14 : r.y - 5}
                      text-anchor="middle"
                    >
                      {label}
                    </text>
                  </>
                )}
              </g>
            );
          })}
          <rect class="sp-hit" x={0} y={0} width={width} height={svgH} {...cur.hitProps} />
        </ChartSvg>
      )}
    </ChartFrame>
  );
}

const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : '0%');

/** Net result by bet category, with wagered and expected loss in the table and tooltip. */
export function categoryRows(
  b: Breakdown,
  fmt: (c: number) => string = (c) => formatMoney(c),
): BarRow[] {
  return b.categories.map((c) => ({
    id: c.id,
    label: c.id,
    value: c.net,
    extra: { Wagered: fmt(c.wagered), 'Expected loss': fmt(c.expected) },
  }));
}
/** Net result by stage, with rounds and share of rounds. */
export function stageRows(
  b: Breakdown,
  fmt: (c: number) => string = (c) => formatMoney(c),
): BarRow[] {
  const total = b.stages.reduce((s, x) => s + x.rounds, 0);
  return b.stages.map((s) => ({
    id: s.id,
    label: s.id,
    value: s.net,
    extra: {
      Rounds: s.rounds.toLocaleString('en-US'),
      'Share of rounds': pct(s.rounds, total),
      Wagered: fmt(s.wagered),
    },
  }));
}
