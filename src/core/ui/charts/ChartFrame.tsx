import { createContext } from 'preact';
import type { ComponentChildren, JSX, Ref } from 'preact';
import { useContext, useId } from 'preact/hooks';
import './charts.css';

export interface TableSpec {
  caption?: string;
  columns: string[];
  rows: (string | number)[][];
}
export interface TooltipSpec {
  /** pixel x inside the plot box */
  x: number;
  title: string;
  lines: string[];
}
export interface LegendItem {
  label: string;
  /** 0-based series colour index (--chart-1..6) */
  color: number;
  dash?: string;
  swatch?: 'line' | 'band' | 'box';
  opacity?: number;
}

/** Colour variable for series `i`, cycling through the six chart tokens. */
export const seriesColor = (i: number): string => `var(--chart-${(i % 6) + 1})`;
/** Dash patterns so series differ without colour: solid, dashed, dotted, dash-dot, long, short. */
export const SERIES_DASH: (string | undefined)[] = [
  undefined,
  '8 4',
  '2 3',
  '10 3 2 3',
  '16 5',
  '4 4',
];
export const dashFor = (i: number): string | undefined => SERIES_DASH[i % SERIES_DASH.length];

interface Ids {
  title: string;
  summary: string;
}
const IdsContext = createContext<Ids>({ title: '', summary: '' });

export interface ChartFrameProps {
  title: string;
  /** computed one-sentence summary, shown and announced */
  summary: string;
  table: TableSpec;
  legend?: LegendItem[];
  plotRef: Ref<HTMLDivElement>;
  tooltip?: TooltipSpec | null;
  /** the `<ChartSvg>` */
  children: ComponentChildren;
  class?: string;
}

function LegendSwatch({ item }: { item: LegendItem }): JSX.Element {
  const c = seriesColor(item.color);
  return (
    <svg width="28" height="12" aria-hidden="true" focusable="false">
      {item.swatch === 'band' || item.swatch === 'box' ? (
        <rect
          x="1"
          y="1"
          width="26"
          height="10"
          fill={c}
          fillOpacity={item.opacity ?? 0.3}
          stroke={c}
        />
      ) : (
        <line
          x1="1"
          x2="27"
          y1="6"
          y2="6"
          stroke={c}
          stroke-width="2.5"
          stroke-dasharray={item.dash}
        />
      )}
    </svg>
  );
}

export function Legend({ items }: { items: LegendItem[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <ul class="sp-chart__legend" aria-label="Legend">
      {items.map((it) => (
        <li key={it.label}>
          <LegendSwatch item={it} />
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ table }: { table: TableSpec }): JSX.Element {
  return (
    <details class="sp-chart__table">
      <summary>Data table</summary>
      <div
        class="sp-chart__tablewrap"
        tabIndex={0}
        role="region"
        aria-label={`${table.caption ?? 'Chart'} data`}
      >
        <table>
          {table.caption ? <caption>{table.caption}</caption> : null}
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={j}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** figure > title, plot (svg + tooltip), legend, summary, data-table toggle. */
export function ChartFrame(props: ChartFrameProps): JSX.Element {
  const uid = useId();
  const ids: Ids = { title: `${uid}-t`, summary: `${uid}-s` };
  const tip = props.tooltip;
  return (
    <figure class={`sp-chart ${props.class ?? ''}`.trim()} aria-labelledby={ids.title}>
      <figcaption id={ids.title} class="sp-chart__title">
        {props.title}
      </figcaption>
      <IdsContext.Provider value={ids}>
        <div class="sp-chart__plot" ref={props.plotRef}>
          {props.children}
          <div
            class="sp-chart__tip"
            hidden={!tip}
            aria-live="polite"
            style={tip ? tipStyle(tip.x) : undefined}
          >
            {tip ? (
              <>
                <strong>{tip.title}</strong>
                {tip.lines.map((l, i) => (
                  <span key={i} style="display:block">
                    {l}
                  </span>
                ))}
              </>
            ) : null}
          </div>
        </div>
      </IdsContext.Provider>
      {props.legend ? <Legend items={props.legend} /> : null}
      <p id={ids.summary} class="sp-chart__summary">
        {props.summary}
      </p>
      <DataTable table={{ ...props.table, caption: props.table.caption ?? props.title }} />
    </figure>
  );
}

function tipStyle(x: number): string {
  // anchor the box left of a right-hand cursor so it stays inside the plot
  return x > 200 ? `right:calc(100% - ${Math.round(x)}px + 12px)` : `left:${Math.round(x) + 12}px`;
}

export interface ChartSvgProps {
  width: number;
  height: number;
  children: ComponentChildren;
  /** cursor/keyboard props from `useCursor` */
  svgProps?: JSX.HTMLAttributes<SVGSVGElement>;
}
/** The `<svg role="img">` named by the title and described by the summary. */
export function ChartSvg({ width, height, children, svgProps }: ChartSvgProps): JSX.Element {
  const ids = useContext(IdsContext);
  return (
    <svg
      class="sp-chart__svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-labelledby={`${ids.title} ${ids.summary}`}
      tabIndex={svgProps ? 0 : undefined}
      {...svgProps}
    >
      {children}
    </svg>
  );
}
