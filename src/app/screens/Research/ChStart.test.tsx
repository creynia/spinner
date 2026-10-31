// Chapter 0: two columns of stat tiles built from the real data rows.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ChStart } from './ChStart';
import { CHAPTERS } from './content';
import { row } from './data';
import { money, pct1 } from './kit';

afterEach(cleanup);

const chapter = CHAPTERS.find((c) => c.id === 'start')!;

describe('ChStart', () => {
  it('draws five neutral tiles for flat red and five for the cash-out ladder', () => {
    const { container } = render(<ChStart chapter={chapter} />);
    const cols = [...container.querySelectorAll('.research-versus-col')];
    expect(cols.map((c) => c.querySelector('h3')?.textContent)).toEqual([
      'Flat $25 on red',
      'Streets with a cash-out',
    ]);
    for (const col of cols) {
      expect([...col.querySelectorAll('.stat-label')].map((e) => e.textContent)).toEqual([
        'Typical session',
        'Chance of ending ahead',
        'Average',
        'Worst 5 % of sessions',
        'Ended broke',
      ]);
      expect(col.querySelectorAll('.stat-neutral')).toHaveLength(5);
    }
  });

  it('shows the values of the data rows with intervals on the estimates', () => {
    const { container } = render(<ChStart chapter={chapter} />);
    const flat = row('observations:flat-red');
    const cash = row('e7-c9:e7-c9-W20-SLhalf');
    const values = [...container.querySelectorAll('.stat-value')].map((e) => e.textContent);
    expect(values).toEqual([
      money(flat.median),
      pct1(flat.pWin),
      money(flat.mean),
      money(flat.cvar5),
      pct1(flat.pBust),
      money(cash.median),
      pct1(cash.pWin),
      money(cash.mean),
      money(cash.cvar5),
      pct1(cash.pBust),
    ]);
    expect(container.querySelectorAll('.stat-ci')).toHaveLength(4);
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });

  it('has a computed summary sentence with the typical session of both', () => {
    const { container } = render(<ChStart chapter={chapter} />);
    const note = container.querySelector('p.research-note')!.textContent;
    expect(note).toContain(money(row('observations:flat-red').median));
    expect(note).toContain(money(row('e7-c9:e7-c9-W20-SLhalf').median));
  });
});
