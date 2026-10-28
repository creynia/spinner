/**
 * Chip layouts: the game-agnostic contract of the layouts feature (layouts.md §2.1). FROZEN once
 * WP-L0 merges: types and constants only, no behaviour. A layout is a shape (bet spots with whole
 * chip counts), never money; a stage copies it into an `x-chips` block with a chip value, and the
 * builder compiles that into ordinary `LayoutSpec` rows (layouts.md §3), so the interpreter, worker
 * and validator never see this file. Imports only `./game` and `./strategy`.
 */
import type { BetId, Cents } from './game';
import type { Slug } from './strategy';

export const LAYOUT_SCHEMA = 1 as const;
/** Same as the stage layout limit after flattening (strategy.md §2.1). */
export const MAX_LAYOUT_SPOTS = 64;
/** Chips on one spot; 1000 × $1 already exceeds every roulette inside maximum. */
export const MAX_CHIPS_PER_SPOT = 1000;

/** One bet spot with a whole number of identical chips. */
export interface LayoutSpot {
  /** Canonical id (aliases are rewritten on save, as definitions do). */
  bet: BetId;
  /** Integer 1..MAX_CHIPS_PER_SPOT; call bets: a multiple of the game's step (their total). */
  chips: number;
}

/** A reusable table layout: a shape, no money. */
export interface ChipLayout {
  schema: typeof LAYOUT_SCHEMA;
  /** Library key, /^[a-z][a-z0-9-]{0,39}$/, stable across renames. */
  id: Slug;
  /** 1..80 chars. */
  name: string;
  /** Plugin id ('roulette'). */
  game: string;
  /** Rules preset the board was drawn on ('european' | 'american' | 'triple-zero'). */
  variant: string;
  /** <= 4000 chars. */
  notes?: string;
  /** <= 16. */
  tags?: Slug[];
  /** 1..64 spots, unique bets, in placement order (that order is the funding order, layouts.md §3.5). */
  spots: LayoutSpot[];
  [ext: `x-${string}`]: unknown;
}

/** IndexedDB record of the `layouts` store (keyPath `id`, index `byUpdated`). */
export interface LayoutRecord {
  v: 1;
  id: Slug;
  layout: ChipLayout;
  /** layoutHash(layout): sha256 hex of canonicalJson({ game, variant, spots sorted by bet }). */
  hash: string;
  createdAt: string;
  updatedAt: string;
  /** Duplicated from. */
  derivedFrom?: Slug;
  /** 'builtin' = a saved copy of a built-in layout. */
  origin: 'user' | 'import' | 'builtin';
}

/** What one chip is worth in a stage (layouts.md D5, D6). */
export type ChipValue =
  | Cents // a denomination, e.g. 500 = $5 chips
  | { units: 1 } // the strategy unit (follows the Session card's Unit)
  | { prog: Slug }; // the current amount of a progression (the layout scales with it)

/** The value of a stage's `x-chips` key (layouts.md D3). Ignored by the interpreter. */
export interface StageChips {
  v: 1;
  /** The frozen copy, 1..64. */
  spots: LayoutSpot[];
  chip: ChipValue;
  /** Where the copy came from; absent for chips placed inline. */
  from?: { id: Slug; hash: string; name: string; builtin?: true };
}
export const STAGE_CHIPS_KEY = 'x-chips' as const;

/** Export file for one or more layouts (`<slug>.layout.json`). */
export const LAYOUT_FILE_FORMAT = 'casino-lab-layout' as const;
export interface LayoutFileV1 {
  format: typeof LAYOUT_FILE_FORMAT;
  version: 1;
  app: { id: string; version: string };
  /** 1..500. */
  layouts: ChipLayout[];
}
