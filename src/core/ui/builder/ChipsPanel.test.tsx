import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { GamePlugin } from '../../contracts/game';
import type { ChipLayout, LayoutRecord, StageChips } from '../../contracts/layout';
import type { StrategyDefinition } from '../../contracts/strategy';
import { compileChips, normalizeStrategy } from '../../strategy';
import { COIN_BET, coin } from '../../testing';
import type { CoinRules } from '../../testing';
import type { BetPickerProps, ChipBoardProps } from '../game-ui';
import type { LayoutChoice } from '../layout/types';
import { Builder } from './Builder';
import type { BuilderEnv } from './env';
import { emptyStrategy } from './model';
import { pathToElementId } from './index';

afterEach(cleanup);

const plugin = coin as unknown as GamePlugin<unknown, unknown, CoinRules, unknown>;
const rules = coin.rules.resolve();
const { min } = coin.limits(COIN_BET, rules)!;

let stepOf = 1;
const FakeBoard: ComponentType<ChipBoardProps<unknown>> = (p) => (
  <div data-testid="board">
    <button type="button" onClick={() => p.onAdjust(COIN_BET, 1)}>
      tap heads
    </button>
    <button type="button" onClick={() => p.onAdjust('tails', 1)}>
      tap tails
    </button>
  </div>
);
const FakePicker: ComponentType<BetPickerProps<unknown>> = (p) => (
  <button type="button" onClick={() => p.onPick(COIN_BET)}>
    pick heads
  </button>
);
const TableView = () => <div data-testid="tableview" />;

function layoutOf(id: string, name: string, spots = [{ bet: COIN_BET, chips: 3 }]): ChipLayout {
  return { schema: 1, id, name, game: 'coin', variant: 'v', spots };
}
const choice = (l: ChipLayout, hash: string, builtin = false): LayoutChoice => ({
  layout: l,
  hash,
  builtin,
});

interface Ctl {
  choices: LayoutChoice[];
  save: Mock<(l: ChipLayout) => Promise<LayoutRecord>>;
  out: StrategyDefinition[];
}
let ctl: Ctl;
const env = (withChips = true): BuilderEnv => ({
  facts: coin.facts,
  catalog: coin.bets.catalog(rules),
  rules,
  ui: { BetPicker: FakePicker as never },
  roundWord: 'flip',
  unit: min,
  chipsVariant: 'v',
  ...(withChips
    ? {
        chips: {
          ui: {
            BetPicker: FakePicker as never,
            TableView: TableView as never,
            chips: {
              ChipBoard: FakeBoard as never,
              step: () => stepOf,
              denominations: [min, min * 5, min * 25],
            },
          },
          plugin,
          layouts: { list: () => Promise.resolve(ctl.choices), save: ctl.save },
          bankroll: 10_000_000,
        },
      }
    : {}),
});

function Harness(p: { init: StrategyDefinition; withChips?: boolean }) {
  const [v, setV] = useState(p.init);
  return (
    <Builder
      value={v}
      onChange={(n) => {
        ctl.out.push(n);
        setV(n);
      }}
      env={env(p.withChips)}
      diagnostics={[]}
    />
  );
}
const last = () => ctl.out[ctl.out.length - 1]!;
const stage = (d: StrategyDefinition, i = 0) => d.stages[i]! as unknown as Record<string, unknown>;

const BLOCK: StageChips = {
  v: 1,
  chip: min * 5,
  spots: [{ bet: COIN_BET, chips: 2 }],
  from: { id: 'lay', hash: 'h1', name: 'Heads pair' },
};
const doc = (st: Record<string, unknown>, extra: Record<string, unknown>[] = [], progs?: object) =>
  ({
    schema: 1,
    id: 'x',
    name: 'x',
    game: 'coin',
    unit: min,
    ...(progs ? { progressions: progs } : {}),
    stages: [{ id: 'play', ...st }, ...extra],
  }) as unknown as StrategyDefinition;
const fresh = (b: StageChips = BLOCK, tail: unknown[] = []) =>
  doc({ 'x-chips': b, layout: [...compileChips(b), ...tail] });
const MART = { m: { kind: 'martingale', track: 'round', base: min, maxSteps: 3, onCap: 'reset' } };

beforeEach(() => {
  stepOf = 1;
  ctl = { choices: [], save: vi.fn(), out: [] };
});

describe('ChipsPanel: rows-only builder without env.chips', () => {
  it('is the old builder: Layout heading, every row listed, no panel', () => {
    const d = fresh(BLOCK, [{ bet: 'tails', amount: 100 }]);
    const { container } = render(<Harness init={d} withChips={false} />);
    expect(screen.queryByText('Chips on the table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Layout' })).toBeTruthy();
    expect(container.querySelectorAll('li.blayout')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add bet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(stage(last()).layout).toHaveLength(3);
    expect(stage(last())['x-chips']).toEqual(BLOCK);
  });
});

describe('ChipsPanel: starting points', () => {
  it('"Tap chips" on a new strategy lifts the red row, leaves layout unchanged and opens the editor', async () => {
    const start = emptyStrategy(min);
    render(<Harness init={start} />);
    expect(screen.getByRole('heading', { name: 'Chips on the table' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Other bets' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tap chips' }));
    const out = last();
    expect(stage(out).layout).toEqual(stage(start).layout);
    expect(stage(out)['x-chips']).toEqual({
      v: 1,
      chip: { units: 1 },
      spots: [{ bet: 'red', chips: 1 }],
    });
    const dlg = screen.getByRole('dialog', { name: 'Chips on the table' });
    expect(within(dlg).getByTestId('board')).toBeTruthy();
    fireEvent.click(within(dlg).getByText('tap heads'));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    const saved = last();
    expect(stage(saved)['x-chips']).toMatchObject({
      spots: [
        { bet: 'red', chips: 1 },
        { bet: COIN_BET, chips: 1 },
      ],
    });
    expect(stage(saved).layout).toEqual([
      { bet: 'red', amount: { units: 1 } },
      { bet: COIN_BET, amount: { units: 1 } },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Chips on the table' })).toBeNull(),
    );
  });

  it('"Edit on the table" lifts several chip-shaped rows and changes nothing in layout', () => {
    const rows = [
      { bet: COIN_BET, amount: { units: 2 } },
      { bet: 'tails', amount: { units: 1 } },
    ];
    render(<Harness init={doc({ layout: rows })} />);
    expect(screen.queryByRole('button', { name: 'Tap chips' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit on the table' }));
    expect(stage(last()).layout).toEqual(rows);
    expect(stage(last())['x-chips']).toMatchObject({ chip: { units: 1 } });
    expect(normalizeStrategy(last()).stages[0]!.layout).toEqual(rows);
  });

  it('cancelling the editor after "Tap chips" puts the stage back exactly as it was', async () => {
    const start = emptyStrategy(min);
    render(<Harness init={start} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap chips' }));
    expect(stage(last())['x-chips']).toBeTruthy();
    const dlg = screen.getByRole('dialog', { name: 'Chips on the table' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(last()).toEqual(normalizeStrategy(start));
    expect(screen.getByRole('button', { name: 'Tap chips' })).toBeTruthy();
  });

  it('cancelling after "Edit on the table" and edits (Discard, or the sheet Close) reverts too', async () => {
    const rows = [
      { bet: COIN_BET, amount: { units: 2 } },
      { bet: 'tails', amount: { units: 1 } },
    ];
    const start = doc({ layout: rows });
    render(<Harness init={start} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit on the table' }));
    let dlg = screen.getByRole('dialog', { name: 'Chips on the table' });
    fireEvent.click(within(dlg).getByText('tap heads'));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(stage(last())['x-chips']).toBeUndefined();
    expect(stage(last()).layout).toEqual(rows);
    // The sheet's own Close goes through the same guard and the same revert.
    fireEvent.click(screen.getByRole('button', { name: 'Edit on the table' }));
    dlg = screen.getByRole('dialog', { name: 'Chips on the table' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(stage(last())['x-chips']).toBeUndefined();
    expect(stage(last()).layout).toEqual(rows);
  });

  it('Android Back (popstate) asks before discarding edits, and closes a clean editor', async () => {
    const start = emptyStrategy(min);
    render(<Harness init={start} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap chips' }));
    const dlg = screen.getByRole('dialog', { name: 'Chips on the table' });
    fireEvent.click(within(dlg).getByText('tap heads'));
    history.back();
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeTruthy(),
    );
    // Still there after a second Back, because the sentinel was re-pushed.
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    history.back();
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(last()).toEqual(normalizeStrategy(start));
    // A clean editor just closes.
    fireEvent.click(screen.getByRole('button', { name: 'Tap chips' }));
    expect(screen.getByRole('dialog', { name: 'Chips on the table' })).toBeTruthy();
    history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancelling the editor of existing chips leaves them alone', async () => {
    render(<Harness init={fresh()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit chips' }));
    const dlg = screen.getByRole('dialog', { name: 'Chips on the table' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ctl.out).toHaveLength(0);
  });

  it('builds the first chips on an empty stage at the smallest legal denomination', () => {
    render(<Harness init={doc({ layout: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap chips' }));
    expect(ctl.out).toHaveLength(0);
    const dlg = screen.getByRole('dialog');
    fireEvent.click(within(dlg).getByText('tap heads'));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(stage(last())['x-chips']).toEqual({
      v: 1,
      chip: min,
      spots: [{ bet: COIN_BET, chips: 1 }],
    });
    expect(stage(last()).layout).toEqual([{ bet: COIN_BET, amount: min }]);
  });
});

describe('ChipsPanel: chip value writes the §3.3 forms', () => {
  it('a denomination writes literal rows chips x d', () => {
    render(<Harness init={fresh()} />);
    const rack = screen.getByRole('radiogroup', { name: 'Chip value' });
    fireEvent.click(within(rack).getByRole('radio', { name: '$25' }));
    expect(stage(last()).layout).toEqual([{ bet: COIN_BET, amount: 2 * min * 25 }]);
    expect((stage(last())['x-chips'] as StageChips).chip).toBe(min * 25);
    expect((stage(last())['x-chips'] as StageChips).from).toEqual(BLOCK.from);
  });

  it('the strategy unit writes { units: n } rows', () => {
    render(<Harness init={fresh()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More chip values' }));
    fireEvent.click(screen.getByRole('button', { name: /Strategy unit/ }));
    expect(stage(last()).layout).toEqual([{ bet: COIN_BET, amount: { units: 2 } }]);
    expect((stage(last())['x-chips'] as StageChips).chip).toEqual({ units: 1 });
  });

  it('a custom amount writes literal rows', () => {
    render(<Harness init={fresh()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More chip values' }));
    const field = screen.getByLabelText('Custom amount (dollars)');
    fireEvent.input(field, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this amount' }));
    expect(stage(last()).layout).toEqual([{ bet: COIN_BET, amount: 600 }]);
  });

  it('following a progression writes { times: [n, { prog }] } and a single chip writes { prog }', () => {
    const b: StageChips = { ...BLOCK, chip: { prog: 'm' } };
    render(<Harness init={doc({ 'x-chips': b, layout: compileChips(b) }, [], MART)} />);
    const sel = screen.getByLabelText<HTMLSelectElement>('Follows progression');
    expect(sel.value).toBe('m');
    expect(screen.getByTestId('chip-value-text').textContent).toMatch(/follow m, starting at/i);
  });

  it('a new progression gets base = the denomination and track "round"', () => {
    render(<Harness init={fresh()} />);
    const sel = screen.getByLabelText<HTMLSelectElement>('Follows progression');
    fireEvent.change(sel, { target: { value: '__new' } });
    const dlg = screen.getByRole('dialog', { name: 'Progression' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Done' }));
    const out = last() as unknown as { progressions: Record<string, Record<string, unknown>> };
    const names = Object.keys(out.progressions);
    expect(names).toHaveLength(1);
    expect(out.progressions[names[0]!]).toMatchObject({
      kind: 'martingale',
      track: 'round',
      base: min * 5,
    });
    expect((stage(last())['x-chips'] as StageChips).chip).toEqual({ prog: names[0] });
    expect(stage(last()).layout).toEqual([
      { bet: COIN_BET, amount: { times: [2, { prog: names[0] }] } },
    ]);
  });

  it('switching the kind in the progression sheet keeps the base', () => {
    render(<Harness init={fresh()} />);
    fireEvent.change(screen.getByLabelText('Follows progression'), { target: { value: '__new' } });
    const dlg = screen.getByRole('dialog', { name: 'Progression' });
    fireEvent.change(within(dlg).getByLabelText('Kind'), { target: { value: 'fibonacci' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Done' }));
    const out = last() as unknown as { progressions: Record<string, Record<string, unknown>> };
    expect(Object.values(out.progressions)[0]).toMatchObject({
      kind: 'fibonacci',
      base: min * 5,
      track: 'round',
    });
  });
});

describe('ChipsPanel: stale chips', () => {
  const rows = [
    { bet: COIN_BET, amount: 9999 },
    { bet: 'tails', amount: 100 },
  ];
  const staleDoc = () => doc({ 'x-chips': BLOCK, layout: rows });

  it('shows the banner, lists every row as an other bet, and does not rewrite the stage', () => {
    const { container } = render(<Harness init={staleDoc()} />);
    expect(screen.getByRole('status').textContent).toMatch(/no longer match/);
    expect(container.querySelectorAll('li.blayout')).toHaveLength(2);
    expect(ctl.out).toHaveLength(0);
  });

  it('Rebuild drops the old rows the block shadows and keeps the rest as manual rows', () => {
    render(<Harness init={staleDoc()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild bets from chips' }));
    expect(stage(last()).layout).toEqual([...compileChips(BLOCK), { bet: 'tails', amount: 100 }]);
    expect(stage(last())['x-chips']).toEqual(BLOCK);
    expect(screen.queryByText(/no longer match/)).toBeNull();
  });

  it('Forget chips removes the block and keeps every row verbatim', () => {
    render(<Harness init={staleDoc()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget chips' }));
    expect(stage(last()).layout).toEqual(rows);
    expect('x-chips' in stage(last())).toBe(false);
  });
});

describe('ChipsPanel: findings', () => {
  it('flags a manual row on a chip spot (W_CHIPS_SHADOWED) on the row, at its absolute index', () => {
    const { container } = render(<Harness init={fresh(BLOCK, [{ bet: COIN_BET, amount: 100 }])} />);
    const row = container.querySelector('li.blayout')!;
    expect(row.id).toBe('b-lay-0-1');
    expect(row.textContent).toContain('W_CHIPS_SHADOWED');
  });

  it('warns W_CHIPS_TABLE when the starting chip is below the minimum', () => {
    const progs = { m: { kind: 'martingale', track: 'round', base: min - 1, maxSteps: 3 } };
    const b: StageChips = { v: 1, chip: { prog: 'm' }, spots: [{ bet: COIN_BET, chips: 1 }] };
    const { container } = render(
      <Harness init={doc({ 'x-chips': b, layout: compileChips(b) }, [], progs)} />,
    );
    const panel = container.querySelector('#b-chips-0')!;
    expect(panel.textContent).toContain('W_CHIPS_TABLE');
    expect(panel.textContent).toMatch(/starting/);
    expect(panel.querySelector('.bchips-cost')!.textContent).toMatch(/see below/);
  });

  it('shows a fitting stage as such, with the cost per round', () => {
    const { container } = render(<Harness init={fresh()} />);
    expect(container.querySelector('.bchips-cost')!.textContent).toMatch(/\$10 a flip.*fits/);
  });

  it('enforces the game step on the spot steppers', () => {
    stepOf = 4;
    const b = { ...BLOCK, spots: [{ bet: COIN_BET, chips: 4 }] };
    render(<Harness init={fresh(b)} />);
    fireEvent.click(screen.getByRole('button', { name: /Add 4 chips to/ }));
    expect((stage(last())['x-chips'] as StageChips).spots).toEqual([{ bet: COIN_BET, chips: 8 }]);
    expect(stage(last()).layout).toEqual([{ bet: COIN_BET, amount: 8 * min * 5 }]);
    fireEvent.click(screen.getByRole('button', { name: /Remove 4 chips from/ }));
    expect((stage(last())['x-chips'] as StageChips).spots).toEqual([{ bet: COIN_BET, chips: 4 }]);
  });

  it('says what a stage inherits', () => {
    const d = doc({ 'x-chips': BLOCK, layout: compileChips(BLOCK) }, [
      { id: 'child', extends: 'play', layout: [] },
    ]);
    const { container } = render(<Harness init={d} />);
    const child = container.querySelectorAll('#b-chips-1')[0]!;
    expect(child.textContent).toMatch(/Inherited from play: 1 spot/);
  });
});

describe('ChipsPanel: layouts and the library', () => {
  it('names the source and marks it edited or deleted', async () => {
    ctl.choices = [choice(layoutOf('lay', 'Heads pair', [{ bet: COIN_BET, chips: 5 }]), 'h1')];
    const { container } = render(<Harness init={fresh()} />);
    await waitFor(() =>
      expect(container.querySelector('.bchips-title')!.textContent).toMatch(/\(edited\)/),
    );
    cleanup();
    ctl.choices = [choice(layoutOf('other', 'Other'), 'x')];
    const r2 = render(<Harness init={fresh()} />);
    await waitFor(() =>
      expect(r2.container.querySelector('.bchips-title')!.textContent).toMatch(/\(deleted\)/),
    );
  });

  it('offers Update / Keep when the library layout changed', async () => {
    const lay = layoutOf('lay', 'Heads pair', [{ bet: COIN_BET, chips: 7 }]);
    ctl.choices = [choice(lay, 'h2')];
    render(<Harness init={fresh()} />);
    const banner = await screen.findByText(/changed since this stage used it/);
    expect(banner.textContent).toContain('Heads pair');
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByText(/changed since/)).toBeNull();
    expect(ctl.out).toHaveLength(0);
  });

  it('Update re-copies the spots and the hash', async () => {
    const lay = layoutOf('lay', 'Heads pair', [{ bet: COIN_BET, chips: 7 }]);
    ctl.choices = [choice(lay, 'h2')];
    render(<Harness init={fresh()} />);
    await screen.findByText(/changed since this stage used it/);
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    const b = stage(last())['x-chips'] as StageChips;
    expect(b.spots).toEqual([{ bet: COIN_BET, chips: 7 }]);
    expect(b.from).toEqual({ id: 'lay', hash: 'h2', name: 'Heads pair' });
    expect(stage(last()).layout).toEqual([{ bet: COIN_BET, amount: 7 * min * 5 }]);
  });

  it('"Use a saved layout" copies it, sets from, and keeps the manual rows', async () => {
    const lay = layoutOf('lib', 'Library one', [
      { bet: COIN_BET, chips: 1 },
      { bet: 'tails', chips: 2 },
    ]);
    ctl.choices = [choice(lay, 'hh'), choice(layoutOf('b1', 'Built one'), 'bb', true)];
    const manual = { bet: 'tails', amount: 50, when: { cmp: ['net', '<', 0] } };
    render(<Harness init={fresh(BLOCK, [manual])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a saved layout' }));
    const dlg = await screen.findByRole('dialog', { name: 'Use a saved layout' });
    await within(dlg).findByText('Library one');
    expect(within(dlg).getByText('Built-in')).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Use Library one' }));
    const b = stage(last())['x-chips'] as StageChips;
    expect(b.spots).toEqual(lay.spots);
    expect(b.from).toEqual({ id: 'lib', hash: 'hh', name: 'Library one' });
    expect(b.chip).toBe(BLOCK.chip);
    expect(stage(last()).layout).toEqual([...compileChips(b), manual]);
  });

  it('marks a built-in source with builtin: true', async () => {
    ctl.choices = [choice(layoutOf('b1', 'Built one'), 'bb', true)];
    render(<Harness init={doc({ layout: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a saved layout' }));
    const dlg = await screen.findByRole('dialog', { name: 'Use a saved layout' });
    fireEvent.click(await within(dlg).findByRole('button', { name: 'Use Built one' }));
    expect((stage(last())['x-chips'] as StageChips).from).toEqual({
      id: 'b1',
      hash: 'bb',
      name: 'Built one',
      builtin: true,
    });
  });

  it('"Save as layout" saves a ChipLayout and points from at the returned record', async () => {
    ctl.save.mockImplementation((l: ChipLayout) =>
      Promise.resolve<LayoutRecord>({
        v: 1,
        id: l.id,
        layout: l,
        hash: 'newhash',
        createdAt: 'a',
        updatedAt: 'a',
        origin: 'user',
      }),
    );
    render(<Harness init={fresh({ v: 1, chip: min, spots: [{ bet: COIN_BET, chips: 2 }] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as layout' }));
    const dlg = screen.getByRole('dialog', { name: 'Save as layout' });
    fireEvent.input(within(dlg).getByLabelText('Layout name'), { target: { value: 'My Pair' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(ctl.save).toHaveBeenCalledTimes(1));
    expect(ctl.save).toHaveBeenCalledTimes(1);
    const saved = ctl.save.mock.calls[0]![0];
    expect(saved).toMatchObject({
      schema: 1,
      id: 'my-pair',
      name: 'My Pair',
      game: 'coin',
      variant: 'v',
      spots: [{ bet: COIN_BET, chips: 2 }],
    });
    await waitFor(() =>
      expect((stage(last())['x-chips'] as StageChips).from).toEqual({
        id: 'my-pair',
        hash: 'newhash',
        name: 'My Pair',
      }),
    );
  });

  it('turns chips into plain bets or removes them', () => {
    const { unmount } = render(<Harness init={fresh()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn into plain bets' }));
    expect('x-chips' in stage(last())).toBe(false);
    expect(stage(last()).layout).toEqual(compileChips(BLOCK));
    unmount();
    ctl.out = [];
    render(<Harness init={fresh()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove chips' }));
    expect('x-chips' in stage(last())).toBe(false);
  });
});

describe('pathToElementId', () => {
  it('maps x-chips paths to the chips panel', () => {
    expect(pathToElementId('/stages/1/x-chips')).toBe('b-chips-1');
    expect(pathToElementId('/stages/1/x-chips/chip')).toBe('b-chips-1');
    expect(pathToElementId('/stages/1/layout/2')).toBe('b-lay-1-2');
  });
});
