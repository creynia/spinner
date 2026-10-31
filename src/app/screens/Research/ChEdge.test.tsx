// Chapter 1: the three E1 layouts as dots on a range, with the table fallback.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ChEdge } from './ChEdge';
import { CHAPTERS } from './content';
import { row } from './data';
import { money } from './kit';

afterEach(cleanup);

const chapter = CHAPTERS.find((c) => c.id === 'edge')!;

describe('ChEdge', () => {
  it('draws a range, a typical-session circle and an average diamond for each of three rows', () => {
    const { container } = render(<ChEdge chapter={chapter} />);
    expect(container.querySelectorAll('g.sp-dotrow')).toHaveLength(3);
    expect(container.querySelectorAll('rect.sp-dotrange')).toHaveLength(3);
    expect(container.querySelectorAll('g.sp-dotmark[data-series="median"] circle')).toHaveLength(3);
    expect(container.querySelectorAll('g.sp-dotmark[data-series="mean"] rect')).toHaveLength(3);
    expect(container.querySelector('.sp-zero text')?.textContent).toBe('Break-even');
    expect(container.querySelector('.sp-chart__legend')?.textContent).toContain(
      'Middle 80 % of sessions',
    );
  });

  it('has a title, a summary and a table with every plotted value', () => {
    const { container } = render(<ChEdge chapter={chapter} />);
    expect(container.querySelector('figcaption')?.textContent).toBe('Result after 500 spins');
    expect(container.querySelector('.sp-chart__summary')?.textContent).toMatch(/80 %/);
    const heads = [...container.querySelectorAll('.sp-chart__table th[scope="col"]')].map(
      (e) => e.textContent,
    );
    expect(heads).toEqual(['Bet', 'Average', 'Typical', '10th pct', '90th pct', 'SD']);
    const cells = [...container.querySelectorAll('.sp-chart__table tbody tr')].map((tr) =>
      [...tr.children].map((c) => c.textContent),
    );
    const red = row('e1-spread:e1-red');
    expect(cells[0]).toEqual([
      'Red',
      money(red.mean),
      money(red.median),
      money(red.p10),
      money(red.p90),
      money(red.sd),
    ]);
    expect(cells.map((c) => c[0])).toEqual(['Red', 'Red + a dozen', '25 numbers']);
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });
});
