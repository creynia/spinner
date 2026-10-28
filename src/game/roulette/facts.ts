// The roulette fact schema (game.md §9; grammar per reconciliation F2: greedy parameter last,
// `count:<n>:<target>`, `FactParam.type: 'target'`) as real data. `compileFact` is a stub (game WP).
import type { FactRef, FactSchema, FactValue } from '@core/contracts/facts';
import type { RoundOutcome } from '@core/contracts/game';
import { EXTRA_TARGETS } from './bets';
import { pocketLabels } from './pockets';
import type { RouletteRules, RouletteView } from './types';

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

export function compileFact(
  _ref: FactRef,
  _rules: RouletteRules,
): (view: RouletteView, last: RoundOutcome | null) => FactValue | null {
  throw new Error('TODO(game)');
}
