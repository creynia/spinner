// Cash-out chapter: the target line with its prediction, the worst-5 % bars and the Martingale pair.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ChCashout, targetPoints } from './ChCashout';
import { CHAPTERS } from './content';
import { row } from './data';
import { money, pct1 } from './kit';

afterEach(cleanup);

const chapter = CHAPTERS.find((c) => c.id === 'cashout')!;

describe('ChCashout', () => {
  it('predicts (1 - q)^W from the spec meta, near the measured values', () => {
    const pts = targetPoints();
    expect(pts.map((p) => p.w)).toEqual([5, 10, 20, 50, 100]);
    const q = row('e7-c9:e7-c9-W20').meta!.q!;
    for (const p of pts) {
      expect(p.predicted).toBeCloseTo((1 - q) ** p.w, 12);
      expect(Math.abs(p.measured - p.predicted!)).toBeLessThan(0.01);
    }
    expect(pts[2]!.predicted!).toBeCloseTo(0.931, 3);
    expect(pts[4]!.predicted!).toBeCloseTo(0.7, 2);
  });

  it('draws two lines, the bars and the Martingale pair from data.json', () => {
    const { container } = render(<ChCashout chapter={chapter} />);
    expect(container.querySelectorAll('figure.sp-chart')).toHaveLength(2);
    expect(container.querySelectorAll('path.sp-line')).toHaveLength(2);
    expect(container.querySelectorAll('g.sp-bar')).toHaveLength(3);
    const text = container.textContent ?? '';
    expect(text).toContain('Chance of ending ahead by cash-out target');
    expect(text).toContain('Worst 5 % of sessions');
    expect(text).toContain('Half of sessions');
    expect(text).toContain('Martingale, 8 levels');
    expect(text).toContain('7 levels + stop');
    const m8 = row('e7-mart:e7m-stop-W20');
    const m7 = row('e7b-mart-L7stop:e7b-L7stop-W20');
    for (const s of [pct1(m8.pWin), money(m8.cvar5), pct1(m7.pWin), money(m7.cvar5)])
      expect(text, s).toContain(s);
    expect(container.querySelectorAll('.research-versus .stat')).toHaveLength(4);
  });

  it('has a summary and a data table for each chart, and h3 only for the two columns', () => {
    const { container } = render(<ChCashout chapter={chapter} />);
    for (const fig of container.querySelectorAll('figure.sp-chart')) {
      expect(fig.querySelector('.sp-chart__summary')?.textContent?.length).toBeGreaterThan(20);
      expect(fig.querySelector('details.sp-chart__table')).not.toBeNull();
    }
    expect(container.querySelector('.sp-chart__summary')?.textContent).toContain('98.2%');
    expect([...container.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
      'Martingale, 8 levels',
      '7 levels + stop',
    ]);
  });
});
