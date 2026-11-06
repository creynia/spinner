// Chapter "hits": the chance of at least one hit within n spins, one line per count of numbers
// covered. Tap or drag on the plot (or use the arrow keys) to pick a spin and read the exact chance
// of every line there. In a ChartFrame, so the data table is the accessible path; the readout under
// the chart is a polite live region.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ChartFrame, ChartSvg, type LegendItem } from '@core/ui';
import type { Chapter } from './content';
import {
  BET_COUNTS,
  MAX_CUSTOM,
  WHEELS,
  hitChance,
  pct2,
  spinsFor,
  tableSpins,
  validCount,
  type Wheel,
} from './hitChance';
import { TableWrap, chartHeight, niceTicks, scaleLinear, seriesColor, useWidth } from './kit';
import './chapters-hits.css';

export const SPAN_CHOICES = [50, 150, 300] as const;
export const DEFAULT_COUNTS: readonly number[] = [1, 6, 12, 18];
export const DEFAULT_SPANS = 150;
const DEFAULT_SPIN = 37;
const TARGETS = [0.5, 0.9, 0.95, 0.99] as const;
const DASHES: (string | undefined)[] = [undefined, '8 4', '2 3', '10 3 2 3', '16 5', '4 4'];

const LEFT = 44;
const RIGHT = 14;
const TOP = 12;

const numbers = (k: number): string => `${k} ${k === 1 ? 'number' : 'numbers'}`;
const sortedUnique = (list: number[]): number[] => [...new Set(list)].sort((a, b) => a - b);

export function ChHits(_props: { chapter: Chapter }): JSX.Element {
  const [wheel, setWheel] = useState<Wheel>(WHEELS[0]!);
  const [counts, setCounts] = useState<number[]>([...DEFAULT_COUNTS]);
  const [custom, setCustom] = useState<number[]>([]);
  const [max, setMax] = useState<number>(DEFAULT_SPANS);
  const [spin, setSpin] = useState<number>(DEFAULT_SPIN);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [pressed, setPressed] = useState(false);

  const { ref, width } = useWidth();
  const height = chartHeight(width);
  const left = LEFT;
  const right = width - RIGHT;
  const bottom = height - 40;
  const x = scaleLinear(1, max, left, right);
  const y = scaleLinear(0, 1, bottom, TOP);
  const xTicks = [
    1,
    ...niceTicks(1, max, Math.max(2, Math.floor((right - left) / 60))).filter((v) => v > 1),
  ];
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const n = Math.min(spin, max);
  const chips = sortedUnique([...BET_COUNTS, ...custom]);
  const pockets = wheel.pockets;

  const lines = counts.map((k, i) => {
    const pts: string[] = [];
    for (let s = 1; s <= max; s++) {
      pts.push(
        `${s === 1 ? 'M' : 'L'}${x(s).toFixed(1)} ${y(hitChance(k, pockets, s)).toFixed(1)}`,
      );
    }
    return { k, i, color: seriesColor((i % 6) + 1), dash: DASHES[i % 6], d: pts.join('') };
  });

  const pick = (clientX: number, svg: SVGSVGElement): void => {
    const r = svg.getBoundingClientRect();
    const px = (clientX - r.left) * (r.width > 0 ? width / r.width : 1);
    const s = Math.round(1 + ((px - left) / (right - left)) * (max - 1));
    setSpin(Math.max(1, Math.min(max, s)));
  };

  const toggle = (k: number): void =>
    setCounts((cur) => (cur.includes(k) ? cur.filter((c) => c !== k) : sortedUnique([...cur, k])));

  const addCustom = (e: Event): void => {
    e.preventDefault();
    const k = Number(text.trim());
    if (text.trim() === '' || !validCount(k)) {
      setNote(`Enter a whole number from 1 to ${MAX_CUSTOM}.`);
      return;
    }
    setNote('');
    setText('');
    if (!BET_COUNTS.includes(k)) setCustom((cur) => sortedUnique([...cur, k]));
    setCounts((cur) => sortedUnique([...cur, k]));
  };

  const legend: LegendItem[] = lines.map((l) => ({
    label: numbers(l.k),
    color: l.i % 6,
    dash: l.dash,
  }));

  const summary = counts.length
    ? `${wheel.label} wheel, spins 1 to ${max}. Spins to a 50 % chance: ${counts
        .map((k) => `${numbers(k)} ${spinsFor(k, pockets, 0.5)}`)
        .join(', ')}.`
    : 'No count of numbers is selected, so no line is drawn.';

  const stepSpins = tableSpins(max);
  const table = {
    caption: `Chance of at least one hit by spin, ${wheel.label} wheel`,
    columns: ['Spins', ...counts.map(numbers)],
    rows: stepSpins.map((s) => [s, ...counts.map((k) => pct2(hitChance(k, pockets, s)))]),
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const big = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = n + big;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = n - big;
    else if (e.key === 'PageUp') next = n + 10;
    else if (e.key === 'PageDown') next = n - 10;
    else if (e.key === 'Home') next = 1;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    setSpin(Math.max(1, Math.min(max, next)));
  };

  return (
    <div class="hits">
      <fieldset class="hits-group">
        <legend>Wheel</legend>
        <div class="chips">
          {WHEELS.map((w) => (
            <button
              type="button"
              class="chip hits-chip"
              aria-pressed={w.id === wheel.id}
              onClick={() => setWheel(w)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset class="hits-group">
        <legend>Numbers covered (pick any)</legend>
        <div class="chips">
          {chips.map((k) => (
            <button
              type="button"
              class="chip hits-chip"
              aria-pressed={counts.includes(k)}
              aria-label={numbers(k)}
              onClick={() => toggle(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <form class="hits-custom" onSubmit={addCustom} noValidate>
          <label for="hits-custom-input">Another count</label>
          <input
            id="hits-custom-input"
            class="input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={`1 to ${MAX_CUSTOM}`}
            value={text}
            aria-invalid={note ? 'true' : undefined}
            aria-describedby={note ? 'hits-custom-note' : undefined}
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <button type="submit" class="btn">
            Add
          </button>
        </form>
        <p id="hits-custom-note" class="hits-note" role={note ? 'alert' : undefined}>
          {note}
        </p>
      </fieldset>
      <fieldset class="hits-group">
        <legend>Spins shown</legend>
        <div class="chips">
          {SPAN_CHOICES.map((m) => (
            <button
              type="button"
              class="chip hits-chip"
              aria-pressed={m === max}
              onClick={() => setMax(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </fieldset>

      <ChartFrame
        title="Chance of at least one hit, by number of spins"
        summary={summary}
        table={table}
        legend={legend}
        plotRef={ref}
        class="hits-chart"
      >
        <ChartSvg
          width={width}
          height={height}
          svgProps={{
            class: 'sp-chart__svg hits-svg',
            'aria-description': 'Tap or use the arrow keys to pick a spin.',
            onKeyDown,
            onClick: (e) => pick(e.clientX, e.currentTarget),
            onPointerDown: (e) => {
              setPressed(true);
              pick(e.clientX, e.currentTarget);
            },
            onPointerMove: (e) => {
              if (pressed && e.pointerType !== 'mouse') pick(e.clientX, e.currentTarget);
              else if (e.buttons === 1) pick(e.clientX, e.currentTarget);
            },
            onPointerUp: () => setPressed(false),
            onPointerCancel: () => setPressed(false),
          }}
        >
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
                  {`${v * 100}%`}
                </text>
              </g>
            ))}
          </g>
          <g class="sp-vticks">
            {xTicks.map((v) => (
              <text key={v} class="sp-axis-text" x={x(v)} y={bottom + 16} text-anchor="middle">
                {v}
              </text>
            ))}
          </g>
          <line class="sp-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
          <text class="sp-axis-text" x={(left + right) / 2} y={height - 6} text-anchor="middle">
            Spins
          </text>
          <rect class="sp-hit" x={left} y={TOP} width={right - left} height={bottom - TOP} />
          {lines.map((l) => (
            <path
              key={l.k}
              class="hits-line"
              data-k={l.k}
              d={l.d}
              fill="none"
              stroke={l.color}
              stroke-width="2.5"
              stroke-dasharray={l.dash}
              stroke-linejoin="round"
            />
          ))}
          <line
            class="hits-guide"
            x1={x(n)}
            x2={x(n)}
            y1={TOP}
            y2={bottom}
            stroke="var(--chart-axis)"
            stroke-width="1.5"
            stroke-dasharray="3 3"
          />
          {lines.map((l) => (
            <circle
              key={l.k}
              class="hits-dot"
              data-k={l.k}
              cx={x(n)}
              cy={y(hitChance(l.k, pockets, n))}
              r="5"
              fill={l.color}
              stroke="var(--surface)"
              stroke-width="2"
            />
          ))}
        </ChartSvg>
      </ChartFrame>

      <div class="hits-readout" aria-live="polite" data-spin={n}>
        <p class="hits-readout-head">
          After <strong>{n}</strong> {n === 1 ? 'spin' : 'spins'}, chance of at least one hit
        </p>
        {lines.length ? (
          <ul>
            {lines.map((l) => (
              <li key={l.k}>
                <svg width="28" height="12" aria-hidden="true" focusable="false">
                  <line
                    x1="1"
                    x2="27"
                    y1="6"
                    y2="6"
                    stroke={l.color}
                    stroke-width="2.5"
                    stroke-dasharray={l.dash}
                  />
                </svg>
                <span>{numbers(l.k)}</span>
                <strong>{pct2(hitChance(l.k, pockets, n))}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p class="hits-note">Pick at least one count of numbers above.</p>
        )}
      </div>

      {counts.length ? (
        <TableWrap label={`Spins needed, ${wheel.label} wheel`}>
          <table class="research-table">
            <caption class="hits-caption">Spins needed to reach a chance of a hit</caption>
            <thead>
              <tr>
                <th scope="col">Numbers</th>
                {TARGETS.map((t) => (
                  <th scope="col">{Math.round(t * 100)} %</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {counts.map((k) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  {TARGETS.map((t) => (
                    <td>{spinsFor(k, pockets, t)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </div>
  );
}
