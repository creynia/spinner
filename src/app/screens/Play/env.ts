// The roulette game for play mode: one `PlayEnv` per wheel variant and rules overrides (table
// limits), built once and reused. The restored engine state always takes the env's rules, so
// limits changed between spins apply to the next spin (the wheel itself never changes mid-session).
import type { Json } from '@core/contracts/game';
import type { PlayEnv } from '@core/play';
import { DEFAULT_RULE_PRESET, RULE_PRESET_IDS, resolveRules, roulette } from '@game/roulette';
import type { RouletteRules, RouletteState } from '@game/roulette';

export type RouletteEnv = PlayEnv<RouletteState, RouletteRules>;
export type RulesOverrides = Record<string, Json>;

const cache = new Map<string, RouletteEnv>();

export const isVariant = (id: unknown): id is string =>
  typeof id === 'string' && RULE_PRESET_IDS.some((v) => v === id);

/**
 * The play environment for a rules preset id and optional overrides. Unknown ids fall back to the
 * default table; overrides the rules reject are ignored (use `rulesError` to validate first).
 */
export function rouletteEnv(variant: string, overrides?: RulesOverrides): RouletteEnv {
  const id = isVariant(variant) ? variant : DEFAULT_RULE_PRESET;
  const ov = overrides && Object.keys(overrides).length ? overrides : undefined;
  const key = ov ? `${id}|${JSON.stringify(ov)}` : id;
  let env = cache.get(key);
  if (!env) {
    let rules: RouletteRules;
    try {
      rules = resolveRules(ov ? { preset: id, overrides: ov } : id);
    } catch {
      rules = resolveRules(id);
    }
    env = {
      plugin: roulette,
      rules,
      restore: (snap, rng) => ({ ...roulette.deserialize(snap), rng, rules }),
    };
    cache.set(key, env);
  }
  return env;
}

/** The env of a session: its wheel plus its rules overrides. */
export const envOf = (s: { variant: string; rulesOverrides?: RulesOverrides }): RouletteEnv =>
  rouletteEnv(s.variant, s.rulesOverrides);

/** Why these overrides are not valid rules for the wheel, or null when they are. */
export function rulesError(variant: string, overrides: RulesOverrides): string | null {
  try {
    resolveRules({ preset: isVariant(variant) ? variant : DEFAULT_RULE_PRESET, overrides });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid table limits';
  }
}
