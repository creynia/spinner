import type { JSX } from 'preact';
import type { SweepResult } from '../../contracts/analysis';
import { formatMoney } from '../../money';
import { LineBand } from './LineBand';
import { formatAxisMoney, formatShare } from './geom/scale';

export interface SweepChartProps {
  sweep: SweepResult;
  /** shown in titles, e.g. "Unit" for path strategy.unit */
  parameterLabel?: string;
  titlePrefix?: string;
  /** format a swept value for ticks and tables; default String(value) */
  valueFmt?: (v: unknown) => string;
  fmt?: (cents: number) => string;
  axisFmt?: (cents: number) => string;
}

/** Metric-vs-parameter: mean net with its p10-p90 band, and P(bust) with its Wilson interval. */
export function SweepChart(props: SweepChartProps): JSX.Element {
  const { sweep } = props;
  const fmt = props.fmt ?? ((v: number) => formatMoney(v));
  const vf = props.valueFmt ?? ((v: unknown) => String(v));
  const param = props.parameterLabel ?? sweep.path;
  const prefix = props.titlePrefix ?? 'Sweep';
  const pts = sweep.points;
  const numeric = pts.every((p) => typeof p.value === 'number');
  const kind = sweep.xScale === 'categorical' || !numeric ? 'categorical' : sweep.xScale;
  const x = pts.map((p, i) => (kind === 'categorical' ? i : (p.value as number)));
  const labels = pts.map((p) => vf(p.value));
  const xFmt = (v: number, i: number): string =>
    i >= 0 && kind === 'categorical' ? (labels[i] ?? '') : vf(v);
  const mean = pts.map((p) => p.metrics.net.mean.value);
  const p10 = pts.map((p) => p.metrics.net.q.p10);
  const p90 = pts.map((p) => p.metrics.net.q.p90);
  const bust = pts.map((p) => p.metrics.probabilities.bust.p);
  const bLo = pts.map((p) => p.metrics.probabilities.bust.ci.lo);
  const bHi = pts.map((p) => p.metrics.probabilities.bust.ci.hi);
  const best = mean.length ? mean.indexOf(Math.max(...mean)) : -1;
  const worst = mean.length ? mean.indexOf(Math.min(...mean)) : -1;
  const meanSummary =
    pts.length === 0
      ? 'No sweep points yet.'
      : `Mean net across ${pts.length} values of ${param}: highest ${fmt(mean[best]!)} at ${labels[best]}, lowest ${fmt(mean[worst]!)} at ${labels[worst]}. ` +
        `The shaded band is the 10th to 90th percentile of session results.`;
  const bustSummary =
    pts.length === 0
      ? 'No sweep points yet.'
      : `P(bust) runs from ${formatShare(Math.min(...bust))} at ${labels[bust.indexOf(Math.min(...bust))]} to ${formatShare(Math.max(...bust))} at ${labels[bust.indexOf(Math.max(...bust))]}. ` +
        `The shaded band is the 95% Wilson interval.`;
  return (
    <div class="sp-sweep" style="display:grid;gap:16px">
      <LineBand
        class="sp-lineband sp-sweep-mean"
        title={`${prefix}: net result vs ${param}`}
        summary={meanSummary}
        x={x}
        xKind={kind}
        xLabels={labels}
        xFmt={xFmt}
        xAxisLabel={param}
        yFmt={fmt}
        yAxisFmt={props.axisFmt ?? formatAxisMoney}
        series={[
          {
            id: 'mean',
            label: 'Mean net',
            y: mean,
            lo: p10,
            hi: p90,
            bandLabel: '10th to 90th percentile',
          },
        ]}
        refs={[{ y: 0, label: 'break-even' }]}
      />
      <LineBand
        class="sp-lineband sp-sweep-bust"
        title={`${prefix}: P(bust) vs ${param}`}
        summary={bustSummary}
        x={x}
        xKind={kind}
        xLabels={labels}
        xFmt={xFmt}
        xAxisLabel={param}
        yFmt={formatShare}
        yDomain={[0, Math.min(1, Math.max(0.05, Math.ceil(Math.max(0, ...bHi) * 10) / 10))]}
        series={[
          { id: 'bust', label: 'P(bust)', y: bust, lo: bLo, hi: bHi, bandLabel: '95% interval' },
        ]}
      />
    </div>
  );
}
