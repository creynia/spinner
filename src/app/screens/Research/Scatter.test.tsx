// Scatter: shapes per group, points outside the domain hidden, the curve and its label, the table.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { curveGroup, Scatter, type ScatterProps } from './Scatter';
import { data } from './data';

afterEach(cleanup);

const props = (over: Partial<ScatterProps> = {}): ScatterProps => ({
  title: 'Never capped',
  summary: 'Three points.',
  points: [
    { id: 'a', x: 0.5, y: 0.6, group: 'g1' },
    { id: 'b', x: 1, y: 0.3, group: 'g2' },
    { id: 'c', x: 3, y: 0, group: 'g1' },
    { id: 'd', x: 1.5, y: 0.1, group: 'nope' },
  ],
  groups: [
    { id: 'g1', label: 'First', shape: 'circle', color: 2 },
    { id: 'g2', label: 'Second', shape: 'triangle', color: 4 },
  ],
  xDomain: [0, 2.5],
  yDomain: [0, 1],
  curve: { label: 'e^(−x)', f: (x) => Math.exp(-x), labelAt: 1.2 },
  xLabel: 'x',
  yLabel: 'y',
  xFmt: (v) => v.toFixed(2),
  yFmt: (v) => `${Math.round(v * 100)}%`,
  table: { columns: ['Ladder', 'x'], rows: [['a', '0.50']] },
  ...over,
});

describe('Scatter', () => {
  it('draws a mark per point inside the domain, in the shape of its group', () => {
    const { container } = render(<Scatter {...props()} />);
    const pts = container.querySelectorAll('g.sp-scatter-point');
    expect(pts).toHaveLength(3);
    expect(container.querySelector('g[data-id="a"] circle')).not.toBeNull();
    expect(container.querySelector('g[data-id="b"] path')).not.toBeNull();
    expect(container.querySelector('g[data-id="c"]')).toBeNull();
    // an unknown group falls into the last group
    expect(container.querySelector('g[data-id="d"]')?.getAttribute('data-group')).toBe('g2');
  });

  it('draws the curve with its label, a legend with a swatch per group, and the table', () => {
    const { container } = render(<Scatter {...props()} />);
    expect(container.querySelector('.sp-scatter-curve path')).not.toBeNull();
    expect(container.querySelector('.sp-scatter-curve text')?.textContent).toBe('e^(−x)');
    const legend = [...container.querySelectorAll('ul.sp-chart__legend li')].map(
      (l) => l.textContent,
    );
    expect(legend).toEqual(['e^(−x)', 'First', 'Second']);
    expect(container.querySelector('details.sp-chart__table table')).not.toBeNull();
    expect(container.querySelector('svg.sp-chart__svg')?.getAttribute('role')).toBe('img');
  });

  it('omits the curve when none is given', () => {
    const { container } = render(<Scatter {...props({ curve: undefined })} />);
    expect(container.querySelector('.sp-scatter-curve')).toBeNull();
  });
});

describe('curveGroup', () => {
  it('maps every family in data.curve to one of the four groups', () => {
    const families = [...new Set(data.curve.map((c) => c.family))];
    expect(families.length).toBeGreaterThan(5);
    for (const f of families) expect(['e3', 'e4-out', 'e4-in', 'e6']).toContain(curveGroup(f));
  });

  it('puts dozens outside, other E4 inside, and unknown families last', () => {
    expect(curveGroup('E3 Martingale red $5')).toBe('e3');
    expect(curveGroup('E4 dozen g')).toBe('e4-out');
    expect(curveGroup('E4 two-dozens g')).toBe('e4-out');
    expect(curveGroup('E4 sixline x2')).toBe('e4-in');
    expect(curveGroup('E4 straights25 g')).toBe('e4-in');
    expect(curveGroup('E6 stack full')).toBe('e6');
    expect(curveGroup('something else')).toBe('e6');
  });
});
