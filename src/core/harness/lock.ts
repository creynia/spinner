// The two-tab lock (harness-data-analysis.md §6.4): the executing tab holds the Web Lock
// `spinner:run:<runId>` for the whole execution; another tab sees "running in another tab".

/** The slice of `navigator.locks` that is used (so tests can fake it). */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>;
}

export type RunLock =
  | { status: 'held'; release(): void }
  /** Another tab is executing this run. */
  | { status: 'busy' }
  /** No Locks API: no lock, a warning is logged by the caller. */
  | { status: 'unsupported' };

export const runLockName = (runId: string): string => `spinner:run:${runId}`;

export function defaultLocks(): LockManagerLike | undefined {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return nav?.locks;
}

export async function acquireRunLock(
  runId: string,
  locks: LockManagerLike | undefined = defaultLocks(),
): Promise<RunLock> {
  if (!locks) return { status: 'unsupported' };
  return new Promise<RunLock>((resolve, reject) => {
    locks
      .request(runLockName(runId), { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve({ status: 'busy' });
          return undefined;
        }
        return new Promise<void>((held) => {
          resolve({ status: 'held', release: () => held() });
        });
      })
      .catch(reject);
  });
}

/** True when another tab is executing `runId` (takes and immediately drops the lock if free). */
export async function isRunLockedElsewhere(
  runId: string,
  locks: LockManagerLike | undefined = defaultLocks(),
): Promise<boolean> {
  const lock = await acquireRunLock(runId, locks);
  if (lock.status === 'held') lock.release();
  return lock.status === 'busy';
}
