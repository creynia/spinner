// `window.__results.start(opts)`: starts a real roulette run from the e2e tests (the Define screen is
// another work package). Installed only outside production builds or with `?e2e` in the URL.
import { normalizeDefinition, type NormalizedDefinition } from '@core';
import { game } from '../../services/game';
import { startRun } from '../../services/runs';

export interface E2eStartOptions {
  name?: string;
  strategy?: 'flat' | 'martingale';
  sessions?: number;
  maxRounds?: number;
  seed?: number;
  bankroll?: number;
}

const FLAT = {
  schema: 1,
  id: 'flat-red',
  name: 'Flat: red',
  game: 'roulette',
  unit: 2500,
  stages: [{ id: 'flat', layout: [{ bet: 'red', amount: { units: 1 } }], rules: [] }],
};
const MARTINGALE = {
  schema: 1,
  id: 'martingale-red',
  name: 'Martingale: red',
  game: 'roulette',
  unit: 2500,
  progressions: {
    m: { kind: 'martingale', base: { units: 1 }, maxSteps: 8, onCap: 'reset', track: 'red' },
  },
  stages: [{ id: 'play', layout: [{ bet: 'red', amount: { prog: 'm' } }], rules: [] }],
};

export function e2eDefinition(o: E2eStartOptions = {}): NormalizedDefinition {
  const res = normalizeDefinition(
    {
      schema: 1,
      name: o.name ?? (o.strategy === 'martingale' ? 'Martingale on red' : 'Flat on red'),
      game: { id: 'roulette', rules: 'european' },
      strategy: (o.strategy === 'martingale' ? MARTINGALE : FLAT) as never,
      session: { bankroll: o.bankroll ?? 500_000, maxRounds: o.maxRounds ?? 100 },
      run: { sessions: o.sessions ?? 2000, seed: o.seed ?? 7 },
    },
    { plugin: game.plugin, resolveStrategyRef: () => undefined },
  );
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.definition;
}

export function installResultsHook(): void {
  if (typeof location === 'undefined') return;
  if (import.meta.env.MODE === 'production' && !location.search.includes('e2e')) return;
  (window as unknown as { __results: unknown }).__results = {
    start: (o?: E2eStartOptions) => startRun(e2eDefinition(o)),
  };
}
