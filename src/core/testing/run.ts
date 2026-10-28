// Helpers that run a definition over the `coin` game through the real pool, controller and
// in-thread transport (tests only).
import type { NormalizedDefinition } from '../contracts/experiment';
import type { GamePlugin } from '../contracts/game';
import type { RunData } from '../contracts/run';
import {
  createInThreadTransport,
  createPool,
  createRunController,
  type HarnessRunController,
  type RunControllerOptions,
  type SimPool,
} from '../harness';
import { coin } from './coin';
import { compileTestStrategy } from './strategy';
import { createMemorySink, type MemorySink } from './sink';

export function coinPool(size: number, hop: 'timeout' | 'microtask' = 'microtask'): SimPool {
  return createPool({
    size,
    spawn: () => createInThreadTransport(coin, { compile: compileTestStrategy, hop }),
  });
}

export interface CoinRun {
  controller: HarnessRunController;
  sink: MemorySink;
  pool: SimPool;
}

export function coinRun(
  definition: NormalizedDefinition,
  opts: {
    workers?: number;
    batchChunks?: number;
    sink?: MemorySink;
    pool?: SimPool;
    runId?: string;
    plugin?: GamePlugin<unknown, unknown, unknown, unknown>;
    controller?: Partial<RunControllerOptions>;
  } = {},
): CoinRun {
  const pool = opts.pool ?? coinPool(opts.workers ?? 1);
  const sink = opts.sink ?? createMemorySink(definition);
  const controller = createRunController({
    definition,
    plugin: opts.plugin ?? coin,
    pool,
    sink,
    runId: opts.runId ?? 'run-test',
    locks: null,
    warn: () => undefined,
    forceBatchChunks: opts.batchChunks,
    ...opts.controller,
  });
  return { controller, sink, pool };
}

/** Run to completion and return the stored data (read back through the sink). */
export async function runCoinToEnd(
  definition: NormalizedDefinition,
  opts: Parameters<typeof coinRun>[1] = {},
): Promise<RunData & { run: CoinRun }> {
  const run = coinRun(definition, opts);
  const settled = run.controller.settled();
  await run.controller.start();
  const status = await settled;
  if (status !== 'done') {
    throw new Error(`run ended ${status}: ${JSON.stringify(run.controller.error)}`);
  }
  const data = await run.sink.load(run.controller.runId);
  if (!data) throw new Error('no data in sink');
  if (!opts.pool) run.pool.terminate();
  return Object.assign(data, { run });
}
