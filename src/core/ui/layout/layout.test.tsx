import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coin, COIN_BET } from '../../testing';
import type { CoinRules } from '../../testing';
import type { GamePlugin } from '../../contracts/game';
import { MAX_LAYOUT_SPOTS } from '../../contracts/layout';
import type { BetPickerProps, ChipBoardProps } from '../game-ui';
import { Sheet } from '../kit';
import { ChipRack, LayoutEditor, LayoutThumb, SpotList, defaultDenom } from '.';
import type { LayoutEditorProps, TableCheck } from '.';

const plugin = coin as unknown as GamePlugin<unknown, unknown, CoinRules, unknown>;
const rules = coin.rules.resolve();
const min = coin.limits(COIN_BET, rules)!.min;

let boardProps: ChipBoardProps<CoinRules> | null = null;
const FakeBoard: ComponentType<ChipBoardProps<CoinRules>> = (p) => {
  boardProps = p;
  return (
    <div data-testid="board" data-readonly={String(!!p.readOnly)}>
      <button type="button" onClick={() => p.onAdjust(COIN_BET, p.tool === 'add' ? 1 : -1)}>
        tap heads
      </button>
      <button
        type="button"
        onClick={() => p.onAdjust(`x${p.spots.length}`, p.tool === 'add' ? 1 : -1)}
      >
        tap new
      </button>
    </div>
  );
};
const FakePicker: ComponentType<BetPickerProps<CoinRules>> = (p) => (
  <button type="button" onClick={() => p.onPick(COIN_BET)}>
    pick heads
  </button>
);
const TableView = vi.fn((_p: unknown) => <div data-testid="tableview" />);
const ui = {
  BetPicker: FakePicker,
  TableView: TableView as never,
  chips: { ChipBoard: FakeBoard, step: () => 1, denominations: [min, min * 5, min * 25] },
};

function setWidth(w: number) {
  (window as unknown as { innerWidth: number }).innerWidth = w;
  window.dispatchEvent(new Event('resize'));
}
const editor = (over: Partial<LayoutEditorProps<CoinRules>> = {}) => (
  <LayoutEditor<CoinRules>
    plugin={plugin}
    rules={rules}
    ui={ui}
    initialSpots={[]}
    name="Test layout"
    variant="v"
    chipValue={min}
    bankroll={10_000_000}
    onSave={() => {}}
    onClose={() => {}}
    {...over}
  />
);
const live = (c: Element) => c.querySelector('[aria-live="polite"]')!.textContent.trim();

beforeEach(() => setWidth(360));
afterEach(() => {
  cleanup();
  boardProps = null;
  TableView.mockClear();
  setWidth(1024);
});

describe('LayoutEditor: tools, history and the live region', () => {
  it('names its controls and groups', () => {
    const { container } = render(editor());
    for (const n of ['Back', 'Undo', 'Redo', 'Clear', 'More'])
      expect(screen.getByRole('button', { name: n })).toBeTruthy();
    const tool = screen.getByRole('radiogroup', { name: 'Tool' });
    expect(
      within(tool)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['Add chips', 'Remove chips']);
    expect(screen.getByRole('tablist', { name: 'Editor view' })).toBeTruthy();
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('adds through the board, announces, and undoes and redoes', () => {
    const { container } = render(editor());
    fireEvent.click(screen.getByText('tap heads'));
    fireEvent.click(screen.getByText('tap heads'));
    expect(boardProps!.spots).toEqual([{ bet: COIN_BET, chips: 2 }]);
    expect(live(container)).toContain('2 chips');
    expect(boardProps!.last).toBe(COIN_BET);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(boardProps!.spots).toEqual([{ bet: COIN_BET, chips: 1 }]);
    expect(live(container)).toMatch(/^Undid: /);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(live(container)).toMatch(/^Redid: /);
    expect(boardProps!.spots[0]!.chips).toBe(2);
  });

  it('removes in Remove mode, and says so when there is nothing to remove', () => {
    const { container } = render(editor({ initialSpots: [{ bet: COIN_BET, chips: 1 }] }));
    fireEvent.click(screen.getByRole('radio', { name: 'Remove chips' }));
    expect(boardProps!.tool).toBe('remove');
    fireEvent.click(screen.getByText('tap heads'));
    expect(boardProps!.spots).toEqual([]);
    fireEvent.click(screen.getByText('tap heads'));
    expect(live(container)).toMatch(/^No chips on /);
  });

  it('clear is undoable and disabled when empty', () => {
    render(editor({ initialSpots: [{ bet: COIN_BET, chips: 3 }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(boardProps!.spots).toEqual([]);
    expect(screen.getByRole('button', { name: 'Clear' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(boardProps!.spots).toHaveLength(1);
  });

  it('handles Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y and E', () => {
    render(editor());
    fireEvent.click(screen.getByText('tap heads'));
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(boardProps!.spots).toEqual([]);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(boardProps!.spots).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'z', metaKey: true });
    fireEvent.keyDown(document, { key: 'y', ctrlKey: true });
    expect(boardProps!.spots).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'e' });
    expect(boardProps!.tool).toBe('remove');
    fireEvent.keyDown(document, { key: 'e' });
    expect(boardProps!.tool).toBe('add');
  });

  it('leaves shortcuts alone while typing in a field', () => {
    render(editor());
    fireEvent.click(screen.getByText('tap heads'));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const name = screen.getByLabelText('Name');
    fireEvent.keyDown(name, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(name, { key: 'e' });
    expect(boardProps!.spots).toHaveLength(1);
    expect(boardProps!.tool).toBe('add');
  });

  it('arrow keys move the tool radio', () => {
    render(editor());
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Add chips' }), { key: 'ArrowRight' });
    expect(boardProps!.tool).toBe('remove');
  });

  it('refuses a 65th spot and a spot above the chip limit', () => {
    const many = Array.from({ length: MAX_LAYOUT_SPOTS }, (_, i) => ({ bet: `x${i}`, chips: 1 }));
    const { container } = render(editor({ initialSpots: many }));
    fireEvent.click(screen.getByText('tap new'));
    expect(boardProps!.spots).toHaveLength(MAX_LAYOUT_SPOTS);
    expect(live(container)).toContain('at most 64 spots');
    cleanup();
    const r = render(editor({ initialSpots: [{ bet: COIN_BET, chips: 1000 }] }));
    fireEvent.click(screen.getByText('tap heads'));
    expect(boardProps!.spots[0]!.chips).toBe(1000);
    expect(live(r.container)).toContain('1000 chips');
  });

  it('lowers the spot limit by the reserved rows', () => {
    const { container } = render(
      editor({ initialSpots: [{ bet: 'x0', chips: 1 }], reservedSpots: MAX_LAYOUT_SPOTS - 1 }),
    );
    fireEvent.click(screen.getByText('tap new'));
    expect(boardProps!.spots).toHaveLength(1);
    expect(live(container)).toContain('at most 1 spot');
  });

  it('survives 200 taps quickly', () => {
    render(editor());
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) fireEvent.click(screen.getByText('tap heads'));
    expect(boardProps!.spots[0]!.chips).toBe(200);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('LayoutEditor: table check, save and guard', () => {
  it('flags spots that fail the table check and shows money in the status', () => {
    const { container } = render(
      editor({ initialSpots: [{ bet: COIN_BET, chips: 1 }], chipValue: 200_000 }),
    );
    expect(boardProps!.chipValue).toBe(200_000);
    expect([...boardProps!.flagged!.keys()]).toEqual([COIN_BET]);
    expect(container.querySelector('.le-problems')!.getAttribute('role')).toBe('status');
    expect(container.querySelector('.le-summary')!.textContent).toContain('!');
  });

  it('shows a neutral hint, not a failure, when only the table minimum is short', () => {
    const { container } = render(
      editor({ initialSpots: [{ bet: COIN_BET, chips: 1 }], chipValue: 50 }),
    );
    expect(container.querySelector('.le-problems')).toBeNull();
    const text = container.querySelector('.le-summary')!.textContent;
    expect(text).toContain('Add $1 more');
    expect(text).toContain('table minimum');
    expect(text).not.toContain('!');
    expect(text).not.toContain('spots placed');
    // The spot is still marked on the board and in the List.
    expect([...boardProps!.flagged!.keys()]).toEqual([COIN_BET]);
  });

  it('keeps the red failure when a minimum is short alongside a real problem', () => {
    const { container } = render(
      editor({
        initialSpots: [
          { bet: COIN_BET, chips: 1 },
          { bet: 'nope', chips: 1 },
        ],
        chipValue: 50,
      }),
    );
    expect(container.querySelector('.le-problems')).not.toBeNull();
    expect(container.querySelector('.le-summary')!.textContent).toContain('!');
  });

  it('shows a tick when everything is placed', () => {
    const { container } = render(editor({ initialSpots: [{ bet: COIN_BET, chips: 1 }] }));
    expect(boardProps!.flagged!.size).toBe(0);
    expect(container.querySelector('.le-problems')).toBeNull();
    expect(container.querySelector('.le-summary')!.textContent).toContain('✓');
  });

  it('shows counts when there is no preview value', () => {
    render(editor({ initialSpots: [{ bet: COIN_BET, chips: 1 }], chipValue: null }));
    expect(boardProps!.chipValue).toBeNull();
    expect(boardProps!.flagged!.size).toBe(0);
  });

  it('Save needs a spot, then hands back the edited fields', () => {
    const onSave = vi.fn();
    render(editor({ onSave, notes: 'n' }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('tap heads'));
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({
      spots: [{ bet: COIN_BET, chips: 1 }],
      name: 'Test layout',
      variant: 'v',
      notes: 'n',
    });
  });

  it('keeps the editor open and says so when saving rejects', async () => {
    const onClose = vi.fn();
    const { container } = render(
      editor({
        initialSpots: [{ bet: COIN_BET, chips: 1 }],
        onSave: () => Promise.reject(new Error('x')),
        onClose,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(() => Promise.resolve());
    expect(live(container)).toContain('Could not save');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes at once when clean, and asks before discarding edits', () => {
    const onClose = vi.fn();
    render(editor({ onClose }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('tap heads'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeTruthy();
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Keep editing'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByText('Discard'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('undoing back to the start is clean again', () => {
    const onClose = vi.fn();
    render(editor({ onClose }));
    fireEvent.click(screen.getByText('tap heads'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('edits the variant and the preview value in More', () => {
    const onVariantChange = vi.fn();
    render(
      editor({
        variants: [
          { id: 'v', label: 'Wheel V' },
          { id: 'w', label: 'Wheel W' },
        ],
        onVariantChange,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.change(screen.getByLabelText('Wheel'), { target: { value: 'w' } });
    expect(onVariantChange).toHaveBeenCalledWith('w');
    fireEvent.click(screen.getByRole('radio', { name: `$${(min * 5) / 100}` }));
    expect(boardProps!.chipValue).toBe(min * 5);
    fireEvent.click(screen.getByText('Show chip counts'));
    expect(boardProps!.chipValue).toBeNull();
  });
});

describe('LayoutEditor: placement', () => {
  it('portrait: tabs switch between the board and the list', () => {
    render(editor({ initialSpots: [{ bet: COIN_BET, chips: 1 }] }));
    expect(screen.getByTestId('board')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    expect(screen.queryByTestId('board')).toBeNull();
    expect(screen.getByRole('list', { name: /Spots/ })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Tool' })).toBeNull();
  });

  it('landscape: a rail with a List sheet', () => {
    setWidth(844);
    render(editor({ initialSpots: [{ bet: COIN_BET, chips: 1 }] }));
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Tools' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(within(screen.getByRole('dialog')).getByRole('list')).toBeTruthy();
  });

  it('desktop: the list sits under the rail', () => {
    setWidth(1280);
    const { container } = render(editor({ initialSpots: [{ bet: COIN_BET, chips: 1 }] }));
    expect(container.querySelector('.le-rail .spot-list')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'List' })).toBeNull();
  });
});

describe('SpotList', () => {
  const base = {
    rules,
    catalog: coin.bets.catalog(rules),
    BetPicker: FakePicker,
    step: () => 2,
    chipValue: null,
  };
  const spots = [
    { bet: 'a', chips: 1 },
    { bet: COIN_BET, chips: 3 },
  ];

  it('has steppers, remove and reorder with accessible names', () => {
    const onAdjust = vi.fn();
    const onRemove = vi.fn();
    const onMove = vi.fn();
    render(
      <SpotList {...base} spots={spots} onAdjust={onAdjust} onRemove={onRemove} onMove={onMove} />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 chips to a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove 2 chips from a' }));
    expect(onAdjust.mock.calls).toEqual([
      ['a', 2],
      ['a', -2],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Move a down' }));
    expect(onMove).toHaveBeenCalledWith('a', 1);
    expect(screen.getByRole('button', { name: 'Move a up' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove a' }));
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('adds a bet through the picker by one step', () => {
    const onAdjust = vi.fn();
    render(
      <SpotList {...base} spots={[]} onAdjust={onAdjust} onRemove={vi.fn()} onMove={vi.fn()} />,
    );
    expect(screen.getByText(/No chips yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a bet' }));
    fireEvent.click(screen.getByText('pick heads'));
    expect(onAdjust).toHaveBeenCalledWith(COIN_BET, 2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables Add a bet at the spot limit', () => {
    render(
      <SpotList
        {...base}
        spots={spots}
        maxSpots={2}
        onAdjust={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add a bet' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows money and the table-check message per row', () => {
    const check: TableCheck = {
      total: 0,
      affordable: true,
      perSpot: [
        {
          bet: 'a',
          asked: 100,
          placed: 0,
          status: 'rejected',
          code: 'below-min',
          reason: 'below the table minimum',
        },
        {
          bet: COIN_BET,
          asked: 900,
          placed: 500,
          status: 'adjusted',
          code: 'clamped',
          reason: 'cut to the table maximum',
        },
      ],
    };
    const { container } = render(
      <SpotList
        {...base}
        chipValue={300}
        check={check}
        spots={spots}
        onAdjust={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    const rows = container.querySelectorAll('.spot-row');
    expect(rows[0]!.textContent).toContain('$3');
    expect(rows[0]!.textContent).toContain('Dropped: below the table minimum');
    expect(rows[1]!.textContent).toContain('$9 becomes $5');
    expect(container.querySelectorAll('.is-flagged')).toHaveLength(2);
  });
});

describe('ChipRack', () => {
  it('is a radiogroup with one tab stop and arrow keys', () => {
    const onChange = vi.fn();
    render(<ChipRack denominations={[100, 500, 2500]} value={500} onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Chip value' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['$1', '$5', '$25']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(radios[1]!, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(2500);
    fireEvent.keyDown(radios[1]!, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith(100);
  });
  it('stays reachable when nothing is selected, and takes a label', () => {
    render(<ChipRack denominations={[100, 500]} value={null} onChange={vi.fn()} label="Chips" />);
    const radios = within(screen.getByRole('radiogroup', { name: 'Chips' })).getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1]);
  });
});

describe('LayoutThumb', () => {
  it('uses ChipBoard readOnly for counts', () => {
    render(
      <LayoutThumb ui={ui} rules={rules} spots={[{ bet: COIN_BET, chips: 2 }]} chipValue={null} />,
    );
    expect(screen.getByTestId('board').dataset.readonly).toBe('true');
    expect(boardProps!.readOnly).toBe(true);
    expect(TableView).not.toHaveBeenCalled();
  });
  it('uses TableView at cents for a chip value', () => {
    render(
      <LayoutThumb ui={ui} rules={rules} spots={[{ bet: COIN_BET, chips: 2 }]} chipValue={500} />,
    );
    expect(screen.getByTestId('tableview')).toBeTruthy();
    expect(TableView.mock.calls[0]![0]).toMatchObject({
      layout: [{ bet: COIN_BET, amount: 1000 }],
    });
  });
  it('falls back to TableView when the game has no chips UI', () => {
    render(
      <LayoutThumb
        ui={{ TableView: ui.TableView }}
        rules={rules}
        spots={[{ bet: COIN_BET, chips: 1 }]}
        chipValue={500}
      />,
    );
    expect(screen.getByTestId('tableview')).toBeTruthy();
  });
  it('describes itself', () => {
    render(
      <LayoutThumb ui={ui} rules={rules} spots={[{ bet: COIN_BET, chips: 2 }]} chipValue={null} />,
    );
    expect(screen.getByRole('group', { name: 'Layout preview: 1 spot, 2 chips' })).toBeTruthy();
  });
});

describe('review fixes', () => {
  it('two adjusts in one task both apply', () => {
    render(editor());
    const p = boardProps!;
    void act(() => {
      p.onAdjust(COIN_BET, 1);
      p.onAdjust(COIN_BET, 1);
      p.onAdjust('x', 1);
    });
    expect(boardProps!.spots).toEqual([
      { bet: COIN_BET, chips: 2 },
      { bet: 'x', chips: 1 },
    ]);
  });

  it('shortcuts stay active when the editor is hosted in a Sheet, not under its own sheet', () => {
    render(
      <Sheet open title="Host" onClose={() => {}}>
        {editor()}
      </Sheet>,
    );
    fireEvent.click(screen.getByText('tap heads'));
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(boardProps!.spots).toEqual([]);
    fireEvent.click(screen.getByText('tap heads'));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(boardProps!.spots).toHaveLength(1);
  });

  it('explains a disabled Save', () => {
    const { container } = render(editor({ name: ' ' }));
    expect(container.querySelector('.le-hint')!.textContent).toBe('Name needed');
    cleanup();
    const r = render(editor());
    expect(r.container.querySelector('.le-hint')!.textContent).toBe('Add a chip to save');
    fireEvent.click(screen.getByText('tap heads'));
    expect(r.container.querySelector('.le-hint')).toBeNull();
  });

  it('E does nothing on the List tab', () => {
    render(editor());
    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    fireEvent.keyDown(document, { key: 'e' });
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(boardProps!.tool).toBe('add');
  });

  it('summarises how many spots would be placed', () => {
    const { container } = render(
      editor({
        initialSpots: [
          { bet: COIN_BET, chips: 1 },
          { bet: 'nope', chips: 1 },
        ],
      }),
    );
    expect(container.querySelector('.le-summary')!.textContent).toContain('1 of 2 spots placed');
  });

  it('defaultDenom throws on empty denominations', () => {
    expect(() => defaultDenom(plugin, rules, [], [])).toThrow(RangeError);
  });

  it('thumb without chips and counts draws text, not money', () => {
    const { container } = render(
      <LayoutThumb
        ui={{ TableView: ui.TableView }}
        rules={rules}
        spots={[{ bet: COIN_BET, chips: 2 }]}
        chipValue={null}
      />,
    );
    expect(container.textContent).toContain(`${COIN_BET} × 2`);
    expect(TableView).not.toHaveBeenCalled();
  });

  it('the read-only board is inert', () => {
    const { container } = render(
      <LayoutThumb ui={ui} rules={rules} spots={[{ bet: COIN_BET, chips: 1 }]} chipValue={null} />,
    );
    expect(container.querySelector('[inert]')).toBeTruthy();
  });
});

describe('SpotList focus', () => {
  it('keeps focus in the list after Move and Remove', () => {
    const Host = () => {
      const [spots, setSpots] = useState([
        { bet: 'a', chips: 1 },
        { bet: 'b', chips: 1 },
        { bet: 'c', chips: 1 },
      ]);
      return (
        <SpotList
          rules={rules}
          catalog={[]}
          spots={spots}
          BetPicker={FakePicker}
          step={() => 1}
          chipValue={null}
          onAdjust={() => {}}
          onRemove={(b) => setSpots((s) => s.filter((x) => x.bet !== b))}
          onMove={(b, d) =>
            setSpots((s) => {
              const i = s.findIndex((x) => x.bet === b);
              const n = [...s];
              [n[i], n[i + d]] = [n[i + d]!, n[i]!];
              return n;
            })
          }
        />
      );
    };
    render(<Host />);
    const down = screen.getByRole('button', { name: 'Move a down' });
    down.focus();
    fireEvent.click(down);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move a down' }));
    expect((document.activeElement as HTMLElement).closest('li')!.dataset.bet).toBe('a');
    const rm = screen.getByRole('button', { name: 'Remove a' });
    rm.focus();
    fireEvent.click(rm);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement!.getAttribute('aria-label')).toBe('Remove c');
    fireEvent.click(screen.getByRole('button', { name: 'Remove c' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove b' }));
    expect(document.activeElement!.textContent).toBe('Add a bet');
  });
});
