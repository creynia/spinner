/**
 * Types and constants of the generic layout editor (layouts.md §6.1). FROZEN with WP-L0: L4 fills
 * the components, L5 and L6 consume them, and none changes a shape without asking the orchestrator.
 */
import type { ComponentType } from 'preact';
import type { BetCatalogEntry, BetId, Cents, GamePlugin } from '../../contracts/game';
import type { ChipLayout, LayoutSpot } from '../../contracts/layout';
import type { Slug } from '../../contracts/strategy';
import type { BetPickerProps, ChipsUi, GameUi } from '../game-ui';

/** The editor's tool (layouts.md §4.3). */
export type ChipTool = 'add' | 'remove';

/** History entries kept per editor session (§4.3). */
export const HISTORY_LIMIT = 200;

/** A bet already resolved to cents at one chip value and level (the input of `checkAtTable`). */
export interface CheckRow {
  bet: BetId;
  cents: Cents;
}

/** One spot's outcome in the table check (§3.4). */
export interface TableCheckSpot {
  bet: BetId;
  /** Cents asked for. */
  asked: Cents;
  /** Cents the table would place (0 when rejected). */
  placed: Cents;
  status: 'ok' | 'adjusted' | 'rejected';
  /** The plugin's reason (`reconcile` rejected/adjusted), English. */
  reason?: string;
}

/** `reconcile` of the rows on a fresh state, mapped generically (§3.4). */
export interface TableCheck {
  /** Cents the table would place in total. */
  total: Cents;
  /** One entry per input row, in input (funding) order. */
  perSpot: TableCheckSpot[];
  /** False when nothing at all could be funded. */
  affordable: boolean;
}

/** Result of `defaultDenom`: the preselected chip value and whether it passes the table check. */
export interface DefaultDenom {
  denom: Cents;
  /** False when no standard denomination passed (the smallest is returned, flagged). */
  ok: boolean;
}

/** The undo/redo/clear state over `LayoutSpot[]` (§4.3, §6.1). */
export interface ChipHistory {
  spots: readonly LayoutSpot[];
  /** Commits a new spot array as one undo step; a no-op (deep-equal) change is dropped. */
  push(next: readonly LayoutSpot[], label: string): void;
  undo(): void;
  redo(): void;
  /** An ordinary undoable step that empties the spots. */
  clear(): void;
  /** Replaces the state and drops all history (loading another layout). */
  reset(spots: readonly LayoutSpot[]): void;
  canUndo: boolean;
  canRedo: boolean;
  /** Label of the step `undo` would undo / `redo` would redo, for the live region; else null. */
  undoLabel: string | null;
  redoLabel: string | null;
  /** True when `spots` differs from the initial state (the unsaved-changes guard). */
  dirty: boolean;
}

export interface ChipRackProps {
  /** Ascending cents (`ChipsUi.denominations`). */
  denominations: readonly Cents[];
  /** The selected denomination, or null when none is (a custom or non-numeric chip value). */
  value: Cents | null;
  onChange(denom: Cents): void;
  /** Accessible name of the radiogroup; default "Chip value". */
  label?: string;
}

export interface SpotListProps<R = unknown> {
  rules: R;
  catalog: readonly BetCatalogEntry[];
  spots: readonly LayoutSpot[];
  /** The game's picker for "Add a bet". */
  BetPicker: ComponentType<BetPickerProps<R>>;
  /** Chips one − / + / add adds or removes (`ChipsUi.step`). */
  step(bet: BetId): number;
  /** Preview chip value in cents (money beside each row), or null for counts only. */
  chipValue: Cents | null;
  /** Table-check result at the preview value, for per-row messages. */
  check?: TableCheck | null;
  /** Adds (`delta > 0`) or removes (`delta < 0`) chips; the shell applies `adjustSpot`. */
  onAdjust(bet: BetId, delta: number): void;
  onRemove(bet: BetId): void;
  /** Moves a spot up (−1) or down (+1) in funding order. */
  onMove(bet: BetId, dir: -1 | 1): void;
  /** Spots the list may still hold (64 minus a stage's manual and inherited rows). */
  maxSpots?: number;
}

export interface LayoutThumbProps<R = unknown> {
  ui: Pick<GameUi<R>, 'TableView'>;
  rules: R;
  spots: readonly LayoutSpot[];
  /** A chip value to draw money at, or null to draw chip counts. */
  chipValue: Cents | null;
}

/** What the editor hands back on Save (the Library saves a `ChipLayout`; a stage keeps `spots`). */
export interface LayoutEditorResult {
  spots: LayoutSpot[];
  name: string;
  variant: string;
  notes?: string;
}

export interface LayoutEditorProps<R = unknown> {
  /** The plugin supplies `reconcile`, `limits` and the catalog for the table check and the List tab. */
  plugin: GamePlugin<unknown, unknown, R, unknown>;
  rules: R;
  /** `ui.chips` is required here; `BetPicker` is used by the List tab. */
  ui: Pick<GameUi<R>, 'BetPicker' | 'TableView'> & { chips: ChipsUi<R> };
  /** Spots to start from (empty for a new layout). */
  initialSpots: readonly LayoutSpot[];
  /** Header fields. Absent `onRename`/`variants`: the name and variant are fixed (stage host). */
  name: string;
  variant: string;
  notes?: string;
  /** Selectable rules presets (id and label); absent: the variant cannot be changed. */
  variants?: readonly { id: string; label: string }[];
  /** Initial preview chip value; null shows counts. The user can change it with the chip rack. */
  chipValue: Cents | null;
  /** Session bankroll for the table check. */
  bankroll: Cents;
  /** Spots held by the stage's manual and inherited rows; lowers the 64-spot limit (§4.3). */
  reservedSpots?: number;
  /** Save requires at least one spot. Returning rejects keep the editor open. */
  onSave(result: LayoutEditorResult): void | Promise<void>;
  /** Back / close; the editor has already run its unsaved-changes guard. */
  onClose(): void;
}

/** A library or built-in layout offered by "Use a saved layout" (§7.2). */
export interface LayoutChoice {
  layout: ChipLayout;
  /** layoutHash of `layout`. */
  hash: string;
  builtin: boolean;
}

/** The builder's optional chips environment: `BuilderEnv.chips` (§7.2). When absent, rows only. */
export interface BuilderChipsEnv<R = unknown> {
  ui: ChipsUi<R>;
  plugin: GamePlugin<unknown, unknown, R, unknown>;
  layouts: {
    list(): Promise<LayoutChoice[]>;
    save(l: ChipLayout): Promise<Slug>;
  };
  /** Session bankroll for the table check. */
  bankroll: Cents;
}
