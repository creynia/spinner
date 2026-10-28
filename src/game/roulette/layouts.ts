// Built-in chip layouts (layouts.md §2.2): read-only shapes in chips, no money. A stage copies one
// into an `x-chips` block and picks the chip value there.
import type { ChipLayout } from '@core/contracts/layout';
import { betDef } from './bets';

const pieces = (bet: string): number => betDef(bet, 'european')?.pieces ?? 1;

const make = (id: string, name: string, notes: string, spots: ChipLayout['spots']): ChipLayout => ({
  schema: 1,
  id,
  name,
  game: 'roulette',
  variant: 'european',
  notes,
  spots,
});

/** Call bets hold one full set of their pieces (voisins 9 chips, tiers 6, orphelins 5). */
export const BUILTIN_LAYOUTS: readonly ChipLayout[] = [
  make('james-bond', 'James Bond', 'High 14, the 13-18 six line 5, zero 1: 20 chips.', [
    { bet: 'high', chips: 14 },
    { bet: 'sixline:13-14-15-16-17-18', chips: 5 },
    { bet: 'straight:0', chips: 1 },
  ]),
  make('voisins', 'Voisins du zéro', 'The 17 pockets around zero, one set.', [
    { bet: 'voisins', chips: pieces('voisins') },
  ]),
  make('tiers', 'Tiers du cylindre', 'The 12 pockets opposite zero, one set.', [
    { bet: 'tiers', chips: pieces('tiers') },
  ]),
  make('orphelins', 'Orphelins', 'The 8 pockets outside voisins and tiers, one set.', [
    { bet: 'orphelins', chips: pieces('orphelins') },
  ]),
  make('zero-neighbours', 'Zero and neighbours', 'Zero and two pockets each side, one chip each.', [
    { bet: 'neighbours:0:2', chips: pieces('neighbours:0:2') },
  ]),
  make('two-dozens', 'Two dozens', 'The first and second dozens, one chip each.', [
    { bet: 'dozen:1', chips: 1 },
    { bet: 'dozen:2', chips: 1 },
  ]),
];
