// Chapter 5 with the real data: points for x <= 2.5, the rest counted in the summary and the table.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ChCurve } from './ChCurve';
import { CHAPTERS } from './content';
import { data } from './data';

afterEach(cleanup);
const chapter = CHAPTERS.find((c) => c.id === 'curve')!;

describe('ChCurve', () => {
  it('draws the ladders with x up to 2.5 and counts the others in the summary', () => {
    const { container } = render(<ChCurve chapter={chapter} />);
    const shown = data.curve.filter((c) => c.x <= 2.5).length;
    const hidden = data.curve.length - shown;
    expect(hidden).toBeGreaterThan(0);
    expect(container.querySelectorAll('g.sp-scatter-point')).toHaveLength(shown);
    const summary = container.querySelector('.sp-chart__summary')?.textContent ?? '';
    expect(summary).toContain(`${data.curve.length} ladders: ${shown} are drawn, and ${hidden}`);
    expect(summary).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('has a title, a legend of four groups and the curve, and a row per ladder in the table', () => {
    const { container } = render(<ChCurve chapter={chapter} />);
    expect(container.querySelector('figcaption.sp-chart__title')?.textContent).toBeTruthy();
    expect(container.querySelectorAll('ul.sp-chart__legend li')).toHaveLength(5);
    expect(container.querySelector('.sp-scatter-curve text')?.textContent).toBe(
      'e^(−x): the ceiling',
    );
    expect(container.querySelectorAll('details.sp-chart__table tbody tr')).toHaveLength(
      data.curve.length,
    );
    const heads = [...container.querySelectorAll('details.sp-chart__table th[scope="col"]')].map(
      (h) => h.textContent,
    );
    expect(heads).toEqual(['Ladder', 'Group', 'x', 'Never capped', 'e^(−x)', 'k']);
  });
});
