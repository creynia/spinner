// Rules presets (game.md §1.1, §4) as real data; resolve/normalize/describe are stubs (game WP).
import type { Cents, Json, RulesRef, RulesSchema } from '@core/contracts/game';
import { formatMoney } from '@core/money';
import type { RouletteRules, TableLimits, WheelKind } from './types';

/** The three presets of decisions #2. "French" is `european` + `laPartage`, a shortcut in the UI. */
export const RULE_PRESET_IDS = [
  'european',
  'american',
  'triple-zero',
] as const satisfies readonly WheelKind[];
export const DEFAULT_RULE_PRESET: WheelKind = 'european';

/** Pace presets (decisions #4). */
export const PACE_PRESETS = {
  live: { roundsPerHour: 40, label: 'live' },
  electronic: { roundsPerHour: 100, label: 'electronic' },
} as const;

/** The high-limit table of decisions #3. The basket maximum depends on the wheel (game.md §4). */
function highLimits(basketMax: Cents): TableLimits {
  return {
    chipUnit: 100,
    outside: { min: 2500, max: 500_000 },
    inside: {
      minChip: 100,
      minTotal: 2500,
      max: {
        straight: 50_000,
        split: 100_000,
        street: 150_000,
        trio: 150_000,
        corner: 200_000,
        basket: basketMax,
        sixline: 300_000,
      },
    },
    maxTotalPerSpin: null,
  };
}

function preset(kind: WheelKind, basketMax: Cents): RouletteRules {
  return {
    preset: kind,
    wheel: kind,
    laPartage: false,
    enPrison: false,
    enPrisonSecondZero: 'lose',
    limits: highLimits(basketMax),
    reconcile: { overMax: 'clamp', shortfall: 'reduce' },
    pace: { ...PACE_PRESETS.live },
  };
}

export const ROULETTE_PRESETS: Record<WheelKind, RouletteRules> = {
  european: preset('european', 200_000),
  american: preset('american', 250_000),
  'triple-zero': preset('triple-zero', 300_000),
};

export type RulesErrorCode =
  | 'rules/preset'
  | 'rules/unknown-key'
  | 'rules/type'
  | 'rules/flags-exclusive'
  | 'rules/flag-needs-single-zero'
  | 'rules/limits'
  | 'rules/pace';

/** Typed error for illegal rules (game.md §1.1); the validator turns it into a JSON-pointer error. */
export class RulesError extends Error {
  readonly code: RulesErrorCode;
  constructor(code: RulesErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RulesError';
    this.code = code;
  }
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const clone = (r: RouletteRules): RouletteRules => structuredClone(r);

/** Deep-merges `src` into `dst`, which must already have every key (unknown keys throw). */
function merge(dst: Record<string, unknown>, src: Record<string, unknown>, path: string): void {
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined) continue;
    if (!(k in dst)) throw new RulesError('rules/unknown-key', `${path}${k}`);
    const cur = dst[k];
    if (isObj(cur)) {
      if (!isObj(v)) throw new RulesError('rules/type', `${path}${k} must be an object`);
      merge(cur, v, `${path}${k}.`);
    } else if (cur === null ? v !== null && typeof v !== 'number' : typeof v !== typeof cur) {
      throw new RulesError('rules/type', `${path}${k}`);
    } else dst[k] = v;
  }
}

function paceLabel(roundsPerHour: number): 'live' | 'electronic' | 'custom' {
  return roundsPerHour === PACE_PRESETS.live.roundsPerHour
    ? 'live'
    : roundsPerHour === PACE_PRESETS.electronic.roundsPerHour
      ? 'electronic'
      : 'custom';
}

function validate(r: RouletteRules): void {
  if (r.laPartage && r.enPrison)
    throw new RulesError('rules/flags-exclusive', 'laPartage and enPrison cannot both be on');
  if ((r.laPartage || r.enPrison) && r.wheel !== 'european')
    throw new RulesError(
      'rules/flag-needs-single-zero',
      'laPartage/enPrison need the european wheel',
    );
  if (r.enPrisonSecondZero !== 'lose' && r.enPrisonSecondZero !== 'reimprison')
    throw new RulesError('rules/type', 'enPrisonSecondZero');
  if (r.reconcile.overMax !== 'clamp' && r.reconcile.overMax !== 'reject')
    throw new RulesError('rules/type', 'reconcile.overMax');
  if (r.reconcile.shortfall !== 'reduce' && r.reconcile.shortfall !== 'reject')
    throw new RulesError('rules/type', 'reconcile.shortfall');
  const l = r.limits;
  const unit = l.chipUnit;
  if (!Number.isSafeInteger(unit) || unit < 1)
    throw new RulesError('rules/limits', 'chipUnit must be a positive integer');
  const ok = (v: number): boolean => Number.isSafeInteger(v) && v >= unit && v % unit === 0;
  const all: [string, number][] = [
    ['outside.min', l.outside.min],
    ['outside.max', l.outside.max],
    ['inside.minChip', l.inside.minChip],
    ['inside.minTotal', l.inside.minTotal],
    ...Object.entries(l.inside.max).map(([k, v]): [string, number] => [`inside.max.${k}`, v]),
  ];
  if (l.maxTotalPerSpin !== null) all.push(['maxTotalPerSpin', l.maxTotalPerSpin]);
  for (const [name, v] of all)
    if (!ok(v))
      throw new RulesError('rules/limits', `${name} must be a positive multiple of the chip unit`);
  if (l.outside.min > l.outside.max)
    throw new RulesError('rules/limits', 'outside.min > outside.max');
  for (const [k, v] of Object.entries(l.inside.max))
    if (l.inside.minChip > v)
      throw new RulesError('rules/limits', `inside.minChip > inside.max.${k}`);
  const h = r.pace.roundsPerHour;
  if (!Number.isFinite(h) || h < 1 || h > 1000)
    throw new RulesError('rules/pace', 'roundsPerHour must be in 1..1000');
}

/** Preset first, then overrides (deep-merged for `limits`, `reconcile`, `pace`). Throws `RulesError`. */
export function resolveRules(p?: string | RulesRef): RouletteRules {
  const ref: RulesRef =
    p === undefined
      ? { preset: DEFAULT_RULE_PRESET, overrides: {} }
      : typeof p === 'string'
        ? { preset: p, overrides: {} }
        : p;
  const base = (ROULETTE_PRESETS as Record<string, RouletteRules | undefined>)[ref.preset];
  if (!base || !Object.hasOwn(ROULETTE_PRESETS, ref.preset))
    throw new RulesError('rules/preset', `unknown preset "${ref.preset}"`);
  const r = clone(base);
  const o: Record<string, unknown> = { ...ref.overrides };
  delete o.preset;
  if (o.wheel !== undefined && o.wheel !== r.wheel)
    throw new RulesError('rules/unknown-key', 'wheel (choose a preset instead)');
  const pace = o.pace;
  if (typeof pace === 'string') {
    const named = Object.hasOwn(PACE_PRESETS, pace)
      ? (PACE_PRESETS as Record<string, { roundsPerHour: number; label: string }>)[pace]
      : undefined;
    if (!named) throw new RulesError('rules/pace', `unknown pace "${pace}"`);
    o.pace = { roundsPerHour: named.roundsPerHour, label: named.label };
  } else if (isObj(pace) && pace.roundsPerHour !== undefined && pace.label === undefined) {
    o.pace = { ...pace, label: paceLabel(Number(pace.roundsPerHour)) };
  }
  merge(r as unknown as Record<string, unknown>, o, '');
  validate(r);
  return r;
}

function diff(base: unknown, cur: unknown): Json | undefined {
  if (isObj(base) && isObj(cur)) {
    const out: Record<string, Json> = {};
    for (const k of Object.keys(cur).sort()) {
      const d = diff(base[k], cur[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return base === cur ? undefined : (cur as Json);
}

/** Preset + overrides with overrides equal to the preset's resolved values pruned (E1). */
export function normalizeRules(p: string | RulesRef): RulesRef {
  const ref: RulesRef = typeof p === 'string' ? { preset: p, overrides: {} } : p;
  const resolved = resolveRules(ref); // validates
  const base = ROULETTE_PRESETS[resolved.preset];
  const d = diff(base, resolved) as Record<string, Json> | undefined;
  delete d?.preset;
  delete d?.wheel;
  return { preset: ref.preset, overrides: d ?? {} };
}

const WHEEL_NAME: Record<string, string> = {
  european: 'European single zero',
  american: 'American double zero',
  'triple-zero': 'Triple zero',
};

export function describeRules(r: RouletteRules): string[] {
  const parts = [WHEEL_NAME[r.wheel] ?? r.wheel];
  if (r.laPartage) parts.push('La partage');
  if (r.enPrison)
    parts.push(r.enPrisonSecondZero === 'reimprison' ? 'En prison (re-imprison)' : 'En prison');
  const { min, max } = r.limits.outside;
  parts.push(`${formatMoney(min)}\u2013${formatMoney(max)}`);
  parts.push(`${r.pace.roundsPerHour} spins/h`);
  return [parts.join(' \u00b7 ')];
}

export const rouletteRules: RulesSchema<RouletteRules> = {
  presets: ROULETTE_PRESETS,
  defaultPreset: DEFAULT_RULE_PRESET,
  resolve: resolveRules,
  normalize: normalizeRules,
  describe: describeRules,
};
