// The in-thread transport: the same handler a worker runs, behind `SimTransport`
// (harness-data-analysis.md §5.1). Vitest in node uses it; the browser uses it only when `Worker`
// is missing.
import type { GamePlugin } from '../contracts/game';
import type { FromSim, SimTransport, ToSim } from '../contracts/protocol';
import { createWorkerHandler, type WorkerHandlerOptions } from './handler';

export interface InThreadOptions extends WorkerHandlerOptions {
  /**
   * How a message hops to the handler. 'timeout' (default) yields to the event loop between
   * messages so timers and the UI keep running; 'microtask' is faster for tests.
   */
  hop?: 'timeout' | 'microtask';
}

export function createInThreadTransport(
  plugin: GamePlugin<unknown, unknown, unknown, unknown>,
  opts: InThreadOptions = {},
): SimTransport {
  const handler = createWorkerHandler(plugin, opts);
  const listeners = new Set<(msg: FromSim) => void>();
  let dead = false;
  const schedule: (fn: () => void) => void =
    opts.hop === 'microtask' ? (fn) => queueMicrotask(fn) : (fn) => void setTimeout(fn, 0);
  return {
    mode: 'inthread',
    post(msg: ToSim): void {
      if (dead) return;
      schedule(() => {
        if (dead) return;
        handler(msg, (reply) => {
          if (dead) return;
          for (const fn of [...listeners]) fn(reply);
        });
      });
    },
    onMessage(fn): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    terminate(): void {
      dead = true;
      listeners.clear();
    },
  };
}
