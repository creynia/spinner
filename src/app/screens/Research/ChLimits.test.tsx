// Limits chapter: the table of typical session / average, the two small bars, the cash-out table.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { CASHOUT_ROWS, COLUMNS, ChLimits, STRATEGIES } from './ChLimits';
import { CHAPTERS } from './content';
import { row } from './data';
import { money } from './kit';

afterEach(cleanup);

const chapter = CHAPTERS.find((c) => c.id === 'limits')!;

describe('ChLimits', () => {
  it('has every row the table and the cash-out table quote', () => {
    for (const s of STRATEGIES)
      for (const c of COLUMNS) expect(() => row(c.key(s.id))).not.toThrow();
    for (const [, key] of CASHOUT_ROWS) expect(() => row(key)).not.toThrow();
  });

  it('renders a scrollable region per table with one cell per strategy and change', () => {
    const { container } = render(<ChLimits chapter={chapter} />);
    const regions = [...container.querySelectorAll('.research-tablewrap')];
    expect(regions).toHaveLength(2);
    for (const r of regions) {
      expect(r.getAttribute('role')).toBe('region');
      expect(r.getAttribute('tabindex')).toBe('0');
      expect(r.getAttribute('aria-label')).toBeTruthy();
    }
    const first = regions[0]!;
    expect(first.querySelectorAll('thead th[scope="col"]')).toHaveLength(1 + COLUMNS.length);
    expect(first.querySelectorAll('tbody th[scope="row"]')).toHaveLength(STRATEGIES.length);
    expect(first.querySelectorAll('tbody td')).toHaveLength(STRATEGIES.length * COLUMNS.length);
    const c9 = row('e8-length:e8-S1000-c9-streets-to12-stack');
    expect(first.textContent).toContain(`${money(c9.median)} / ${money(c9.mean)}`);
    // every average is negative on every row, and the table says so in its numbers
    for (const s of STRATEGIES)
      for (const c of COLUMNS) expect(row(c.key(s.id)).mean).toBeLessThan(0);
    expect(regions[1]!.querySelectorAll('tbody tr')).toHaveLength(CASHOUT_ROWS.length);
  });

  it('draws the two bar charts with a summary and a data table each', () => {
    const { container } = render(<ChLimits chapter={chapter} />);
    const figs = [...container.querySelectorAll('figure.sp-chart')];
    expect(figs.map((f) => f.querySelector('figcaption')?.textContent)).toEqual([
      'Typical session, American wheel',
      'Typical session at 1,000 spins',
    ]);
    for (const f of figs) {
      expect(f.querySelectorAll('g.sp-bar')).toHaveLength(STRATEGIES.length);
      expect(f.querySelector('.sp-chart__summary')?.textContent).toContain('Typical session');
      expect(f.querySelector('details.sp-chart__table')).not.toBeNull();
    }
  });
});
