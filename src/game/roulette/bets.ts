// The bet catalog (game.md §3). The id lists and the catalog are real (UI pickers need them on day
// one); `parseBet` and `betDef` are stubs (game WP).
import type { BetCatalogEntry, BetId } from '@core/contracts/game';
import { pocketLabels } from './pockets';
import type { BetDef, Family, RouletteRules, WheelKind } from './types';

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

/** Canonical id (aliases folded), wheel-independent; null when unparseable (game.md §3.2). */
export function parseBet(_id: string): BetId | null {
  throw new Error('TODO(game)');
}

/** A bet resolved for one wheel; null when the wheel does not have it. */
export function betDef(_id: BetId, _wheel: WheelKind): BetDef | null {
  throw new Error('TODO(game)');
}
