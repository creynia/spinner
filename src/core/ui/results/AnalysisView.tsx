import './results.css';
// The Analyze screen body: tabs Overview, Paths, Risk, Where the money went, Convergence,
// Sessions, Export. Pure over `RunData` (the screen loads it); analysis is memoized per run.
import { useMemo, useState } from 'preact/hooks';
import type { Distribution, Proportion, RunMetrics } from '../../contracts/analysis';
import type { RunData } from '../../contracts/run';
import { convergence, domainSize, fanChart, runMetrics, survival } from '../../analysis';
import {
  Bars,
  ConvergenceChart,
  FanChart,
  Histogram,
  SurvivalChart,
  categoryRows,
  stageRows,
} from '../charts';
import { Card, EmptyState, Segmented, Tabs } from '../kit';
import { ExportPanel } from './ExportPanel';
import { KeyNumbers, type KeyRow } from './KeyNumbers';
import { SessionsTable } from './SessionsTable';
import {
  fmtHours,
  fmtInt,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtZ,
  makeFramer,
  type Framer,
  type MoneyFraming,
} from './format';

export const ANALYZE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'paths', label: 'Paths' },
  { id: 'risk', label: 'Risk' },
  { id: 'money', label: 'Where the money went' },
  { id: 'convergence', label: 'Convergence' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'export', label: 'Export' },
] as const;
export type AnalyzeTab = (typeof ANALYZE_TABS)[number]['id'];

export function isAnalyzeTab(x: string | null | undefined): x is AnalyzeTab {
  return ANALYZE_TABS.some((t) => t.id === x);
}

export interface AnalysisViewProps {
  data: RunData;
  /** Even-money table maximum in cents; always passed to `runMetrics`. */
  tableMax?: number;
  framing: MoneyFraming;
  tab: AnalyzeTab;
  onTab: (t: AnalyzeTab) => void;
  /** Watch link per session, or null for a read-only bundle without re-simulation. */
  sessionHref?: (index: number) => string | null;
  onOpenSession?: (index: number) => void;
  baseUrl?: string;
}

const prop = (id: string, label: string, p: Proportion, hint?: string): KeyRow => ({
  id,
  label,
  value: fmtPct(p.p),
  interval: { lo: fmtPct(p.ci.lo), hi: fmtPct(p.ci.hi) },
  ...(hint ? { hint } : {}),
});

function meanRow(
  id: string,
  label: string,
  d: Distribution,
  fmt: (v: number) => string,
  hint?: string,
): KeyRow {
  const ci = d.mean.ci;
  return {
    id,
    label,
    value: fmt(d.mean.value),
    interval: ci ? { lo: fmt(ci.lo), hi: fmt(ci.hi) } : null,
    tooFew: !ci,
    ...(hint ? { hint } : {}),
  };
}

function quantileRows(prefix: string, d: Distribution, fmt: (v: number) => string): KeyRow[] {
  return (
    [
      ['p10', '10th percentile'],
      ['p50', 'Median'],
      ['p90', '90th percentile'],
      ['p99', '99th percentile'],
    ] as const
  ).map(([k, label]) => ({
    id: `${prefix}-${k}`,
    label,
    value: fmt(d.q[k]),
    interval: k === 'p50' && d.medianCI ? { lo: fmt(d.medianCI.lo), hi: fmt(d.medianCI.hi) } : null,
    tooFew: k === 'p50' && !d.medianCI,
  }));
}

export function verdictLine(m: RunMetrics, fr: Framer): string {
  const ci = m.net.mean.ci;
  const mean = fr.money(m.net.mean.value, { sign: true });
  const pm = ci ? ` ± ${fr.money((ci.hi - ci.lo) / 2)}` : '';
  const few = ci ? '' : ' (too few sessions for an interval)';
  return `mean ${mean}${pm} ${fr.unit} · P(ahead) ${fmtPct(m.probabilities.ahead.p)} · bust ${fmtPct(m.probabilities.bust.p)}${few}`;
}

function Warn({ children, id }: { children: preact.ComponentChildren; id: string }) {
  return (
    <div class="warn-card" role="note" data-warning={id}>
      <strong>Warning.</strong> {children}
    </div>
  );
}

function sum(a: ArrayLike<number>, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]!;
  return s;
}

export function AnalysisView(props: AnalysisViewProps) {
  const { data, framing, tab, onTab, tableMax } = props;
  const metrics = useMemo(() => runMetrics(data, { tableMax }), [data, tableMax]);
  const n = metrics.n;
  const fr = useMemo(
    () => makeFramer(framing, metrics.length.mean.value, data.definition.session.roundsPerHour),
    [framing, metrics, data],
  );
  const partial = n < data.meta.sessions;
  const adjusted = sum(data.summary.adjusted, n);
  const anomalies = sum(data.summary.anomalies, n);
  const b = metrics.breakdown;

  return (
    <div class="analysis" data-run={data.meta.runId}>
      {partial ? (
        <Warn id="partial">
          Analyzing the first {fmtInt(n)} of {fmtInt(data.meta.sessions)} sessions: the run did not
          finish.
        </Warn>
      ) : null}
      {n < 30 ? (
        <Warn id="few">
          Only {fmtInt(n)} sessions: intervals are hidden below 30 sessions, so read these as rough.
        </Warn>
      ) : null}
      <Tabs
        tabs={ANALYZE_TABS}
        value={tab}
        onChange={(t) => onTab(t as AnalyzeTab)}
        label="Analysis sections"
        idPrefix="an"
      >
        {tab === 'overview' ? <Overview {...{ data, metrics, fr, b, adjusted }} /> : null}
        {tab === 'paths' ? <Paths data={data} metrics={metrics} /> : null}
        {tab === 'risk' ? (
          <Risk metrics={metrics} tableMax={tableMax} bankroll={data.definition.session.bankroll} />
        ) : null}
        {tab === 'money' ? <Money {...{ metrics, adjusted, anomalies, n }} /> : null}
        {tab === 'convergence' ? <Conv data={data} metrics={metrics} fr={fr} /> : null}
        {tab === 'sessions' ? (
          <Card title="Sessions">
            <p class="muted">
              Every session of the run. Sort with the headers; select a row to watch that session.
            </p>
            <SessionsTable data={data} hrefFor={props.sessionHref} onOpen={props.onOpenSession} />
          </Card>
        ) : null}
        {tab === 'export' ? <ExportPanel data={data} baseUrl={props.baseUrl} /> : null}
      </Tabs>
    </div>
  );
}

function Overview({
  data,
  metrics: m,
  fr,
  b,
  adjusted,
}: {
  data: RunData;
  metrics: RunMetrics;
  fr: Framer;
  b: RunMetrics['breakdown'];
  adjusted: number;
}) {
  const e = m.edge;
  const exp = m.expected;
  const money = (v: number) => fr.money(v);
  const mean = m.net.mean;
  const rows: KeyRow[] = [
    {
      id: 'mean-net',
      label: `Mean net ${fr.unit}`,
      value: fr.money(mean.value, { sign: true }),
      interval: mean.ci
        ? { lo: fr.money(mean.ci.lo, { sign: true }), hi: fr.money(mean.ci.hi, { sign: true }) }
        : null,
      tooFew: !mean.ci,
      tone: mean.value >= 0 ? 'good' : 'bad',
    },
    {
      id: 'median-net',
      label: `Median net ${fr.unit}`,
      value: fr.money(m.net.q.p50, { sign: true }),
      interval: m.net.medianCI
        ? {
            lo: fr.money(m.net.medianCI.lo, { sign: true }),
            hi: fr.money(m.net.medianCI.hi, { sign: true }),
          }
        : null,
      tooFew: !m.net.medianCI,
    },
    { id: 'sd', label: `Spread (SD) ${fr.unit}`, value: fr.money(m.net.sd), interval: null },
    prop('p-ahead', 'P(ahead)', m.probabilities.ahead, 'finished with more than the bankroll'),
    prop('p-bust', 'P(bust)', m.probabilities.bust),
    prop('p-stop-win', 'P(stop-win)', m.probabilities.stopWin),
    prop('p-stop-loss', 'P(stop-loss)', m.probabilities.stopLoss),
    prop('p-cap', 'P(played to the round limit)', m.probabilities.cap),
    ...Object.entries(m.probabilities.strategy).map(([k, p]) =>
      prop(`p-strategy-${k}`, `P(strategy stop: ${k})`, p),
    ),
    {
      id: 'expected-loss',
      label: `Expected loss ${fr.unit}`,
      value: fr.money(exp.meanExpectedLoss),
      interval: null,
      hint: 'from the exact odds, before luck',
    },
    {
      id: 'realized-loss',
      label: `Realized loss ${fr.unit}`,
      value: fr.money(exp.meanRealizedLoss.value),
      interval: exp.meanRealizedLoss.ci
        ? { lo: fr.money(exp.meanRealizedLoss.ci.lo), hi: fr.money(exp.meanRealizedLoss.ci.hi) }
        : null,
      tooFew: !exp.meanRealizedLoss.ci,
    },
    {
      id: 'cost-hour',
      label: 'Cost of play (expected loss per hour)',
      value: fmtMoney(e.costOfPlayPerHour),
      interval: null,
      hint: `at ${fmtInt(data.definition.session.roundsPerHour)} rounds an hour`,
    },
    {
      id: 'luck',
      label: 'Run luck (z)',
      value: fmtZ(exp.luckZ),
      interval: null,
      hint: exp.luckLabel ? luckText(exp.luckLabel) : undefined,
    },
  ];
  if (e.realized && e.analytic !== null) {
    rows.push({
      id: 'edge',
      label: 'Realized edge vs analytic edge',
      value: `${fmtPct(e.realized.value)} vs ${fmtPct(e.analytic)}`,
      interval: e.realized.ci
        ? { lo: fmtPct(e.realized.ci.lo), hi: fmtPct(e.realized.ci.hi) }
        : null,
      tooFew: !e.realized.ci,
    });
  }
  return (
    <>
      <Card title="Verdict">
        <p class="verdict" data-verdict>
          {verdictLine(m, fr)}
        </p>
        <p class="muted">
          {fmtInt(m.n)} sessions of up to {fmtInt(data.definition.session.maxRounds)} rounds,
          bankroll {fmtMoney(data.definition.session.bankroll)}. Amounts are {fr.unit}.
        </p>
      </Card>
      {b.rejected.total > 0 ? (
        <Warn id="rejected">
          The strategy asked for {fmtInt(b.rejected.total)} bets the table would not allow (in{' '}
          {fmtPct(b.rejected.sessionsWithRejections.p)} of sessions). They were rejected, not
          played. See &ldquo;Where the money went&rdquo;.
        </Warn>
      ) : null}
      {b.errors.total > 0 ? (
        <Warn id="errors">
          {fmtInt(b.errors.total)} sessions ended in error
          {b.errors.first[0] ? `: ${b.errors.first[0].code}, ${b.errors.first[0].message}` : ''}.
        </Warn>
      ) : null}
      {adjusted > 0 ? (
        <p class="muted">
          {fmtInt(adjusted)} bets were adjusted to fit the table (clamped, reduced or rounded).
        </p>
      ) : null}
      <div class="two-col">
        <Card title="Result distribution">
          <Histogram
            histogram={m.net.histogram}
            title={`Net result ${fr.unit}`}
            fmt={money}
            axisFmt={money}
            xLabel="Net result"
          />
        </Card>
        <Card title="Key numbers">
          <KeyNumbers rows={rows} caption="Key numbers with 95% intervals" />
        </Card>
      </div>
      {m.expected.sessionZ ? (
        <details class="card luck">
          <summary>Luck: how each session compares with the odds</summary>
          <Histogram
            histogram={m.expected.sessionZ}
            title="Session luck z"
            fmt={(v) => fmtNum(v, 1)}
            axisFmt={(v) => fmtNum(v, 0)}
            xLabel="z"
          />
        </details>
      ) : null}
    </>
  );
}

function luckText(l: NonNullable<RunMetrics['expected']['luckLabel']>): string {
  return {
    ordinary: 'ordinary',
    mild: 'a bit lucky or unlucky',
    unusual: 'unusual',
    'very-unusual': 'very unusual: check the strategy or report a bug',
  }[l];
}

function Paths({ data, metrics }: { data: RunData; metrics: RunMetrics }) {
  const fan = useMemo(() => fanChart(data), [data]);
  const surv = useMemo(() => survival(data), [data]);
  const rph = data.definition.session.roundsPerHour;
  return (
    <div class="two-col">
      <Card title="Fan chart">
        <FanChart fan={fan} title="Net result by round" />
        <p class="muted">
          Bands show the middle 50% and 90% of sessions; the dashed line is the exact expected path.
          At {fmtInt(rph)} rounds an hour, 100 rounds is {fmtHours(100 / rph)}.
        </p>
      </Card>
      <Card title="Survival">
        <SurvivalChart survival={surv} title="Share still playing by round" showIncidence />
        <p class="muted">
          {surv.medianRounds === null
            ? 'More than half of the sessions reached the round limit.'
            : `Half of the sessions had ended by round ${fmtInt(surv.medianRounds)} (${fmtHours(surv.medianRounds / rph)}).`}{' '}
          Mean length {fmtNum(metrics.length.mean.value, 0)} rounds.
        </p>
      </Card>
    </div>
  );
}

function Risk({
  metrics: m,
  tableMax,
  bankroll,
}: {
  metrics: RunMetrics;
  tableMax?: number;
  bankroll: number;
}) {
  const dd = m.drawdown;
  const ex = m.exposure;
  const ddRows: KeyRow[] = [
    meanRow('dd-mean', 'Mean max drawdown', dd, fmtMoney, 'largest fall from a peak, per session'),
    ...quantileRows('dd', dd, fmtMoney),
    prop(
      'dd-half',
      `P(drawdown at least half the bankroll, ${fmtMoney(bankroll / 2)})`,
      dd.pHalfBankroll,
    ),
    prop('dd-full', `P(drawdown at least the bankroll, ${fmtMoney(bankroll)})`, dd.pFullBankroll),
    prop('bust', 'P(bust)', m.probabilities.bust),
  ];
  const exRows: KeyRow[] = [
    meanRow('ex-mean', 'Mean largest amount on the table', ex, fmtMoney),
    ...quantileRows('ex', ex, fmtMoney),
    { id: 'ex-max', label: 'Largest of all sessions', value: fmtMoney(ex.max), interval: null },
    ex.pAtTableMax
      ? prop(
          'ex-at-max',
          `P(reached the table maximum, ${fmtMoney(tableMax ?? 0)})`,
          ex.pAtTableMax,
        )
      : {
          id: 'ex-at-max',
          label: 'P(reached the table maximum)',
          value: 'n/a',
          interval: null,
          hint: 'table maximum unknown',
        },
  ];
  return (
    <div class="two-col">
      <Card title="Drawdown">
        <Histogram
          histogram={dd.histogram}
          title="Max drawdown per session"
          xLabel="Max drawdown"
        />
        <KeyNumbers rows={ddRows} caption="Drawdown numbers with 95% intervals" />
      </Card>
      <Card title="Exposure">
        <Histogram
          histogram={ex.histogram}
          title="Largest amount on the table per session"
          xLabel="Max on the table"
        />
        <KeyNumbers rows={exRows} caption="Exposure numbers with 95% intervals" />
      </Card>
    </div>
  );
}

function Money({
  metrics: m,
  adjusted,
  anomalies,
  n,
}: {
  metrics: RunMetrics;
  adjusted: number;
  anomalies: number;
  n: number;
}) {
  const b = m.breakdown;
  const rej = Object.entries(b.rejected.byReason);
  const def = Object.entries(b.deferred.byReason);
  return (
    <>
      {b.rejected.total > 0 ? (
        <Warn id="rejected">
          {fmtInt(b.rejected.total)} rejected bets in {fmtPct(b.rejected.sessionsWithRejections.p)}{' '}
          of sessions (95% CI {fmtPct(b.rejected.sessionsWithRejections.ci.lo)} to{' '}
          {fmtPct(b.rejected.sessionsWithRejections.ci.hi)}). The strategy asked for something the
          table would not allow.
        </Warn>
      ) : null}
      <div class="two-col">
        <Card title="By bet category">
          {b.categories.length ? (
            <>
              <Bars
                rows={categoryRows(b)}
                title="Net result by bet category"
                valueLabel="Net"
                signed
              />
              <div
                class="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Table, scrolls sideways"
              >
                <table class="plain-table">
                  <caption class="visually-hidden">Bet categories</caption>
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col" class="num">
                        Wagered
                      </th>
                      <th scope="col" class="num">
                        Net
                      </th>
                      <th scope="col" class="num">
                        Expected loss
                      </th>
                      <th scope="col" class="num">
                        Edge (realized / analytic)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.categories.map((c) => (
                      <tr key={c.id}>
                        <th scope="row">{c.id}</th>
                        <td class="num">{fmtMoney(c.wagered)}</td>
                        <td class="num">{fmtMoney(c.net, { sign: true })}</td>
                        <td class="num">{fmtMoney(c.expected)}</td>
                        <td class="num">
                          {c.realizedEdge === null ? 'n/a' : fmtPct(c.realizedEdge)} /{' '}
                          {c.analyticEdge === null ? 'n/a' : fmtPct(c.analyticEdge)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <EmptyState title="No bets were placed" />
          )}
        </Card>
        <Card title="By stage">
          {b.stages.length ? (
            <>
              <Bars rows={stageRows(b)} title="Net result by stage" valueLabel="Net" signed />
              <div
                class="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Table, scrolls sideways"
              >
                <table class="plain-table">
                  <caption class="visually-hidden">Stages</caption>
                  <thead>
                    <tr>
                      <th scope="col">Stage</th>
                      <th scope="col" class="num">
                        Rounds
                      </th>
                      <th scope="col" class="num">
                        Wagered
                      </th>
                      <th scope="col" class="num">
                        Net
                      </th>
                      <th scope="col" class="num">
                        Entries
                      </th>
                      <th scope="col" class="num">
                        Ended here
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.stages.map((s) => (
                      <tr key={s.id}>
                        <th scope="row">{s.id}</th>
                        <td class="num">
                          {fmtInt(s.rounds)} ({fmtPct(s.roundShare)})
                        </td>
                        <td class="num">{fmtMoney(s.wagered)}</td>
                        <td class="num">{fmtMoney(s.net, { sign: true })}</td>
                        <td class="num">{fmtInt(s.entries)}</td>
                        <td class="num">{fmtInt(s.stops)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <EmptyState title="No stages" />
          )}
        </Card>
      </div>
      <Card title="Rejected, deferred and adjusted">
        <dl class="facts" data-counts>
          <dt>Rejected bets</dt>
          <dd data-count="rejected">{fmtInt(b.rejected.total)}</dd>
          <dt>Deferred bets</dt>
          <dd data-count="deferred">{fmtInt(b.deferred.total)}</dd>
          <dt>Adjusted bets</dt>
          <dd data-count="adjusted">{fmtInt(adjusted)}</dd>
          <dt>Strategy anomalies</dt>
          <dd data-count="anomalies">{fmtInt(anomalies)}</dd>
          <dt>Sessions</dt>
          <dd>{fmtInt(n)}</dd>
        </dl>
        {rej.length ? (
          <p>Rejected by reason: {rej.map(([k, v]) => `${k} ${fmtInt(v)}`).join(', ')}.</p>
        ) : null}
        {def.length ? (
          <p>Deferred by reason: {def.map(([k, v]) => `${k} ${fmtInt(v)}`).join(', ')}.</p>
        ) : null}
        {b.rejected.total + b.deferred.total + adjusted === 0 ? (
          <p class="muted">The table accepted everything the strategy asked for.</p>
        ) : null}
      </Card>
    </>
  );
}

function Conv({ data, metrics, fr }: { data: RunData; metrics: RunMetrics; fr: Framer }) {
  const [metric, setMetric] = useState<'mean' | 'bust' | 'ahead'>('mean');
  const [halfDollars, setHalfDollars] = useState('');
  const target = useMemo(() => {
    const v = Number(halfDollars);
    return Number.isFinite(v) && v > 0 ? { meanHalfWidth: Math.round(v * 100) } : undefined;
  }, [halfDollars]);
  const c = useMemo(() => convergence(data, target), [data, target]);
  const n = domainSize(data);
  const msg = c.bigEnough
    ? `Big enough: the mean net is within ${fmtMoney(c.target.meanHalfWidth)} and P(bust) within ${fmtPct(c.target.pHalfWidth)}.`
    : `Run about ${fmtInt(Math.max(c.suggested.forMean, c.suggested.forBust))} sessions for the mean within ${fmtMoney(c.target.meanHalfWidth)} and P(bust) within ${fmtPct(c.target.pHalfWidth)}.`;
  return (
    <div class="two-col">
      <Card title="Running estimate">
        <Segmented
          label="Measure"
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'mean', label: 'Mean net' },
            { value: 'bust', label: 'P(bust)' },
            { value: 'ahead', label: 'P(ahead)' },
          ]}
        />
        <ConvergenceChart
          convergence={c}
          title="Estimate as sessions accumulate"
          metric={metric}
          expectedNet={metrics.expected.expectedNetLine}
        />
      </Card>
      <Card title="Is it big enough?">
        <p class="verdict" data-convergence>
          {msg}
        </p>
        <dl class="facts">
          <dt>Sessions now</dt>
          <dd>{fmtInt(n)}</dd>
          <dt>Needed for the mean</dt>
          <dd data-suggested="mean">{fmtInt(c.suggested.forMean)}</dd>
          <dt>Needed for P(bust)</dt>
          <dd data-suggested="bust">{fmtInt(c.suggested.forBust)}</dd>
        </dl>
        <div class="field">
          <label for="half">Target half-width of the mean, in dollars (per session)</label>
          <input
            id="half"
            class="input"
            inputMode="decimal"
            value={halfDollars}
            placeholder={String(Math.round(c.target.meanHalfWidth) / 100)}
            onInput={(e) => setHalfDollars(e.currentTarget.value)}
          />
          <p class="hint">
            Default: 10% of the expected loss, at least $1. Amounts here are per session ({fr.unit}{' '}
            elsewhere).
          </p>
        </div>
      </Card>
    </div>
  );
}
