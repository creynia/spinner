// core/harness: session loop, worker handler, in-thread transport, pool, batches, run controller
// (owner: core-harness). WP0 ships throwing stubs, except that the worker handler already answers
// `ping` with `pong` (architecture.md §12.1.7) so the worker path is proven end to end.
import type { GamePlugin } from '../contracts/game';
import type { NormalizedDefinition } from '../contracts/experiment';
import { CORE_VERSION } from '../contracts/version';
import { SIM_PROTOCOL, type FromSim, type SimTransport, type ToSim } from '../contracts/protocol';
import type { RunController, RunSink } from '../contracts/run';

/** The handler a worker (or the in-thread transport) runs: one message in, replies out. */
export type WorkerHandler = (
  msg: ToSim,
  reply: (msg: FromSim, transfer?: Transferable[]) => void,
) => void;

/** A fixed set of simulation workers behind `SimTransport`s (harness-data-analysis.md §5.2). */
export interface SimPool {
  readonly size: number;
  terminate(): void;
}

/**
 * Handler for the sim worker. WP0: `ping` -> `pong { protocol, coreVersion, game }`; every other
 * message is answered with `error { code: 'not-implemented' }` until core-harness lands.
 */
export function createWorkerHandler(
  plugin: GamePlugin<unknown, unknown, unknown, unknown>,
): WorkerHandler {
  return (msg, reply) => {
    if (msg.t === 'ping') {
      reply({
        t: 'pong',
        protocol: SIM_PROTOCOL,
        coreVersion: CORE_VERSION,
        game: { id: plugin.id, version: plugin.version },
      });
    } else if (msg.t !== 'dispose') {
      reply({ t: 'error', code: 'not-implemented', message: 'TODO(core-harness)' });
    }
  };
}

/** Same handler through a microtask hop; Vitest in node and the browser fallback. */
export function createInThreadTransport(
  _plugin: GamePlugin<unknown, unknown, unknown, unknown>,
): SimTransport {
  throw new Error('TODO(core-harness)');
}

/** `spawn` is `spawnSimWorker` from `src/workers/spawn.ts`, injected by the app. */
export function createPool(_opts: { spawn: () => SimTransport; size: number }): SimPool {
  throw new Error('TODO(core-harness)');
}

export function createRunController(_opts: {
  definition: NormalizedDefinition;
  plugin: GamePlugin<unknown, unknown, unknown, unknown>;
  pool: SimPool;
  sink: RunSink;
  runId?: string;
}): RunController {
  throw new Error('TODO(core-harness)');
}

/** Checkpoint schedule (harness-data-analysis.md §4). */
export function checkpointSchedule(
  _maxRounds: number,
  _sessions: number,
  _spec: 'auto' | number[],
): Int32Array {
  throw new Error('TODO(core-harness)');
}

/** Sessions per chunk (harness-data-analysis.md §5.3). */
export function chunkSizeFor(_maxRounds: number): number {
  throw new Error('TODO(core-harness)');
}

/** Deterministic sample session indices (harness-data-analysis.md §5.6). */
export function sampleIndices(_sessions: number, _samples: number): number[] {
  throw new Error('TODO(core-harness)');
}
