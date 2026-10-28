import type { JSX } from 'preact';
import type { Convergence } from '../../contracts/analysis';
import { formatMoney } from '../../money';
import { LineBand } from './LineBand';
import { formatAxisCount, formatAxisMoney, formatShare } from './geom/scale';
import { convergenceSummary } from './geom/summary';
import type { ConvergenceMetric } from './geom/summary';

export interface ConvergenceChartProps {
  convergence: Convergence;
  title: string;
  metric?: ConvergenceMetric;
  /** analytic expected net, drawn as a dashed reference line for the mean */
  expectedNet?: number;
  fmt?: (cents: number) => string;
  axisFmt?: (cents: number) => string;
}

/** Running estimate and its 95% interval as sessions accumulate (log x). */
export function ConvergenceChart(props: ConvergenceChartProps): JSX.Element {
  const c = props.convergence;
  const metric = props.metric ?? 'mean';
  const fmt = props.fmt ?? ((v: number) => formatMoney(v));
  const isMoney = metric === 'mean';
  const pick = {
    mean: { y: c.mean, lo: c.lo, hi: c.hi, label: 'Running mean net' },
    bust: { y: c.pBust, lo: c.pBustLo, hi: c.pBustHi, label: 'Running P(bust)' },
    ahead: { y: c.pAhead, lo: c.pAheadLo, hi: c.pAheadHi, label: 'Running P(ahead)' },
  }[metric];
  return (
    <LineBand
      class="sp-convergence"
      title={props.title}
      summary={convergenceSummary(c, metric, fmt)}
      x={c.n}
      xKind="log"
      xFmt={(v) => formatAxisCount(Math.round(v))}
      xAxisLabel="Sessions"
      yFmt={isMoney ? fmt : formatShare}
      yAxisFmt={isMoney ? (props.axisFmt ?? formatAxisMoney) : formatShare}
      yDomain={isMoney ? undefined : [0, 1]}
      series={[
        {
          id: metric,
          label: pick.label,
          y: pick.y,
          lo: pick.lo,
          hi: pick.hi,
          bandLabel: '95% interval',
        },
      ]}
      refs={
        isMoney && props.expectedNet !== undefined
          ? [
              {
                y: props.expectedNet,
                label: `expected ${fmt(props.expectedNet)}`,
                dash: '8 4',
                stroke: 'var(--line-expected)',
              },
            ]
          : undefined
      }
    />
  );
}
