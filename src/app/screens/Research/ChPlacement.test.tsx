// Chapter 4 with the real data: seven rows, three series, the prediction from meta, "never" for null.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ChPlacement, PLACEMENTS, predictedHalfLife } from './ChPlacement';
import { CHAPTERS } from './content';
import { row } from './data';

afterEach(cleanup);
const chapter = CHAPTERS.find((c) => c.id === 'placement')!;

describe('predictedHalfLife', () => {
  it('is ln 2 / (q p) and null without meta', () => {
    expect(predictedHalfLife({ p: 0.5, q: 0.01 })).toBeCloseTo(Math.LN2 / 0.005, 9);
    expect(predictedHalfLife(null)).toBeNull();
    expect(predictedHalfLife({ p: 0.5, q: 0 })).toBeNull();
  });

  it('reproduces the chapter horizons: dozen x1.5 near 159, corner near 141', () => {
    const dozen = predictedHalfLife(row('e4-dozen:e4-dozen-g-stop').meta)!;
    const corner = predictedHalfLife(row('e4-corner:e4-corner-g-stop').meta)!;
    expect(Math.abs(dozen - 159)).toBeLessThan(3);
    expect(Math.abs(corner - 141)).toBeLessThan(3);
  });
});

describe('ChPlacement', () => {
  it('draws a row per placement and a mark for each value present', () => {
    const { container } = render(<ChPlacement chapter={chapter} />);
    expect(container.querySelectorAll('g.sp-dotrow')).toHaveLength(PLACEMENTS.length);
    expect(container.querySelectorAll('g[data-series="right"]')).toHaveLength(
      PLACEMENTS.filter((p) => row(p.right).medianAheadUntil !== null).length,
    );
    expect(container.querySelectorAll('g[data-series="predicted"]')).toHaveLength(
      PLACEMENTS.length,
    );
    expect(container.querySelector('figcaption.sp-chart__title')?.textContent).toBeTruthy();
    const summary = container.querySelector('.sp-chart__summary')?.textContent ?? '';
    expect(summary).toMatch(/dozen/i);
    expect(summary).not.toMatch(/NaN|undefined/);
  });

  it('has the legend, and a table with growth factor, never and clamped values', () => {
    const { container } = render(<ChPlacement chapter={chapter} />);
    const legend = [...container.querySelectorAll('ul.sp-chart__legend li')].map(
      (l) => l.textContent,
    );
    expect(legend).toEqual(['Right growth factor', 'Doubling', 'Predicted n½']);
    const rows = [...container.querySelectorAll('details.sp-chart__table tbody tr')].map((r) =>
      [...r.children].map((c) => c.textContent),
    );
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual(['Dozen', '×1.5', '150', '70', '159']);
    expect(rows[1]![2]).toBe('500+');
    expect(rows.some((r) => r[3] === 'never')).toBe(true);
  });
});
