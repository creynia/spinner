// Built-in roulette layouts are legal at a $5 chip on the European table (layouts.md §2.2).
import { describe, expect, it } from 'vitest';
import type { GamePlugin } from '@core/contracts/game';
import { checkAtTable } from '@core/ui';
import { BUILTIN_LAYOUTS, ROULETTE_PRESETS, roulette } from '@game/roulette';

describe('built-in layouts at the table', () => {
  it('every built-in is legal at a $5 chip on the European table', () => {
    const plugin = roulette as unknown as GamePlugin<unknown, unknown, unknown, unknown>;
    for (const l of BUILTIN_LAYOUTS) {
      const c = checkAtTable(
        plugin,
        ROULETTE_PRESETS.european,
        l.spots.map((s) => ({ bet: s.bet, cents: s.chips * 500 })),
        1_000_000,
      );
      expect(
        c.perSpot.map((p) => `${p.bet}:${p.status}`),
        l.id,
      ).toEqual(l.spots.map((s) => `${s.bet}:ok`));
    }
  });
});
