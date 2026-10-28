import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateStrategy, type ValidationContext } from '@core/strategy';
import { STRATEGY_PRESETS, STRATEGY_PRESET_IDS, ROULETTE_PRESETS, roulette } from './index';
import type { WheelKind } from './index';

const load = (id: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`./presets/${id}.json`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;

const ctxFor = (wheel: WheelKind): ValidationContext => {
  const rules = ROULETTE_PRESETS[wheel];
  return {
    gameId: 'roulette',
    catalog: roulette.bets.catalog(rules),
    parseBet: (id) => roulette.bets.parse(id),
    facts: roulette.facts,
    rules,
    limits: (b, r, v) => roulette.limits(b, r as typeof rules, v as never),
    compileFact: (ref, r) => roulette.compileFact(ref, r as typeof rules),
    compileHistory: (pr, r) => roulette.compileHistory!(pr, r as typeof rules),
  };
};

describe('strategy presets (decisions #10; game.md §11)', () => {
  it('ships one JSON file per listed id, with the listed name', () => {
    for (const p of STRATEGY_PRESETS) {
      const def = load(p.id);
      expect(def).toMatchObject({
        schema: 1,
        id: p.id,
        name: p.name,
        game: 'roulette',
        unit: 2500,
      });
      expect(typeof def.notes).toBe('string');
    }
    expect(STRATEGY_PRESET_IDS).toHaveLength(12);
  });
  it.each(STRATEGY_PRESET_IDS)('%s validates with zero errors on the european rules', (id) => {
    const diags = validateStrategy(load(id), ctxFor('european'));
    expect(diags.filter((d) => d.severity === 'error')).toEqual([]);
  });
  it.each(STRATEGY_PRESET_IDS)('%s validates structurally', (id) => {
    expect(validateStrategy(load(id), null).filter((d) => d.severity === 'error')).toEqual([]);
  });
  it('every preset also validates on the american wheel', () => {
    // flat/progression presets use only red/dozens/inside bets, available on every wheel
    for (const id of STRATEGY_PRESET_IDS) {
      const errors = validateStrategy(load(id), ctxFor('american')).filter(
        (d) => d.severity === 'error',
      );
      expect(errors, id).toEqual([]);
    }
  });
});
