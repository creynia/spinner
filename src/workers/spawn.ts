// The only `new Worker(new URL(...))` in the repo (architecture.md §3). Frozen after WP0.
// The app injects this into `createPool({ spawn: spawnSimWorker, size })`.
import type { FromSim, SimTransport, ToSim } from '@core/contracts/protocol';

/** Starts one sim worker and wraps it as a `SimTransport` (mode 'worker'). */
export function spawnSimWorker(): SimTransport {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  const listeners = new Set<(msg: FromSim) => void>();
  const emit = (msg: FromSim): void => {
    for (const fn of [...listeners]) fn(msg);
  };
  worker.onmessage = (e: MessageEvent<FromSim>): void => emit(e.data);
  worker.onerror = (e: ErrorEvent): void =>
    emit({ t: 'error', code: 'worker-error', message: e.message || 'worker failed to start' });
  worker.onmessageerror = (): void =>
    emit({
      t: 'error',
      code: 'worker-messageerror',
      message: 'worker message could not be cloned',
    });
  return {
    mode: 'worker',
    post(msg: ToSim, transfer?: Transferable[]): void {
      worker.postMessage(msg, transfer ?? []);
    },
    onMessage(fn): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    terminate(): void {
      listeners.clear();
      worker.terminate();
    },
  };
}
