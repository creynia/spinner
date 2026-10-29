// The cross-tab sync lock (sync.md §7.11): each cycle takes the Web Lock `spinner:sync` with
// `ifAvailable`; a tab that does not get it reports `busy` (the engine never does). Without the
// Web Locks API (old WebViews) a module-level flag stands in, which still serialises one page.

export const LOCK_NAME = 'spinner:sync';

/** The slice of `LockManager` this uses; tests pass a fake shared by two "tabs". */
export interface LockLike {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>;
  query?(): Promise<{ held?: { name?: string }[] }>;
}

export type Held<T> = { held: true; value: T } | { held: false };

export interface SyncLock {
  /** Runs `fn` while holding the lock, or resolves `{ held: false }` at once when another tab has it. */
  run<T>(fn: () => Promise<T>): Promise<Held<T>>;
  /** True when another context holds the lock right now (best effort; false when unknown). */
  heldElsewhere(): Promise<boolean>;
}

let fallbackHeld = false;

export function createSyncLock(manager?: LockLike | null): SyncLock {
  const m: LockLike | undefined =
    manager === null
      ? undefined
      : (manager ??
        (typeof navigator !== 'undefined'
          ? (navigator as unknown as { locks?: LockLike }).locks
          : undefined));
  if (!m) {
    return {
      async run(fn) {
        if (fallbackHeld) return { held: false };
        fallbackHeld = true;
        try {
          return { held: true, value: await fn() };
        } finally {
          fallbackHeld = false;
        }
      },
      heldElsewhere: () => Promise.resolve(false),
    };
  }
  return {
    run: <T>(fn: () => Promise<T>) =>
      m.request<Held<T>>(LOCK_NAME, { ifAvailable: true }, async (lock) =>
        lock ? { held: true, value: await fn() } : { held: false },
      ),
    async heldElsewhere() {
      try {
        const q = await m.query?.();
        return q?.held?.some((h) => h.name === LOCK_NAME) ?? false;
      } catch {
        return false;
      }
    },
  };
}
