import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChipBoardProps } from '@core/ui';
import { ROULETTE_PRESETS } from '../rules';
import type { RouletteRules } from '../types';
import { ChipBoard } from './chip-board';
import { rouletteUi } from './index';
import { anchorOf, buildBoard } from './geometry';
import { stepOf } from './chips';

const rules: RouletteRules = ROULETTE_PRESETS.european;
const board = buildBoard('european', 'portrait');

function setPhone(phone: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: phone && q.includes('max-width'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
beforeEach(() => {
  setPhone(true);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const q = (c: ParentNode, sel: string): Element => {
  const el = c.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

function mount(over: Partial<ChipBoardProps<RouletteRules>> = {}) {
  const onAdjust = vi.fn();
  const onStatus = vi.fn();
  const props: ChipBoardProps<RouletteRules> = {
    rules,
    spots: [],
    tool: 'add',
    chipValue: null,
    onAdjust,
    onStatus,
    ...over,
  };
  const r = render(<ChipBoard {...props} />);
  const svg = q(r.container, 'svg.rl-board') as SVGSVGElement;
  // The SVG fills 374 x 672 CSS px, so client px are board units minus the viewBox origin.
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: board.view.w, height: board.view.h }) as DOMRect;
  const at = (id: string) => {
    const p = anchorOf(board, id)!;
    return { clientX: p.x - board.view.x, clientY: p.y - board.view.y };
  };
  const tap = (id: string, target: Element = svg): void => {
    fireEvent.click(target, { detail: 1, ...at(id) });
  };
  const openMode = (): void => {
    fireEvent.click(q(r.container, '.rl-mode'));
  };
  const openCalls = (): void => {
    openMode();
    fireEvent.click(r.getByRole('button', { name: 'Call bets…' }));
  };
  return {
    ...r,
    openMode,
    openCalls,
    svg,
    onAdjust,
    onStatus,
    at,
    tap,
    rerender: (p: Partial<typeof props>) => r.rerender(<ChipBoard {...props} {...p} />),
  };
}

describe('tap placement', () => {
  it('acts on click, never on pointerdown', () => {
    const { svg, onAdjust, at, tap } = mount();
    fireEvent.pointerDown(svg, { button: 0, pointerType: 'touch', ...at('straight:17') });
    fireEvent.pointerUp(svg, { button: 0, ...at('straight:17') });
    expect(onAdjust).not.toHaveBeenCalled();
    tap('straight:17');
    expect(onAdjust).toHaveBeenCalledWith('straight:17', 1);
  });

  it('Auto mode resolves edges to splits and corners', () => {
    const { onAdjust, tap } = mount();
    tap('split:17-20');
    tap('corner:13-14-16-17');
    expect(onAdjust.mock.calls.map((c) => String(c[0]))).toEqual([
      'split:17-20',
      'corner:13-14-16-17',
    ]);
  });

  it('a lock picks the nearest bet of that family anywhere in the cell', () => {
    const { svg, onAdjust, getByRole, at, openMode } = mount();
    openMode();
    const group = getByRole('radiogroup');
    fireEvent.click(group.querySelector('[role=radio][aria-label="2, split"]')!);
    expect(q(document.body, '.rl-mode').textContent).toBe('Split ▾');
    // Near the middle of cell 17 a split is still chosen, never the straight.
    const p = at('straight:17');
    fireEvent.click(svg, { detail: 1, ...p });
    expect(String(onAdjust.mock.calls[0]![0])).toMatch(/^split:/);
  });

  it('long-press opens the bet sheet and swallows the click', async () => {
    vi.useFakeTimers();
    const { container, svg, onAdjust, at, getByRole } = mount();
    const cell = q(container, '[data-pocket="17"]');
    fireEvent.pointerDown(cell, { button: 0, pointerType: 'touch', ...at('straight:17') });
    await act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(container.querySelector('[role=dialog]')).toBeNull();
    await act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(getByRole('dialog').getAttribute('aria-label')).toBe('Bets on 17');
    fireEvent.pointerUp(cell, { button: 0 });
    fireEvent.click(svg, { detail: 1, ...at('straight:17') });
    expect(onAdjust).not.toHaveBeenCalled();
    // The next tap works again.
    fireEvent.click(svg, { detail: 1, ...at('straight:17') });
    expect(onAdjust).toHaveBeenCalledTimes(1);
  });

  it('moving more than 8 px, or releasing early, cancels the long-press', async () => {
    vi.useFakeTimers();
    const { container, at } = mount();
    const cell = q(container, '[data-pocket="17"]');
    const p = at('straight:17');
    fireEvent.pointerDown(cell, { button: 0, ...p });
    fireEvent.pointerMove(cell, { clientX: p.clientX + 9, clientY: p.clientY });
    await act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(container.querySelector('[role=dialog]')).toBeNull();
    fireEvent.pointerDown(cell, { button: 0, ...p });
    fireEvent.pointerUp(cell, { button: 0 });
    await act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(container.querySelector('[role=dialog]')).toBeNull();
  });

  it('suppresses contextmenu; only a mouse right-click removes one step', () => {
    const { svg, onAdjust, at } = mount({ spots: [{ bet: 'straight:17', chips: 2 }] });
    const touch = fireEvent.contextMenu(svg, { button: 0, ...at('straight:17') });
    expect(touch).toBe(false); // preventDefault was called
    expect(onAdjust).not.toHaveBeenCalled();
    fireEvent.contextMenu(svg, { button: 2, ...at('straight:17') });
    expect(onAdjust).toHaveBeenCalledWith('straight:17', -1);
  });

  it('draws chips with pointer-events none so the board decides', () => {
    const { container } = mount({ spots: [{ bet: 'straight:17', chips: 2 }] });
    const chip = q(container, '.rl-chip');
    expect(chip.getAttribute('style')).toContain('pointer-events');
    expect(chip.textContent).toBe('2');
    expect(q(container, 'svg.rl-board').classList.contains('rl-board--place')).toBe(true);
  });
});

describe('tools', () => {
  it('Remove takes a step off a spot, and says so when the spot is empty', () => {
    const { tap, onAdjust, onStatus, rerender } = mount({
      tool: 'remove',
      spots: [{ bet: 'straight:17', chips: 2 }],
    });
    tap('straight:17');
    expect(onAdjust).toHaveBeenCalledWith('straight:17', -1);
    onAdjust.mockClear();
    rerender({ tool: 'remove', spots: [] });
    tap('straight:17');
    expect(onAdjust).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('No chips on Straight 17');
  });

  it('reports the resolved bet with the new chip count', () => {
    const { tap, onStatus } = mount({ spots: [{ bet: 'split:17-20', chips: 1 }] });
    tap('split:17-20');
    expect(onStatus).toHaveBeenLastCalledWith('Split 17 and 20 · 2 chips');
  });

  it('outside boxes: Enter applies the tool, Delete removes one step', () => {
    const { container, onAdjust } = mount({ spots: [{ bet: 'red', chips: 3 }] });
    const red = q(container, '[data-bet="red"]');
    fireEvent.keyDown(red, { key: 'Enter' });
    expect(onAdjust).toHaveBeenLastCalledWith('red', 1);
    fireEvent.keyDown(red, { key: 'Delete' });
    expect(onAdjust).toHaveBeenLastCalledWith('red', -1);
    expect(red.getAttribute('aria-label')).toMatch(/^Red, 3 chips, pays 1 to 1\. Adds a chip\.$/);
    expect(red.getAttribute('aria-label')!.toLowerCase()).toContain('red');
  });

  it('a pointer-less click on an outside box (assistive technology) applies the tool', () => {
    const { container, onAdjust } = mount();
    fireEvent.click(q(container, '[data-bet="dozen:2"]'), { detail: 0 });
    expect(onAdjust).toHaveBeenCalledWith('dozen:2', 1);
  });
});

describe('bet-type lock', () => {
  it('is a radiogroup named "Bet type" with label-in-name options', () => {
    const { getByRole, openMode } = mount();
    openMode();
    const group = getByRole('radiogroup');
    const label = document.getElementById(group.getAttribute('aria-labelledby')!)!;
    expect(label.textContent).toBe('Bet type');
    expect(label.firstChild!.textContent).toBe('Bet');
    const radios = [...group.querySelectorAll('[role=radio]')];
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Auto',
      '1, straight',
      '2, split',
      '3, street',
      '4, corner (trio and basket nearest the zero)',
      '6, six line',
    ]);
    for (const r of radios)
      expect(r.getAttribute('aria-label')?.startsWith(r.textContent ?? '')).toBe(true);
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(radios.filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('arrow keys move and select, announce the mode, and persist per device', () => {
    const { getByRole, onStatus, openMode } = mount();
    openMode();
    const group = getByRole('radiogroup');
    const auto = group.querySelector('[role=radio]')!;
    fireEvent.keyDown(auto, { key: 'ArrowRight' });
    fireEvent.keyDown(group.querySelectorAll('[role=radio]')[1]!, { key: 'ArrowRight' });
    expect(onStatus).toHaveBeenLastCalledWith('Split mode');
    expect(localStorage.getItem('spinner:chip-lock')).toBe('split');
    cleanup();
    const again = mount();
    again.openMode();
    expect(
      again
        .getByRole('radiogroup')
        .querySelector('[aria-checked=true]')!
        .getAttribute('aria-label'),
    ).toBe('2, split');
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { getByRole, openMode } = mount();
    openMode();
    expect(() =>
      fireEvent.click(getByRole('radiogroup').querySelectorAll('[role=radio]')[3]!),
    ).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('call bets and neighbours', () => {
  it('one compact control opens the mode sheet; Call bets… is European only', () => {
    const e = mount();
    expect(e.container.querySelector('[role=tablist]')).toBeNull();
    const btn = q(e.container, '.rl-mode');
    expect(btn.textContent).toBe('Auto ▾');
    expect(btn.getAttribute('aria-label')).toBe('Auto, bet type and call bets');
    e.openMode();
    expect(e.getByRole('dialog', { name: 'Bet type' })).toBeTruthy();
    expect(e.getByRole('button', { name: 'Call bets…' })).toBeTruthy();
    cleanup();
    const us = render(
      <ChipBoard
        rules={ROULETTE_PRESETS.american}
        spots={[]}
        tool="add"
        chipValue={null}
        onAdjust={() => undefined}
      />,
    );
    fireEvent.click(q(us.container, '.rl-mode'));
    expect(us.queryByRole('button', { name: 'Call bets…' })).toBeNull();
  });

  it('Escape closes the sheet and focus returns to the control', async () => {
    vi.useFakeTimers();
    const { container, openMode, getByRole } = mount();
    openMode();
    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' });
    await act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(q(container, '.rl-mode'));
  });

  it('sector steppers move by the call bet pieces', () => {
    const { container, onAdjust, openCalls } = mount({ spots: [{ bet: 'voisins', chips: 9 }] });
    expect(stepOf('voisins')).toBe(9);
    openCalls();
    const plus = q(container, '[data-bet="voisins"] button[aria-label^="Add"]');
    fireEvent.click(plus);
    expect(onAdjust).toHaveBeenLastCalledWith('voisins', 9);
    fireEvent.click(q(container, '[data-bet="voisins"] button[aria-label^="Remove"]'));
    expect(onAdjust).toHaveBeenLastCalledWith('voisins', -9);
    expect(q(container, '[data-bet="voisins"] output').textContent).toBe('9');
    expect(
      q(container, '[data-bet="tiers"] button[aria-label^="Remove"]').hasAttribute('disabled'),
    ).toBe(true);
  });

  it('neighbours add 2k+1 chips and placed neighbours get steppers', () => {
    const { container, onAdjust, openCalls } = mount({
      spots: [{ bet: 'neighbours:0:2', chips: 5 }],
    });
    openCalls();
    fireEvent.click(q(container, '[data-add-neighbours]'));
    expect(onAdjust).toHaveBeenLastCalledWith('neighbours:0:2', 5);
    fireEvent.click(q(container, 'button[aria-label="More neighbours"]'));
    fireEvent.click(q(container, '[data-add-neighbours]'));
    expect(onAdjust).toHaveBeenLastCalledWith('neighbours:0:3', 7);
    const placed = q(
      container,
      '[aria-label="Neighbours on the layout"] [data-bet="neighbours:0:2"]',
    );
    fireEvent.click(q(placed, 'button[aria-label^="Remove"]'));
    expect(onAdjust).toHaveBeenLastCalledWith('neighbours:0:2', -5);
  });

  it('draws call bets as dashed ghost chips on their component spots', () => {
    const { container } = mount({ spots: [{ bet: 'voisins', chips: 9 }] });
    const ghosts = [...container.querySelectorAll('.rl-chip--ghost')];
    expect(ghosts.length).toBeGreaterThan(5);
    expect(ghosts.every((g) => g.getAttribute('data-kind') === 'ghost')).toBe(true);
    const total = ghosts.reduce((n, g) => n + Number(g.getAttribute('data-count')), 0);
    expect(total).toBe(9);
    expect(ghosts[0]!.getAttribute('aria-label')).toMatch(/from Voisins du zéro/);
  });
});

describe('sheet and accessible names', () => {
  it('Enter on a number opens the sheet with steppers; the sheet stays open', () => {
    const { container, onAdjust, rerender, getByRole } = mount({
      spots: [{ bet: 'straight:17', chips: 2 }],
    });
    const cell = q(container, '[data-pocket="17"]');
    expect(cell.getAttribute('aria-label')).toMatch(
      /^Straight 17 \(black\), 2 chips, pays 35 to 1\./,
    );
    fireEvent.keyDown(cell, { key: 'Enter' });
    const dialog = getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Bets on 17');
    const row = q(dialog, '[data-bet-row="straight:17"]');
    expect(q(row, 'output').textContent).toBe('2');
    fireEvent.click(q(row, 'button[aria-label^="Add"]'));
    expect(onAdjust).toHaveBeenLastCalledWith('straight:17', 1);
    fireEvent.click(q(row, 'button[aria-label^="Remove"]'));
    expect(onAdjust).toHaveBeenLastCalledWith('straight:17', -1);
    rerender({ spots: [{ bet: 'straight:17', chips: 3 }] });
    expect(q(container, '[role=dialog] [data-bet-row="straight:17"] output').textContent).toBe('3');
    // Every inside bet containing 17 has a row with its own stepper.
    expect(dialog.querySelectorAll('[data-bet-row]').length).toBeGreaterThan(8);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(container.querySelector('[role=dialog]')).toBeNull();
  });

  it('chips carry names with counts', () => {
    const { container } = mount({
      spots: [
        { bet: 'split:1-4', chips: 3 },
        { bet: 'straight:17', chips: 1 },
      ],
    });
    const labels = [...container.querySelectorAll('.rl-chip[role=img]')].map((c) =>
      c.getAttribute('aria-label'),
    );
    expect(labels).toContain('Split 1 and 4, 3 chips');
    expect(labels).toContain('Straight 17, 1 chip');
  });

  it('a flagged spot is ringed with a "!" and its reason is in the name', () => {
    const { container } = mount({
      spots: [{ bet: 'straight:17', chips: 1 }],
      flagged: new Map([['straight:17', 'below the table minimum']]),
    });
    const chip = q(container, '.rl-chip--flag');
    expect(chip.querySelector('.rl-flag')!.textContent).toBe('!');
    expect(chip.getAttribute('aria-label')).toContain('below the table minimum');
  });

  it('the pockets of the last spot stay lit under reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce') || query.includes('max-width'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { container } = mount({ last: 'split:17-20' });
    expect(
      [...container.querySelectorAll('.rl-hl')].map((c) =>
        c.closest('[data-pocket]')!.getAttribute('data-pocket'),
      ),
    ).toEqual(['17', '20']);
  });
});

describe('readOnly', () => {
  it('draws count badges only: no taps, no tabs, no lock, no sheet', () => {
    const { container, svg, onAdjust, at } = mount({
      readOnly: true,
      spots: [
        { bet: 'straight:17', chips: 4 },
        { bet: 'voisins', chips: 9 },
      ],
    });
    expect(container.querySelector('[role=button]')).toBeNull();
    expect(container.querySelector('[role=radiogroup], .rl-mode')).toBeNull();
    expect(container.querySelector('[role=tablist]')).toBeNull();
    expect(svg.classList.contains('rl-board--place')).toBe(false);
    expect(q(container, '[data-spot="straight:17"]:not(.rl-chip--ghost)').textContent).toBe('4');
    fireEvent.click(svg, { detail: 1, ...at('straight:17') });
    expect(onAdjust).not.toHaveBeenCalled();
  });
});

describe('rouletteUi.chips', () => {
  it('supplies ChipBoard, step and ascending denominations', () => {
    const chips = rouletteUi.chips!;
    expect(chips.ChipBoard).toBe(ChipBoard);
    expect(chips.step('straight:0')).toBe(1);
    expect(chips.step('voisins')).toBe(9);
    expect(chips.step('neighbours:0:3')).toBe(7);
    expect([...chips.denominations]).toEqual([...chips.denominations].sort((a, b) => a - b));
    expect(chips.denominations).toContain(500);
  });
});
