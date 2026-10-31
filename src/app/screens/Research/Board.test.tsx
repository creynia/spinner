// The board glyph: 37 cells, covered cells filled, towers sized by the stake, the capped overlay.
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { BoardGlyph, chipCount } from './Board';

afterEach(cleanup);

describe('chipCount', () => {
  it('is 1 at the unit, one more per doubling, clamped to 1..11', () => {
    expect(chipCount(100)).toBe(1);
    expect(chipCount(200)).toBe(2);
    expect(chipCount(41100)).toBe(10);
    expect(chipCount(100000000)).toBe(11);
    expect(chipCount(1)).toBe(1);
    expect(chipCount(300, 300)).toBe(1);
  });
});

describe('BoardGlyph', () => {
  const bets = [
    { numbers: [1, 2, 3], amount: 100 },
    { numbers: [16, 17, 18], amount: 100 },
  ];

  it('draws 37 cells and fills the covered numbers only', () => {
    const { container } = render(<BoardGlyph bets={bets} label="two streets" />);
    expect(container.querySelectorAll('rect.board-cell')).toHaveLength(37);
    const on = [...container.querySelectorAll('rect.board-cell-on')].map((r) =>
      Number(r.getAttribute('data-n')),
    );
    expect(on).toEqual([1, 2, 3, 16, 17, 18]);
  });

  it('puts a street in one column: 3, 2, 1 from top to bottom', () => {
    const { container } = render(<BoardGlyph bets={bets} label="two streets" />);
    const cell = (n: number): Element => container.querySelector(`rect[data-n="${n}"]`)!;
    const y = (n: number): number => Number(cell(n).getAttribute('y'));
    expect(y(3)).toBeLessThan(y(2));
    expect(y(2)).toBeLessThan(y(1));
    expect(cell(1).getAttribute('x')).toBe(cell(3).getAttribute('x'));
  });

  it('stacks one disc per chip and has an accessible name', () => {
    const { container } = render(
      <BoardGlyph bets={[{ numbers: [1, 2, 3], amount: 400 }]} label="one street" />,
    );
    expect(container.querySelectorAll('rect.board-disc')).toHaveLength(3);
    expect(container.querySelector('svg')?.getAttribute('role')).toBe('img');
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('one street');
    expect(container.querySelector('title')).toBeNull();
  });

  it('covers the zero cell when zero is bet and shows the overlay when capped', () => {
    const { container } = render(
      <BoardGlyph bets={[{ numbers: [0], amount: 100 }]} label="zero" capped />,
    );
    expect(container.querySelector('rect[data-n="0"]')?.getAttribute('class')).toContain(
      'board-cell-on',
    );
    expect(container.querySelector('.board-capped')?.textContent).toBe('Ladder ran out');
    expect(container.querySelector('g[opacity="0.4"]')).not.toBeNull();
  });

  it('scales with width through the viewBox', () => {
    const { container } = render(<BoardGlyph bets={bets} label="x" width={130} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('130');
    expect(svg.getAttribute('viewBox')).toBe('0 0 260 112');
    expect(svg.getAttribute('height')).toBe('56');
  });
});
