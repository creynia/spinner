// A stand-in roulette plugin and strategy hooks for the definition-layer tests (core cannot import
// the real game). Only what `normalizeDefinition` touches is implemented.
import type { GamePlugin, Json, RulesRef } from '../../contracts/game';
import type { NormalizeContext } from '../../contracts/experiment';
import type { StrategyDefinition } from '../../contracts/strategy';
import type { StrategyHooks } from '../normalize';

const DEFAULTS: Record<string, Record<string, Json>> = {
  european: { laPartage: false, enPrison: false },
  american: { laPartage: false, enPrison: false },
};

function normalize(p: string | RulesRef): RulesRef {
  const ref: RulesRef = typeof p === 'string' ? { preset: p, overrides: {} } : p;
  const base = DEFAULTS[ref.preset];
  if (!base) throw new Error(`unknown preset "${ref.preset}"`);
  const overrides: Record<string, Json> = {};
  for (const k of Object.keys(ref.overrides).sort()) {
    const v = ref.overrides[k] as Json;
    if (!(k in base)) throw new Error(`unknown rule "${k}"`);
    if (v !== base[k]) overrides[k] = v;
  }
  return { preset: ref.preset, overrides };
}

export const stubRoulette = {
  id: 'roulette',
  name: 'Stub roulette',
  version: '0.0.0',
  rules: {
    presets: {},
    defaultPreset: 'european',
    resolve: (p?: string | RulesRef) => ({ ...normalize(p ?? 'european') }),
    normalize,
    describe: () => [],
  },
  bets: {
    catalog: () => [],
    parse: (id: string) => (['red', 'black'].includes(id) ? id : null),
    available: () => true,
  },
  pace: (r: unknown) => ({
    roundsPerHour: (r as RulesRef).preset === 'american' ? 38 : 40,
    label: 'live',
  }),
  limits: () => ({ min: 2500, max: 500_000 }),
  facts: { facts: {}, events: {} },
  compileFact: () => () => 0,
} as unknown as GamePlugin<unknown, unknown, unknown, unknown>;

export const LIBRARY: Record<string, StrategyDefinition> = {
  'flat-red': {
    schema: 1,
    id: 'flat-red',
    name: 'Flat red',
    game: 'roulette',
    unit: 2500,
    stages: [{ id: 'main', layout: [{ bet: 'red', amount: { units: 1 } }], rules: [] }],
  },
};

export const ctx: NormalizeContext = {
  plugin: stubRoulette,
  resolveStrategyRef: (ref) => LIBRARY[ref],
};

/** Stands in for `normalizeStrategy` (strategy.md §13.4): drops the `rules: []` default. */
export const hooks: StrategyHooks = {
  normalizeStrategy(def) {
    const copy = structuredClone(def);
    for (const st of copy.stages) if (st.rules && st.rules.length === 0) delete st.rules;
    return copy;
  },
  validateStrategy: () => [],
};
