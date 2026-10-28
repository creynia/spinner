import type { JSX } from 'preact';
import type { Scale } from './geom/scale';

export interface PlotBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}
export interface Tick {
  v: number;
  label: string;
}

/** Plot rectangle inside an svg of `width` x `height`, leaving room for tick labels. */
export function plotBox(
  width: number,
  height: number,
  yLabelChars: number,
  opts?: { right?: number; top?: number },
): PlotBox {
  const left = Math.min(Math.round(width * 0.3), Math.max(40, Math.round(yLabelChars * 7 + 14)));
  const right = width - (opts?.right ?? 12);
  const top = opts?.top ?? 14;
  const bottom = height - 44;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

/** Chart height from width: 220 px minimum on phones, capped on wide screens. */
export function chartHeight(width: number, ratio = 0.52): number {
  return Math.round(Math.min(380, Math.max(220, width * ratio)));
}

export function YAxis({
  box,
  scale,
  ticks,
}: {
  box: PlotBox;
  scale: Scale;
  ticks: Tick[];
}): JSX.Element {
  return (
    <g class="sp-yaxis">
      {ticks.map((t) => (
        <g key={t.v}>
          <line class="sp-grid" x1={box.left} x2={box.right} y1={scale(t.v)} y2={scale(t.v)} />
          <text
            class="sp-axis-text"
            x={box.left - 6}
            y={scale(t.v)}
            text-anchor="end"
            dominant-baseline="central"
          >
            {t.label}
          </text>
        </g>
      ))}
    </g>
  );
}

export function XAxis({
  box,
  scale,
  ticks,
  label,
}: {
  box: PlotBox;
  scale: Scale;
  ticks: Tick[];
  label?: string;
}): JSX.Element {
  return (
    <g class="sp-xaxis">
      <line class="sp-axis" x1={box.left} x2={box.right} y1={box.bottom} y2={box.bottom} />
      {ticks.map((t) => (
        <g key={t.v}>
          <line
            class="sp-axis"
            x1={scale(t.v)}
            x2={scale(t.v)}
            y1={box.bottom}
            y2={box.bottom + 4}
          />
          <text class="sp-axis-text" x={scale(t.v)} y={box.bottom + 18} text-anchor="middle">
            {t.label}
          </text>
        </g>
      ))}
      {label ? (
        <text
          class="sp-axis-text"
          x={(box.left + box.right) / 2}
          y={box.bottom + 38}
          text-anchor="middle"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

/** A labelled vertical or horizontal reference line (zero line, expected line, target). */
export function RefLine({
  box,
  orientation,
  at,
  label,
  dash,
  stroke = 'var(--zero)',
  strokeWidth = 1.5,
  labelRow = 0,
  anchor,
}: {
  box: PlotBox;
  orientation: 'v' | 'h';
  at: number;
  label: string;
  dash?: string;
  stroke?: string;
  strokeWidth?: number;
  labelRow?: number;
  anchor?: 'start' | 'end';
}): JSX.Element {
  if (orientation === 'v') {
    const a = anchor ?? (at > (box.left + box.right) / 2 ? 'end' : 'start');
    return (
      <g class="sp-ref" data-ref={label}>
        <line
          x1={at}
          x2={at}
          y1={box.top}
          y2={box.bottom}
          stroke={stroke}
          stroke-width={strokeWidth}
          stroke-dasharray={dash}
        />
        <text
          class="sp-halo"
          x={at + (a === 'start' ? 4 : -4)}
          y={box.top + 10 + labelRow * 14}
          text-anchor={a}
        >
          {label}
        </text>
      </g>
    );
  }
  return (
    <g class="sp-ref" data-ref={label}>
      <line
        x1={box.left}
        x2={box.right}
        y1={at}
        y2={at}
        stroke={stroke}
        stroke-width={strokeWidth}
        stroke-dasharray={dash}
      />
      <text class="sp-halo" x={box.right - 4} y={at - 5 - labelRow * 14} text-anchor="end">
        {label}
      </text>
    </g>
  );
}
