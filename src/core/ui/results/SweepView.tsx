// Sweep results: metric-vs-parameter charts and a table of the variants.
import { useMemo } from 'preact/hooks';
import type { RunData } from '../../contracts/run';
import { sweepResult } from '../../analysis';
import { SweepChart } from '../charts';
import { Card } from '../kit';
import { fmtInt, fmtMoney, fmtPct, makeFramer, type MoneyFraming } from './format';

export interface SweepViewProps {
  path: string;
  values: unknown[];
  runs: RunData[];
  tableMax?: number;
  framing: MoneyFraming;
  valueFmt?: (v: unknown) => string;
}

export function SweepView({ path, values, runs, tableMax, framing, valueFmt }: SweepViewProps) {
  const sweep = useMemo(
    () => sweepResult(path, values, runs, { tableMax }),
    [path, values, runs, tableMax],
  );
  const vf = valueFmt ?? ((v: unknown) => String(v));
  const rph = runs[0]?.definition.session.roundsPerHour ?? 40;
  // Each variant is scaled by its own mean rounds; the chart and step differences are per session.
  const frs = sweep.points.map((p) => makeFramer(framing, p.metrics.length.mean.value, rph));
  const fr = frs[0] ?? makeFramer('session', 0, rph);
  return (
    <>
      <Card title="Metric against parameter">
        <SweepChart
          sweep={sweep}
          parameterLabel={path}
          valueFmt={vf}
          fmt={(c) => fmtMoney(c)}
          axisFmt={(c) => fmtMoney(c)}
        />
        <p class="muted">
          All variants use the same seed, so differences between neighbours are paired by session.
          The chart is per session; the table is {fr.unit}.
        </p>
      </Card>
      <Card title="Variants">
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Variants, scrolls sideways"
        >
          <table class="plain-table" data-variants>
            <caption class="visually-hidden">One row per value of {path}</caption>
            <thead>
              <tr>
                <th scope="col">Value</th>
                <th scope="col" class="num">
                  Mean net
                </th>
                <th scope="col" class="num">
                  95% CI
                </th>
                <th scope="col" class="num">
                  P(ahead)
                </th>
                <th scope="col" class="num">
                  P(bust)
                </th>
                <th scope="col" class="num">
                  Step difference
                </th>
              </tr>
            </thead>
            <tbody>
              {sweep.points.map((p, i) => {
                const m = p.metrics;
                const ci = m.net.mean.ci;
                const adj = i > 0 ? sweep.adjacent[i - 1] : null;
                return (
                  <tr key={p.runId}>
                    <th scope="row">{vf(p.value)}</th>
                    <td class="num">{frs[i]!.money(m.net.mean.value, { sign: true })}</td>
                    <td class="num">
                      {ci
                        ? `${frs[i]!.money(ci.lo, { sign: true })} to ${frs[i]!.money(ci.hi, { sign: true })}`
                        : 'too few sessions'}
                    </td>
                    <td class="num">
                      {fmtPct(m.probabilities.ahead.p)} ({fmtPct(m.probabilities.ahead.ci.lo)} to{' '}
                      {fmtPct(m.probabilities.ahead.ci.hi)})
                    </td>
                    <td class="num">
                      {fmtPct(m.probabilities.bust.p)} ({fmtPct(m.probabilities.bust.ci.lo)} to{' '}
                      {fmtPct(m.probabilities.bust.ci.hi)})
                    </td>
                    <td class="num">
                      {adj
                        ? `${fmtMoney(adj.meanNet.value, { sign: true })} (${fmtMoney(adj.meanNet.ci.lo, { sign: true })} to ${fmtMoney(adj.meanNet.ci.hi, { sign: true })})`
                        : 'first'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p class="muted" data-method-label>
          {fmtInt(sweep.points.length)} variants. Step differences:{' '}
          {sweep.adjacent.every((d) => d.method === 'paired')
            ? 'paired by session (same seed)'
            : 'unpaired (Welch)'}
          .
        </p>
      </Card>
    </>
  );
}
