// A read-only picture of a layout (layouts.md §6.1): the game's `ChipBoard` (`readOnly`) draws chip
// counts; with a chip value, or when the game has no chips UI, its `TableView` draws money.
import { MAX_LAYOUT_SPOTS } from '../../contracts/layout';
import { plural, totalChips } from './adjust';
import type { LayoutThumbProps } from './types';

const noop = () => {};

export function LayoutThumb<R>({ ui, rules, spots, chipValue }: LayoutThumbProps<R>) {
  const label = `Layout preview: ${plural(spots.length, 'spot')}, ${plural(totalChips(spots), 'chip')}`;
  const Board = ui.chips?.ChipBoard;
  return (
    <div class="layout-thumb" role="group" aria-label={label} data-spots={spots.length}>
      {Board && chipValue === null ? (
        <Board rules={rules} spots={spots} tool="add" chipValue={null} onAdjust={noop} readOnly />
      ) : (
        <ui.TableView
          rules={rules}
          layout={spots.slice(0, MAX_LAYOUT_SPOTS).map((s) => ({
            bet: s.bet,
            amount: s.chips * (chipValue ?? 100),
          }))}
          lastOutcome={null}
          highlight={null}
        />
      )}
    </div>
  );
}
