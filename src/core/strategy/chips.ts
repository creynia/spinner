/**
 * Chip math (layouts.md §5.1; owner: WP-L1). FROZEN signatures: L0 ships stubs that throw
 * `not implemented (WP-L1)`; L1 fills the bodies without changing a signature.
 *
 * A stage holds `x-chips` (a `StageChips` block) plus `layout` rows. The first `spots.length` rows
 * of `layout` are generated from the block, in spot order (§3.2); the rest are manual rows.
 */
import type { BetId, Cents } from '../contracts/game';
import {
  MAX_CHIPS_PER_SPOT,
  MAX_LAYOUT_SPOTS,
  type ChipValue,
  type LayoutSpot,
  type StageChips,
} from '../contracts/layout';
import type {
  Diagnostic,
  Expr,
  LayoutSpec,
  ProgressionSpec,
  Slug,
  Stage,
  StrategyDefinition,
} from '../contracts/strategy';
import { validateStrategy, type ValidationContext } from './validate';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const esc = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');
const CHIPS_KEY = 'x-chips';
/** Largest amount in cents anywhere (a literal chip or one spot's chips x chip), as in the validator. */
const MAX_CENTS = 2 ** 31 - 1;

/** Key-order-insensitive structural equality of JSON values. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => jsonEqual(x, (b as unknown[])[i]))
    );
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => k in b && jsonEqual(a[k], b[k]));
  }
  return false;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ---------------------------------------------------------------- compile (§3.3)

/**
 * The amount expression of one spot (§3.3): a literal `chips × d` for a denomination, `{ units: chips }`
 * for the unit, and `{ prog: p }` (one chip) or `{ times: [chips, { prog: p }] }` for a progression.
 */
export function chipAmount(chips: number, chip: ChipValue): Expr {
  if (typeof chip === 'number') return chips * chip;
  if ('units' in chip) return { units: chips };
  return chips === 1 ? { prog: chip.prog } : { times: [chips, { prog: chip.prog }] };
}

/** The generated rows of a block, one per spot in spot order: `{ bet, amount: chipAmount(chips, chip) }`. */
export function compileChips(c: StageChips): LayoutSpec[] {
  return c.spots.map((s) => ({ bet: s.bet, amount: chipAmount(s.chips, c.chip) }));
}

// ---------------------------------------------------------------- reading the block

function validChip(x: unknown): x is ChipValue {
  if (typeof x === 'number') return Number.isInteger(x) && x >= 1 && x <= MAX_CENTS;
  if (!isObj(x)) return false;
  const keys = Object.keys(x);
  if (keys.length !== 1) return false;
  if (keys[0] === 'units') return x.units === 1;
  return keys[0] === 'prog' && typeof x.prog === 'string' && SLUG.test(x.prog);
}

function validSpot(x: unknown): x is LayoutSpot {
  return (
    isObj(x) &&
    typeof x.bet === 'string' &&
    x.bet.length > 0 &&
    isInt(x.chips) &&
    x.chips >= 1 &&
    x.chips <= MAX_CHIPS_PER_SPOT
  );
}

function validFrom(x: unknown): boolean {
  return (
    isObj(x) &&
    typeof x.id === 'string' &&
    typeof x.hash === 'string' &&
    typeof x.name === 'string' &&
    (x.builtin === undefined || x.builtin === true)
  );
}

/** Index of the first spot whose bet already appeared earlier in `spots`, or -1. */
function firstDuplicate(spots: unknown[]): number {
  const seen = new Set<unknown>();
  for (let i = 0; i < spots.length; i++) {
    const bet = isObj(spots[i]) ? (spots[i] as Obj).bet : undefined;
    if (typeof bet !== 'string') continue;
    if (seen.has(bet)) return i;
    seen.add(bet);
  }
  return -1;
}

/** The stage's `x-chips`, shape-checked (v, spots, chip, from); `null` when absent or malformed. */
export function readStageChips(stage: unknown): StageChips | null {
  if (!isObj(stage)) return null;
  const b = stage[CHIPS_KEY];
  if (!isObj(b) || b.v !== 1) return null;
  if (!Array.isArray(b.spots) || b.spots.length < 1 || b.spots.length > MAX_LAYOUT_SPOTS)
    return null;
  if (!b.spots.every(validSpot) || !validChip(b.chip)) return null;
  if (firstDuplicate(b.spots) >= 0) return null;
  if (typeof b.chip === 'number') {
    const c = b.chip;
    if (b.spots.some((sp: LayoutSpot) => sp.chips * c > MAX_CENTS)) return null;
  }
  if (b.from !== undefined && !validFrom(b.from)) return null;
  return clone(b) as unknown as StageChips;
}

/**
 * Splits a stage's `layout` by the generated-prefix rule (§3.2). `manual` holds the rows after the
 * prefix; `stale` is true (and `manual` holds every row) when the prefix differs from `compileChips`.
 */
export function splitStageLayout(stage: Stage): {
  chips: StageChips | null;
  manual: LayoutSpec[];
  stale: boolean;
} {
  const rows = Array.isArray(stage.layout) ? stage.layout : [];
  const chips = readStageChips(stage);
  if (!chips) return { chips: null, manual: rows.slice(), stale: false };
  const n = chips.spots.length;
  const fresh = rows.length >= n && jsonEqual(rows.slice(0, n), compileChips(chips));
  return fresh
    ? { chips, manual: rows.slice(n), stale: false }
    : { chips, manual: rows.slice(), stale: true };
}

/**
 * Writes `x-chips` (or removes it for `null`) and regenerates the prefix rows, keeping manual rows.
 * A stale stage keeps every row as manual (nothing is lost; `W_CHIPS_SHADOWED` flags duplicates).
 * `null` also drops the generated rows of a fresh stage, since the chips were their source.
 * A stage with no block yet whose rows already start with `compileChips(chips)` is lifted in place:
 * those rows become the prefix (so `withStageChips(st, liftRows(st.layout))` leaves `layout` as is).
 */
export function withStageChips(stage: Stage, chips: StageChips | null): Stage {
  const split = splitStageLayout(stage);
  let manual = split.manual;
  if (chips && !split.chips) {
    // Lifting in place: rows that already equal the generated prefix become that prefix.
    const gen = compileChips(chips);
    if (manual.length >= gen.length && jsonEqual(manual.slice(0, gen.length), gen))
      manual = manual.slice(gen.length);
  }
  const out: Stage = { ...stage };
  const rest = out as unknown as Obj;
  if (chips) {
    rest[CHIPS_KEY] = clone(chips);
    out.layout = [...compileChips(chips), ...manual];
  } else {
    delete rest[CHIPS_KEY];
    if (manual.length > 0 || stage.layout !== undefined) out.layout = manual;
  }
  return out;
}

// ---------------------------------------------------------------- lift (§5.1, §7.3)

type Form = { kind: 'units' } | { kind: 'prog'; p: Slug } | { kind: 'lit'; d: number };

/** The chip count of a row under a form, or null when the row does not fit it. */
function liftOne(amount: unknown, form: Form | null, chip: number | null): [Form, number] | null {
  const ok = (n: unknown): n is number => isInt(n) && n >= 1 && n <= MAX_CHIPS_PER_SPOT;
  const as = (f: Form, n: unknown): [Form, number] | null =>
    ok(n) && (form === null || sameForm(form, f)) ? [f, n] : null;
  if (typeof amount === 'number') {
    if (chip === null || !isInt(amount) || amount < chip || amount % chip !== 0) return null;
    return as({ kind: 'lit', d: chip }, amount / chip);
  }
  if (!isObj(amount) || Object.keys(amount).length !== 1) return null;
  if ('units' in amount) return as({ kind: 'units' }, amount.units);
  if ('prog' in amount) {
    return typeof amount.prog === 'string' ? as({ kind: 'prog', p: amount.prog }, 1) : null;
  }
  if ('times' in amount) {
    const t = amount.times;
    if (!Array.isArray(t) || t.length !== 2 || !isObj(t[1])) return null;
    const p = t[1].prog;
    if (Object.keys(t[1]).length !== 1 || typeof p !== 'string') return null;
    // times:[1, prog] never comes out of chipAmount, so it would not round-trip.
    return isInt(t[0]) && t[0] >= 2 ? as({ kind: 'prog', p }, t[0]) : null;
  }
  return null;
}

function sameForm(a: Form, b: Form): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'prog') return a.p === (b as typeof a).p;
  if (a.kind === 'lit') return a.d === (b as typeof a).d;
  return true;
}

/**
 * Lifts chip-shaped rows into a block with no change to `layout` (§5.1, §7.3): rows with no `when`,
 * `parent`, `working` or `label`, whose amounts are all `{ units: n }`, all one progression
 * (`{ prog: p }` or `{ times: [n, { prog: p }] }`), or positive integer literals when the stage's
 * `x-chips.chip` is a number; `chip` is that value (the literal form is lifted only when `chip` is a
 * number, and the result keeps it). `null` when nothing qualifies.
 *
 * The lifted rows are the longest qualifying prefix of `rows` (the generated-prefix rule, §3.2), of
 * one form, with distinct bets, at most 64. `compileChips` of the result equals that prefix.
 */
export function liftRows(rows: readonly LayoutSpec[], chip?: Cents): StageChips | null {
  const lit = typeof chip === 'number' && Number.isInteger(chip) && chip >= 1 ? chip : null;
  let form: Form | null = null;
  const spots: LayoutSpot[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (spots.length >= MAX_LAYOUT_SPOTS || !isObj(row)) break;
    const keys = Object.keys(row);
    if (keys.length !== 2 || !('bet' in row) || !('amount' in row)) break;
    if (typeof row.bet !== 'string' || row.bet === '' || seen.has(row.bet)) break;
    const hit = liftOne(row.amount, form, lit);
    if (!hit) break;
    form = hit[0];
    seen.add(row.bet);
    spots.push({ bet: row.bet, chips: hit[1] });
  }
  if (!form || spots.length === 0) return null;
  const value: ChipValue =
    form.kind === 'units' ? { units: 1 } : form.kind === 'prog' ? { prog: form.p } : form.d;
  return { v: 1, spots, chip: value };
}

// ---------------------------------------------------------------- tapping

/**
 * One tap: add (`delta > 0`) or remove (`delta < 0`) `|delta|` chips on `bet`; the spot disappears at
 * 0 and is appended (placement order) when new. `refused` names the limit hit; the input spots are
 * then returned unchanged. `lim` defaults to `MAX_LAYOUT_SPOTS` / `MAX_CHIPS_PER_SPOT`.
 * Removing more chips than a spot holds removes the spot. A zero or non-integer delta is a no-op.
 */
export function adjustSpot(
  spots: readonly LayoutSpot[],
  bet: BetId,
  delta: number,
  lim?: { maxSpots?: number; maxChips?: number },
): { spots: LayoutSpot[]; refused?: 'max-spots' | 'max-chips' | 'none-to-remove' } {
  const maxSpots = lim?.maxSpots ?? MAX_LAYOUT_SPOTS;
  const maxChips = lim?.maxChips ?? MAX_CHIPS_PER_SPOT;
  const same = (): LayoutSpot[] => spots.map((s) => ({ ...s }));
  if (!Number.isInteger(delta) || delta === 0) return { spots: same() };
  const i = spots.findIndex((s) => s.bet === bet);
  const cur = i < 0 ? 0 : (spots[i] as LayoutSpot).chips;
  if (delta > 0) {
    if (i < 0 && spots.length >= maxSpots) return { spots: same(), refused: 'max-spots' };
    if (cur + delta > maxChips) return { spots: same(), refused: 'max-chips' };
    if (i < 0) return { spots: [...same(), { bet, chips: delta }] };
    return { spots: same().map((s, j) => (j === i ? { bet, chips: cur + delta } : s)) };
  }
  if (i < 0) return { spots: same(), refused: 'none-to-remove' };
  const left = cur + delta;
  if (left <= 0) return { spots: same().filter((_, j) => j !== i) };
  return { spots: same().map((s, j) => (j === i ? { ...s, chips: left } : s)) };
}

/** Order-insensitive equality of two spot lists (same bets with the same chips). */
export function sameSpots(a: readonly LayoutSpot[], b: readonly LayoutSpot[]): boolean {
  if (a.length !== b.length) return false;
  const key = (s: LayoutSpot): string => `${s.bet}\u0000${s.chips}`;
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.every((k, i) => k === kb[i]);
}

// ---------------------------------------------------------------- diagnostics (§5.3)

const MESSAGES: Record<string, string> = {
  E_LAYOUT_SCHEMA: 'invalid layout: {detail}',
  E_LAYOUT_SPOTS: 'a layout needs 1 to 64 spots ({detail})',
  E_LAYOUT_CHIPS: 'chips must be a whole number from 1 to 1000',
  E_LAYOUT_DUP_BET: 'bet {value} appears twice',
  W_LAYOUT_ALIAS: 'bet {value} was rewritten to {canonical}',
  E_CHIPS_SHAPE: 'the chips block of this stage is malformed',
  W_CHIPS_STALE: "these chips no longer match the stage's bets (edited as JSON)",
  W_CHIPS_SHADOWED: 'bet {value} is also a chip spot, so this row is ignored',
};

function diag(code: string, path: string, params?: Record<string, string | number>): Diagnostic {
  const message = (MESSAGES[code] ?? code).replace(/\{(\w+)\}/g, (_, k: string) =>
    params && k in params ? String(params[k]) : '',
  );
  const d: Diagnostic = {
    code,
    severity: code.startsWith('W_') ? 'warning' : 'error',
    path,
    message,
  };
  if (params) d.params = params;
  return d;
}

/**
 * Validates a `ChipLayout` (§2.2, §5.3): schema, slug, name and notes lengths, game, spot count,
 * chips, duplicate bets, availability on `variant` (through a throwaway strategy). `ctx` null skips
 * the catalog checks. Codes: E_LAYOUT_SCHEMA, E_LAYOUT_SPOTS, E_LAYOUT_CHIPS, E_LAYOUT_DUP_BET,
 * E_UNKNOWN_BET, E_BET_UNAVAILABLE, W_LAYOUT_ALIAS.
 *
 * `ctx` must already be built for `variant`'s rules. Field-level problems (id, name, notes, tags,
 * game, variant, a spot that is not an object) are all `E_LAYOUT_SCHEMA` with the field's path.
 */
export function validateChipLayout(x: unknown, ctx: ValidationContext | null): Diagnostic[] {
  const out: Diagnostic[] = [];
  const schema = (path: string, detail: string): void => {
    out.push(diag('E_LAYOUT_SCHEMA', path, { detail }));
  };
  if (!isObj(x)) {
    schema('', 'expected an object');
    return out;
  }
  if (x.schema !== 1) {
    const newer = typeof x.schema === 'number' && x.schema > 1;
    schema('/schema', newer ? 'made with a newer version of the app' : 'schema must be 1');
  }
  if (typeof x.id !== 'string' || !SLUG.test(x.id)) schema('/id', 'id must be a slug');
  if (typeof x.name !== 'string' || x.name.length < 1 || x.name.length > 80)
    schema('/name', 'name must be 1 to 80 characters');
  if (typeof x.game !== 'string' || x.game === '') schema('/game', 'game is required');
  else if (ctx?.gameId !== undefined && x.game !== ctx.gameId)
    schema('/game', `layout is for game ${x.game}, not ${ctx.gameId}`);
  if (typeof x.variant !== 'string' || x.variant === '') schema('/variant', 'variant is required');
  if (x.notes !== undefined && (typeof x.notes !== 'string' || x.notes.length > 4000))
    schema('/notes', 'notes must be at most 4000 characters');
  if (x.tags !== undefined) {
    if (
      !Array.isArray(x.tags) ||
      x.tags.length > 16 ||
      !x.tags.every((t) => typeof t === 'string' && SLUG.test(t))
    )
      schema('/tags', 'tags must be at most 16 slugs');
  }
  if (!Array.isArray(x.spots)) {
    out.push(diag('E_LAYOUT_SPOTS', '/spots', { detail: 'spots must be a list' }));
    return out;
  }
  if (x.spots.length < 1 || x.spots.length > MAX_LAYOUT_SPOTS)
    out.push(diag('E_LAYOUT_SPOTS', '/spots', { detail: `got ${x.spots.length}` }));

  const rows: { i: number; bet: string }[] = [];
  const seen = new Set<string>();
  x.spots.forEach((s: unknown, i: number) => {
    const p = `/spots/${i}`;
    if (!isObj(s) || typeof s.bet !== 'string' || s.bet === '') {
      schema(isObj(s) ? `${p}/bet` : p, 'a spot needs a bet id');
      return;
    }
    if (!isInt(s.chips) || s.chips < 1 || s.chips > MAX_CHIPS_PER_SPOT)
      out.push(diag('E_LAYOUT_CHIPS', `${p}/chips`));
    let bet = s.bet;
    if (ctx) {
      const canon = ctx.parseBet(bet);
      if (canon !== null && canon !== bet) {
        out.push(diag('W_LAYOUT_ALIAS', `${p}/bet`, { value: bet, canonical: canon }));
        bet = canon;
      }
    }
    if (seen.has(bet)) out.push(diag('E_LAYOUT_DUP_BET', `${p}/bet`, { value: bet }));
    else {
      seen.add(bet);
      rows.push({ i, bet });
    }
  });

  if (ctx && rows.length > 0) {
    const throwaway = {
      schema: 1,
      id: 'layout-check',
      name: 'layout check',
      game: ctx.gameId ?? String(x.game),
      unit: 100,
      stages: [{ id: 'a', layout: rows.map((r) => ({ bet: r.bet, amount: 100 })) }],
    };
    for (const d of validateStrategy(throwaway, ctx)) {
      if (d.code !== 'E_UNKNOWN_BET' && d.code !== 'E_BET_UNAVAILABLE') continue;
      const m = /^\/stages\/0\/layout\/(\d+)\/bet$/.exec(d.path);
      const row = m ? rows[Number(m[1])] : undefined;
      if (row) out.push({ ...d, path: `/spots/${row.i}/bet` });
    }
  }
  return out;
}

/**
 * Builder-level stage checks (§5.3): E_CHIPS_SHAPE, W_CHIPS_STALE, W_CHIPS_SHADOWED. Paths are
 * `/stages/<s>/x-chips` and `/stages/<s>/layout/<r>`. `W_CHIPS_TABLE` comes from the UI's table check.
 */
export function validateStageChips(def: StrategyDefinition): Diagnostic[] {
  const out: Diagnostic[] = [];
  const stages: unknown = def?.stages;
  if (!Array.isArray(stages)) return out;
  stages.forEach((st: unknown, s: number) => {
    if (!isObj(st) || !(CHIPS_KEY in st)) return;
    const path = `/stages/${s}/${CHIPS_KEY}`;
    if (!readStageChips(st)) {
      const raw = st[CHIPS_KEY];
      const spotList = isObj(raw) && Array.isArray(raw.spots) ? raw.spots : [];
      const dup = firstDuplicate(spotList);
      out.push(diag('E_CHIPS_SHAPE', dup >= 0 ? `${path}/spots/${dup}` : path));
      return;
    }
    const { chips, manual, stale } = splitStageLayout(st as unknown as Stage);
    if (!chips) return;
    if (stale) {
      out.push(diag('W_CHIPS_STALE', path));
      return;
    }
    const bets = new Set(chips.spots.map((c) => c.bet));
    manual.forEach((row, j) => {
      if (isObj(row) && typeof row.bet === 'string' && bets.has(row.bet))
        out.push(
          diag('W_CHIPS_SHADOWED', `/stages/${s}/layout/${esc(String(chips.spots.length + j))}`, {
            value: row.bet,
          }),
        );
    });
  });
  return out;
}

// ---------------------------------------------------------------- progressions (§7.4)

/** Constant value of an expression made of literals and units; null otherwise (mirrors the validator). */
function constEval(e: unknown, unit: Cents, depth = 0): number | null {
  if (depth > 64) return null;
  if (typeof e === 'number') return Number.isFinite(e) ? e : null;
  if (!isObj(e)) return null;
  if ('units' in e) return typeof e.units === 'number' && unit ? e.units * unit : null;
  const list = (k: string): number[] | null => {
    const v = e[k];
    if (!Array.isArray(v)) return null;
    const r: number[] = [];
    for (const item of v) {
      const c = constEval(item, unit, depth + 1);
      if (c === null) return null;
      r.push(c);
    }
    return r;
  };
  for (const k of ['add', 'times', 'max', 'min'] as const) {
    if (k in e) {
      const xs = list(k);
      if (!xs || xs.length === 0) return null;
      if (k === 'add') return xs.reduce((a, b) => a + b, 0);
      if (k === 'times') return xs.reduce((a, b) => a * b, 1);
      return k === 'max' ? Math.max(...xs) : Math.min(...xs);
    }
  }
  if ('sub' in e) {
    const xs = list('sub');
    return xs && xs.length === 2 ? (xs[0] as number) - (xs[1] as number) : null;
  }
  if ('div' in e) {
    const xs = list('div');
    return xs && xs.length === 2 && xs[1] !== 0 ? (xs[0] as number) / (xs[1] as number) : null;
  }
  if ('floorTo' in e) {
    const xs = list('floorTo');
    return xs && xs.length === 2 && (xs[1] as number) > 0
      ? Math.floor((xs[0] as number) / (xs[1] as number)) * (xs[1] as number)
      : null;
  }
  if ('abs' in e) {
    const c = constEval(e.abs, unit, depth + 1);
    return c === null ? null : Math.abs(c);
  }
  return null;
}

/** An optional integer parameter in range (default when absent); `undefined` when present but invalid. */
function intParam(spec: Obj, key: string, min: number, max: number, dflt: number | null) {
  const v = spec[key];
  if (v === undefined) return dflt;
  return isInt(v) && v >= min && v <= max ? v : undefined;
}

/**
 * The amount of every level a progression can reach, in cents (level 0 first), for constant bases;
 * `null` for labouchere, formula bases and malformed specs.
 */
function levelAmounts(spec: ProgressionSpec, unit: Cents): number[] | null {
  const s = spec as unknown as Obj;
  const kind = s.kind;
  if (kind === 'sequence') {
    if (!Array.isArray(s.amounts) || s.amounts.length < 1) return null;
    const out: number[] = [];
    for (const a of s.amounts) {
      const c = constEval(a, unit);
      if (c === null) return null;
      out.push(c);
    }
    return out;
  }
  if (kind === 'labouchere') return null;
  const base = s.base === undefined ? unit || null : constEval(s.base, unit);
  if (base === null) return null;
  const levels = (n: number, f: (k: number) => number): number[] =>
    Array.from({ length: n }, (_, k) => f(k) * base);
  switch (kind) {
    case 'flat':
      return [base];
    case 'martingale': {
      const n = intParam(s, 'maxSteps', 1, 30, null);
      const m = intParam(s, 'multiplier', 2, 10, 2);
      return n == null || m == null ? null : levels(n, (k) => m ** k);
    }
    case 'grand-martingale': {
      const n = intParam(s, 'maxSteps', 1, 29, null);
      return n == null ? null : levels(n, (k) => 2 ** (k + 1) - 1);
    }
    case 'fibonacci': {
      const n = intParam(s, 'maxSteps', 1, 40, 20);
      if (n == null) return null;
      const f = [1, 1];
      for (let i = 2; i < n; i++) f.push((f[i - 1] as number) + (f[i - 2] as number));
      return levels(n, (k) => f[k] as number);
    }
    case 'dalembert': {
      const n = intParam(s, 'maxSteps', 1, 1000, 50);
      const step = s.step === undefined ? base : constEval(s.step, unit);
      if (n == null || step === null) return null;
      return Array.from({ length: n }, (_, k) => base + k * step);
    }
    case 'paroli': {
      const n = intParam(s, 'maxSteps', 1, 20, 3);
      const m = intParam(s, 'multiplier', 2, 10, 2);
      return n == null || m == null ? null : levels(n, (k) => m ** k);
    }
    case '1-3-2-6':
      return [1, 3, 2, 6].map((k) => k * base);
    case 'oscars-grind': {
      const n = intParam(s, 'maxSteps', 1, 1000, 20);
      return n == null ? null : levels(n, (k) => k + 1);
    }
    default:
      return null;
  }
}

/**
 * Largest amount a progression reaches (§5.1, S4); `null` for labouchere and formula bases. Levels
 * above a constant `maxAmount` are never reached (level 0 always is), so this caps at it on purpose.
 * The validator's own top for `W_PROG_ABOVE_TABLE_MAX` ignores `maxAmount`, so the two differ there.
 */
export function progressionTop(spec: ProgressionSpec, unit: Cents): Cents | null {
  const amounts = levelAmounts(spec, unit);
  if (!amounts) return null;
  const maxAmount = (spec as unknown as Obj).maxAmount;
  let reach = amounts;
  if (maxAmount !== undefined) {
    const cap = constEval(maxAmount, unit);
    if (cap === null) return null;
    reach = amounts.filter((a, k) => k === 0 || a <= cap);
  }
  return Math.floor(Math.max(...reach));
}

/** Level-0 amount of a progression; `null` for formula bases (labouchere: `(first + last) x base`). */
export function progressionBase(spec: ProgressionSpec, unit: Cents): Cents | null {
  const s = spec as unknown as Obj;
  if (s.kind === 'sequence') {
    const a = Array.isArray(s.amounts) ? constEval(s.amounts[0], unit) : null;
    return a === null ? null : Math.floor(a);
  }
  if (s.kind === 'labouchere') {
    // Level 0 is (first + last) x base, or first x base for a one-number line (§7.4).
    const line = s.line;
    if (!Array.isArray(line) || line.length < 1 || line.length > 64) return null;
    if (!line.every((n) => isInt(n) && n >= 1)) return null;
    const b = s.base === undefined ? unit || null : constEval(s.base, unit);
    if (b === null) return null;
    const first = line[0] as number;
    const last = line[line.length - 1] as number;
    return Math.floor((line.length === 1 ? first : first + last) * b);
  }
  if (s.base !== undefined) {
    const b = s.base === undefined ? unit || null : constEval(s.base, unit);
    return b === null ? null : Math.floor(b);
  }
  return unit ? unit : null;
}

/**
 * Resolves a chip value to cents at the starting and the top level (§3.4, S3): a literal gives
 * `{ base: d, top: d }`, `{ units: 1 }` gives the unit, `{ prog: p }` gives `progressionBase` and
 * `progressionTop` of `p`. Both are `null` when the base is a formula (or `p` is unknown).
 */
export function resolveChipValue(
  chip: ChipValue,
  ctx: { unit: Cents; progressions?: Record<Slug, ProgressionSpec> },
): { base: Cents | null; top: Cents | null } {
  if (typeof chip === 'number') return { base: chip, top: chip };
  if ('units' in chip) return { base: ctx.unit, top: ctx.unit };
  const spec =
    ctx.progressions && Object.hasOwn(ctx.progressions, chip.prog)
      ? ctx.progressions[chip.prog]
      : undefined;
  if (!spec) return { base: null, top: null };
  const base = progressionBase(spec, ctx.unit);
  return base === null ? { base: null, top: null } : { base, top: progressionTop(spec, ctx.unit) };
}

// ---------------------------------------------------------------- sweeps (§8.1)

const CHIP_PATH = /^\/strategy\/stages\/(0|[1-9]\d*)\/x-chips\/chip$/;

/** `{ stage }` when `path` is `/strategy/stages/<s>/x-chips/chip` (the sweepable chip value), else `null`. */
export function isChipPath(path: string): { stage: number } | null {
  const m = CHIP_PATH.exec(path);
  return m ? { stage: Number(m[1]) } : null;
}

/**
 * Regenerates one stage's prefix rows from its (possibly just changed) `x-chips` (§8.1 sweep). The
 * first `spots.length` rows are replaced and the rest kept, because a swept chip value leaves the old
 * prefix behind and the spot count does not change. Returns `def` itself when there is nothing to do.
 */
export function recompileStageChips(def: StrategyDefinition, stage: number): StrategyDefinition {
  const st = def.stages?.[stage];
  const chips = st ? readStageChips(st) : null;
  if (!st || !chips) return def;
  const rows = Array.isArray(st.layout) ? st.layout : [];
  const next: Stage = {
    ...st,
    layout: [...compileChips(chips), ...rows.slice(chips.spots.length)],
  };
  return { ...def, stages: def.stages.map((s, i) => (i === stage ? next : s)) };
}
