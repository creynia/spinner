import { describe, expect, it } from 'vitest';
import type { StrategyDefinition } from '@core/contracts/strategy';
import { normalizeStrategy } from '@core/strategy';
import { STRATEGY_PRESET_IDS } from '@game/roulette';
import goldens from './__fixtures__/roulette-goldens.json';
import { fromJson, toJson } from '@core/ui/builder/model';

const presetFiles = import.meta.glob<StrategyDefinition>('../../../game/roulette/presets/*.json', {
  eager: true,
  import: 'default',
});
const presets = Object.entries(presetFiles).map(([k, v]) => [k.split('/').pop()!, v] as const);

describe('builder model round trip', () => {
  it('finds all 12 presets', () => {
    expect(presets.length).toBe(12);
    expect(STRATEGY_PRESET_IDS.length).toBe(12);
  });
  const all: [string, StrategyDefinition][] = [
    ...presets.map(([n, d]) => [`preset ${n}`, d] as [string, StrategyDefinition]),
    ...(goldens as unknown as StrategyDefinition[]).map(
      (d) => [`golden ${d.id}`, d] as [string, StrategyDefinition],
    ),
  ];
  it.each(all)('%s: toJson(fromJson(d)) equals normalizeStrategy(d)', (_n, d) => {
    expect(toJson(fromJson(d))).toEqual(normalizeStrategy(d));
  });
  it.each(all)('%s: fromJson(toJson(m)) equals m', (_n, d) => {
    const m = fromJson(d);
    expect(fromJson(toJson(m))).toEqual(m);
  });
  it('keeps x- keys and empty optional arrays', () => {
    const d = {
      schema: 1,
      id: 'x',
      name: 'x',
      game: 'roulette',
      unit: 2500,
      'x-note': { a: 1 },
      stages: [
        {
          id: 'a',
          layout: [],
          onEnter: [],
          'x-pos': 3,
          rules: [{ when: { any: [] }, then: [{ stop: 'done' }], 'x-r': true }],
        },
      ],
    } as unknown as StrategyDefinition;
    expect(toJson(fromJson(d))).toEqual(normalizeStrategy(d));
  });
});
