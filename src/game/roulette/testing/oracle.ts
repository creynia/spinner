// An independent oracle for the roulette rules, written from plain English (game.md §13.1). It
// imports nothing from bets.ts, netvector.ts or engine.ts: ids are read straight from their text.
// Test helper only.

export type OracleWheel = 'european' | 'american' | 'triple-zero';
export interface OracleRules {
  wheel: OracleWheel;
  laPartage?: boolean;
  enPrison?: boolean;
  reimprison?: boolean;
}

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const EU_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

/** Pocket label for an index: 37 is 00, 38 is 000. */
export const labelOf = (p: number): string => (p === 37 ? '00' : p === 38 ? '000' : String(p));
const indexOf = (label: string): number =>
  label === '00' ? 37 : label === '000' ? 38 : Number(label);

export const pocketCount = (w: OracleWheel): number =>
  w === 'european' ? 37 : w === 'american' ? 38 : 39;

/** Plain pieces of a call bet: [bet id, weight]. */
export function oracleComponents(id: string): [string, number][] | null {
  const split = (a: number, b: number): [string, number] => [`split:${a}-${b}`, 1];
  if (id === 'voisins')
    return [
      ['trio:0-2-3', 2],
      split(4, 7),
      split(12, 15),
      split(18, 21),
      split(19, 22),
      split(32, 35),
      ['corner:25-26-28-29', 2],
    ];
  if (id === 'tiers')
    return [split(5, 8), split(10, 11), split(13, 16), split(23, 24), split(27, 30), split(33, 36)];
  if (id === 'orphelins')
    return [['straight:1', 1], split(6, 9), split(14, 17), split(17, 20), split(31, 34)];
  if (id === 'jeu-zero') return [split(0, 3), split(12, 15), ['straight:26', 1], split(32, 35)];
  const m = /^neighbours:(\d+):(\d)$/.exec(id);
  if (m) {
    const at = EU_ORDER.indexOf(Number(m[1]));
    const k = Number(m[2]);
    const out: [string, number][] = [];
    for (let d = -k; d <= k; d++) out.push([`straight:${EU_ORDER[(at + d + 37) % 37]}`, 1]);
    return out;
  }
  return null;
}

/** Number of pieces a call bet's total is divided into (1 for everything else). */
export const oraclePieces = (id: string): number =>
  oracleComponents(id)?.reduce((n, c) => n + c[1], 0) ?? 1;

const isEven = (id: string): boolean => ['red', 'black', 'odd', 'even', 'low', 'high'].includes(id);

/** Does the single (non-call) bet `id` cover `pocket`? */
function covers(id: string, pocket: number, w: OracleWheel): boolean {
  if (id === 'basket') {
    const set = [0, 1, 2, 3];
    if (w !== 'european') set.push(37);
    if (w === 'triple-zero') set.push(38);
    return set.includes(pocket);
  }
  const n = pocket;
  const real = n >= 1 && n <= 36;
  switch (id) {
    case 'red':
      return real && REDS.has(n);
    case 'black':
      return real && !REDS.has(n);
    case 'odd':
      return real && n % 2 === 1;
    case 'even':
      return real && n % 2 === 0;
    case 'low':
      return real && n <= 18;
    case 'high':
      return real && n >= 19;
  }
  const [kind, rest] = id.split(':') as [string, string];
  if (kind === 'dozen') return real && Math.floor((n - 1) / 12) + 1 === Number(rest);
  if (kind === 'column') return real && ((n - 1) % 3) + 1 === Number(rest);
  return rest.split('-').map(indexOf).includes(pocket);
}

/** Profit per 1 staked when a single bet wins. */
function pays(id: string, w: OracleWheel): number {
  if (id === 'basket') return w === 'european' ? 8 : w === 'american' ? 6 : 5;
  if (isEven(id)) return 1;
  const [kind, rest] = id.split(':') as [string, string];
  if (kind === 'dozen' || kind === 'column') return 2;
  const count = rest.split('-').length;
  return 36 / count - 1; // 1 -> 35, 2 -> 17, 3 -> 11, 4 -> 8, 6 -> 5
}

export interface Expected {
  profit: number;
  result: 'win' | 'lose' | 'push' | 'stays';
}

/** Expected resolution of `amount` cents on bet `id` when `pocket` comes up (first spin). */
export function oracle(id: string, amount: number, pocket: number, r: OracleRules): Expected {
  const zeroRule = pocket === 0 && r.wheel === 'european' && isEven(id);
  if (zeroRule && r.laPartage)
    return { profit: -(amount - Math.floor(amount / 2)), result: 'lose' };
  if (zeroRule && r.enPrison) return { profit: 0, result: 'stays' };
  const comps = oracleComponents(id);
  let profit = 0;
  if (comps) {
    const piece = amount / oraclePieces(id);
    for (const [spot, weight] of comps)
      profit += covers(spot, pocket, r.wheel)
        ? piece * weight * pays(spot, r.wheel)
        : -piece * weight;
  } else {
    profit = covers(id, pocket, r.wheel) ? amount * pays(id, r.wheel) : -amount;
  }
  return { profit, result: profit > 0 ? 'win' : profit < 0 ? 'lose' : 'push' };
}

/** Expected resolution of an imprisoned bet on the NEXT spin. */
export function oraclePrison(id: string, amount: number, pocket: number, r: OracleRules): Expected {
  if (covers(id, pocket, r.wheel)) return { profit: 0, result: 'push' };
  if (pocket === 0 && r.reimprison) return { profit: 0, result: 'stays' };
  return { profit: -amount, result: 'lose' };
}

/** All fixed bet ids of a wheel, enumerated here from the geometry of the layout. */
export function oracleIds(w: OracleWheel): string[] {
  const ids: string[] = [];
  const zeros = w === 'european' ? ['0'] : w === 'american' ? ['0', '00'] : ['0', '00', '000'];
  for (const z of zeros) ids.push(`straight:${z}`);
  for (let n = 1; n <= 36; n++) ids.push(`straight:${n}`);
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) ids.push(`split:${n}-${n + 1}`);
    if (n <= 33) ids.push(`split:${n}-${n + 3}`);
  }
  const zeroSplits: Record<OracleWheel, string[]> = {
    european: ['0-1', '0-2', '0-3'],
    american: ['0-1', '0-2', '00-2', '00-3', '0-00'],
    'triple-zero': ['0-1', '000-2', '00-3', '0-000', '00-000'],
  };
  for (const s of zeroSplits[w]) ids.push(`split:${s}`);
  for (let r = 0; r < 12; r++) ids.push(`street:${3 * r + 1}-${3 * r + 2}-${3 * r + 3}`);
  const trios: Record<OracleWheel, string[]> = {
    european: ['0-1-2', '0-2-3'],
    american: ['0-1-2', '0-00-2', '00-2-3'],
    'triple-zero': ['0-00-000'],
  };
  for (const t of trios[w]) ids.push(`trio:${t}`);
  for (let r = 0; r < 11; r++)
    for (const c of [1, 2]) {
      const n = 3 * r + c;
      ids.push(`corner:${n}-${n + 1}-${n + 3}-${n + 4}`);
    }
  ids.push('basket');
  for (let r = 0; r < 11; r++) {
    const n = 3 * r + 1;
    ids.push(`sixline:${[0, 1, 2, 3, 4, 5].map((i) => n + i).join('-')}`);
  }
  ids.push('red', 'black', 'odd', 'even', 'low', 'high');
  for (const d of [1, 2, 3]) ids.push(`dozen:${d}`, `column:${d}`);
  return ids;
}
