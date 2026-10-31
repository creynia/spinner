// Chapter 2: median paths of flat, Martingale and Fibonacci on red, the Martingale band and the
// spin-290 mark, all from the real data.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ChMartingale } from './ChMartingale';
import { CHAPTERS } from './content';
import { path, row } from './data';
import { money } from './kit';

afterEach(cleanup);

const chapter = CHAPTERS.find((c) => c.id === 'martingale')!;

describe('ChMartingale', () => {
  it('draws three lines, the Martingale band, break-even and the turning spin', () => {
    const { container } = render(<ChMartingale chapter={chapter} />);
    expect(
      [...container.querySelectorAll('path.sp-line')].map((p) => p.getAttribute('data-series')),
    ).toEqual(['flat', 'martingale', 'fibonacci']);
    expect(container.querySelectorAll('path.sp-band')).toHaveLength(1);
    expect(container.querySelector('[data-ref="Break-even"]')).not.toBeNull();
    const turn = container.querySelector('[data-ref="turn"] text')!.textContent;
    expect(turn).toContain(`Spin ${row('observations:martingale-red').medianAheadUntil}`);
    expect(turn).toContain('290');
    // dashes as well as colours tell the lines apart
    const dashes = [...container.querySelectorAll('path.sp-line')].map((p) =>
      p.getAttribute('stroke-dasharray'),
    );
    expect(new Set(dashes).size).toBe(3);
  });

  it('has a legend with the band, a summary naming the peak and the turn, and a full table', () => {
    const { container } = render(<ChMartingale chapter={chapter} />);
    const legend = container.querySelector('.sp-chart__legend')!.textContent;
    expect(legend).toContain('Martingale, middle 80 %');
    expect(legend).toContain('Fibonacci');
    const summary = container.querySelector('.sp-chart__summary')!.textContent;
    const mart = row('observations:martingale-red');
    expect(summary).toContain(money(mart.medianPeak.net));
    expect(summary).toContain('290');
    const rows = container.querySelectorAll('.sp-chart__table tbody tr');
    expect(rows).toHaveLength(path('observations:martingale-red').rounds.length);
    expect(container.querySelectorAll('.sp-chart__table th[scope="col"]')).toHaveLength(6);
    expect(container.innerHTML).not.toMatch(/NaN|undefined/);
  });
});
