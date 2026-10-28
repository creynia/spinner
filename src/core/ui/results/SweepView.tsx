// Sweep results: metric-vs-parameter charts and a table of the variants.
import { useMemo } from 'preact/hooks';
import type { RunData } from '../../contracts/run';
import { sweepResult } from '../../analysis';
import { SweepChart } from '../charts';
import { Card } from '../kit';
import { fmtInt, fmtPct, makeFramer, type MoneyFraming } from './format';

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
  const fr = makeFramer(framing, sweep.points[0]?.metrics.length.mean.value ?? 0, rph);
  return (
    <>
      <Card title="Metric against parameter">
        <SweepChart
          sweep={sweep}
          parameterLabel={path}
          valueFmt={vf}
          fmt={(c) => fr.money(c)}
          axisFmt={(c) => fr.money(c)}
        />
        <p class="muted">
          All variants use the same seed, so differences between neighbours are paired by session.
          Amounts are {fr.unit}.
        </p>
      </Card>
      <Card title="Variants">
        <div class="table-scroll" tabIndex={0} role="region" aria-label="Table, scrolls sideways">
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
                    <td class="num">{fr.money(m.net.mean.value, { sign: true })}</td>
                    <td class="num">
                      {ci
                        ? `${fr.money(ci.lo, { sign: true })} to ${fr.money(ci.hi, { sign: true })}`
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
                        ? `${fr.money(adj.meanNet.value, { sign: true })} (${fr.money(adj.meanNet.ci.lo, { sign: true })} to ${fr.money(adj.meanNet.ci.hi, { sign: true })})`
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
