// How long until a bet hits? Pure maths for chapter "hits": with k numbers covered on a wheel of N
// pockets, one spin hits with chance k/N, so at least one hit within n spins has chance
// 1 − (1 − k/N)^n. The spin number it takes to reach a target chance is a ceiling of a ratio of logs.

export interface Wheel {
  id: 'european' | 'american' | 'triple';
  label: string;
  /** pockets: 37 (0-36), 38 (0, 00, 1-36), 39 (0, 00, 000, 1-36) */
  pockets: number;
}

export const WHEELS: readonly Wheel[] = [
  { id: 'european', label: 'European (37)', pockets: 37 },
  { id: 'american', label: 'American (38)', pockets: 38 },
  { id: 'triple', label: 'Triple zero (39)', pockets: 39 },
];

/** Counts of numbers that are real bets or common layouts: straight, split, street, corner, line... */
export const BET_COUNTS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 9, 12, 18, 24];

export const MAX_CUSTOM = 36;

/** Chance of at least one hit in `n` spins when `k` of `pockets` numbers are covered. */
export function hitChance(k: number, pockets: number, n: number): number {
  if (n <= 0 || k <= 0) return 0;
  if (k >= pockets) return 1;
  // 1 − (1 − p)^n written with log1p / expm1 so small p and small n keep their precision
  return -Math.expm1(n * Math.log1p(-k / pockets));
}

/**
 * Fewest spins after which the chance of at least one hit reaches `target` (0 < target < 1).
 * The log formula is corrected by one step either way, so rounding never moves the answer.
 */
export function spinsFor(k: number, pockets: number, target: number): number {
  if (k >= pockets) return 1;
  let n = Math.max(1, Math.ceil(Math.log(1 - target) / Math.log1p(-k / pockets)));
  while (n > 1 && hitChance(k, pockets, n - 1) >= target) n--;
  while (hitChance(k, pockets, n) < target) n++;
  return n;
}

/** Median wait: the first spin count with at least a 50 % chance of a hit. */
export const medianSpins = (k: number, pockets: number): number => spinsFor(k, pockets, 0.5);

/** "63.21%": two decimals, as the readout shows it. */
/**
 * A chance as a percentage with 2 decimals. A hit chance is never certain, so values that would
 * round up to 100 read "> 99.99%" instead of a misleading "100.00%".
 */
export const pct2 = (p: number): string =>
  p < 1 && p * 100 >= 99.995 ? '> 99.99%' : `${(p * 100).toFixed(2)}%`;

/** True for a whole number of covered numbers from 1 to 36. */
export const validCount = (k: number): boolean => Number.isInteger(k) && k >= 1 && k <= MAX_CUSTOM;

/** Spin counts the data table lists, up to `max`. */
export function tableSpins(max: number): number[] {
  const base = [1, 2, 3, 5, 10, 15, 20, 25, 30, 37, 50, 75, 100, 150, 200, 250, 300];
  return base.filter((n) => n <= max);
}
