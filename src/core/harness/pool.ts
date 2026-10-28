// The worker pool (harness-data-analysis.md §5.2): size min(cores - 1, 8), created lazily, one
// active run at a time (a FIFO of leases), a separate `aux` worker for Watch and quick checks,
// idle workers terminated after 60 s.
import type { SimTransport } from '../contracts/protocol';

export const MAX_POOL_SIZE = 8;
export const POOL_IDLE_MS = 60_000;

/** Default pool size: `clamp(cores - 1, 1, 8)`. */
export function defaultPoolSize(hardwareConcurrency?: number): number {
  const hc =
    hardwareConcurrency ??
    (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined) ??
    2;
  return Math.min(MAX_POOL_SIZE, Math.max(1, Math.floor(hc) - 1));
}

/** Exclusive use of the pool's workers by one run. */
export interface PoolLease {
  readonly workers: readonly SimTransport[];
  /** Terminate worker `i` and start a fresh one in its place (crash recovery). */
  replace(i: number): SimTransport;
  /** Terminate every worker of the pool (cancel). The pool respawns them on the next lease. */
  terminateAll(): void;
  /** Hand the pool to the next waiting run. Idempotent. */
  release(): void;
}

export interface SimPool {
  readonly size: number;
  /** Wait for the pool (FIFO), then own it until `release()`. */
  lease(): Promise<PoolLease>;
  /** A single separate worker for re-simulating one session and quick checks. */
  aux(): SimTransport;
  /** Terminate every worker, aux included. The pool stays usable (workers respawn lazily). */
  terminate(): void;
}

export function createPool(opts: {
  spawn: () => SimTransport;
  size: number;
  idleMs?: number;
}): SimPool {
  const size = Math.max(1, Math.floor(opts.size));
  const idleMs = opts.idleMs ?? POOL_IDLE_MS;
  const slots: (SimTransport | null)[] = new Array<SimTransport | null>(size).fill(null);
  let auxT: SimTransport | null = null;
  let held = false;
  const waiting: (() => void)[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  const killWorkers = (): void => {
    for (let i = 0; i < size; i++) {
      slots[i]?.terminate();
      slots[i] = null;
    }
  };
  const armIdle = (): void => {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!held) killWorkers();
      auxT?.terminate();
      auxT = null;
    }, idleMs);
  };

  const grant = (): PoolLease => {
    held = true;
    clearIdle();
    for (let i = 0; i < size; i++) slots[i] ??= opts.spawn();
    let released = false;
    const lease: PoolLease = {
      get workers() {
        return slots as readonly SimTransport[];
      },
      replace(i) {
        slots[i]?.terminate();
        const t = opts.spawn();
        slots[i] = t;
        return t;
      },
      terminateAll() {
        killWorkers();
      },
      release() {
        if (released) return;
        released = true;
        held = false;
        const next = waiting.shift();
        if (next) next();
        else armIdle();
      },
    };
    return lease;
  };

  return {
    size,
    lease() {
      if (!held) return Promise.resolve(grant());
      return new Promise<PoolLease>((resolve) => {
        waiting.push(() => resolve(grant()));
      });
    },
    aux() {
      if (!auxT) auxT = opts.spawn();
      if (!held) armIdle();
      return auxT;
    },
    terminate() {
      clearIdle();
      killWorkers();
      auxT?.terminate();
      auxT = null;
    },
  };
}
