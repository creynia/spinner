import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RunData } from '../../contracts/run';
import { FLAT_COIN, MARTINGALE_COIN, coinDefinition, runCoinToEnd } from '../../testing';
import { runMetrics } from '../../analysis';
import { AnalysisView, ANALYZE_TABS, type AnalyzeTab } from './AnalysisView';
import { CompareView, METHOD_PAIRED, METHOD_WELCH } from './CompareView';
import { ProgressCard } from './ProgressCard';
import { SessionsTable } from './SessionsTable';
import { fmtMoney, fmtPct, makeFramer } from './format';

let big: RunData;
let small: RunData;
let martin: RunData;
let otherSeed: RunData;

beforeAll(async () => {
  big = await runCoinToEnd(coinDefinition({ sessions: 10_000, maxRounds: 40, seed: 3 }), {
    workers: 2,
  });
  small = await runCoinToEnd(coinDefinition({ sessions: 12, maxRounds: 40, seed: 3 }));
  martin = await runCoinToEnd(
    coinDefinition({ strategy: MARTINGALE_COIN, sessions: 400, maxRounds: 40, seed: 3 }),
  );
  const flat = coinDefinition({ strategy: FLAT_COIN, sessions: 400, maxRounds: 40, seed: 3 });
  otherSeed = await runCoinToEnd({ ...flat, run: { ...flat.run, seed: 99 } }, { runId: 'other' });
}, 60_000);
afterEach(cleanup);
afterAll(() => undefined);

const view = (data: RunData, tab: AnalyzeTab) =>
  render(
    <AnalysisView
      data={data}
      framing="session"
      tab={tab}
      onTab={() => undefined}
      tableMax={50_000}
    />,
  );

describe('formatting', () => {
  it('formats money, percentages and framings consistently', () => {
    expect(fmtMoney(-4123, { sign: true })).toBe('-$41.23');
    expect(fmtMoney(1_234_567)).toBe('$12,346');
    expect(fmtPct(0.3849)).toBe('38.5%');
    const hour = makeFramer('hour', 50, 40);
    expect(hour.unit).toBe('per hour');
    expect(hour.money(1000)).toBe('$8');
    expect(makeFramer('per100', 50, 40).money(1000)).toBe('$20');
    expect(makeFramer('hour', 0, 40).unit).toBe('per session');
  });
});

describe('AnalysisView', () => {
  it('renders seven tabs with one panel', () => {
    const { container } = view(big, 'overview');
    const tabs = container.querySelectorAll('[role=tab]');
    expect(tabs).toHaveLength(ANALYZE_TABS.length);
    expect(container.querySelectorAll('[role=tabpanel]')).toHaveLength(1);
  });

  it('overview: verdict, histogram and key numbers with intervals', () => {
    const { container } = view(big, 'overview');
    expect(container.querySelector('[data-verdict]')?.textContent).toMatch(
      /mean .* ± .*P\(ahead\) \d+\.\d%/,
    );
    expect(container.querySelector('figure svg, svg')).not.toBeNull();
    const row = container.querySelector('[data-metric="mean-net"] .kn-ci');
    expect(row?.textContent).toMatch(/to/);
    expect(container.querySelector('[data-metric="p-bust"] .kn-ci')?.textContent).toMatch(/to/);
  });

  it('hides intervals below 30 sessions and says why', () => {
    const { container } = view(small, 'overview');
    expect(container.querySelector('[data-warning="few"]')).not.toBeNull();
    expect(container.querySelector('[data-metric="mean-net"] .kn-ci')?.textContent).toMatch(
      /too few sessions/,
    );
    expect(container.querySelector('[data-verdict]')?.textContent).toMatch(/too few sessions/);
    // probabilities keep their Wilson interval
    expect(container.querySelector('[data-metric="p-ahead"] .kn-ci')?.textContent).toMatch(/to/);
  });

  it('paths and risk tabs show their charts; risk reports the table maximum', () => {
    const paths = view(big, 'paths').container;
    expect(paths.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
    cleanup();
    const risk = view(big, 'risk').container;
    expect(risk.querySelector('[data-metric="ex-at-max"]')?.textContent).toMatch(/table maximum/);
    expect(risk.querySelector('[data-metric="dd-half"]')).not.toBeNull();
  });

  it('money tab: categories, stages, counts and the rejected warning', () => {
    const clean = view(big, 'money').container;
    expect(clean.querySelector('[data-warning="rejected"]')).toBeNull();
    expect(clean.querySelector('[data-count="rejected"]')?.textContent).toBe('0');
    cleanup();
    const bad: RunData = {
      ...big,
      chunkStats: {
        ...big.chunkStats,
        rejectedByReason: big.chunkStats.rejectedByReason.map((_, i): Record<string, number> =>
          i === 0 ? { 'over-max': 7 } : {},
        ),
      },
    };
    const warned = view(bad, 'money').container;
    expect(warned.querySelector('[data-warning="rejected"]')).not.toBeNull();
    expect(warned.querySelector('[data-count="rejected"]')?.textContent).toBe('7');
  });

  it('convergence suggests a session count', () => {
    const { container } = view(martin, 'convergence');
    expect(container.querySelector('[data-convergence]')?.textContent).toMatch(
      /sessions|Big enough/,
    );
    expect(
      Number(
        (container.querySelector('[data-suggested="mean"]')?.textContent ?? '0').replace(/,/g, ''),
      ),
    ).toBeGreaterThan(0);
  });

  it('export tab offers every file', () => {
    const { container } = view(big, 'export');
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Download run file',
        'summaries.csv',
        'fan.csv',
        'definition.json',
        'Copy share link',
      ]),
    );
    expect(container.querySelector('[role=switch]')?.textContent).toMatch(/Gallery trim/);
  });

  it('SD per hour and per 100 rounds come from the per-round SD, not a linear scaling', () => {
    const m = runMetrics(big, { tableMax: 50_000 });
    const hour = render(
      <AnalysisView data={big} framing="hour" tab="overview" onTab={() => undefined} />,
    ).container;
    expect(hour.querySelector('[data-metric="sd"] .kn-value')?.textContent).toContain(
      fmtMoney(m.volatility.sdHour),
    );
    cleanup();
    const per100 = render(
      <AnalysisView data={big} framing="per100" tab="overview" onTab={() => undefined} />,
    ).container;
    expect(per100.querySelector('[data-metric="sd"] .kn-value')?.textContent).toContain(
      fmtMoney(m.volatility.sdPer100),
    );
    expect(m.volatility.sdHour).not.toBeCloseTo(
      (m.net.sd * big.definition.session.roundsPerHour) / m.length.mean.value,
      0,
    );
  });

  it('only analytic rows say exact; the median stays per session', () => {
    const { container } = view(big, 'overview');
    expect(container.querySelector('[data-metric="expected-loss"] .kn-ci')?.textContent).toBe(
      'exact',
    );
    expect(container.querySelector('[data-metric="sd"] .kn-ci')?.textContent).toBe('');
    expect(container.querySelector('[data-metric="median-net"]')?.textContent).toContain(
      'per session',
    );
  });

  it('the rejected warning names the reasons', () => {
    const bad: RunData = {
      ...big,
      chunkStats: {
        ...big.chunkStats,
        rejectedByReason: big.chunkStats.rejectedByReason.map((_, i): Record<string, number> =>
          i === 0 ? { unaffordable: 7, 'over-max': 2 } : {},
        ),
      },
    };
    const w = view(bad, 'overview').container.querySelector('[data-warning="rejected"]');
    expect(w?.textContent).toContain(
      '9 bets were rejected: 7 not enough bankroll, 2 over the table limit',
    );
  });

  it('scroll regions are labelled distinctly', () => {
    const { container } = view(big, 'money');
    const labels = [...container.querySelectorAll('[role=region]')].map((e) =>
      e.getAttribute('aria-label'),
    );
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('applies the money framing', () => {
    const { container } = render(
      <AnalysisView data={big} framing="hour" tab="overview" onTab={() => undefined} />,
    );
    expect(container.querySelector('[data-verdict]')?.textContent).toMatch(/per hour/);
  });
});

describe('SessionsTable', () => {
  it('virtualises 10,000 rows, sorts, and links rows to Watch', () => {
    const { container } = render(<SessionsTable data={big} hrefFor={(i) => `#/watch/r/${i}`} />);
    const table = container.querySelector('table')!;
    expect(table.getAttribute('data-rows')).toBe('10000');
    const rows = container.querySelectorAll('tr.session-row');
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(40);
    expect(container.querySelector('a[href="#/watch/r/0"]')).not.toBeNull();
    const net = [...container.querySelectorAll('.sort-btn')].find((b) =>
      b.textContent?.startsWith('Net'),
    )!;
    fireEvent.click(net);
    const first = Number(
      container.querySelector('tr.session-row th')?.textContent?.replace(/,/g, ''),
    );
    expect(big.summary.net[first]).toBe(Math.max(...big.summary.net));
    expect(container.querySelector('th[aria-sort="descending"]')).not.toBeNull();
  });
});

describe('ProgressCard', () => {
  it('shows progress, rate, ETA and the soft warning over two minutes', () => {
    const { container } = render(
      <ProgressCard
        status="running"
        completed={2500}
        total={10_000}
        sessionsPerSec={40}
        etaMs={300_000}
        elapsedMs={60_000}
      />,
    );
    const bar = container.querySelector('[role=progressbar]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(container.querySelector('[data-field=rate]')?.textContent).toMatch(/40\.0 sessions\/s/);
    expect(container.querySelector('[data-field=eta]')?.textContent).toBe('5 min 00 s');
    expect(container.querySelector('[data-warning=long]')).not.toBeNull();
    cleanup();
    const quick = render(
      <ProgressCard status="running" completed={1} total={10} sessionsPerSec={5} etaMs={3000} />,
    );
    expect(quick.container.querySelector('[data-warning=long]')).toBeNull();
  });
});

describe('CompareView', () => {
  it('says paired for a shared seed and Welch otherwise, with a difference per metric', () => {
    const runs = [
      { id: 'a', label: 'Flat', data: big },
      { id: 'b', label: 'Martingale', data: martin },
    ];
    const paired = render(<CompareView runs={runs} framing="session" />).container;
    expect(paired.querySelector('[data-method-label]')?.textContent).toContain(METHOD_PAIRED);
    expect(paired.querySelector('[data-method="paired"]')).not.toBeNull();
    expect(paired.querySelector('[data-metric="mean-net"] [data-diff="1"]')?.textContent).toMatch(
      /to/,
    );
    cleanup();
    const welch = render(
      <CompareView
        runs={[runs[0]!, { id: 'c', label: 'Other seed', data: otherSeed }]}
        framing="session"
      />,
    ).container;
    expect(welch.querySelector('[data-method-label]')?.textContent).toContain(METHOD_WELCH);
  });
});
