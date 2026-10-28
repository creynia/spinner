import { describe, expect, it } from 'vitest';
import {
  CALL_BET_IDS,
  SECTORS,
  WHEEL_ORDER,
  betDef,
  fixedBetIds,
  parseBet,
  type WheelKind,
} from './index';

const WHEELS: readonly WheelKind[] = ['european', 'american', 'triple-zero'];
const neighbourIds = (): string[] =>
  Array.from({ length: 37 }, (_, p) =>
    Array.from({ length: 9 }, (_, k) => `neighbours:${p}:${k + 1}`),
  ).flat();

describe('parseBet (game.md §3.2)', () => {
  it('round-trips every canonical id', () => {
    for (const wheel of WHEELS)
      for (const id of fixedBetIds(wheel)) expect(parseBet(id), id).toBe(id);
    for (const id of [...CALL_BET_IDS, ...neighbourIds()]) expect(parseBet(id), id).toBe(id);
    for (const id of ['prison:red', 'prison:high']) expect(parseBet(id)).toBe(id);
  });
  it.each([
    ['split:20-17', 'split:17-20'],
    ['corner:21-17-20-18', 'corner:17-18-20-21'],
    ['street:16', 'street:16-17-18'],
    ['sixline:13', 'sixline:13-14-15-16-17-18'],
    ['sixline:13-18', 'sixline:13-14-15-16-17-18'],
    ['17', 'straight:17'],
    ['00', 'straight:00'],
    ['first-four', 'basket'],
    ['top-line', 'basket'],
    ['1-18', 'low'],
    ['manque', 'low'],
    ['19-36', 'high'],
    ['passe', 'high'],
    ['Rouge', 'red'],
    ['noir', 'black'],
    ['pair', 'even'],
    ['impair', 'odd'],
    ['voisins-du-zero', 'voisins'],
    ['Voisins-du-zéro', 'voisins'],
    ['tiers-du-cylindre', 'tiers'],
    ['zero-spiel', 'jeu-zero'],
    ['jeu-0', 'jeu-zero'],
    ['neighbours:17', 'neighbours:17:2'],
    ['  SPLIT:00-2 ', 'split:00-2'],
    ['split:2-0', 'split:0-2'],
    ['prison:rouge', 'prison:red'],
  ])('folds alias %s to %s', (alias, canonical) => {
    expect(parseBet(alias)).toBe(canonical);
  });
  it.each([
    '',
    'split:17-21',
    'split:17',
    'street:17',
    'street:16-17-19',
    'corner:17-18-19-20',
    'sixline:14',
    'sixline:13-19',
    'straight:37',
    'straight:07',
    'straight:0000',
    'dozen:4',
    'column:0',
    'neighbours:00:2',
    'neighbours:17:0',
    'neighbours:17:10',
    'neighbours:37:2',
    'prison:dozen:1',
    'prison',
    'split:17-17',
    'trio:1-2-3',
    'basket:1',
    'red:1',
  ])('rejects %j', (bad) => {
    expect(parseBet(bad)).toBeNull();
  });
  it('rejects 200 random non-ids', () => {
    let x = 12345;
    const next = (): number => (x = (Math.imul(x, 1103515245) + 12345) >>> 0);
    const alphabet = 'abcxyz:-_ 0123456789,.';
    for (let i = 0; i < 200; i++) {
      let s = '';
      for (let j = 0, len = 1 + (next() % 12); j < len; j++)
        s += alphabet[next() % alphabet.length];
      // a random string may legitimately be a pocket or a bare id; those are not "non-ids"
      if (/^\s*(0|00|000|[1-9]\d?)\s*$/.test(s) && Number(s.trim()) <= 36) continue;
      expect(parseBet(s), JSON.stringify(s)).toBeNull();
    }
  });
});

describe('betDef (game.md §3)', () => {
  it('has a definition for every fixed id on its wheel, and only there', () => {
    for (const wheel of WHEELS) {
      const own = new Set(fixedBetIds(wheel));
      for (const other of WHEELS)
        for (const id of fixedBetIds(other))
          expect(betDef(id, wheel) !== null, `${wheel} ${id}`).toBe(own.has(id));
    }
  });
  it('limits call and neighbour bets to the european wheel', () => {
    for (const id of [...CALL_BET_IDS, 'neighbours:17:2']) {
      expect(betDef(id, 'european'), id).not.toBeNull();
      expect(betDef(id, 'american'), id).toBeNull();
      expect(betDef(id, 'triple-zero'), id).toBeNull();
    }
  });
  it('covers the pockets of game.md §3.1', () => {
    const cover = (id: string, w: WheelKind = 'european') => [...betDef(id, w)!.pockets];
    expect(cover('straight:17')).toEqual([17]);
    expect(cover('split:17-20')).toEqual([17, 20]);
    expect(cover('street:16-17-18')).toEqual([16, 17, 18]);
    expect(cover('corner:17-18-20-21')).toEqual([17, 18, 20, 21]);
    expect(cover('sixline:13-14-15-16-17-18')).toHaveLength(6);
    expect(cover('basket')).toEqual([0, 1, 2, 3]);
    expect(cover('basket', 'american')).toEqual([0, 37, 1, 2, 3]);
    expect(cover('basket', 'triple-zero')).toEqual([0, 37, 38, 1, 2, 3]);
    expect(cover('split:00-3', 'american')).toEqual([37, 3]);
    expect(cover('trio:0-00-000', 'triple-zero')).toEqual([0, 37, 38]);
    expect(cover('column:3')).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36]);
    expect(cover('dozen:2')).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(cover('red')).toHaveLength(18);
    expect(cover('odd')).toHaveLength(18);
    expect(cover('neighbours:17:2')).toEqual([2, 17, 25, 34, 6].sort((a, b) => a - b));
    expect(cover('neighbours:0:2')).toEqual([0, 3, 15, 26, 32]);
  });
  it('pays per family and wheel', () => {
    const pays = (id: string, w: WheelKind = 'european') => betDef(id, w)!.pays;
    expect([
      pays('straight:1'),
      pays('split:1-2'),
      pays('street:1-2-3'),
      pays('trio:0-1-2'),
    ]).toEqual([35, 17, 11, 11]);
    expect([
      pays('corner:1-2-4-5'),
      pays('sixline:1-2-3-4-5-6'),
      pays('red'),
      pays('dozen:1'),
    ]).toEqual([8, 5, 1, 2]);
    expect([pays('basket'), pays('basket', 'american'), pays('basket', 'triple-zero')]).toEqual([
      8, 6, 5,
    ]);
  });
  it('expands call bets into components (game.md §3.3)', () => {
    const total = (id: string) => betDef(id, 'european')!.pieces;
    expect([total('voisins'), total('tiers'), total('orphelins'), total('jeu-zero')]).toEqual([
      9, 6, 5, 4,
    ]);
    expect(total('neighbours:17:3')).toBe(7);
    for (const id of CALL_BET_IDS) {
      const def = betDef(id, 'european')!;
      const union = new Set<number>();
      for (const c of def.components!)
        for (const p of betDef(c.spot, 'european')!.pockets) union.add(p);
      expect(
        [...union].sort((a, b) => a - b),
        id,
      ).toEqual([...def.pockets]);
      expect([...def.pockets]).toEqual([...SECTORS[id]].sort((a, b) => a - b));
    }
  });
  it('neighbours follow the wheel order, wrapping round zero', () => {
    const order = WHEEL_ORDER.european.map(Number);
    for (let i = 0; i < 37; i++) {
      const def = betDef(`neighbours:${order[i]}:9`, 'european')!;
      const expected = Array.from({ length: 19 }, (_, d) => order[(i + d - 9 + 37) % 37]!).sort(
        (a, b) => a - b,
      );
      expect([...def.pockets]).toEqual(expected);
    }
  });
});
