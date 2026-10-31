// Chapter 3: measured horizon against the n-half prediction for L5 to L10, and the two bankroll stats.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ChLevels, predictedHalfLife } from './ChLevels';
import { CHAPTERS } from './content';
import { row } from './data';
import { ladder } from './ladderMath';

afterEach(cleanup);

const chapter = CHAPTERS.find((c) => c.id === 'levels')!;
const LEVELS = [5, 6, 7, 8, 9, 10];

describe('ChLevels', () => {
  it('predicts the same half-life as ladder() for a $5 base, L10 within 3 of 1,117', () => {
    const want = LEVELS.map(
      (L) => ladder({ c: 18, g: 2, base: 500, unit: 500, betMax: 500000, maxLevels: L }).nHalf,
    );
    const got = LEVELS.map((L) => predictedHalfLife(row(`e3a-levels:e3a-L${L}`), L));
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 6));
    expect(Math.abs(got[5]! - 1117)).toBeLessThan(3);
  });

  it('draws a measured and a predicted line over six levels with the session-end reference', () => {
    const { container } = render(<ChLevels chapter={chapter} />);
    expect(
      [...container.querySelectorAll('path.sp-line')].map((p) => p.getAttribute('data-series')),
    ).toEqual(['measured', 'predicted']);
    expect(container.querySelectorAll('circle.sp-point')).toHaveLength(12);
    expect(container.querySelector('[data-ref^="Session ends"]')).not.toBeNull();
    expect(container.querySelector('.sp-chart__summary')?.textContent).toContain('$10,000');
  });

  it('tables every level, showing 500+ for sessions still ahead at the end', () => {
    const { container } = render(<ChLevels chapter={chapter} />);
    const body = [...container.querySelectorAll('.sp-chart__table tbody tr')].map((tr) =>
      [...tr.children].map((c) => c.textContent),
    );
    expect(body.map((r) => r[0])).toEqual(LEVELS.map(String));
    expect(body[0]![1]).toBe(`${row('e3a-levels:e3a-L5').medianAheadUntil} spins`);
    expect(body[4]![1]).toBe('500+ spins');
    expect(body[5]![1]).toBe('500+ spins');
    expect(body[5]![2]).toMatch(/^1,11\d spins$/);
    expect(container.innerHTML).not.toMatch(/NaN|undefined/);
  });

  it('shows the two bankroll stats', () => {
    const { container } = render(<ChLevels chapter={chapter} />);
    const labels = [...container.querySelectorAll('.stat-label')].map((e) => e.textContent);
    expect(labels).toEqual(['Ahead until, $5,000 bankroll', 'Ahead until, $10,000 bankroll']);
    const values = [...container.querySelectorAll('.stat-value')].map((e) => e.textContent);
    expect(values).toEqual([
      `Spin ${row('observations:martingale-red').medianAheadUntil}`,
      `Spin ${row('observations:martingale-red-br10k').medianAheadUntil}`,
    ]);
  });
});
