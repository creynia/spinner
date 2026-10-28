// Spot arithmetic the shell needs (layouts.md §4.3). Local to the editor so it does not wait on
// WP-L1's `adjustSpot`; the semantics are the same (one tap adds or removes `|delta|` chips).
import type { BetCatalogEntry, BetId, Cents } from '../../contracts/game';
import { MAX_CHIPS_PER_SPOT, MAX_LAYOUT_SPOTS, type LayoutSpot } from '../../contracts/layout';

export type Refusal = 'max-spots' | 'max-chips' | 'none-to-remove';

export interface Adjusted {
  spots: LayoutSpot[];
  refused?: Refusal;
}

/** Adds (`delta > 0`) or removes (`delta < 0`) chips on `bet`; a spot at 0 disappears. */
export function adjustSpots(
  spots: readonly LayoutSpot[],
  bet: BetId,
  delta: number,
  lim: { maxSpots?: number; maxChips?: number } = {},
): Adjusted {
  const maxSpots = lim.maxSpots ?? MAX_LAYOUT_SPOTS;
  const maxChips = lim.maxChips ?? MAX_CHIPS_PER_SPOT;
  const i = spots.findIndex((s) => s.bet === bet);
  const keep = spots.map((s) => ({ ...s }));
  if (delta === 0) return { spots: keep };
  if (delta > 0) {
    if (i < 0) {
      if (spots.length >= maxSpots) return { spots: keep, refused: 'max-spots' };
      if (delta > maxChips) return { spots: keep, refused: 'max-chips' };
      return { spots: [...keep, { bet, chips: delta }] };
    }
    const n = spots[i]!.chips + delta;
    if (n > maxChips) return { spots: keep, refused: 'max-chips' };
    keep[i] = { ...keep[i]!, chips: n };
    return { spots: keep };
  }
  if (i < 0) return { spots: keep, refused: 'none-to-remove' };
  const n = spots[i]!.chips + delta;
  if (n <= 0) keep.splice(i, 1);
  else keep[i] = { ...keep[i]!, chips: n };
  return { spots: keep };
}

/** Order-sensitive deep equality (a reorder is a change). */
export function sameSpotsInOrder(a: readonly LayoutSpot[], b: readonly LayoutSpot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.bet === b[i]!.bet && s.chips === b[i]!.chips);
}

export function totalChips(spots: readonly LayoutSpot[]): number {
  return spots.reduce((n, s) => n + s.chips, 0);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "$5", "$0.50", "$1,000". */
export function money(cents: Cents): string {
  const dollars = cents / 100;
  const whole = Number.isInteger(dollars);
  return `$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A readable name for a bet id from the catalog; parameterised and unknown ids fall back. */
export function betLabel(catalog: readonly BetCatalogEntry[], id: BetId): string {
  const hit = catalog.find((c) => c.id === id);
  if (hit) return hit.label;
  const parts = id.split(':');
  const head = catalog.find((c) => c.id.split(':')[0] === parts[0] && c.id.includes('<'));
  if (head && parts.length === 3) return `${head.label} ${parts[1]} ±${parts[2]}`;
  return id;
}

/** The money a spot stands for at a chip value, or null at counts. */
export function spotCents(chips: number, value: Cents | null): Cents | null {
  return value === null ? null : chips * value;
}

export function makeRows(spots: readonly LayoutSpot[], value: Cents) {
  return spots.map((s) => ({ bet: s.bet, cents: s.chips * value }));
}
