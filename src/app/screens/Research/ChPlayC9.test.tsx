// Chapter 10, "Play c9 at the table": the level table, the glyphs, Open in Define for the c9
// cash-out candidate, and the pocket card's print button.
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChPlayC9, glyphLevels, PRINT_CLASS, printCard } from './ChPlayC9';
import { CHAPTERS } from './content';
import { row } from './data';
import { money, pct1 } from './kit';
import { C9_ROW, LEVEL_HEAD, PLAY_C9 } from './playC9';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove(PRINT_CLASS);
  vi.unstubAllGlobals();
});

const chapter = CHAPTERS.find((c) => c.id === 'play-c9')!;

describe('ChPlayC9', () => {
  it('renders the level table with 16 rows and the derived amounts', () => {
    const { container } = render(<ChPlayC9 chapter={chapter} />);
    const table = container.querySelector('table.play-levels')!;
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      ...LEVEL_HEAD,
    ]);
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(16);
    expect(rows.map((r) => r.querySelector('th[scope=row]')!.textContent)).toEqual(
      PLAY_C9.levels.map((l) => String(l.level)),
    );
    const cells = (i: number) => [...rows[i]!.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells(0)).toEqual(['1 (1–3)', '1', '$1', money(-100), money(1100)]);
    expect(cells(14)).toEqual([
      '4 (1–12)',
      '274',
      '$1,096',
      `${money(-327500)}loss limit: leave`,
      money(1300),
    ]);
    expect(rows[14]!.classList.contains('play-level-trip')).toBe(true);
    expect(cells(15)[3]).toBe(`${money(-491900)}not reached`);
    expect(table.closest('.research-tablewrap')?.getAttribute('role')).toBe('region');
  });

  it('draws a board glyph for each key level', () => {
    const { container } = render(<ChPlayC9 chapter={chapter} />);
    expect(glyphLevels(PLAY_C9)).toEqual([0, 1, 2, 3, 14]);
    const glyphs = [...container.querySelectorAll('.play-glyph svg.board-glyph')];
    expect(glyphs).toHaveLength(5);
    expect(glyphs[0]!.querySelectorAll('.board-cell-on')).toHaveLength(3);
    expect(glyphs[4]!.querySelectorAll('.board-cell-on')).toHaveLength(12);
    expect(glyphs[4]!.getAttribute('aria-label')).toMatch(/^Level 14: 4 streets, \$274 each/);
  });

  it('shows the session numbers from the ledger row', () => {
    const r = row(C9_ROW);
    const { container } = render(<ChPlayC9 chapter={chapter} />);
    const stats = container.querySelector('.play-stats')!.textContent;
    for (const s of [money(r.median), pct1(r.pWin), pct1(1 - r.pWin), money(r.mean)])
      expect(stats).toContain(s);
    expect(container.textContent).toContain('every dollar you bet costs 2.7 cents');
    expect(container.textContent).toContain('It does not work there');
  });

  it('opens this exact candidate in Define', () => {
    const { container, getAllByRole } = render(<ChPlayC9 chapter={chapter} />);
    expect(container.querySelectorAll('.research-candidate')).toHaveLength(1);
    const [button] = getAllByRole('button', { name: /^Open in Define: / });
    expect(button!.getAttribute('aria-label')).toBe(
      'Open in Define: Keeper c9 + cash-out ($280 win, $2,460 loss)',
    );
  });

  it('prints the pocket card alone: marks the page, calls print, unmarks after printing', () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const { container, getByRole } = render(<ChPlayC9 chapter={chapter} />);
    const card = container.querySelector('.play-card')!;
    expect(card.querySelectorAll('table.play-card-table tbody tr')).toHaveLength(16);
    fireEvent.click(getByRole('button', { name: 'Print this card' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains(PRINT_CLASS)).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement.classList.contains(PRINT_CLASS)).toBe(false);
  });

  it('leaves no print mark behind on unmount', () => {
    vi.stubGlobal('print', vi.fn());
    const { unmount } = render(<ChPlayC9 chapter={chapter} />);
    printCard(window);
    expect(document.documentElement.classList.contains(PRINT_CLASS)).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains(PRINT_CLASS)).toBe(false);
  });
});
