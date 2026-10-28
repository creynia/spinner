import { describe, expect, it } from 'vitest';
import { MAX_CHIPS_PER_SPOT, MAX_LAYOUT_SPOTS } from '@core/contracts/layout';
import { betDef } from './bets';
import { BUILTIN_LAYOUTS } from './layouts';

const stepOf = (bet: string): number => betDef(bet, 'european')?.pieces ?? 1;

describe('built-in layouts', () => {
  it('have unique slug ids and names', () => {
    expect(new Set(BUILTIN_LAYOUTS.map((l) => l.id)).size).toBe(BUILTIN_LAYOUTS.length);
    for (const l of BUILTIN_LAYOUTS) {
      expect(l.id).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
      expect(l.name.length).toBeGreaterThan(0);
      expect(l.name.length).toBeLessThanOrEqual(80);
      expect(l.schema).toBe(1);
      expect(l.game).toBe('roulette');
    }
  });

  it('hold legal bets once each, in whole chips, call bets in multiples of their step', () => {
    for (const l of BUILTIN_LAYOUTS) {
      expect(l.spots.length).toBeGreaterThan(0);
      expect(l.spots.length).toBeLessThanOrEqual(MAX_LAYOUT_SPOTS);
      expect(new Set(l.spots.map((s) => s.bet)).size).toBe(l.spots.length);
      for (const s of l.spots) {
        expect(betDef(s.bet, 'european'), s.bet).not.toBeNull();
        expect(Number.isInteger(s.chips)).toBe(true);
        expect(s.chips).toBeGreaterThanOrEqual(1);
        expect(s.chips).toBeLessThanOrEqual(MAX_CHIPS_PER_SPOT);
        expect(s.chips % stepOf(s.bet)).toBe(0);
      }
    }
  });

  it('James Bond is the 14 / 5 / 1 shape of the preset', () => {
    const jb = BUILTIN_LAYOUTS.find((l) => l.id === 'james-bond')!;
    expect(jb.spots).toEqual([
      { bet: 'high', chips: 14 },
      { bet: 'sixline:13-14-15-16-17-18', chips: 5 },
      { bet: 'straight:0', chips: 1 },
    ]);
  });

  it('each call bet layout holds one full set', () => {
    const chips = (id: string) => BUILTIN_LAYOUTS.find((l) => l.id === id)!.spots[0]!.chips;
    expect(chips('voisins')).toBe(9);
    expect(chips('tiers')).toBe(6);
    expect(chips('orphelins')).toBe(5);
    expect(chips('zero-neighbours')).toBe(5);
  });

  // Needs L1's `validateChipLayout` (PR #27): enable the real check when it lands.
  it.todo('every built-in passes validateChipLayout');
});
