import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coin, COIN_BET } from '../../testing';
import type { CoinRules } from '../../testing';
import type { GamePlugin } from '../../contracts/game';
import type { ChipLayout } from '../../contracts/layout';
import type { ChipBoardProps } from '../game-ui';
import { LayoutEditor, PlaceLayoutSheet } from '.';
import type { LayoutChoice, LayoutEditorProps, PlaceLayoutSheetProps } from '.';

const plugin = coin as unknown as GamePlugin<unknown, unknown, CoinRules, unknown>;
const rules = coin.rules.resolve();

let boardProps: ChipBoardProps<CoinRules> | null = null;
const FakeBoard: ComponentType<ChipBoardProps<CoinRules>> = (p) => {
  if (!p.readOnly) boardProps = p;
  return (
    <div data-testid="board">
      {p.readOnly ? null : (
        <button type="button" onClick={() => p.onAdjust(COIN_BET, 1)}>
          tap heads
        </button>
      )}
    </div>
  );
};
const ui = {
  BetPicker: (() => null) as never,
  TableView: (() => <div />) as never,
  chips: {
    ChipBoard: FakeBoard,
    step: (b: string) => (b === 'pair' ? 2 : 1),
    denominations: [100, 500, 2500],
  },
};

const layout = (id: string, name: string, chips: number, over: Partial<ChipLayout> = {}) =>
  ({
    schema: 1,
    id,
    name,
    game: 'coin',
    variant: 'standard',
    spots: [{ bet: COIN_BET, chips }],
    ...over,
  }) as ChipLayout;
const choice = (l: ChipLayout, builtin = false): LayoutChoice => ({
  layout: l,
  hash: 'h',
  builtin,
});

const CHOICES: LayoutChoice[] = [
  choice(layout('three', 'Three heads', 3)),
  choice(layout('ten', 'Ten heads', 10), true),
  choice(layout('wheelie', 'Roulette thing', 1, { game: 'roulette' })),
  choice(
    layout('tails', 'Tails layout', 1, {
      variant: 'triple-zero',
      spots: [{ bet: 'tails', chips: 1 }],
    }),
  ),
];

function sheet(over: Partial<PlaceLayoutSheetProps<CoinRules>> = {}) {
  const onPlace = vi.fn();
  const r = render(
    <PlaceLayoutSheet<CoinRules>
      open
      onClose={() => {}}
      layouts={CHOICES}
      ui={ui}
      plugin={plugin}
      rules={rules}
      bankroll={100_000}
      onPlace={onPlace}
      {...over}
    />,
  );
  return { ...r, onPlace };
}
const confirmBtn = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: /^(Add to table|Replace bets)$/ });
const total = (c: Element) => c.querySelector('.pl-total')!.textContent;

afterEach(() => {
  cleanup();
  boardProps = null;
});

describe('PlaceLayoutSheet', () => {
  it('lists layouts as radios and disables the ones that do not fit this table', () => {
    sheet();
    const group = screen.getByRole('radiogroup', { name: 'Layouts' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-disabled'))).toEqual([
      null,
      null,
      'true',
      'true',
    ]);
    expect(screen.getByRole('radio', { name: 'Roulette thing' }).textContent).toContain(
      'Made for Roulette, not Coin',
    );
    expect(screen.getByRole('radio', { name: 'Tails layout' }).textContent).toContain(
      'Drawn for the Triple zero wheel: 1 bet not on this table',
    );
    // A disabled one cannot be picked.
    fireEvent.click(screen.getByRole('radio', { name: 'Roulette thing' }));
    expect(screen.getByRole('radio', { name: 'Three heads' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    // One tab stop.
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it('selects initialId, preselects the chip value and shows the total', () => {
    const { container } = sheet({ initialId: 'ten' });
    expect(screen.getByRole('radio', { name: 'Ten heads' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: '$1' }).getAttribute('aria-checked')).toBe('true');
    expect(total(container)).toContain('10 chips × $1 = $10');
    fireEvent.click(screen.getByRole('radio', { name: '$5' }));
    expect(total(container)).toContain('$50');
    // Another layout starts from its own preselected value again.
    fireEvent.click(screen.getByRole('radio', { name: 'Three heads' }));
    expect(total(container)).toContain('3 chips × $1 = $3');
  });

  it('ignores an initialId that does not fit', () => {
    sheet({ initialId: 'wheelie' });
    expect(screen.getByRole('radio', { name: 'Three heads' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('filters by name', () => {
    sheet();
    fireEvent.input(screen.getByLabelText('Search layouts'), { target: { value: 'ten' } });
    expect(screen.getAllByRole('radio', { name: /heads|thing|layout/ })).toHaveLength(1);
    fireEvent.input(screen.getByLabelText('Search layouts'), { target: { value: 'zzz' } });
    expect(screen.getByRole('status').textContent).toContain('No layout matches');
  });

  it('places copies of the spots at the chip value, in the chosen mode', () => {
    const { onPlace } = sheet({ initialId: 'three' });
    fireEvent.click(screen.getByRole('radio', { name: '$5' }));
    fireEvent.click(confirmBtn());
    expect(onPlace).toHaveBeenLastCalledWith([{ bet: COIN_BET, chips: 3 }], 500, 'add', CHOICES[0]);
    expect(onPlace.mock.calls[0]![0]).not.toBe(CHOICES[0]!.layout.spots);
    fireEvent.click(screen.getByRole('radio', { name: 'Replace bets' }));
    expect(confirmBtn().textContent).toBe('Replace bets');
    fireEvent.click(confirmBtn());
    expect(onPlace.mock.calls[1]![2]).toBe('replace');
  });

  it('is disabled with a reason when the total passes the bankroll; Replace frees the stake', () => {
    const { onPlace } = sheet({ initialId: 'ten', bankroll: 500, staked: 1000 });
    expect(confirmBtn().disabled).toBe(true);
    const why = document.getElementById(confirmBtn().getAttribute('aria-describedby')!)!;
    expect(why.textContent).toContain('Costs $10; you have $5');
    fireEvent.click(confirmBtn());
    expect(onPlace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Replace bets' }));
    expect(confirmBtn().disabled).toBe(false);
  });

  it('warns about table limits at the chosen value', () => {
    const { container } = sheet({ initialId: 'ten' });
    fireEvent.click(screen.getByRole('radio', { name: '$25' }));
    // 10 × $25 = $250 is fine; the coin table max is $1,000.
    expect(container.querySelector('.pl-warn')).toBeNull();
    cleanup();
    const r = sheet({
      layouts: [choice(layout('big', 'Big', 100))],
      bankroll: 10_000_000,
    });
    fireEvent.click(screen.getByRole('radio', { name: '$25' }));
    expect(r.container.querySelector('.pl-warn')!.textContent).toContain('table maximum');
  });

  it('arrow keys move through the layouts that fit', () => {
    sheet();
    const three = screen.getByRole('radio', { name: 'Three heads' });
    fireEvent.keyDown(three, { key: 'ArrowDown' });
    const ten = screen.getByRole('radio', { name: 'Ten heads' });
    expect(ten.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(ten);
    // Wraps past the two that do not fit.
    fireEvent.keyDown(ten, { key: 'ArrowDown' });
    expect(three.getAttribute('aria-checked')).toBe('true');
  });

  it('offers Edit for library layouts only, and New', () => {
    const onEdit = vi.fn();
    const onNew = vi.fn();
    sheet({ onEdit, onNew, initialId: 'ten' });
    expect(screen.queryByRole('button', { name: 'Edit Ten heads' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Three heads' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Three heads' }));
    expect(onEdit).toHaveBeenCalledWith(CHOICES[0]);
    fireEvent.click(screen.getByRole('button', { name: 'New layout' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('says so when there are no layouts', () => {
    sheet({ layouts: [] });
    expect(screen.getByText(/No layouts yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to table' })).toBeNull();
  });
});

const editor = (over: Partial<LayoutEditorProps<CoinRules>> = {}) => (
  <LayoutEditor<CoinRules>
    plugin={plugin}
    rules={rules}
    ui={ui}
    initialSpots={[{ bet: COIN_BET, chips: 3 }]}
    name="Test layout"
    variant="v"
    chipValue={100}
    bankroll={10_000_000}
    onSave={() => {}}
    onClose={() => {}}
    {...over}
  />
);
const live = (c: Element) => c.querySelector('[aria-live="polite"]')!.textContent.trim();

describe('LayoutEditor: scale and play', () => {
  it('doubles in one undo step and halves only when every spot splits evenly', () => {
    const { container } = render(editor());
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const halve = screen.getByRole('button', { name: 'Halve all (÷2)' });
    expect(halve.hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('.le-more .le-hint')!.textContent).toContain(
      'does not split evenly',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Double all (×2)' }));
    expect(boardProps!.spots).toEqual([{ bet: COIN_BET, chips: 6 }]);
    expect(live(container)).toContain('Doubled all spots: 6 chips');
    fireEvent.click(screen.getByRole('button', { name: 'Halve all (÷2)' }));
    expect(boardProps!.spots).toEqual([{ bet: COIN_BET, chips: 3 }]);
    expect(live(container)).toContain('Halved');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(boardProps!.spots).toEqual([{ bet: COIN_BET, chips: 6 }]);
    expect(live(container)).toContain('Undid: Halved all spots');
  });

  it('respects the step when halving', () => {
    render(editor({ initialSpots: [{ bet: 'pair', chips: 2 }] }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'Halve all (÷2)' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('shows the total stake at the preview value', () => {
    const { container } = render(editor());
    const summary = container.querySelector('.le-summary')!;
    expect(summary.querySelector('.le-total')!.textContent).toBe('$3');
    expect(summary.textContent).toContain('$3 total at $1 chips');
  });

  it('has no Play button without onPlay', () => {
    render(editor());
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('Play hands back the spots; with changes it saves first', async () => {
    const onPlay = vi.fn();
    const onSave = vi.fn();
    render(editor({ onPlay, onSave }));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await Promise.resolve();
    expect(onSave).not.toHaveBeenCalled();
    expect(onPlay).toHaveBeenLastCalledWith([{ bet: COIN_BET, chips: 3 }]);
    fireEvent.click(screen.getByText('tap heads'));
    const btn = screen.getByRole('button', { name: 'Save & play' });
    expect(btn.textContent).toBe('Save & play');
    fireEvent.click(btn);
    await vi.waitFor(() => expect(onPlay).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenLastCalledWith([{ bet: COIN_BET, chips: 4 }]);
  });

  it('does not play when saving fails', async () => {
    const onPlay = vi.fn();
    render(editor({ onPlay, onSave: () => Promise.reject(new Error('x')) }));
    fireEvent.click(screen.getByText('tap heads'));
    fireEvent.click(screen.getByRole('button', { name: 'Save & play' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(onPlay).not.toHaveBeenCalled();
  });
});
