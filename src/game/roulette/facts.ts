// The roulette fact schema (game.md §9; grammar per reconciliation F2: greedy parameter last,
// `count:<n>:<target>`, `FactParam.type: 'target'`) as real data. `compileFact` is a stub (game WP).
import type { FactRef, FactSchema } from '@core/contracts/facts';
import type { FactAccessor } from '@core/contracts/game';
import type { HistoryPredicate } from '@core/contracts/strategy';
import { EXTRA_TARGETS, EVEN_MONEY_IDS, betDef, parseBet } from './bets';
import { columnOf, dozenOf, pocketLabels, sectorOf, wheelSpec, zeroPockets } from './pockets';
import type { RouletteRules, RouletteView, SpinHistory, WheelSpec, WindowCounter } from './types';

const target = { name: 'target', type: 'target' } as const;
const lastScope = { scope: 'round', nullable: true } as const;

export const rouletteFacts: FactSchema = {
  facts: [
    {
      name: 'lastNumber',
      label: 'last number',
      doc: 'The last pocket.',
      ...lastScope,
      value: { type: 'enum', values: pocketLabels('triple-zero') },
    },
    {
      name: 'lastColor',
      label: 'last colour',
      doc: 'Colour of the last pocket (zeros are green).',
      ...lastScope,
      value: { type: 'enum', values: ['red', 'black', 'green'] },
    },
    {
      name: 'lastParity',
      label: 'last parity',
      doc: 'Odd or even; a zero is neither.',
      ...lastScope,
      value: { type: 'enum', values: ['odd', 'even', 'zero'] },
    },
    {
      name: 'lastHalf',
      label: 'last half',
      doc: 'Low (1-18) or high (19-36); a zero is neither.',
      ...lastScope,
      value: { type: 'enum', values: ['low', 'high', 'zero'] },
    },
    {
      name: 'lastDozen',
      label: 'last dozen',
      doc: 'Which dozen; 0 for a zero pocket.',
      ...lastScope,
      value: { type: 'enum', values: [0, 1, 2, 3] },
    },
    {
      name: 'lastColumn',
      label: 'last column',
      doc: 'Which column; 0 for a zero pocket.',
      ...lastScope,
      value: { type: 'enum', values: [0, 1, 2, 3] },
    },
    {
      name: 'lastSector',
      label: 'last sector',
      doc: 'Wheel sector of the last pocket (european wheel only).',
      ...lastScope,
      value: { type: 'enum', values: ['voisins', 'tiers', 'orphelins'] },
    },
    {
      name: 'lastZero',
      label: 'last was a zero',
      doc: 'Whether the last pocket was a zero.',
      ...lastScope,
      value: { type: 'boolean' },
    },
    {
      name: 'spinsSince',
      label: 'spins since',
      doc: 'Spins since the target last hit; the round count if never (0 right after a hit).',
      scope: 'state',
      nullable: false,
      params: [target],
      value: { type: 'number', unit: 'count', integer: true, min: 0 },
    },
    {
      name: 'streak',
      label: 'streak of',
      doc: 'Consecutive most-recent spins that hit the target (0 if the last missed).',
      scope: 'state',
      nullable: false,
      params: [target],
      value: { type: 'number', unit: 'count', integer: true, min: 0 },
    },
    {
      name: 'count',
      label: 'hits in the last n spins',
      doc: 'Hits on the target in the last n spins (fewer spins so far: counts what exists).',
      scope: 'state',
      nullable: false,
      params: [{ name: 'n', type: 'number', min: 1, max: 1000 }, target],
      value: { type: 'number', unit: 'count', integer: true, min: 0, max: 1000 },
    },
    {
      name: 'hits',
      label: 'hits this session',
      doc: 'Hits on the target this session.',
      scope: 'state',
      nullable: false,
      params: [target],
      value: { type: 'number', unit: 'count', integer: true, min: 0 },
    },
    {
      name: 'zeroCount',
      label: 'zeros this session',
      doc: 'Same as hits:zero.',
      scope: 'state',
      nullable: false,
      value: { type: 'number', unit: 'count', integer: true, min: 0 },
    },
    {
      name: 'colorStreak',
      label: 'colour streak',
      doc: 'Length of the current run of equal colour (a zero run counts as green).',
      scope: 'state',
      nullable: false,
      value: { type: 'number', unit: 'count', integer: true, min: 0 },
    },
    {
      name: 'imprisoned',
      label: 'imprisoned on',
      doc: 'Amount imprisoned on that even-money bet (0 if none).',
      scope: 'state',
      nullable: false,
      params: [{ name: 'bet', type: 'bet' }],
      value: { type: 'number', unit: 'money', integer: true, min: 0 },
    },
  ],
  // bet-won / bet-lost / bet-push are derived by the core (reconciliation F1), not plugin events.
  events: [
    { name: 'spin', label: 'a spin', doc: 'Every round played, bets or not.' },
    { name: 'zero', label: 'a zero', doc: 'The pocket was a zero.' },
    {
      name: 'partage',
      label: 'la partage',
      doc: 'La partage halved an even-money bet.',
      params: [{ name: 'bet', type: 'bet' }],
    },
    {
      name: 'imprisoned',
      label: 'imprisoned',
      doc: 'An even-money bet went to prison.',
      params: [{ name: 'bet', type: 'bet' }],
    },
    {
      name: 'released',
      label: 'released',
      doc: 'An imprisoned bet was returned.',
      params: [{ name: 'bet', type: 'bet' }],
    },
    {
      name: 'prison-lost',
      label: 'lost in prison',
      doc: 'An imprisoned bet was lost.',
      params: [{ name: 'bet', type: 'bet' }],
    },
  ],
};

/** Targets that are not bet ids (game.md §9.1); `green` is an alias of `zero`. */
export const FACT_EXTRA_TARGETS = EXTRA_TARGETS;

export const RING = 1024;

export function createHistory(pockets: number): SpinHistory {
  return {
    ring: new Uint8Array(RING),
    len: 0,
    hitsByPocket: new Int32Array(pockets),
    lastSeen: new Int32Array(pockets).fill(-1),
    colorRun: 0,
    lastColor: 0,
    windows: [],
  };
}

/** Records one spin: O(registered windows). Called by `playRound` after settlement. */
export function recordSpin(h: SpinHistory, wheel: WheelSpec, pocket: number): void {
  const len = h.len;
  for (const w of h.windows) {
    w.count += w.mask[pocket]!;
    if (len >= w.n) w.count -= w.mask[h.ring[(len - w.n) % RING]!]!;
  }
  h.ring[len % RING] = pocket;
  h.hitsByPocket[pocket]!++;
  h.lastSeen[pocket] = len;
  const color = wheel.color[pocket]!;
  h.colorRun = len > 0 && color === h.lastColor ? h.colorRun + 1 : 1;
  h.lastColor = color;
  h.len = len + 1;
}

/** Registers (or finds) a running window; backfills from the ring, which is exact for n <= 1000. */
function windowOf(h: SpinHistory, target: string, n: number, mask: Uint8Array): WindowCounter {
  const found = h.windows.find((w) => w.n === n && w.target === target);
  if (found) return found;
  let count = 0;
  for (let i = Math.max(0, h.len - n); i < h.len; i++) count += mask[h.ring[i % RING]!]!;
  const w: WindowCounter = { target, n, mask, count };
  h.windows.push(w);
  return w;
}

/** A resolved fact target: canonical key plus the pockets it covers on this wheel. */
export interface ResolvedTarget {
  key: string;
  pockets: readonly number[];
  mask: Uint8Array;
}

/**
 * `zero`/`green` or any bet id available on the wheel (aliases folded). Throws `RangeError` for
 * anything else; the strategy validator turns that into `E_FACT_ARGS`.
 */
export function resolveTarget(raw: string, rules: RouletteRules): ResolvedTarget {
  const s = raw.trim().toLowerCase();
  const wheel = wheelSpec(rules.wheel);
  let key: string;
  let pockets: readonly number[];
  if (s === 'zero' || s === 'green') {
    key = 'zero';
    pockets = zeroPockets(rules.wheel);
  } else {
    const id = parseBet(s);
    const def = id === null || id.startsWith('prison:') ? null : betDef(id, rules.wheel);
    if (!id || !def) throw new RangeError(`roulette: unknown or unavailable target "${raw}"`);
    key = id;
    pockets = def.pockets;
  }
  const mask = new Uint8Array(wheel.n);
  for (const p of pockets) mask[p] = 1;
  return { key, pockets, mask };
}

const NO_ARGS = new Set([
  'lastNumber',
  'lastColor',
  'lastParity',
  'lastHalf',
  'lastDozen',
  'lastColumn',
  'lastSector',
  'lastZero',
  'zeroCount',
  'colorStreak',
]);

const COLOR = ['green', 'red', 'black'] as const;

/** The pocket of the spin just resolved, from the history ring (null before the first spin). */
const lastPocket = (v: RouletteView): number =>
  v.history.len === 0 ? -1 : v.history.ring[(v.history.len - 1) % RING]!;

function bad(ref: string, why: string): never {
  throw new RangeError(`roulette: bad fact ref "${ref}": ${why}`);
}

export function compileFact(ref: FactRef, rules: RouletteRules): FactAccessor<RouletteView> {
  const colon = ref.indexOf(':');
  const name = colon < 0 ? ref : ref.slice(0, colon);
  const args = colon < 0 ? null : ref.slice(colon + 1);
  const wheel = wheelSpec(rules.wheel);
  const europe = rules.wheel === 'european';
  if (NO_ARGS.has(name)) {
    if (args !== null) bad(ref, 'takes no arguments');
    switch (name) {
      case 'lastNumber':
        return (v) => (lastPocket(v) < 0 ? null : wheel.labels[lastPocket(v)]!);
      case 'lastColor':
        return (v) => (lastPocket(v) < 0 ? null : COLOR[wheel.color[lastPocket(v)]!]!);
      case 'lastParity':
        return (v) => {
          const p = lastPocket(v);
          return p < 0 ? null : p < 1 || p > 36 ? 'zero' : p % 2 === 1 ? 'odd' : 'even';
        };
      case 'lastHalf':
        return (v) => {
          const p = lastPocket(v);
          return p < 0 ? null : p < 1 || p > 36 ? 'zero' : p <= 18 ? 'low' : 'high';
        };
      case 'lastDozen':
        return (v) => (lastPocket(v) < 0 ? null : dozenOf(lastPocket(v)));
      case 'lastColumn':
        return (v) => (lastPocket(v) < 0 ? null : columnOf(lastPocket(v)));
      case 'lastSector':
        return (v) => (!europe || lastPocket(v) < 0 ? null : sectorOf(lastPocket(v)));
      case 'lastZero':
        return (v) => (lastPocket(v) < 0 ? null : wheel.color[lastPocket(v)] === 0);
      case 'zeroCount': {
        const zeros = zeroPockets(rules.wheel);
        return (v) => zeros.reduce((n, p) => n + v.history.hitsByPocket[p]!, 0);
      }
      default:
        return (v) => v.history.colorRun; // colorStreak
    }
  }
  if (args === null || args === '') bad(ref, 'missing argument');
  switch (name) {
    case 'hits': {
      const { pockets } = resolveTarget(args, rules);
      return (v) => pockets.reduce((n, p) => n + v.history.hitsByPocket[p]!, 0);
    }
    case 'spinsSince': {
      const { pockets } = resolveTarget(args, rules);
      return (v) => {
        const h = v.history;
        let last = -1;
        for (const p of pockets) if (h.lastSeen[p]! > last) last = h.lastSeen[p]!;
        return last < 0 ? h.len : h.len - 1 - last;
      };
    }
    case 'streak': {
      const { mask } = resolveTarget(args, rules);
      return (v) => {
        const h = v.history;
        const max = Math.min(h.len, RING);
        let n = 0;
        while (n < max && mask[h.ring[(h.len - 1 - n) % RING]!]) n++;
        return n;
      };
    }
    case 'count': {
      const c = args.indexOf(':');
      const nText = c < 0 ? args : args.slice(0, c);
      if (c < 0 || !/^[1-9]\d{0,3}$/.test(nText)) bad(ref, 'expected count:<n>:<target>');
      const n = Number(nText);
      if (n < 1 || n > 1000) bad(ref, 'n must be 1..1000');
      const { key, mask } = resolveTarget(args.slice(c + 1), rules);
      let seen: SpinHistory | null = null;
      let win: WindowCounter;
      return (v) => {
        if (v.history !== seen) {
          win = windowOf(v.history, key, n, mask);
          seen = v.history;
        }
        return win.count;
      };
    }
    case 'imprisoned': {
      const id = parseBet(args);
      if (id === null || !(EVEN_MONEY_IDS as readonly string[]).includes(id))
        bad(ref, 'expected an even-money bet');
      const prisonId = `prison:${id}`;
      return (v) => v.prison.reduce((n, b) => (b.bet === prisonId ? n + b.amount : n), 0);
    }
    default:
      return bad(ref, 'unknown fact');
  }
}

/**
 * The fact target a generic history predicate maps to (strategy.md §8.4), or null when it has no
 * single target (arrays, `lastColor in [black, green]`, state facts).
 */
export function historyTarget(p: HistoryPredicate): string | null {
  if ('event' in p) return p.event === 'zero' ? 'zero' : null;
  const v = Array.isArray(p.equals) ? null : p.equals;
  if (v === null) return null;
  switch (p.fact) {
    case 'lastColor':
      return v === 'red' || v === 'black' ? v : v === 'green' ? 'zero' : null;
    case 'lastParity':
      return v === 'odd' || v === 'even' ? v : v === 'zero' ? 'zero' : null;
    case 'lastHalf':
      return v === 'low' || v === 'high' ? v : v === 'zero' ? 'zero' : null;
    case 'lastDozen':
      return v === 0 ? 'zero' : v === 1 || v === 2 || v === 3 ? `dozen:${v}` : null;
    case 'lastColumn':
      return v === 0 ? 'zero' : v === 1 || v === 2 || v === 3 ? `column:${v}` : null;
    case 'lastNumber':
      return typeof v === 'string' ? `straight:${v}` : null;
    case 'lastSector':
      return v === 'voisins' || v === 'tiers' || v === 'orphelins' ? v : null;
    case 'lastZero':
      return v === true ? 'zero' : null;
    default:
      return null;
  }
}

/**
 * Optional hook (strategy.md §8.4): the plugin's indexed counter for a generic history predicate.
 * A predicate carries no kind (streak/count/since), so the accessor returned is `roundsSince`
 * (= `spinsSince:<target>`); the other two are `compileFact('streak:<t>')` / `count:<n>:<t>` with
 * `t = historyTarget(predicate)`. Null when the predicate has no single target on this wheel.
 */
export function compileHistory(
  predicate: HistoryPredicate,
  rules: RouletteRules,
): FactAccessor<RouletteView> | null {
  const t = historyTarget(predicate);
  if (t === null) return null;
  try {
    return compileFact(`spinsSince:${t}`, rules);
  } catch {
    return null;
  }
}
