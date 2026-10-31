// Chapter 2, Why doubling feels like it works: the typical (median) session path of flat betting,
// Martingale and Fibonacci on red, with Martingale's middle 80 % band, and a vertical mark at the
// spin where the Martingale typical session stops being ahead (`medianAheadUntil`, spin 290).
// `LineBand` (core) has no vertical reference line, so the chart is drawn here with ChartFrame and
// ChartSvg, in the same visual language: dashes tell the lines apart as well as colour.
import { ChartFrame, ChartSvg, type LegendItem } from '@core/ui';
import './chapters-0-3.css';
import type { Chapter } from './content';
import { path, row } from './data';
import {
  axisMoney,
  chartHeight,
  money,
  niceDomain,
  niceTicks,
  scaleLinear,
  seriesColor,
  spins,
  tickCountFor,
  useWidth,
} from './kit';

const FLAT = 'observations:flat-red';
const MART = 'observations:martingale-red';
const FIB = 'observations:fibonacci-red';

/** Dash patterns by series position (solid, dashed, dotted), the same as the core line charts. */
const DASH: (string | undefined)[] = [undefined, '8 4', '2 3'];

const linePath = (xs: number[], ys: number[]): string =>
  xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${ys[i]!.toFixed(1)}`).join('');

const bandPath = (xs: number[], lo: number[], hi: number[]): string =>
  `${linePath(xs, lo)}${xs
    .map((_, i) => {
      const k = xs.length - 1 - i;
      return `L${xs[k]!.toFixed(1)} ${hi[k]!.toFixed(1)}`;
    })
    .join('')}Z`;

export function ChMartingale(_props: { chapter: Chapter }) {
  const flat = path(FLAT);
  const mart = path(MART);
  const fib = path(FIB);
  const martRow = row(MART);
  const fibRow = row(FIB);
  const flatRow = row(FLAT);
  const turn = martRow.medianAheadUntil;
  const { ref, width } = useWidth();
  const height = chartHeight(width);

  const lines = [
    { id: 'flat', label: 'Flat $25 on red', y: flat.p50 },
    { id: 'martingale', label: 'Martingale', y: mart.p50 },
    { id: 'fibonacci', label: 'Fibonacci', y: fib.p50 },
  ];
  const bandLabel = 'Martingale, middle 80 %';
  const all = [...flat.p50, ...mart.p50, ...fib.p50, ...mart.p10, ...mart.p90, 0];
  const [y0, y1] = niceDomain(Math.min(...all), Math.max(...all), 5);
  const yTicks = niceTicks(y0, y1, 5);
  const left = Math.min(
    Math.round(width * 0.3),
    Math.max(40, yTicks.reduce((m, v) => Math.max(m, axisMoney(v).length), 4) * 7 + 14),
  );
  const right = width - 12;
  const top = 14;
  const bottom = height - 44;
  const xMax = Math.max(...flat.rounds);
  const x = scaleLinear(0, xMax, left, right);
  const y = scaleLinear(y0, y1, bottom, top);
  const xTicks = niceTicks(0, xMax, tickCountFor(right - left, 80));
  const px = flat.rounds.map(x);
  const turnX = turn !== null && turn > 0 && turn < xMax ? x(turn) : null;
  const turnLabel = `Spin ${spins(turn ?? 0)}`;
  const labelAnchor = turnX !== null && turnX > (left + right) / 2 ? 'end' : 'start';

  const summary =
    `The typical Martingale session peaks at ${money(martRow.medianPeak.net)} at spin ${spins(martRow.medianPeak.round)}` +
    (turn === null
      ? ' and is never ahead.'
      : turn >= xMax
        ? ' and is still ahead at the end.'
        : `, is ahead until spin ${spins(turn)} and ends at ${money(martRow.median)}`) +
    `; the typical Fibonacci session ends at ${money(fibRow.median)} and flat betting at ${money(flatRow.median)}.`;

  const legend: LegendItem[] = [
    ...lines.map((l, i) => ({ label: l.label, color: i, dash: DASH[i] })),
    { label: bandLabel, color: 1, swatch: 'band', opacity: 0.18 },
  ];

  return (
    <ChartFrame
      title="Typical session by spin, on red"
      summary={summary}
      table={{
        columns: [
          'Spin',
          'Flat typical',
          'Martingale typical',
          'Martingale 10th pct',
          'Martingale 90th pct',
          'Fibonacci typical',
        ],
        rows: flat.rounds.map((r, i) => [
          `spin ${spins(r)}`,
          money(flat.p50[i]!),
          money(mart.p50[i]!),
          money(mart.p10[i]!),
          money(mart.p90[i]!),
          money(fib.p50[i]!),
        ]),
      }}
      legend={legend}
      plotRef={ref}
      class="sp-lineband"
    >
      <ChartSvg width={width} height={height}>
        <g class="sp-yaxis">
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
                {axisMoney(v)}
              </text>
            </g>
          ))}
        </g>
        <g class="sp-xaxis">
          <line class="sp-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
          {xTicks.map((v) => (
            <g key={v}>
              <line class="sp-axis" x1={x(v)} x2={x(v)} y1={bottom} y2={bottom + 4} />
              <text class="sp-axis-text" x={x(v)} y={bottom + 18} text-anchor="middle">
                {spins(v)}
              </text>
            </g>
          ))}
          <text class="sp-axis-text" x={(left + right) / 2} y={bottom + 38} text-anchor="middle">
            Spin
          </text>
        </g>
        <g class="sp-ref" data-ref="Break-even">
          <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="var(--zero)" stroke-width="1.5" />
          <text class="sp-halo" x={right - 4} y={y(0) - 5} text-anchor="end">
            Break-even
          </text>
        </g>
        <path
          class="sp-band"
          data-series="martingale"
          d={bandPath(px, mart.p10.map(y), mart.p90.map(y))}
          fill={seriesColor(2)}
          fill-opacity="0.18"
          stroke={seriesColor(2)}
          stroke-opacity="0.35"
          stroke-width="1"
          stroke-dasharray="2 3"
        />
        {turnX !== null ? (
          <g class="sp-ref" data-ref="turn">
            <line
              x1={turnX}
              x2={turnX}
              y1={top}
              y2={bottom}
              stroke="var(--zero)"
              stroke-width="1.5"
              stroke-dasharray="4 4"
            />
            <text
              class="sp-halo"
              x={turnX + (labelAnchor === 'start' ? 4 : -4)}
              y={top + 10}
              text-anchor={labelAnchor}
            >
              {turnLabel}
            </text>
            <text
              class="sp-halo"
              x={turnX + (labelAnchor === 'start' ? 4 : -4)}
              y={top + 24}
              text-anchor={labelAnchor}
            >
              Martingale turns
            </text>
          </g>
        ) : null}
        {lines.map((l, i) => (
          <path
            key={l.id}
            class="sp-line"
            data-series={l.id}
            d={linePath(px, l.y.map(y))}
            fill="none"
            stroke={seriesColor(i + 1)}
            stroke-width="2.5"
            stroke-dasharray={DASH[i]}
            stroke-linejoin="round"
          />
        ))}
      </ChartSvg>
    </ChartFrame>
  );
}
