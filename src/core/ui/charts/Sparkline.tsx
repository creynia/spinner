import type { JSX } from 'preact';
import { formatMoney } from '../../money';
import './charts.css';
import { extent, linearScale } from './geom/scale';
import { linePath } from './geom/shapes';

export interface SparklineProps {
  values: ArrayLike<number>;
  /** accessible name, e.g. "Equity this session" */
  label: string;
  width?: number;
  height?: number;
  /** draw a baseline at this value (e.g. the starting bankroll) */
  baseline?: number;
  fmt?: (v: number) => string;
  class?: string;
}

/** Tiny inline trend line with an end dot and a screen-reader summary (first, low, high, last). */
export function Sparkline(props: SparklineProps): JSX.Element {
  const { values, width = 120, height = 32 } = props;
  const fmt = props.fmt ?? ((v: number) => formatMoney(v));
  const n = values.length;
  const e = extent(values, ...(props.baseline !== undefined ? [[props.baseline]] : [])) ?? [0, 1];
  const pad = 3;
  const x = linearScale(0, Math.max(1, n - 1), pad, width - pad);
  const y = linearScale(e[0], e[1], height - pad, pad);
  const xs = Array.from({ length: n }, (_, i) => x(i));
  const ys = Array.from({ length: n }, (_, i) => y(values[i]!));
  const first = values[0];
  const last = values[n - 1];
  const lo = e[0];
  const hi = extent(values)?.[1] ?? 0;
  const text =
    n === 0
      ? `${props.label}: no data`
      : `${props.label}: starts ${fmt(first!)}, ends ${fmt(last!)}, low ${fmt(extent(values)![0])}, high ${fmt(hi)}`;
  void lo;
  return (
    <span class={`sp-spark ${props.class ?? ''}`.trim()}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={text}
      >
        {props.baseline !== undefined ? (
          <line
            class="sp-spark-base"
            x1={pad}
            x2={width - pad}
            y1={y(props.baseline)}
            y2={y(props.baseline)}
            stroke="var(--muted, #4f5b6b)"
            stroke-dasharray="2 3"
          />
        ) : null}
        <path
          class="sp-spark-line"
          d={linePath(xs, ys)}
          fill="none"
          stroke="var(--chart-1, #1d5fbf)"
          stroke-width="1.75"
          stroke-linejoin="round"
        />
        {n > 0 ? (
          <circle
            class="sp-spark-end"
            cx={xs[n - 1]}
            cy={ys[n - 1]}
            r="2.5"
            fill="var(--chart-1, #1d5fbf)"
          />
        ) : null}
      </svg>
      <table class="sp-sr">
        <caption>{props.label}</caption>
        <thead>
          <tr>
            <th scope="col">Point</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {n > 0 ? (
            <>
              <tr>
                <th scope="row">Start</th>
                <td>{fmt(first!)}</td>
              </tr>
              <tr>
                <th scope="row">Low</th>
                <td>{fmt(extent(values)![0])}</td>
              </tr>
              <tr>
                <th scope="row">High</th>
                <td>{fmt(hi)}</td>
              </tr>
              <tr>
                <th scope="row">End</th>
                <td>{fmt(last!)}</td>
              </tr>
            </>
          ) : null}
        </tbody>
      </table>
    </span>
  );
}
