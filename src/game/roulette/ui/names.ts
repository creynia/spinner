// Words and number formats for the roulette UI (labels, payouts, money, colours).
import { familyOf, payout } from '../bets';
import { colorCode, pocketIndexOf } from '../pockets';
import type { Color, WheelKind } from '../types';

const ORDINAL = ['', '1st', '2nd', '3rd'];
const CALL_NAMES: Record<string, string> = {
  voisins: 'Voisins du zéro',
  tiers: 'Tiers du cylindre',
  orphelins: 'Orphelins',
  'jeu-zero': 'Jeu zéro',
};
const EVEN_NAMES: Record<string, string> = {
  red: 'Red',
  black: 'Black',
  odd: 'Odd',
  even: 'Even',
  low: 'Low 1–18',
  high: 'High 19–36',
};

function list(items: string[]): string {
  return items.length <= 2
    ? items.join(' and ')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Plain-words name of a canonical bet id ("Split 17 and 20"). */
export function betName(id: string, wheel: WheelKind = 'european'): string {
  const [head = '', rest = ''] = id.split(':');
  const pockets = rest.split('-');
  switch (head) {
    case 'straight':
      return `Straight ${rest}`;
    case 'split':
      return `Split ${list(pockets)}`;
    case 'street':
      return `Street ${pockets[0]} to ${pockets.at(-1)}`;
    case 'trio':
      return `Trio ${list(pockets)}`;
    case 'corner':
      return `Corner ${list(pockets)}`;
    case 'sixline':
      return `Six line ${pockets[0]} to ${pockets.at(-1)}`;
    case 'basket':
      return wheel === 'european' ? 'First four' : 'Top line';
    case 'dozen':
      return `${ORDINAL[Number(rest)] ?? rest} dozen`;
    case 'column':
      return `Column ${rest}`;
    case 'neighbours': {
      const [, p, k = '2'] = id.split(':');
      return `Neighbours of ${p} ±${k}`;
    }
    case 'prison':
      return `${betName(rest, wheel)} (in prison)`;
    default:
      return CALL_NAMES[id] ?? EVEN_NAMES[id] ?? id;
  }
}

/** "pays 17 to 1", or the call-bet wording. */
export function paysText(id: string, wheel: WheelKind): string {
  const family = familyOf(id);
  if (family === null) return '';
  const n = payout(family, wheel);
  return n > 0 ? `pays ${n} to 1` : 'pays by component';
}

/** "$25", "$12.50". */
export function money(cents: number): string {
  const d = cents / 100;
  return `$${Number.isInteger(d) ? d.toLocaleString('en-US') : d.toFixed(2)}`;
}

/** Short text that fits a chip: "$25", "$1.5k". */
export function chipText(cents: number): string {
  const d = cents / 100;
  if (d >= 10_000) return `$${Math.round(d / 1000)}k`;
  if (d >= 1000) return `$${Number((d / 1000).toFixed(1))}k`;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

/** Colour of a pocket label. */
export function colorOfLabel(label: string): Color {
  const c = colorCode(pocketIndexOf(label));
  return c === 1 ? 'red' : c === 2 ? 'black' : 'green';
}
