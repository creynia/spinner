// Compare: 2 to 6 runs side by side, overlaid histograms and fan medians, a difference column
// with its interval, and the method label (paired by session, or Welch).
import { useMemo, useState } from 'preact/hooks';
import type { DiffEstimate, PairDiff, RunMetrics } from '../../contracts/analysis';
import type { RunData } from '../../contracts/run';
import { compareRuns, fanChart } from '../../analysis';
import { FanChart, OverlayHistogram } from '../charts';
import { Card, Segmented } from '../kit';
import { fmtInt, fmtNum, fmtPct, makeFramer, type MoneyFraming } from './format';

export interface CompareRun {
  id: string;
  label: string;
  data: RunData;
}

export interface CompareViewProps {
  runs: CompareRun[];
  tableMax?: number;
  framing: MoneyFraming;
}

export const METHOD_PAIRED = 'Paired by session (same seed: common random numbers)';
export const METHOD_WELCH = 'Unpaired (Welch): the runs use different seeds or versions';

interface MetricDef {
  id: string;
  label: string;
  kind: 'money' | 'pct' | 'num';
  value: (m: RunMetrics) => number;
  ci: (m: RunMetrics) => [number, number] | null;
  diff: (d: PairDiff) => DiffEstimate | null;
}

const ci = (e: { ci?: { lo: number; hi: number } }): [number, number] | null =>
  e.ci ? [e.ci.lo, e.ci.hi] : null;

const METRICS: MetricDef[] = [
  {
    id: 'mean-net',
    label: 'Mean net',
    kind: 'money',
    value: (m) => m.net.mean.value,
    ci: (m) => ci(m.net.mean),
    diff: (d) => d.meanNet,
  },
  {
    id: 'expected-loss',
    label: 'Mean expected loss',
    kind: 'money',
    value: (m) => m.expected.meanExpectedLoss,
    ci: () => null,
    diff: (d) => d.meanExpectedLoss,
  },
  {
    id: 'p-ahead',
    label: 'P(ahead)',
    kind: 'pct',
    value: (m) => m.probabilities.ahead.p,
    ci: (m) => [m.probabilities.ahead.ci.lo, m.probabilities.ahead.ci.hi],
    diff: (d) => d.probabilities.ahead,
  },
  {
    id: 'p-bust',
    label: 'P(bust)',
    kind: 'pct',
    value: (m) => m.probabilities.bust.p,
    ci: (m) => [m.probabilities.bust.ci.lo, m.probabilities.bust.ci.hi],
    diff: (d) => d.probabilities.bust,
  },
  {
    id: 'p-stop-win',
    label: 'P(stop-win)',
    kind: 'pct',
    value: (m) => m.probabilities.stopWin.p,
    ci: (m) => [m.probabilities.stopWin.ci.lo, m.probabilities.stopWin.ci.hi],
    diff: (d) => d.probabilities.stopWin,
  },
  {
    id: 'p-stop-loss',
    label: 'P(stop-loss)',
    kind: 'pct',
    value: (m) => m.probabilities.stopLoss.p,
    ci: (m) => [m.probabilities.stopLoss.ci.lo, m.probabilities.stopLoss.ci.hi],
    diff: (d) => d.probabilities.stopLoss,
  },
  {
    id: 'max-drawdown',
    label: 'Mean max drawdown',
    kind: 'money',
    value: (m) => m.drawdown.mean.value,
    ci: (m) => ci(m.drawdown.mean),
    diff: (d) => d.meanMaxDrawdown,
  },
  {
    id: 'rounds',
    label: 'Mean rounds played',
    kind: 'num',
    value: (m) => m.length.mean.value,
    ci: (m) => ci(m.length.mean),
    diff: (d) => d.meanRounds,
  },
  {
    id: 'edge',
    label: 'Realized edge',
    kind: 'pct',
    value: (m) => m.edge.realized?.value ?? NaN,
    ci: (m) => (m.edge.realized ? ci(m.edge.realized) : null),
    diff: (d) => d.realizedEdge,
  },
];

export function CompareView({ runs, tableMax, framing }: CompareViewProps) {
  const result = useMemo(
    () =>
      compareRuns(
        runs.map((r) => r.data),
        { tableMax },
      ),
    [runs, tableMax],
  );
  const [chart, setChart] = useState<'hist' | 'fan'>('hist');
  const base = result.metrics[0]!;
  const rph = runs[0]!.data.definition.session.roundsPerHour;
  const fr = makeFramer(framing, base.length.mean.value, rph);
  const paired = result.diffs.length > 0 && result.diffs.every((d) => d.method === 'paired');
  const mixed = result.diffs.some((d) => d.method !== result.diffs[0]!.method);
  const fans = useMemo(() => runs.map((r) => fanChart(r.data)), [runs]);

  const fmt = (def: MetricDef, v: number, sign = false): string => {
    if (!Number.isFinite(v)) return 'n/a';
    if (def.kind === 'money') return fr.money(v, { sign });
    if (def.kind === 'pct') return sign ? `${v >= 0 ? '+' : '-'}${fmtPct(Math.abs(v))}` : fmtPct(v);
    return sign ? `${v >= 0 ? '+' : '-'}${fmtNum(Math.abs(v), 1)}` : fmtNum(v, 1);
  };
  const method = mixed
    ? 'Mixed: some runs are paired with the first, some are not'
    : paired
      ? METHOD_PAIRED
      : METHOD_WELCH;

  return (
    <div class="compare" data-method={mixed ? 'mixed' : paired ? 'paired' : 'welch'}>
      <p class="method-note" role="note" data-method-label>
        <strong>Method:</strong> {method}. Differences are against {runs[0]!.label}
        {runs.length > 2 ? ', without correction for comparing several runs' : ''}. Amounts are{' '}
        {fr.unit}.
      </p>
      {result.diffs.some((d) => d.crn) ? (
        <p class="muted">
          {result.diffs.map((d, i) =>
            d.crn ? (
              <span key={i}>
                {runs[i + 1]!.label}: correlation with the first run {fmtNum(d.crn.rho, 2)},
                variance reduction {fmtPct(Math.max(0, d.crn.varianceReduction))}.{' '}
              </span>
            ) : null,
          )}
        </p>
      ) : null}
      {result.diffs.flatMap((d, i) =>
        d.notes.map((n) => (
          <p key={`${i}-${n}`} class="muted" data-note>
            {runs[i + 1]!.label}: {n}.
          </p>
        )),
      )}
      <div class="metric-cards">
        {METRICS.map((def) => (
          <Card key={def.id} title={def.label} level={3} class="metric-card">
            <table class="plain-table" data-metric={def.id}>
              <caption class="visually-hidden">
                {def.label} for each run, with the difference from the first run
              </caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col" class="num">
                    Value
                  </th>
                  <th scope="col" class="num">
                    Difference (95% CI)
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => {
                  const m = result.metrics[i]!;
                  const v = def.value(m);
                  const c = def.ci(m);
                  const d = i > 0 ? def.diff(result.diffs[i - 1]!) : null;
                  return (
                    <tr key={r.id}>
                      <th scope="row">{r.label}</th>
                      <td class="num">
                        {fmt(def, v)}
                        {c ? (
                          <span class="ci-line">
                            {fmt(def, c[0])} to {fmt(def, c[1])}
                          </span>
                        ) : null}
                      </td>
                      <td class="num" data-diff={i}>
                        {i === 0 ? (
                          <span class="muted">baseline</span>
                        ) : d ? (
                          <>
                            {fmt(def, d.value, true)}
                            <span class="ci-line">
                              {fmt(def, d.ci.lo, true)} to {fmt(def, d.ci.hi, true)}
                            </span>
                          </>
                        ) : (
                          <span class="muted">n/a</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
      <Card title="Overlays">
        <Segmented
          label="Chart"
          value={chart}
          onChange={setChart}
          options={[
            { value: 'hist', label: 'Distribution' },
            { value: 'fan', label: 'Paths' },
          ]}
        />
        {chart === 'hist' ? (
          <OverlayHistogram
            lo={result.sharedHistogram.lo}
            width={result.sharedHistogram.width}
            series={runs.map((r, i) => ({
              id: r.id,
              label: r.label,
              counts: result.sharedHistogram.counts[i]!,
            }))}
            markers={{ zero: 0 }}
            title={`Net result per session (${fr.unit})`}
            fmt={(c) => fr.money(c)}
            axisFmt={(c) => fr.money(c)}
          />
        ) : (
          <FanChart
            fan={fans[0]!}
            label={runs[0]!.label}
            title="Median net by round, with the first run's middle 50%"
            overlays={runs.slice(1).map((r, i) => ({
              id: r.id,
              label: r.label,
              rounds: fans[i + 1]!.rounds,
              p50: fans[i + 1]!.p50,
            }))}
          />
        )}
        <p class="muted">
          {fmtInt(runs.length)} runs; sessions compared:{' '}
          {result.diffs.map((d) => fmtInt(d.n)).join(', ')}.
        </p>
      </Card>
    </div>
  );
}
