/**
 * `GameUi`: the Preact side of a game plugin (reconciliation G5; architecture.md §3). FROZEN.
 *
 * The pure `GamePlugin` has no `ui` field, so Preact never enters the worker bundle; the app
 * composes `{ plugin: roulette, ui: rouletteUi }` in `src/app/services/game.ts`. Prop shapes follow
 * game.md §12.2-§12.3 with the roulette-only `prison` prop generalised to `pending` (imprisoned
 * bets are "pending/contract" entries). Lives in `core/ui` (not `contracts/`) because it uses
 * Preact types; it imports only `contracts/` types besides Preact.
 */
import type { ComponentType } from 'preact';
import type { BetId, Cents, Layout, RoundOutcome } from '../contracts/game';
import type { LayoutSpot } from '../contracts/layout';

export interface TableViewProps<R = unknown> {
  rules: R;
  /** Bets placed this window. */
  layout: Layout;
  /** Bets carried over and not changeable (e.g. imprisoned bets): game.md §12.3 `prison`. */
  pending?: Layout;
  lastOutcome: RoundOutcome | null;
  /** The bet whose covered pockets are highlighted (the trace row being hovered), or null. */
  highlight: BetId | null;
}

export interface BetPickerProps<R = unknown> {
  rules: R;
  value?: BetId;
  /** Returns canonical bet ids only; amounts are the builder's generic amount editor. */
  onPick(bet: BetId): void;
}

export interface OutcomeGlyphProps {
  outcome: RoundOutcome;
}

/** Props of the game's tap-to-place board (layouts.md §6.2). */
export interface ChipBoardProps<R = unknown> {
  rules: R;
  spots: readonly LayoutSpot[];
  tool: 'add' | 'remove';
  /** Preview chip value in cents for labels, or null to show counts. */
  chipValue: Cents | null;
  /** Ask the shell to change a spot; `delta` is ± the game's step for that bet. */
  onAdjust(bet: BetId, delta: number): void;
  /** The spot changed last: its covered pockets are highlighted. */
  last?: BetId | null;
  /** Per-spot problems from the table check (ringed chips). */
  flagged?: ReadonlyMap<BetId, string>;
  /** Draw spots with count badges only: no taps, no sheet (thumbnails). */
  readOnly?: boolean;
  /** Status text for the shell's live status line (lock mode, the resolved bet: "Split mode", "Split 1|4"). */
  onStatus?(message: string): void;
}

/** The game's contribution to the generic layout editor (layouts.md §6.2). */
export interface ChipsUi<R = unknown> {
  /** Board plus the game's own panels (roulette: the Table and Call bets tabs, the bet-type lock). */
  ChipBoard: ComponentType<ChipBoardProps<R>>;
  /** Chips one tap adds or removes (roulette call bets: their pieces). */
  step(bet: BetId): number;
  /** Denominations for the chip rack, ascending, cents. */
  denominations: readonly Cents[];
}

export interface GameUi<R = unknown> {
  TableView: ComponentType<TableViewProps<R>>;
  BetPicker: ComponentType<BetPickerProps<R>>;
  OutcomeGlyph: ComponentType<OutcomeGlyphProps>;
  /** Optional (additive): tap-to-place chips. Absent: the builder shows rows only. */
  chips?: ChipsUi<R>;
}
