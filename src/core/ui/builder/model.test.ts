import { describe, expect, it } from 'vitest';
import type { StrategyDefinition } from '../../contracts/strategy';
import { normalizeStrategy } from '../../strategy';
import { fromJson, toJson } from './model';

describe('builder model', () => {
  it('keeps x- keys, empty optional arrays and odd conditions through the round trip', () => {
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
          rules: [
            { when: { any: [] }, then: [{ stop: 'done' }], 'x-r': true },
            {
              when: {
                all: [{ all: [{ onTable: 'red' }, { everyN: 3 }] }, { not: { onTable: 'black' } }],
              },
              then: [{ skipRound: true }],
            },
          ],
        },
      ],
    } as unknown as StrategyDefinition;
    expect(toJson(fromJson(d))).toEqual(normalizeStrategy(d));
    const m = fromJson(d);
    expect(fromJson(toJson(m))).toEqual(m);
  });
});
