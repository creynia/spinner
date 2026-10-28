// Pocket data (game.md §2) as real data; `wheelSpec` is a stub (game WP).
import type { PocketIndex, PocketLabel, WheelKind, WheelSpec } from './types';

/** Pocket labels by wheel, by PocketIndex (0..36 numbers, 37 '00', 38 '000'). */
export function pocketLabels(wheel: WheelKind): PocketLabel[] {
  const labels: PocketLabel[] = Array.from({ length: 37 }, (_, i) => String(i) as PocketLabel);
  if (wheel !== 'european') labels.push('00');
  if (wheel === 'triple-zero') labels.push('000');
  return labels;
}

export const RED_NUMBERS: readonly number[] = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

/** Clockwise from 0 (game.md §2.2). Triple-zero is display only and not sourced yet. */
export const WHEEL_ORDER: Record<WheelKind, readonly PocketLabel[]> = {
  european: [
    '0',
    '32',
    '15',
    '19',
    '4',
    '21',
    '2',
    '25',
    '17',
    '34',
    '6',
    '27',
    '13',
    '36',
    '11',
    '30',
    '8',
    '23',
    '10',
    '5',
    '24',
    '16',
    '33',
    '1',
    '20',
    '14',
    '31',
    '9',
    '22',
    '18',
    '29',
    '7',
    '28',
    '12',
    '35',
    '3',
    '26',
  ],
  american: [
    '0',
    '28',
    '9',
    '26',
    '30',
    '11',
    '7',
    '20',
    '32',
    '17',
    '5',
    '22',
    '34',
    '15',
    '3',
    '24',
    '36',
    '13',
    '1',
    '00',
    '27',
    '10',
    '25',
    '29',
    '12',
    '8',
    '19',
    '31',
    '18',
    '6',
    '21',
    '33',
    '16',
    '4',
    '23',
    '35',
    '14',
    '2',
  ],
  'triple-zero': [],
};

/** European sectors, each a contiguous arc of the wheel (game.md §2.2). */
export const SECTORS = {
  voisins: [22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25],
  tiers: [27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33],
  orphelins: [17, 34, 6, 1, 20, 14, 31, 9],
  'jeu-zero': [12, 35, 3, 26, 0, 32, 15],
} as const satisfies Record<string, readonly PocketIndex[]>;

const NUMBER_COUNT: Record<WheelKind, 37 | 38 | 39> = {
  european: 37,
  american: 38,
  'triple-zero': 39,
};

/** Pocket index of a label: '0' is 0, '1'..'36' are 1..36, '00' is 37, '000' is 38. */
export function pocketIndexOf(label: string): number {
  if (label === '00') return 37;
  if (label === '000') return 38;
  return Number(label);
}

/** Canonical id order: `0 < 00 < 000 < 1 < 2 < ... < 36` (game.md §2.1). */
export function pocketRank(label: string): number {
  if (label === '0') return 0;
  if (label === '00') return 1;
  if (label === '000') return 2;
  return Number(label) + 2;
}

/** Zero pockets by wheel (indices). */
export function zeroPockets(wheel: WheelKind): readonly PocketIndex[] {
  return wheel === 'european' ? [0] : wheel === 'american' ? [0, 37] : [0, 37, 38];
}

const RED_SET: ReadonlySet<number> = new Set(RED_NUMBERS);
/** True for a red number 1..36. */
export const isRed = (n: number): boolean => RED_SET.has(n);
/** 0 green, 1 red, 2 black, for a pocket index. */
export const colorCode = (p: number): 0 | 1 | 2 => (p < 1 || p > 36 ? 0 : isRed(p) ? 1 : 2);
/** Dozen 1..3 of a number 1..36, 0 for any zero. */
export const dozenOf = (p: number): 0 | 1 | 2 | 3 =>
  p < 1 || p > 36 ? 0 : (Math.ceil(p / 12) as 1 | 2 | 3);
/** Column 1..3 of a number 1..36, 0 for any zero. */
export const columnOf = (p: number): 0 | 1 | 2 | 3 =>
  p < 1 || p > 36 ? 0 : ((((p - 1) % 3) + 1) as 1 | 2 | 3);

const SECTOR_OF = new Map<number, 'voisins' | 'tiers' | 'orphelins'>();
for (const name of ['voisins', 'tiers', 'orphelins'] as const)
  for (const p of SECTORS[name]) SECTOR_OF.set(p, name);
/** European sector of a number; null on any other wheel or for an unknown index. */
export const sectorOf = (p: number): 'voisins' | 'tiers' | 'orphelins' | null =>
  SECTOR_OF.get(p) ?? null;

const SPECS = new Map<WheelKind, WheelSpec>();
/** The (shared, frozen) wheel spec: pockets, order, colours (game.md §2). */
export function wheelSpec(kind: WheelKind): WheelSpec {
  let spec = SPECS.get(kind);
  if (!spec) {
    const labels = pocketLabels(kind);
    const color = new Uint8Array(labels.length);
    for (let p = 0; p < labels.length; p++) color[p] = colorCode(p);
    spec = Object.freeze({
      kind,
      n: NUMBER_COUNT[kind],
      labels: Object.freeze(labels),
      order: Object.freeze(WHEEL_ORDER[kind].map(pocketIndexOf)),
      color,
    });
    SPECS.set(kind, spec);
  }
  return spec;
}
