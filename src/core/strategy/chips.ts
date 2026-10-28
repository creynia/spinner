/**
 * Chip math (layouts.md §5.1; owner: WP-L1). FROZEN signatures: L0 ships stubs that throw
 * `not implemented (WP-L1)`; L1 fills the bodies without changing a signature.
 *
 * A stage holds `x-chips` (a `StageChips` block) plus `layout` rows. The first `spots.length` rows
 * of `layout` are generated from the block, in spot order (§3.2); the rest are manual rows.
 */
import type { BetId, Cents } from '../contracts/game';
import type { ChipValue, LayoutSpot, StageChips } from '../contracts/layout';
import type {
  Diagnostic,
  Expr,
  LayoutSpec,
  ProgressionSpec,
  Slug,
  Stage,
  StrategyDefinition,
} from '../contracts/strategy';
import type { ValidationContext } from './validate';

const todo = (name: string): never => {
  throw new Error(`not implemented (WP-L1): ${name}`);
};

/**
 * The amount expression of one spot (§3.3): a literal `chips × d` for a denomination, `{ units: chips }`
 * for the unit, and `{ prog: p }` (one chip) or `{ times: [chips, { prog: p }] }` for a progression.
 */
export function chipAmount(_chips: number, _chip: ChipValue): Expr {
  return todo('chipAmount');
}

/** The generated rows of a block, one per spot in spot order: `{ bet, amount: chipAmount(chips, chip) }`. */
export function compileChips(_c: StageChips): LayoutSpec[] {
  return todo('compileChips');
}

/** The stage's `x-chips`, shape-checked (v, spots, chip, from); `null` when absent or malformed. */
export function readStageChips(_stage: unknown): StageChips | null {
  return todo('readStageChips');
}

/**
 * Splits a stage's `layout` by the generated-prefix rule (§3.2). `manual` holds the rows after the
 * prefix; `stale` is true (and `manual` holds every row) when the prefix differs from `compileChips`.
 */
export function splitStageLayout(_stage: Stage): {
  chips: StageChips | null;
  manual: LayoutSpec[];
  stale: boolean;
} {
  return todo('splitStageLayout');
}

/** Writes `x-chips` (or removes it for `null`) and regenerates the prefix rows, keeping manual rows. */
export function withStageChips(_stage: Stage, _chips: StageChips | null): Stage {
  return todo('withStageChips');
}

/**
 * Lifts chip-shaped rows into a block with no change to `layout` (§5.1, §7.3): rows with no `when`,
 * `parent`, `working` or `label`, whose amounts are all `{ units: n }`, all one progression
 * (`{ prog: p }` or `{ times: [n, { prog: p }] }`), or positive integer literals when the stage's
 * `x-chips.chip` is a number. `null` when nothing qualifies.
 */
export function liftRows(_rows: readonly LayoutSpec[]): StageChips | null {
  return todo('liftRows');
}

/**
 * One tap: add (`delta > 0`) or remove (`delta < 0`) `|delta|` chips on `bet`; the spot disappears at
 * 0 and is appended (placement order) when new. `refused` names the limit hit; the input spots are
 * then returned unchanged. `lim` defaults to `MAX_LAYOUT_SPOTS` / `MAX_CHIPS_PER_SPOT`.
 */
export function adjustSpot(
  _spots: readonly LayoutSpot[],
  _bet: BetId,
  _delta: number,
  _lim?: { maxSpots?: number; maxChips?: number },
): { spots: LayoutSpot[]; refused?: 'max-spots' | 'max-chips' | 'none-to-remove' } {
  return todo('adjustSpot');
}

/** Order-insensitive equality of two spot lists (same bets with the same chips). */
export function sameSpots(_a: readonly LayoutSpot[], _b: readonly LayoutSpot[]): boolean {
  return todo('sameSpots');
}

/**
 * Validates a `ChipLayout` (§2.2, §5.3): schema, slug, name and notes lengths, game, spot count,
 * chips, duplicate bets, availability on `variant` (through a throwaway strategy). `ctx` null skips
 * the catalog checks. Codes: E_LAYOUT_SCHEMA, E_LAYOUT_SPOTS, E_LAYOUT_CHIPS, E_LAYOUT_DUP_BET,
 * E_UNKNOWN_BET, E_BET_UNAVAILABLE, W_LAYOUT_ALIAS.
 */
export function validateChipLayout(_x: unknown, _ctx: ValidationContext | null): Diagnostic[] {
  return todo('validateChipLayout');
}

/**
 * Builder-level stage checks (§5.3): E_CHIPS_SHAPE, W_CHIPS_STALE, W_CHIPS_SHADOWED. Paths are
 * `/stages/<s>/x-chips` and `/stages/<s>/layout/<r>`. `W_CHIPS_TABLE` comes from the UI's table check.
 */
export function validateStageChips(_def: StrategyDefinition): Diagnostic[] {
  return todo('validateStageChips');
}

/** Largest amount a progression reaches (§5.1, S4); `null` for labouchere and formula bases. */
export function progressionTop(_spec: ProgressionSpec, _unit: Cents): Cents | null {
  return todo('progressionTop');
}

/** Level-0 amount of a progression; `null` for formula bases. */
export function progressionBase(_spec: ProgressionSpec, _unit: Cents): Cents | null {
  return todo('progressionBase');
}

/**
 * Resolves a chip value to cents at the starting and the top level (§3.4, S3): a literal gives
 * `{ base: d, top: d }`, `{ units: 1 }` gives the unit, `{ prog: p }` gives `progressionBase` and
 * `progressionTop` of `p`. Both are `null` when the base is a formula (or `p` is unknown).
 */
export function resolveChipValue(
  _chip: ChipValue,
  _ctx: { unit: Cents; progressions?: Record<Slug, ProgressionSpec> },
): { base: Cents | null; top: Cents | null } {
  return todo('resolveChipValue');
}

/** `{ stage }` when `path` is `/strategy/stages/<s>/x-chips/chip` (the sweepable chip value), else `null`. */
export function isChipPath(_path: string): { stage: number } | null {
  return todo('isChipPath');
}

/** Regenerates one stage's prefix rows from its (possibly just changed) `x-chips` (§8.1 sweep). */
export function recompileStageChips(_def: StrategyDefinition, _stage: number): StrategyDefinition {
  return todo('recompileStageChips');
}
