// The roulette game for play mode: one `PlayEnv` per wheel variant, built once and reused.
import type { PlayEnv } from '@core/play';
import { DEFAULT_RULE_PRESET, RULE_PRESET_IDS, resolveRules, roulette } from '@game/roulette';
import type { RouletteRules, RouletteState } from '@game/roulette';

export type RouletteEnv = PlayEnv<RouletteState, RouletteRules>;

const cache = new Map<string, RouletteEnv>();

export const isVariant = (id: unknown): id is string =>
  typeof id === 'string' && RULE_PRESET_IDS.some((v) => v === id);

/** The play environment for a rules preset id (unknown ids fall back to the default table). */
export function rouletteEnv(variant: string): RouletteEnv {
  const id = isVariant(variant) ? variant : DEFAULT_RULE_PRESET;
  let env = cache.get(id);
  if (!env) {
    env = {
      plugin: roulette,
      rules: resolveRules(id),
      restore: (snap, rng) => ({ ...roulette.deserialize(snap), rng }),
    };
    cache.set(id, env);
  }
  return env;
}
