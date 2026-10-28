// Shared helpers for the roulette integration tests (golden traces, reconcile, Monte Carlo,
// determinism, perf): real strategy compiler + real roulette plugin through the real harness.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildRunner,
  checkpointSchedule,
  chunkSizeFor,
  createInThreadTransport,
  createPool,
} from '@core/harness';
import { resultsDigest } from '@core/store';
import { coinRun } from '@core/testing';
import type { RunData } from '@core/contracts/run';
import type { BatchRunner } from '@core/harness';
import { normalizeDefinition } from '@core/experiment';
import type { NormalizedDefinition } from '@core/contracts/experiment';
import type { GamePlugin, Json } from '@core/contracts/game';
import { compileStrategy } from '@core/strategy';
import { roulette, STRATEGY_PRESET_IDS } from '@game/roulette';

export const plugin = roulette as unknown as GamePlugin<unknown, unknown, unknown, unknown>;
export const PRESET_IDS: readonly string[] = STRATEGY_PRESET_IDS;
export const GOLDEN_SEED = 20261028;
export const GOLDEN_BANKROLL = 500_000; // $5,000

export function presetJson(id: string): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, '../../src/game/roulette/presets', `${id}.json`), 'utf8'),
  );
}

export type RulesInput = string | { preset: string; overrides: Record<string, Json> };

export interface DefOptions {
  rules?: RulesInput;
  sessions?: number;
  maxRounds?: number;
  bankroll?: number;
  seed?: number;
  samples?: number;
  strategy?: unknown;
}

export function rouletteDef(presetId: string, o: DefOptions = {}): NormalizedDefinition {
  const r = normalizeDefinition(
    {
      schema: 1,
      name: `integration ${presetId}`,
      game: { id: 'roulette', rules: o.rules ?? 'european' },
      strategy: (o.strategy ?? presetJson(presetId)) as never,
      session: { bankroll: o.bankroll ?? GOLDEN_BANKROLL, maxRounds: o.maxRounds ?? 500 },
      run: {
        sessions: o.sessions ?? 1,
        seed: o.seed ?? GOLDEN_SEED,
        sampleSessions: o.samples ?? 0,
      },
    },
    { plugin: roulette, resolveStrategyRef: () => undefined },
  );
  if (!r.ok) throw new Error(`${presetId}: ${JSON.stringify(r.errors)}`);
  return r.definition;
}

export function runnerFor(def: NormalizedDefinition): BatchRunner {
  return buildRunner(
    plugin,
    def,
    checkpointSchedule(def.session.maxRounds, def.run.sessions, 'auto'),
    chunkSizeFor(def.session.maxRounds),
    def.run.sessions,
    compileStrategy,
  );
}

/** Run every chunk of a definition on this thread, calling `onBatch` per batch of chunks. */
export function runAll(
  def: NormalizedDefinition,
  onBatch: (out: ReturnType<BatchRunner['runBatch']>) => void,
  traceIndices: readonly number[] = [],
): BatchRunner {
  const runner = runnerFor(def);
  const chunks = Math.ceil(def.run.sessions / runner.chunkSize);
  for (let c = 0; c < chunks; c += 4) {
    const n = Math.min(4, chunks - c);
    const lo = c * runner.chunkSize;
    const hi = (c + n) * runner.chunkSize;
    onBatch(
      runner.runBatch(
        c,
        n,
        traceIndices.filter((i) => i >= lo && i < hi),
      ),
    );
  }
  return runner;
}

/** The harness-data-analysis.md §14.1 reference strategy in the real language: three stages, no stops. */
export const REFERENCE_3_STAGE = {
  schema: 1,
  id: 'perf-reference',
  name: 'Perf reference: warm, mart, flat',
  game: 'roulette',
  unit: 2500,
  progressions: {
    m: { kind: 'martingale', base: { units: 1 }, maxSteps: 6, onCap: 'reset', track: 'red' },
  },
  stages: [
    {
      id: 'warm',
      layout: [{ bet: 'red', amount: { units: 1 } }],
      rules: [{ when: { cmp: ['roundsInStage', '>=', 20] }, then: [{ goto: 'mart' }] }],
    },
    {
      id: 'mart',
      layout: [{ bet: 'red', amount: { prog: 'm' } }],
      rules: [
        { when: { cmp: ['net', '>=', 50_000] }, then: [{ goto: 'flat' }] },
        { when: { cmp: ['net', '<=', -150_000] }, then: [{ goto: 'warm' }] },
      ],
    },
    {
      id: 'flat',
      layout: [
        { bet: 'dozen:1', amount: { units: 1 } },
        { bet: 'dozen:2', amount: { units: 1 } },
      ],
      rules: [{ when: { cmp: ['roundsInStage', '>=', 50] }, then: [{ goto: 'warm' }] }],
    },
  ],
};

/** Run a definition to completion through the real pool + controller (in-thread workers). */
export async function runViaPool(
  def: NormalizedDefinition,
  workers: number,
  opts: { batchChunks?: number } = {},
): Promise<{ data: RunData; digest: string; ms: number }> {
  const pool = createPool({
    size: workers,
    spawn: () => createInThreadTransport(plugin, { hop: 'microtask' }),
  });
  const r = coinRun(def, { pool, plugin, batchChunks: opts.batchChunks });
  const settled = r.controller.settled();
  const t0 = performance.now();
  await r.controller.start();
  const status = await settled;
  const ms = performance.now() - t0;
  if (status !== 'done')
    throw new Error(`run ended ${status}: ${JSON.stringify(r.controller.error)}`);
  const data = await r.sink.load(r.controller.runId);
  pool.terminate();
  if (!data) throw new Error('no data');
  return { data, digest: await resultsDigest(data), ms };
}

export const PERF_ENABLED = process.env.PERF === '1';
