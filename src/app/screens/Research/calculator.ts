// Pure maths of the ladder calculator (docs/design/research.md section 7): the cycle model of
// `ladderMath.ts` plus the cash-out. European wheel only (p = c/37). Amounts are integer cents.
import { ladder, type LadderResult } from './ladderMath';

export interface CalcInput {
  /** Numbers covered per bet (1..35). */
  c: number;
  /** First bet, cents. */
  base: number;
  /** Chip size, cents: bets round up to a multiple of it. */
  unit: number;
  /** Bet maximum, cents. */
  betMax: number;
  /** Bankroll, cents. */
  bankroll: number;
  /** Session length in spins. */
  spins: number;
  /** Cash-out target in cycle wins; 0 = no cash-out. */
  w: number;
}

export interface CalcResult {
  ladder: LadderResult;
  /** Predicted chance of ending ahead. */
  pWin: number;
  /** Predicted typical session (cents), or 'negative' when it is below break-even. */
  typical: number | 'negative';
  /** Cents lost when the ladder runs out (the sum of every bet in the ladder). */
  capLoss: number;
}

export type CalcField = 'c' | 'base' | 'unit' | 'betMax' | 'bankroll' | 'spins' | 'w';

export const CALC_DEFAULTS: CalcInput = {
  c: 18,
  base: 2500,
  unit: 100,
  betMax: 500000,
  bankroll: 500000,
  spins: 500,
  w: 0,
};

export const CALC_PRESETS: readonly { id: string; label: string; input: CalcInput }[] = [
  {
    id: 'red-25',
    label: 'Red, doubling from $25',
    input: { c: 18, base: 2500, unit: 2500, betMax: 500000, bankroll: 500000, spins: 500, w: 0 },
  },
  {
    id: 'red-5',
    label: 'Red, doubling from $5',
    input: { c: 18, base: 500, unit: 500, betMax: 500000, bankroll: 511500, spins: 500, w: 0 },
  },
  {
    id: 'dozen-15',
    label: 'Dozen, ×1.5 from $25',
    input: { c: 12, base: 2500, unit: 100, betMax: 500000, bankroll: 500000, spins: 500, w: 0 },
  },
];

export const LIMITS = { spinsMax: 100000, wMax: 1000 } as const;

/** Error text per field for the range and cross-field checks; empty when the input is usable. */
export function validate(i: CalcInput): Partial<Record<CalcField, string>> {
  const e: Partial<Record<CalcField, string>> = {};
  if (!Number.isInteger(i.c) || i.c < 1 || i.c > 35) e.c = 'Pick 1 to 35 numbers.';
  if (!(i.unit >= 1)) e.unit = 'The chip size must be at least $0.01.';
  if (!(i.base >= 1) || i.base > i.betMax) e.base = 'The first bet must fit under the bet maximum.';
  if (i.betMax < i.base) e.betMax = 'The first bet must fit under the bet maximum.';
  if (i.bankroll < i.base) e.bankroll = 'The bankroll must cover the first bet.';
  if (!Number.isInteger(i.spins) || i.spins < 1 || i.spins > LIMITS.spinsMax)
    e.spins = 'Spins: 1 to 100,000.';
  if (!Number.isInteger(i.w) || i.w < 0 || i.w > LIMITS.wMax) e.w = '0 to 1,000 cycle wins.';
  return e;
}

/**
 * Chance of ending ahead and typical session with a cash-out of `w` cycle wins (0 = none). A
 * session plays about p*S cycles, so the target counts only as far as that:
 * P(ahead) = e^(-q*min(W, p*S)). The typical session is the profit of that many cycles while
 * more than half of the sessions end ahead.
 */
export function cashOut(
  r: LadderResult,
  w: number,
  spins: number,
): { pWin: number; typical: number | 'negative' } {
  const cycles = Math.min(w > 0 ? w : Infinity, r.p * spins);
  const pWin = Math.exp(-r.q * cycles);
  return { pWin, typical: pWin > 0.5 ? cycles * r.profitPerCycle : 'negative' };
}

/** Everything the calculator shows. The input must pass `validate`. */
export function calculate(i: CalcInput): CalcResult {
  const l = ladder({
    c: i.c,
    base: i.base,
    unit: i.unit,
    betMax: i.betMax,
    bankroll: i.bankroll,
    spins: i.spins,
  });
  const { pWin, typical } = cashOut(l, i.w, i.spins);
  return { ladder: l, pWin, typical, capLoss: l.totalStake };
}
