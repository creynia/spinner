// Parameterised bets (`neighbours:<p>:<k>`) through the real validation context, as Define and the
// harness build it: the catalog keys the family by its template id, the validator must resolve it.
import { describe, expect, it } from 'vitest';
import { validateChipLayout, validateStrategy, type ValidationContext } from '@core/strategy';
import { ROULETTE_PRESETS, roulette } from './index';
import type { WheelKind } from './index';

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
  };
};

const strategyBetting = (...bets: string[]): unknown => ({
  schema: 1,
  id: 'nb',
  name: 'Neighbours',
  game: 'roulette',
  unit: 2500,
  stages: [{ id: 'a', layout: bets.map((bet) => ({ bet, amount: { units: 1 } })) }],
});

const codes = (def: unknown, wheel: WheelKind = 'european'): string[] =>
  validateStrategy(def, ctxFor(wheel))
    .filter((d) => d.severity === 'error')
    .map((d) => `${d.code}@${d.path}`);

describe('parameterised bets resolve through the catalog family', () => {
  it.each(['neighbours:0:2', 'neighbours:17:9', 'neighbours:17', 'Neighbours:0:1'])(
    '%s validates on european',
    (bet) => {
      expect(codes(strategyBetting(bet))).toEqual([]);
    },
  );
  it('fixed bets still validate alongside', () => {
    expect(codes(strategyBetting('red', 'neighbours:0:2', 'voisins'))).toEqual([]);
  });
  it.each([
    'neighbours:99:2',
    'neighbours:0:9x',
    'neighbours:0:0',
    'neighbours:0:10',
    'neighbours',
  ])('%s is E_UNKNOWN_BET', (bet) => {
    expect(codes(strategyBetting(bet))).toEqual(['E_UNKNOWN_BET@/stages/0/layout/0/bet']);
  });
  it('a wheel without the family still reports E_BET_UNAVAILABLE', () => {
    expect(codes(strategyBetting('neighbours:0:2'), 'american')).toEqual([
      'E_BET_UNAVAILABLE@/stages/0/layout/0/bet',
    ]);
  });
  it('validateChipLayout accepts neighbours and rejects malformed ones', () => {
    const layout = (bet: string): unknown => ({
      schema: 1,
      id: 'nb-layout',
      name: 'Neighbours layout',
      game: 'roulette',
      variant: 'european',
      spots: [{ bet, chips: 1 }],
    });
    const ctx = ctxFor('european');
    expect(validateChipLayout(layout('neighbours:0:2'), ctx)).toEqual([]);
    expect(validateChipLayout(layout('neighbours:99:2'), ctx).map((d) => d.code)).toEqual([
      'E_UNKNOWN_BET',
    ]);
    expect(validateChipLayout(layout('neighbours:0:9x'), ctx).map((d) => d.code)).toEqual([
      'E_UNKNOWN_BET',
    ]);
  });
});
