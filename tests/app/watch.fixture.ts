// A real roulette run for the Watch/Gallery/Import tests: a preset through the real harness
// (in-thread transport), read back through a memory sink.
import {
  createInThreadTransport,
  createPool,
  createRunController,
  normalizeDefinition,
} from '@core';
import type { NormalizedDefinition } from '@core/contracts/experiment';
import type { RunData } from '@core/contracts/run';
import { createMemorySink } from '@core/testing';
import { roulette } from '@game/roulette';
import martingale from '../../src/game/roulette/presets/martingale-red.json';
import redMartThenFlat from '../../src/game/roulette/presets/red-mart-then-flat.json';

const presets: Record<string, unknown> = {
  'martingale-red': martingale,
  'red-mart-then-flat': redMartThenFlat,
};

export function rouletteDefinition(
  preset = 'red-mart-then-flat',
  over: {
    sessions?: number;
    maxRounds?: number;
    bankroll?: number;
    samples?: number;
    seed?: number;
  } = {},
): NormalizedDefinition {
  const r = normalizeDefinition(
    {
      schema: 1,
      name: `Test ${preset}`,
      game: { id: 'roulette', rules: 'european' },
      strategy: presets[preset] as never,
      session: { bankroll: over.bankroll ?? 200_000, maxRounds: over.maxRounds ?? 120 },
      run: {
        sessions: over.sessions ?? 12,
        seed: over.seed ?? 20261028,
        sampleSessions: over.samples ?? 4,
      },
    },
    { plugin: roulette, resolveStrategyRef: () => undefined },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.definition;
}

export async function rouletteRun(definition = rouletteDefinition()): Promise<RunData> {
  const pool = createPool({
    size: 1,
    spawn: () => createInThreadTransport(roulette, { hop: 'microtask' }),
  });
  const sink = createMemorySink(definition);
  const c = createRunController({
    definition,
    plugin: roulette,
    pool,
    sink,
    runId: 'run-watch-test',
    locks: null,
    warn: () => undefined,
  });
  const settled = c.settled();
  await c.start();
  const status = await settled;
  if (status !== 'done') throw new Error(`run ended ${status}`);
  const data = await sink.load('run-watch-test');
  pool.terminate();
  if (!data) throw new Error('no data');
  return data;
}
