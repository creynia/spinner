// Chapter 6 with the real data: nine glyphs, the median-path chart, the four-seed table.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ChShapes, GLYPH_LEVELS, levelWords } from './ChShapes';
import { CHAPTERS } from './content';
import { row } from './data';
import { money } from './kit';
import { SURVIVORS } from './survivors';

afterEach(cleanup);
const chapter = CHAPTERS.find((c) => c.id === 'shapes')!;

describe('ChShapes', () => {
  it('draws each survivor at levels 0, 3 and 8, with towers that grow with the stake', () => {
    expect(GLYPH_LEVELS).toEqual([0, 3, 8]);
    const { container } = render(<ChShapes chapter={chapter} />);
    const glyphs = container.querySelectorAll('svg.board-glyph');
    expect(glyphs).toHaveLength(9);
    const towers = [...glyphs].map((g) => g.querySelectorAll('g.board-tower').length);
    expect(towers).toEqual([1, 4, 4, 2, 2, 2, 1, 4, 9]);
    const first = glyphs[0]!.querySelector('g.board-tower')!.getAttribute('data-chips');
    const last = glyphs[2]!.querySelector('g.board-tower')!.getAttribute('data-chips');
    expect(Number(last)).toBeGreaterThan(Number(first));
    for (const g of glyphs) expect(g.getAttribute('aria-label')).toBeTruthy();
  });

  it('describes a level in words and a legend names the marks', () => {
    expect(levelWords(SURVIVORS[0]!, 3)).toBe('4 streets, $3 each · $12 on the table');
    expect(levelWords(SURVIVORS[0]!, 0)).toBe('1 street, $1 each · $1 on the table');
    expect(levelWords(SURVIVORS[0]!, 20)).toBe('Ladder ran out after 20 losses');
    const { container } = render(<ChShapes chapter={chapter} />);
    expect(container.querySelectorAll('ul.board-legend li')).toHaveLength(2);
  });

  it('charts the three typical-session paths with a title, summary, legend and data table', () => {
    const { container } = render(<ChShapes chapter={chapter} />);
    expect(container.querySelector('figcaption.sp-chart__title')?.textContent).toBeTruthy();
    const summary = container.querySelector('.sp-chart__summary')?.textContent ?? '';
    for (const s of SURVIVORS) {
      expect(summary).toContain(`${s.id} ${money(row(`e6-full:${s.rowId}@20261031`).median)}`);
    }
    expect(summary).not.toMatch(/NaN|undefined/);
    expect(container.querySelectorAll('.sp-chart__legend li').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('details.sp-chart__table')).not.toBeNull();
  });

  it('has the four-seed table in a scrolling region, seed 20261031 first and the range second', () => {
    const { container } = render(<ChShapes chapter={chapter} />);
    const region = container.querySelector('.research-tablewrap');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('aria-label')).toBeTruthy();
    const heads = [...region!.querySelectorAll('th[scope="col"]')].map((h) => h.textContent);
    expect(heads).toEqual([
      'Ladder',
      'Typical session',
      'Chance of ending ahead',
      'Average',
      'Worst 5 % of sessions',
      'Lost the ladder',
      'Ended broke',
    ]);
    const rows = region!.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    const c9 = row('e6-full:c9-streets-to12-stack@20261031');
    const cell = rows[0]!.querySelectorAll('td')[0]!;
    expect(cell.firstChild?.textContent).toBe(money(c9.median));
    expect(cell.querySelector('.research-range')?.textContent).toMatch(/^4 seeds: .+ to .+$/);
    expect(rows[2]!.querySelector('th')?.textContent).toBe('a1, widen');
  });
});
