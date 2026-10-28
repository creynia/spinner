// The generic layout editor (owner: WP-L4; layouts.md §6.1). WP-L0 ships frozen stubs: components
// render null and functions throw `not implemented (WP-L4)`. L4 fills the bodies (in the files it
// owns) without changing a signature in `types.ts`.
import type { Cents, GamePlugin } from '../../contracts/game';
import type { LayoutSpot } from '../../contracts/layout';
import type {
  ChipHistory,
  ChipRackProps,
  CheckRow,
  DefaultDenom,
  LayoutEditorProps,
  LayoutThumbProps,
  SpotListProps,
  TableCheck,
} from './types';

export * from './types';

const todo = (name: string): never => {
  throw new Error(`not implemented (WP-L4): ${name}`);
};

/** The shell: header, tool row, tabs (Table hosts `ui.chips.ChipBoard`, List), status, shortcuts, guard. */
export function LayoutEditor<R>(_props: LayoutEditorProps<R>): null {
  return null;
}

/** The denomination radiogroup. */
export function ChipRack(_props: ChipRackProps): null {
  return null;
}

/** The List tab: one row per spot in funding order. */
export function SpotList<R>(_props: SpotListProps<R>): null {
  return null;
}

/** A read-only `TableView` of the spots, at a value or as counts. */
export function LayoutThumb<R>(_props: LayoutThumbProps<R>): null {
  return null;
}

/** The undo/redo/clear reducer over `LayoutSpot[]` (limit `HISTORY_LIMIT`). */
export function useChipHistory(_initial: readonly LayoutSpot[]): ChipHistory {
  return todo('useChipHistory');
}

/**
 * Applies the plugin's real `reconcile` to a fresh `createState({ rules, rng, bankroll })` (rng from
 * `sessionRng`) and maps `rejected` and `adjusted` per row (§3.4). `rows` are already resolved to
 * cents at one chip level (callers use `resolveChipValue`); this never evaluates expressions.
 */
export function checkAtTable<S, A, R, V>(
  _plugin: GamePlugin<S, A, R, V>,
  _rules: R,
  _rows: readonly CheckRow[],
  _bankroll: Cents,
): TableCheck {
  return todo('checkAtTable');
}

/**
 * The preselected chip value (§3.4): the smallest of `denominations` at which `checkAtTable` of
 * `chips × denom` per spot (at `bankroll`, default a large one) reports no rejection and no
 * adjustment; when none qualifies, the smallest with `ok: false`.
 */
export function defaultDenom<S, A, R, V>(
  _plugin: GamePlugin<S, A, R, V>,
  _rules: R,
  _spots: readonly LayoutSpot[],
  _denominations: readonly Cents[],
  _bankroll?: Cents,
): DefaultDenom {
  return todo('defaultDenom');
}
