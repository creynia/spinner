// Rules presets (game.md §1.1, §4) as real data; resolve/normalize/describe are stubs (game WP).
import type { Cents, RulesRef, RulesSchema } from '@core/contracts/game';
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

/** Throws a typed `RulesError` (game.md §1.1) for illegal combinations. */
export function resolveRules(_p?: string | RulesRef): RouletteRules {
  throw new Error('TODO(game)');
}

export function normalizeRules(_p: string | RulesRef): RulesRef {
  throw new Error('TODO(game)');
}

export function describeRules(_r: RouletteRules): string[] {
  throw new Error('TODO(game)');
}

export const rouletteRules: RulesSchema<RouletteRules> = {
  presets: ROULETTE_PRESETS,
  defaultPreset: DEFAULT_RULE_PRESET,
  resolve: resolveRules,
  normalize: normalizeRules,
  describe: describeRules,
};
