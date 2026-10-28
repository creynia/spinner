import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Bars,
  ConvergenceChart,
  FanChart,
  Histogram,
  OverlayHistogram,
  Sparkline,
  SurvivalChart,
  SweepChart,
  categoryRows,
  stageRows,
} from './index';
import {
  breakdownFixture,
  convergenceFixture,
  equityFixture,
  fanFixture,
  histogramFixture,
  survivalFixture,
  sweepFixture,
} from './__fixtures__/data';

afterEach(cleanup);

/** Every chart: a named figure, an svg image labelled by title + summary, a non-empty summary, a data table. */
function expectAccessible(container: Element, title: string): void {
  const fig = container.querySelector('figure.sp-chart')!;
  expect(fig).toBeTruthy();
  const titleEl = fig.querySelector('figcaption')!;
  expect(titleEl.textContent).toBe(title);
  expect(fig.getAttribute('aria-labelledby')).toBe(titleEl.id);
  const svg = fig.querySelector('svg[role="img"]')!;
  const ids = svg.getAttribute('aria-labelledby')!.split(' ');
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(titleEl.id);
  const summary = fig.querySelector(`[id="${ids[1]}"]`)!;
  expect(summary.textContent.length).toBeGreaterThan(20);
  const details = fig.querySelector('details.sp-chart__table')!;
  expect(details.querySelector('summary')!.textContent).toBe('Data table');
  const rows = details.querySelectorAll('tbody tr');
  expect(rows.length).toBeGreaterThan(0);
  const cols = details.querySelectorAll('thead th').length;
  expect(rows[0]!.children.length).toBe(cols);
  expect(details.querySelectorAll('th[scope="col"]').length).toBe(cols);
}

describe('Histogram', () => {
  it('draws a rect per non-empty bin, the zero and expected lines, ticks and a table row per bin', () => {
    const h = histogramFixture();
    const nonEmpty = Array.from(h.counts).filter((c) => c > 0).length;
    const { container } = render(<Histogram histogram={h} title="Net per session" />);
    expectAccessible(container, 'Net per session');
    expect(container.querySelectorAll('.sp-bars rect')).toHaveLength(nonEmpty);
    expect(container.querySelector('[data-ref^="zero"]')).toBeTruthy();
    expect(container.querySelector('[data-ref^="expected"]')!.textContent).toContain('-$140');
    expect(container.querySelector('[data-ref^="mean"]')).toBeTruthy();
    expect(container.querySelectorAll('.sp-xaxis text').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.sp-yaxis text').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.sp-chart__table tbody tr')).toHaveLength(24);
  });
  it('omits marker lines that the histogram does not carry', () => {
    const h = { ...histogramFixture(), markers: {} };
    const { container } = render(<Histogram histogram={h} title="t" />);
    expect(container.querySelectorAll('.sp-ref')).toHaveLength(0);
  });
  it('handles an empty histogram without crashing', () => {
    const h = { lo: 0, width: 1, counts: new Uint32Array(0), zeroBin: null, markers: {} };
    const { container } = render(<Histogram histogram={h} title="Empty" />);
    expect(container.querySelector('.sp-chart__summary')!.textContent).toContain('No sessions');
  });
  it('shows a tooltip on tap and clears it with Escape', () => {
    const { container } = render(<Histogram histogram={histogramFixture()} title="t" />);
    const tip = container.querySelector('.sp-chart__tip') as HTMLElement;
    expect(tip.hidden).toBe(true);
    fireEvent.pointerDown(container.querySelector('.sp-hit')!, {
      clientX: 300,
      pointerType: 'touch',
    });
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toMatch(/sessions/);
    fireEvent.keyDown(container.querySelector('svg')!, { key: 'Escape' });
    expect(tip.hidden).toBe(true);
    fireEvent.keyDown(container.querySelector('svg')!, { key: 'ArrowRight' });
    expect(tip.hidden).toBe(false);
  });
});

describe('review fixes (components)', () => {
  it('draws a convergence band with NaN intervals without losing the line', () => {
    const cv = convergenceFixture();
    for (let i = 0; i < 5; i++) {
      cv.lo[i] = NaN;
      cv.hi[i] = NaN;
    }
    const { container } = render(<ConvergenceChart convergence={cv} title="c" />);
    expect(container.querySelector('path.sp-band')!.getAttribute('d')).not.toContain('NaN');
    expect(container.querySelector('path.sp-band')!.getAttribute('d')!.length).toBeGreaterThan(10);
    expect(container.querySelector('path.sp-line')!.getAttribute('d')).not.toContain('NaN');
  });
  it('fan legend swatches use the band tokens', () => {
    const { container } = render(<FanChart fan={fanFixture()} title="p" />);
    const fills = Array.from(container.querySelectorAll('.sp-chart__legend rect')).map((r) =>
      r.getAttribute('fill'),
    );
    expect(fills).toContain('var(--band-outer)');
    expect(fills).toContain('var(--band-inner)');
  });
  it('skips markers outside the bins', () => {
    const h = { ...histogramFixture(), markers: { zero: 900000, expected: -14000 } };
    const { container } = render(<Histogram histogram={h} title="t" />);
    expect(container.querySelector('[data-ref^="zero"]')).toBeNull();
    expect(container.querySelector('[data-ref^="expected"]')).toBeTruthy();
  });
  it('whole-number y ticks on small counts', () => {
    const h = { lo: 0, width: 10, counts: Uint32Array.of(1, 0, 1), zeroBin: null, markers: {} };
    const { container } = render(<Histogram histogram={h} title="t" />);
    const labels = Array.from(container.querySelectorAll('.sp-yaxis text')).map(
      (t) => t.textContent,
    );
    expect(new Set(labels).size).toBe(labels.length);
  });
  it('draws point markers for a single checkpoint', () => {
    const f = fanFixture(1);
    const { container } = render(<FanChart fan={f} title="p" />);
    expect(container.querySelectorAll('.sp-point')).toHaveLength(5);
  });
  it('empty data gives summary and table only, no svg', () => {
    const h = { lo: 0, width: 1, counts: new Uint32Array(0), zeroBin: null, markers: {} };
    const { container } = render(<Histogram histogram={h} title="e" />);
    expect(container.querySelector('svg[role="img"]')).toBeNull();
    expect(container.querySelector('.sp-chart__table')).toBeTruthy();
  });
  it('compare-mode expected line differs from the overlay colours', () => {
    const fan = fanFixture();
    const { container } = render(
      <FanChart
        fan={fan}
        title="p"
        overlays={[{ id: 'm', label: 'M', rounds: fan.rounds, p50: fan.p5 }]}
      />,
    );
    expect(container.querySelector('path.sp-expected')!.getAttribute('stroke')).toBe(
      'var(--chart-text)',
    );
  });
});

describe('OverlayHistogram', () => {
  it('draws one outline per run with distinct dash patterns and a legend entry each', () => {
    const a = histogramFixture();
    const b = histogramFixture(3);
    const { container } = render(
      <OverlayHistogram
        title="Compare"
        lo={a.lo}
        width={a.width}
        markers={a.markers}
        series={[
          { id: 'a', label: 'Flat', counts: a.counts },
          { id: 'b', label: 'Martingale', counts: b.counts },
        ]}
      />,
    );
    expectAccessible(container, 'Compare');
    const outlines = Array.from(container.querySelectorAll('path.sp-outline'));
    expect(outlines).toHaveLength(2);
    expect(new Set(outlines.map((o) => o.getAttribute('stroke-dasharray'))).size).toBe(2);
    expect(container.querySelectorAll('.sp-chart__legend li')).toHaveLength(2);
    expect(container.querySelector('.sp-chart__summary')!.textContent).toContain(
      'Martingale about',
    );
    expect(container.querySelectorAll('.sp-chart__table thead th')).toHaveLength(3);
  });
});

describe('FanChart', () => {
  it('draws two bands, the median and the dashed expected line', () => {
    const fan = fanFixture();
    const { container } = render(<FanChart fan={fan} title="Paths" />);
    expectAccessible(container, 'Paths');
    expect(container.querySelectorAll('path.sp-band-outer')).toHaveLength(1);
    expect(container.querySelectorAll('path.sp-band-inner')).toHaveLength(1);
    expect(container.querySelectorAll('path.sp-median')).toHaveLength(1);
    expect(
      container.querySelector('path.sp-expected')!.getAttribute('stroke-dasharray'),
    ).toBeTruthy();
    expect(container.querySelector('.sp-chart__summary')!.textContent).toContain(
      'After 500 rounds',
    );
    expect(container.querySelectorAll('.sp-chart__legend li')).toHaveLength(4);
  });
  it('compare mode swaps the bands for overlaid medians', () => {
    const fan = fanFixture();
    const { container } = render(
      <FanChart
        fan={fan}
        title="Paths"
        label="Flat"
        overlays={[{ id: 'm', label: 'Martingale', rounds: fan.rounds, p50: fan.p5 }]}
      />,
    );
    expect(container.querySelectorAll('path.sp-band-outer')).toHaveLength(0);
    expect(container.querySelectorAll('path.sp-overlay-median')).toHaveLength(1);
    expect(container.querySelector('.sp-chart__summary')!.textContent).toContain('Martingale');
  });
  it('tooltips list every percentile', () => {
    const { container } = render(<FanChart fan={fanFixture()} title="p" />);
    fireEvent.keyDown(container.querySelector('svg')!, { key: 'End' });
    const tip = container.querySelector('.sp-chart__tip')!;
    expect(tip.textContent).toContain('Round 500');
    expect(tip.textContent).toContain('95th pct');
    expect(tip.textContent).toContain('expected');
  });
});

describe('SurvivalChart', () => {
  it('draws the step curve plus one dashed line per ending reason', () => {
    const { container } = render(
      <SurvivalChart survival={survivalFixture()} title="Still playing" />,
    );
    expectAccessible(container, 'Still playing');
    expect(container.querySelectorAll('path.sp-alive')).toHaveLength(1);
    expect(container.querySelector('path.sp-alive')!.getAttribute('d')).toMatch(/H.*V/);
    expect(container.querySelectorAll('path.sp-incidence')).toHaveLength(3);
    expect(container.querySelector('.sp-median-mark')!.textContent).toContain('round 372');
  });
  it('can hide incidence lines', () => {
    const { container } = render(
      <SurvivalChart survival={survivalFixture()} title="s" showIncidence={false} />,
    );
    expect(container.querySelectorAll('path.sp-incidence')).toHaveLength(0);
  });
});

describe('ConvergenceChart', () => {
  it('draws the running line, its interval band and the expected reference', () => {
    const { container } = render(
      <ConvergenceChart
        convergence={convergenceFixture()}
        title="Converging"
        expectedNet={-14000}
      />,
    );
    expectAccessible(container, 'Converging');
    expect(container.querySelectorAll('path.sp-line')).toHaveLength(1);
    expect(container.querySelectorAll('path.sp-band')).toHaveLength(1);
    expect(container.querySelector('[data-ref^="expected"]')).toBeTruthy();
    expect(container.querySelector('.sp-chart__summary')!.textContent).toContain('95% interval');
    expect(container.querySelectorAll('.sp-point')).toHaveLength(24);
  });
  it('shows probabilities on a 0-100% axis', () => {
    const { container } = render(
      <ConvergenceChart convergence={convergenceFixture()} title="b" metric="bust" />,
    );
    const labels = Array.from(container.querySelectorAll('.sp-yaxis text')).map(
      (t) => t.textContent,
    );
    expect(labels[0]).toBe('0%');
    expect(labels.at(-1)).toBe('100%');
  });
});

describe('SweepChart', () => {
  it('renders a mean+band chart and a P(bust) chart', () => {
    const { container } = render(<SweepChart sweep={sweepFixture()} parameterLabel="Unit" />);
    const figs = container.querySelectorAll('figure.sp-chart');
    expect(figs).toHaveLength(2);
    expect(figs[0]!.querySelectorAll('path.sp-band')).toHaveLength(1);
    expect(figs[0]!.querySelectorAll('.sp-point')).toHaveLength(5);
    expect(figs[1]!.querySelector('figcaption')!.textContent).toContain('P(bust)');
    expect(figs[1]!.querySelectorAll('.sp-chart__table tbody tr')).toHaveLength(5);
  });
  it('labels categorical values on the axis', () => {
    const { container } = render(<SweepChart sweep={sweepFixture('categorical')} />);
    const ticks = Array.from(container.querySelectorAll('.sp-xaxis text')).map(
      (t) => t.textContent,
    );
    expect(ticks).toContain('martingale');
  });
});

describe('Bars', () => {
  it('draws a bar per item, labelled by signed value, with a table', () => {
    const rows = categoryRows(breakdownFixture());
    const { container } = render(
      <Bars title="Where the money went" valueLabel="Net" rows={rows} signed />,
    );
    expectAccessible(container, 'Where the money went');
    expect(container.querySelectorAll('g.sp-bar')).toHaveLength(4);
    const labels = Array.from(container.querySelectorAll('g.sp-bar text')).map(
      (t) => t.textContent,
    );
    expect(labels).toContain('+$640');
    expect(labels).toContain('-$1,800');
    expect(container.querySelectorAll('.sp-chart__table thead th')).toHaveLength(4);
  });
  it('lays out horizontally on request with the sign in the label (not colour alone)', () => {
    const rows = stageRows(breakdownFixture());
    const { container } = render(
      <Bars title="Stages" valueLabel="Net" rows={rows} orientation="horizontal" signed />,
    );
    const bars = Array.from(container.querySelectorAll('g.sp-bar rect'));
    expect(bars).toHaveLength(2);
    const [neg, pos] = bars.map(
      (b) => Number(b.getAttribute('x')) + Number(b.getAttribute('width')),
    );
    expect(neg).toBeLessThan(pos!);
    expect(container.querySelector('.sp-chart__summary')!.textContent).toContain(
      'martingale -$2,100',
    );
  });
  it('copes with no rows', () => {
    const { container } = render(<Bars title="Empty" valueLabel="Net" rows={[]} />);
    expect(container.querySelector('.sp-chart__summary')!.textContent).toContain('Nothing');
  });
});

describe('Sparkline', () => {
  it('draws one path and an end dot, named for screen readers with a hidden table', () => {
    const { container } = render(
      <Sparkline values={equityFixture()} label="Equity" baseline={500000} />,
    );
    const svg = container.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute('aria-label')).toMatch(/^Equity: starts \$5,000, ends/);
    expect(container.querySelectorAll('path.sp-spark-line')).toHaveLength(1);
    expect(container.querySelectorAll('.sp-spark-end')).toHaveLength(1);
    expect(container.querySelectorAll('.sp-sr tbody tr')).toHaveLength(4);
  });
  it('handles no data', () => {
    const { container } = render(<Sparkline values={[]} label="Equity" />);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Equity: no data');
    expect(container.querySelectorAll('.sp-spark-end')).toHaveLength(0);
  });
});
