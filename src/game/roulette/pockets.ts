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

export function wheelSpec(_kind: WheelKind): WheelSpec {
  throw new Error('TODO(game)');
}
