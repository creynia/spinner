// Integer-cent helpers and the rounding policy of game.md §5/§8 (money is integer cents everywhere).
import type { Cents, Fraction } from '../contracts/game';

export type { Cents };

/** True for a safe integer number of cents. */
export function isCents(x: unknown): x is Cents {
  return typeof x === 'number' && Number.isSafeInteger(x);
}

/** Throws `RangeError` unless `x` is a safe integer. Returns it for chaining. */
export function assertCents(x: number, what = 'amount'): Cents {
  if (!Number.isSafeInteger(x)) throw new RangeError(`${what} must be an integer number of cents`);
  return x;
}

/** `d` dollars in cents (`dollars(25)` is 2500). Whole dollars only. */
export function dollars(d: number): Cents {
  return assertCents(d * 100, 'dollars');
}

/**
 * Round **down** to a multiple of `unit` (game.md §8 step 3: "Never round up: the strategy never
 * spends more than it asked"). `unit` is the chip unit, or `pieces x chipUnit` for a call bet.
 * Fractional inputs are allowed (the interpreter may produce them, e.g. from `div`). Callers reject
 * negative and non-finite amounts before rounding (game.md §8 step 2).
 */
export function floorToUnit(amount: number, unit: Cents): Cents {
  if (!(unit >= 1) || !Number.isSafeInteger(unit))
    throw new RangeError('unit must be an integer >= 1');
  return Math.floor(amount / unit) * unit;
}

/**
 * La partage (game.md §1.2, §5): the player gets back `floor(amount / 2)` cents, so the loss is
 * `amount - floor(amount / 2)`. The floor is the house-favouring direction.
 */
export function partageRefund(amount: Cents): Cents {
  return Math.floor(amount / 2);
}

/** Loss of an even-money bet on a la partage zero: `amount - floor(amount / 2)` (positive). */
export function partageLoss(amount: Cents): Cents {
  return amount - partageRefund(amount);
}

/** "-$0.14" | "+$39" | "$1,250" (ASCII minus; cents omitted when whole and >= $1). */
export function formatMoney(cents: Cents, opts?: { sign?: boolean }): string {
  const c = Math.round(cents);
  const abs = Math.abs(c);
  const dollarsPart = Math.floor(abs / 100);
  const rem = abs % 100;
  const d = String(dollarsPart).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = abs < 100 || rem !== 0 ? `${d}.${String(rem).padStart(2, '0')}` : d;
  const sign = c < 0 ? '-' : opts?.sign && c > 0 ? '+' : '';
  return `${sign}$${body}`;
}

/** Exact decimal dollars for CSV and exports: `-0.01`, `-12.50`, `1234567.89` (no grouping, always 2 places). */
export function formatDollarsExact(cents: Cents): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${s}` : s;
}

/** "1.41%" (exact bigint rounding, half away from zero). */
export function formatPct(fraction: Fraction, digits = 2): string {
  let { num: n, den: d } = fraction;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const negative = n < 0n;
  const num = (negative ? -n : n) * 100n * 10n ** BigInt(digits);
  const q = (2n * num + d) / (2n * d);
  const s = q.toString().padStart(digits + 1, '0');
  const int = s.slice(0, s.length - digits);
  const frac = digits > 0 ? `.${s.slice(s.length - digits)}` : '';
  return `${negative && q !== 0n ? '-' : ''}${int}${frac}%`;
}
