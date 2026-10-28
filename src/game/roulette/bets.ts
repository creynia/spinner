// The bet catalog (game.md §3). The id lists and the catalog are real (UI pickers need them on day
// one); `parseBet` and `betDef` are stubs (game WP).
import type { BetCatalogEntry, BetId } from '@core/contracts/game';
import {
  SECTORS,
  WHEEL_ORDER,
  columnOf,
  dozenOf,
  isRed,
  pocketIndexOf,
  pocketLabels,
  pocketRank,
} from './pockets';
import type { BetDef, Family, PocketIndex, RouletteRules, WheelKind } from './types';

export const BET_FAMILIES = [
  'straight',
  'split',
  'street',
  'trio',
  'corner',
  'basket',
  'sixline',
  'even-money',
  'dozen',
  'column',
  'call',
  'neighbours',
] as const satisfies readonly Family[];

export const EVEN_MONEY_IDS = ['red', 'black', 'odd', 'even', 'low', 'high'] as const;
export const OUTSIDE_BET_IDS = [
  ...EVEN_MONEY_IDS,
  'dozen:1',
  'dozen:2',
  'dozen:3',
  'column:1',
  'column:2',
  'column:3',
] as const;
/** Fixed call-bet ids (european only); `neighbours:<p>:<k>` is parameterised. */
export const CALL_BET_IDS = ['voisins', 'tiers', 'orphelins', 'jeu-zero'] as const;
/** Zero rules apply to these (game.md §1.2). */
export const PRISON_BET_IDS = EVEN_MONEY_IDS.map((id) => `prison:${id}` as const);

/** Extra fact targets beyond bet ids (game.md §9.1). */
export const EXTRA_TARGETS = ['zero', 'green'] as const;

/** Zero-row splits and trios per wheel, in canonical pocket order (game.md §3.1). */
const ZERO_ROW: Record<WheelKind, { splits: string[]; trios: string[] }> = {
  european: {
    splits: ['split:0-1', 'split:0-2', 'split:0-3'],
    trios: ['trio:0-1-2', 'trio:0-2-3'],
  },
  american: {
    splits: ['split:0-1', 'split:0-2', 'split:00-2', 'split:00-3', 'split:0-00'],
    trios: ['trio:0-1-2', 'trio:0-00-2', 'trio:00-2-3'],
  },
  'triple-zero': {
    splits: ['split:0-1', 'split:000-2', 'split:00-3', 'split:0-000', 'split:00-000'],
    trios: ['trio:0-00-000'],
  },
};

/** Payout "X to 1" by family on a wheel (game.md §3.1; call bets pay by component). */
export function payout(family: Family, wheel: WheelKind): number {
  switch (family) {
    case 'straight':
      return 35;
    case 'split':
      return 17;
    case 'street':
    case 'trio':
      return 11;
    case 'corner':
      return 8;
    case 'basket':
      return wheel === 'european' ? 8 : wheel === 'american' ? 6 : 5;
    case 'sixline':
      return 5;
    case 'even-money':
      return 1;
    case 'dozen':
    case 'column':
      return 2;
    case 'call':
    case 'neighbours':
      return 0;
  }
}

/** Every fixed (non-parameterised, non-call) placeable bet id on a wheel, canonical form. */
export function fixedBetIds(wheel: WheelKind): BetId[] {
  const ids: BetId[] = pocketLabels(wheel).map((p) => `straight:${p}`);
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) ids.push(`split:${n}-${n + 1}`);
    if (n + 3 <= 36) ids.push(`split:${n}-${n + 3}`);
  }
  ids.push(...ZERO_ROW[wheel].splits);
  for (let n = 1; n <= 34; n += 3) ids.push(`street:${n}-${n + 1}-${n + 2}`);
  ids.push(...ZERO_ROW[wheel].trios);
  for (let n = 1; n <= 32; n++) {
    if (n % 3 !== 0) ids.push(`corner:${n}-${n + 1}-${n + 3}-${n + 4}`);
  }
  ids.push('basket');
  for (let n = 1; n <= 31; n += 3) {
    ids.push(`sixline:${[0, 1, 2, 3, 4, 5].map((k) => n + k).join('-')}`);
  }
  ids.push(...OUTSIDE_BET_IDS);
  return ids;
}

/** The family of a canonical bet id (by its prefix); null for `prison:*` and unknown prefixes. */
export function familyOf(id: BetId): Family | null {
  const head = id.split(':')[0] ?? '';
  switch (head) {
    case 'straight':
    case 'split':
    case 'street':
    case 'trio':
    case 'corner':
    case 'basket':
    case 'sixline':
    case 'dozen':
    case 'column':
    case 'neighbours':
      return head;
    case 'voisins':
    case 'tiers':
    case 'orphelins':
    case 'jeu-zero':
      return 'call';
    default:
      return (EVEN_MONEY_IDS as readonly string[]).includes(id) ? 'even-money' : null;
  }
}

function label(id: BetId, family: Family): string {
  const rest = id.split(':').slice(1).join(':');
  const pockets = rest.replaceAll('-', ' ');
  switch (family) {
    case 'straight':
      return `Straight ${rest}`;
    case 'split':
    case 'street':
    case 'trio':
    case 'corner':
    case 'sixline':
      return `${family[0]!.toUpperCase()}${family.slice(1)} ${pockets}`;
    case 'basket':
      return 'Basket';
    case 'dozen':
      return `Dozen ${rest}`;
    case 'column':
      return `Column ${rest}`;
    default:
      return id[0]!.toUpperCase() + id.slice(1);
  }
}

/** The catalog for these rules: the fixed ids plus one parameterised `neighbours:<p>:<k>` entry. */
export function catalog(rules: RouletteRules): BetCatalogEntry[] {
  const entry = (id: BetId, family: Family): BetCatalogEntry => {
    const pays = payout(family, rules.wheel);
    return {
      id,
      label: label(id, family),
      category: family,
      limitClass: family === 'call' || family === 'neighbours' ? 'call' : insideOrOutside(family),
      description: pays > 0 ? `Pays ${pays} to 1` : 'Pays by component chips',
      persistent: false,
      contract: false,
    };
  };
  const list = fixedBetIds(rules.wheel).map((id) => entry(id, familyOf(id)!));
  if (rules.wheel === 'european') {
    list.push(...CALL_BET_IDS.map((id) => entry(id, 'call')));
    list.push({
      ...entry('neighbours:<p>:<k>', 'neighbours'),
      label: 'Neighbours',
      description: 'A pocket and k neighbours each side (k = 1..9); 35 to 1 per piece',
      parameters: { p: 'number', k: 'number' },
    });
  }
  return list;
}

function insideOrOutside(family: Family): 'inside' | 'outside' {
  return family === 'even-money' || family === 'dozen' || family === 'column'
    ? 'outside'
    : 'inside';
}

const WHEELS: readonly WheelKind[] = ['european', 'american', 'triple-zero'];

/** Every canonical non-parameterised id on any wheel (the legal set `parseBet` checks against). */
const KNOWN: ReadonlySet<string> = new Set([
  ...WHEELS.flatMap((w) => fixedBetIds(w)),
  ...CALL_BET_IDS,
]);
const FIXED: Record<WheelKind, ReadonlySet<string>> = {
  european: new Set(fixedBetIds('european')),
  american: new Set(fixedBetIds('american')),
  'triple-zero': new Set(fixedBetIds('triple-zero')),
};

const ALIASES: Readonly<Record<string, string>> = {
  'first-four': 'basket',
  'top-line': 'basket',
  '1-18': 'low',
  manque: 'low',
  '19-36': 'high',
  passe: 'high',
  rouge: 'red',
  noir: 'black',
  pair: 'even',
  impair: 'odd',
  'voisins-du-zero': 'voisins',
  'tiers-du-cylindre': 'tiers',
  'zero-spiel': 'jeu-zero',
  'jeu-0': 'jeu-zero',
};

/** '0', '00', '000' or 1..36 without a leading zero. */
function isPocketLabel(s: string): boolean {
  if (s === '0' || s === '00' || s === '000') return true;
  return /^[1-9]\d?$/.test(s) && Number(s) <= 36;
}

const sortPockets = (tokens: readonly string[]): string[] =>
  [...tokens].sort((a, b) => pocketRank(a) - pocketRank(b));

const range = (from: number, count: number): string[] =>
  Array.from({ length: count }, (_, i) => String(from + i));

/**
 * Canonical id (aliases folded), wheel-independent; null when unparseable (game.md §3.2). Case
 * insensitive, trims, ignores accents. The result is a legal bet of its family on some wheel
 * (`split:17-21` is null); whether the current wheel has it is `betDef` / `available`.
 */
export function parseBet(input: string): BetId | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (s.length === 0 || s.length > 80) return null;
  if (Object.hasOwn(ALIASES, s)) s = ALIASES[s]!;
  if (isPocketLabel(s)) return `straight:${s}`;
  if (KNOWN.has(s)) return s;
  const parts = s.split(':');
  const head = parts[0]!;
  if (head === 'prison') {
    const inner = parts.length > 1 ? parseBet(parts.slice(1).join(':')) : null;
    return inner !== null && (EVEN_MONEY_IDS as readonly string[]).includes(inner)
      ? `prison:${inner}`
      : null;
  }
  if (head === 'neighbours') {
    if (parts.length < 2 || parts.length > 3) return null;
    const p = parts[1]!;
    if (!isPocketLabel(p) || p === '00' || p === '000') return null;
    const k = parts.length === 3 ? parts[2]! : '2';
    return /^[1-9]$/.test(k) ? `neighbours:${p}:${k}` : null;
  }
  if (parts.length !== 2) return null;
  if (head === 'straight') return null; // handled above through KNOWN; other pockets are illegal
  if (!['split', 'street', 'trio', 'corner', 'sixline'].includes(head)) return null;
  let tokens = parts[1]!.split('-');
  if (!tokens.every(isPocketLabel)) return null;
  const first = Number(tokens[0]);
  if (head === 'street' && tokens.length === 1 && first >= 1) tokens = range(first, 3);
  else if (head === 'sixline' && tokens.length === 1 && first >= 1) tokens = range(first, 6);
  else if (
    head === 'sixline' &&
    tokens.length === 2 &&
    first >= 1 &&
    Number(tokens[1]) === first + 5
  )
    tokens = range(first, 6);
  const id = `${head}:${sortPockets(tokens).join('-')}`;
  return KNOWN.has(id) ? id : null;
}

// ------------------------------------------------------------------ bet definitions per wheel

const idx = (tokens: readonly string[]): PocketIndex[] => sortPockets(tokens).map(pocketIndexOf);

const CALL_COMPONENTS: Record<
  (typeof CALL_BET_IDS)[number],
  readonly (readonly [spot: string, weight: number])[]
> = {
  voisins: [
    ['trio:0-2-3', 2],
    ['split:4-7', 1],
    ['split:12-15', 1],
    ['split:18-21', 1],
    ['split:19-22', 1],
    ['split:32-35', 1],
    ['corner:25-26-28-29', 2],
  ],
  tiers: [
    ['split:5-8', 1],
    ['split:10-11', 1],
    ['split:13-16', 1],
    ['split:23-24', 1],
    ['split:27-30', 1],
    ['split:33-36', 1],
  ],
  orphelins: [
    ['straight:1', 1],
    ['split:6-9', 1],
    ['split:14-17', 1],
    ['split:17-20', 1],
    ['split:31-34', 1],
  ],
  'jeu-zero': [
    ['split:0-3', 1],
    ['split:12-15', 1],
    ['straight:26', 1],
    ['split:32-35', 1],
  ],
};

function evenMoneyPockets(id: string): PocketIndex[] {
  const all = Array.from({ length: 36 }, (_, i) => i + 1);
  switch (id) {
    case 'red':
      return all.filter(isRed);
    case 'black':
      return all.filter((n) => !isRed(n));
    case 'odd':
      return all.filter((n) => n % 2 === 1);
    case 'even':
      return all.filter((n) => n % 2 === 0);
    case 'low':
      return all.filter((n) => n <= 18);
    default:
      return all.filter((n) => n >= 19);
  }
}

function basketPockets(wheel: WheelKind): PocketIndex[] {
  return wheel === 'european'
    ? [0, 1, 2, 3]
    : wheel === 'american'
      ? [0, 37, 1, 2, 3]
      : [0, 37, 38, 1, 2, 3];
}

const limitClassOf = (family: Family): BetDef['limitClass'] =>
  family === 'call' || family === 'neighbours' ? 'call' : insideOrOutside(family);

function buildDef(id: BetId, wheel: WheelKind): BetDef | null {
  const family = familyOf(id);
  if (family === null) return null;
  const base = { id, family, limitClass: limitClassOf(family), evenMoney: family === 'even-money' };
  const rest = id.split(':').slice(1).join(':');
  switch (family) {
    case 'call': {
      if (wheel !== 'european') return null;
      const comps = CALL_COMPONENTS[id as (typeof CALL_BET_IDS)[number]];
      const components = comps.map(([spot, weight]) => ({ spot, weight }));
      const pockets = [...SECTORS[id as keyof typeof SECTORS]].sort((a, b) => a - b);
      return {
        ...base,
        pockets,
        pays: 0,
        components,
        pieces: components.reduce((n, c) => n + c.weight, 0),
      };
    }
    case 'neighbours': {
      if (wheel !== 'european') return null;
      const [p, k] = rest.split(':');
      const order = WHEEL_ORDER.european;
      const at = order.indexOf(p as never);
      if (at < 0 || !/^[1-9]$/.test(k ?? '')) return null;
      const kk = Number(k);
      const pockets: PocketIndex[] = [];
      for (let d = -kk; d <= kk; d++) pockets.push(Number(order[(at + d + 37 * 2) % 37]));
      const components = pockets.map((q) => ({ spot: `straight:${q}`, weight: 1 }));
      return {
        ...base,
        pockets: [...pockets].sort((a, b) => a - b),
        pays: 0,
        components,
        pieces: 2 * kk + 1,
      };
    }
    case 'basket':
      return { ...base, pockets: basketPockets(wheel), pays: payout(family, wheel), pieces: 1 };
    case 'even-money':
      return { ...base, pockets: evenMoneyPockets(id), pays: 1, pieces: 1 };
    case 'dozen': {
      const d = Number(rest);
      return {
        ...base,
        pockets: Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => dozenOf(n) === d),
        pays: 2,
        pieces: 1,
      };
    }
    case 'column': {
      const c = Number(rest);
      return {
        ...base,
        pockets: Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => columnOf(n) === c),
        pays: 2,
        pieces: 1,
      };
    }
    default: {
      if (!FIXED[wheel].has(id)) return null;
      return { ...base, pockets: idx(rest.split('-')), pays: payout(family, wheel), pieces: 1 };
    }
  }
}

const DEFS: Record<WheelKind, Map<string, BetDef | null>> = {
  european: new Map(),
  american: new Map(),
  'triple-zero': new Map(),
};

/** A bet resolved for one wheel (frozen, cached); null when the wheel does not have it. */
export function betDef(id: BetId, wheel: WheelKind): BetDef | null {
  const cache = DEFS[wheel];
  let def = cache.get(id);
  if (def === undefined) {
    const built = buildDef(id, wheel);
    def = built && Object.freeze({ ...built, pockets: Object.freeze(built.pockets) });
    if (def) cache.set(id, def); // misses are cheap to recompute; never cache junk ids
  }
  return def;
}
