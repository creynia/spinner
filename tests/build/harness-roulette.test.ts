// Real roulette through the harness: 1 vs 2 workers are byte-identical (real strategy interpreter).
import { describe, expect, it } from 'vitest';
import type { GamePlugin } from '@core/contracts/game';
import { ENDED_BY } from '@core/contracts/run';
import { createInThreadTransport, createPool } from '@core/harness';
import { FLAT_COIN, coinDefinition, coinRun, digestRunData } from '@core/testing';
import { roulette } from '@game/roulette';

const plugin = roulette as unknown as GamePlugin<unknown, unknown, unknown, unknown>;

function definition() {
  const def = coinDefinition({
    strategy: {
      ...FLAT_COIN,
      game: 'roulette',
      unit: 2500,
      stages: [
        {
          id: 'main',
          layout: [
            { bet: 'red', amount: { units: 1 } },
            { bet: 'straight:17', amount: { units: 1 } },
          ],
        },
      ],
    },
    sessions: 300,
    maxRounds: 60,
    bankroll: 500_000,
  });
  def.game = { id: 'roulette', rules: { preset: 'european', overrides: {} } };
  return def;
}

async function run(workers: number, batchChunks: number): Promise<string> {
  const def = definition();
  const pool = createPool({
    size: workers,
    spawn: () => createInThreadTransport(plugin, { hop: 'microtask' }),
  });
  const r = coinRun(def, { pool, batchChunks, plugin });
  const settled = r.controller.settled();
  await r.controller.start();
  expect(await settled).toBe('done');
  const data = await r.sink.load(r.controller.runId);
  pool.terminate();
  expect(data!.sessions).toBe(300);
  expect(data!.summary.roundsPlayed[0]).toBe(60);
  // Two bets on the table every round: money really moved.
  for (let i = 0; i < data!.sessions; i++) expect(data!.summary.wagered[i]).toBeGreaterThan(0);
  expect(data!.summary.wagered[0]).toBe(60 * 2 * 2500);
  return digestRunData(data!);
}

describe('roulette determinism', () => {
  it('1 worker and 2 workers with other batch sizes give identical bytes', async () => {
    expect(await run(2, 1)).toBe(await run(1, 64));
  });
});

describe('plugin exception in createState', () => {
  it('ends every session with `error` and records the message, the run still completes', async () => {
    const broken = {
      ...plugin,
      createState: () => {
        throw new Error('createState exploded');
      },
    } as unknown as GamePlugin<unknown, unknown, unknown, unknown>;
    const def = definition();
    const pool = createPool({
      size: 1,
      spawn: () => createInThreadTransport(broken, { hop: 'microtask' }),
    });
    const r = coinRun(def, { pool, plugin: broken });
    const settled = r.controller.settled();
    await r.controller.start();
    expect(await settled).toBe('done');
    const data = await r.sink.load(r.controller.runId);
    pool.terminate();
    for (let i = 0; i < data!.sessions; i++) {
      expect(data!.summary.endedBy[i]).toBe(ENDED_BY.error);
      expect(data!.summary.roundsPlayed[i]).toBe(0);
      expect(data!.summary.wagered[i]).toBe(0);
    }
    // The error list is capped (MAX_STORED_ERRORS); the summary column above is the full count.
    expect(data!.chunkStats.errorCount).toBeGreaterThan(0);
    expect(data!.chunkStats.errors[0]).toMatchObject({
      code: 'session-exception',
      message: 'createState exploded',
    });
  });
});
