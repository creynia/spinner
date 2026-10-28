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
import type { BetId, Layout, RoundOutcome } from '../contracts/game';

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

export interface GameUi<R = unknown> {
  TableView: ComponentType<TableViewProps<R>>;
  BetPicker: ComponentType<BetPickerProps<R>>;
  OutcomeGlyph: ComponentType<OutcomeGlyphProps>;
}
