// DotRows: marks per row and series, null draws nothing, the clamp triangle, the table fallback.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { DotRows, type DotRowsProps } from './DotRows';
import { axisMoney, money } from './kit';

afterEach(cleanup);

const props = (over: Partial<DotRowsProps> = {}): DotRowsProps => ({
  title: 'Result after 500 spins',
  summary: 'Typical and average session for three bets.',
  series: [
    { id: 'median', label: 'Typical session', shape: 'circle', color: 1 },
    { id: 'mean', label: 'Average', shape: 'diamond', color: 2 },
  ],
  rows: [
    { id: 'a', label: 'Red', range: [-9000, 6000], values: { median: -1500, mean: -1300 } },
    { id: 'b', label: 'Dozen', range: [-12000, 20000], values: { median: 500, mean: null } },
    { id: 'c', label: '25 numbers', values: { median: -2000, mean: -2200 } },
  ],
  zeroLine: 'Break-even',
  fmt: money,
  axisFmt: axisMoney,
  axisLabel: 'Result after 500 spins',
  rangeLabel: 'Middle 80 % of sessions',
  table: {
    columns: ['Bet', 'Typical', 'Average'],
    rows: [
      ['Red', '-$15', '-$13'],
      ['Dozen', '+$5', '-'],
      ['25 numbers', '-$20', '-$22'],
    ],
  },
  ...over,
});

describe('DotRows', () => {
  it('draws one group per row, one range bar per row with a range, and a mark per value', () => {
    const { container } = render(<DotRows {...props()} />);
    expect(container.querySelectorAll('g.sp-dotrow')).toHaveLength(3);
    expect(container.querySelectorAll('rect.sp-dotrange')).toHaveLength(2);
    expect(container.querySelectorAll('g.sp-dotmark[data-series="median"]')).toHaveLength(3);
    expect(container.querySelectorAll('g.sp-dotmark[data-series="mean"]')).toHaveLength(2);
    expect(container.querySelectorAll('g.sp-dotmark[data-row="b"]')).toHaveLength(1);
    expect(container.querySelector('g.sp-dotmark[data-series="mean"] rect')).not.toBeNull();
    expect(container.querySelector('g.sp-dotmark[data-series="median"] circle')).not.toBeNull();
  });

  it('draws nothing for a null value and the zero line only when asked', () => {
    const { container, rerender } = render(<DotRows {...props()} />);
    expect(container.querySelector('g.sp-dotmark[data-row="b"][data-series="mean"]')).toBeNull();
    expect(container.querySelector('g.sp-zero')?.textContent).toBe('Break-even');
    rerender(<DotRows {...props({ zeroLine: undefined })} />);
    expect(container.querySelector('g.sp-zero')).toBeNull();
  });

  it('clamps a value above clampAt to a triangle at the axis end with a "500+" label', () => {
    const rows = [
      { id: 'x', label: 'Dozen', values: { s: 420 } },
      { id: 'y', label: 'Corner', values: { s: 900 } },
      { id: 'z', label: 'Never', values: { s: null } },
    ];
    const { container } = render(
      <DotRows
        {...props({
          series: [{ id: 's', label: 'Stays ahead', shape: 'circle', color: 1 }],
          rows,
          domain: [0, 500],
          clampAt: 500,
          zeroLine: undefined,
          fmt: String,
          axisFmt: String,
          table: {
            columns: ['Bet', 'Spins'],
            rows: [
              ['Dozen', 420],
              ['Corner', '500+'],
              ['Never', 'never'],
            ],
          },
        })}
      />,
    );
    expect(container.querySelectorAll('g.sp-dotmark')).toHaveLength(1);
    const clamp = container.querySelectorAll('g.sp-dotclamp');
    expect(clamp).toHaveLength(1);
    expect(clamp[0]!.getAttribute('data-row')).toBe('y');
    expect(clamp[0]!.querySelector('path')).not.toBeNull();
    expect(clamp[0]!.textContent).toBe('500+');
  });

  it('has the legend with the range and every series, and the table fallback', () => {
    const { container } = render(<DotRows {...props()} />);
    const legend = [...container.querySelectorAll('ul.sp-chart__legend li')].map(
      (li) => li.textContent,
    );
    expect(legend).toEqual(['Middle 80 % of sessions', 'Typical session', 'Average']);
    expect(container.querySelector('figure[aria-labelledby]')).not.toBeNull();
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
    const rows = container.querySelectorAll('details.sp-chart__table tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toBe('Red-$15-$13');
    expect(container.querySelector('p.sp-chart__summary')?.textContent).toContain('three bets');
  });

  it('shows no range entry in the legend when no row has a range', () => {
    const rows = [{ id: 'a', label: 'Red', values: { median: 1, mean: 2 } }];
    const { container } = render(<DotRows {...props({ rows, zeroLine: undefined })} />);
    expect(container.querySelectorAll('ul.sp-chart__legend li')).toHaveLength(2);
    expect(container.querySelector('rect.sp-dotrange')).toBeNull();
  });
});
