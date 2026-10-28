import { describe, expect, it } from 'vitest';
import type { ExperimentDefinition, NormalizedDefinition } from '@core/contracts/experiment';
import { createInThreadTransport, definitionId, normalizeDefinition, simulateOn } from '@core';
import { roulette } from '@game/roulette';
import { buildVariants, leafLabel, leafPaths } from './sweep';

const SPOTS = [
  { bet: 'red', chips: 5 },
  { bet: 'straight:17', chips: 3 },
  { bet: 'straight:20', chips: 2 },
];

// Legal at the lowest swept value ($5): Red is 5 chips and the inside bets total 5 chips (>= minTotal).
function chipDef(): NormalizedDefinition {
  const raw = {
    schema: 1,
    name: 'Chips',
    game: { id: 'roulette', rules: { preset: 'european', overrides: {} } },
    session: { bankroll: 1_000_000, maxRounds: 20, roundsPerHour: 40 },
    run: { seed: 7, sessions: 4, sampleSessions: 2, checkpointSchedule: 'auto' },
    strategy: {
      schema: 1,
      id: 'chips',
      name: 'Chips',
      game: 'roulette',
      unit: 500,
      stages: [
        {
          id: 'play',
          'x-chips': {
            v: 1,
            spots: SPOTS,
            chip: 500,
            from: { id: 'my-layout', hash: 'abc', name: 'Mine' },
          },
          layout: [
            { bet: 'red', amount: 2500 },
            { bet: 'straight:17', amount: 1500 },
            { bet: 'straight:20', amount: 1000 },
          ],
        },
      ],
    },
  } as unknown as ExperimentDefinition;
  const res = normalizeDefinition(raw, { plugin: roulette, resolveStrategyRef: () => undefined });
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.definition;
}

const CHIP = '/strategy/stages/0/x-chips/chip';

describe('leafPaths with a chip stage', () => {
  const leaves = leafPaths(chipDef()).map((l) => l.path);
  it('offers the chip value and labels it', () => {
    expect(leaves).toContain(CHIP);
    const d = chipDef();
    expect(leafLabel(d, { path: CHIP, value: 500 })).toBe('Stage play: chip value (now 500)');
  });
  it('hides every other x- path and the compiled chip rows', () => {
    expect(leaves.filter((p) => p.includes('x-chips'))).toEqual([CHIP]);
    expect(leaves.some((p) => /\/layout\/\d+\/amount/.test(p))).toBe(false);
    expect(leaves).toContain('/session/bankroll');
  });
});

describe('buildVariants over a chip value', () => {
  it('recompiles the rows: chips x value, distinct ids, and the variants run', async () => {
    const base = chipDef();
    const res = buildVariants(base, CHIP, [500, 2500, 10_000]);
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    expect(res.variants).toHaveLength(3);
    for (const v of res.variants) {
      const chip = v.value as number;
      const rows = v.definition.strategy.stages[0]!.layout!;
      expect(rows.map((r) => r.amount)).toEqual(SPOTS.map((s) => s.chips * chip));
    }
    const ids = await Promise.all(res.variants.map((v) => definitionId(v.definition)));
    expect(new Set(ids).size).toBe(3);
    const transport = createInThreadTransport(roulette, { hop: 'microtask' });
    for (const v of res.variants) {
      const out = await simulateOn(transport, v.definition, 0);
      expect(out.row).toBeDefined();
    }
  });
  it('rejects the whole sweep for a value that is not whole cents', () => {
    for (const bad of [12.5, 0, -500, '500']) {
      const res = buildVariants(chipDef(), CHIP, [500, bad]);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors[0]?.message).toBe('chip value must be whole cents');
    }
  });
  it('denies the other x- paths and compiled chip rows', () => {
    for (const p of [
      '/strategy/stages/0/x-chips/spots/0/chips',
      '/strategy/stages/0/x-chips/from/hash',
      '/strategy/stages/0/x-chips/v',
      '/strategy/stages/0/layout/0/amount',
      '/strategy/stages/0/layout/2/amount',
    ]) {
      const res = buildVariants(chipDef(), p, [1, 2]);
      expect(res.ok, p).toBe(false);
    }
  });
});
