// Retry delays for `network`, `server` and `rate` errors (sync.md §7.11). Pure; the engine and the
// app service decide when to call it.
import type { RemoteError } from '@core';

/** 30 s, 1 m, 2 m, 5 m, 10 m, then 15 m for every later attempt. */
export const BACKOFF_STEPS_MS: readonly number[] = [
  30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
];
/** `drive-full` is retried hourly, or on Sync now. */
export const QUOTA_RETRY_MS = 3_600_000;
export const JITTER = 0.2;

/**
 * The wait before retry number `attempt` (0 = the first retry). `Retry-After` wins and is not
 * jittered; otherwise the step gets +-20 % jitter (`random` returns [0, 1)).
 */
export function backoffDelay(
  attempt: number,
  o: { retryAfterMs?: number | undefined; random?: () => number } = {},
): number {
  if (o.retryAfterMs !== undefined && o.retryAfterMs > 0) return o.retryAfterMs;
  const i = Math.min(Math.max(0, Math.floor(attempt)), BACKOFF_STEPS_MS.length - 1);
  const base = BACKOFF_STEPS_MS[i]!;
  const r = (o.random ?? Math.random)();
  return Math.round(base * (1 - JITTER + 2 * JITTER * r));
}

export type ErrorPolicy = 'backoff' | 'needs-auth' | 'drive-full' | 'error' | 'offline';

/** How the engine reacts to a remote error (sync.md §7.11). */
export function policyOf(e: Pick<RemoteError, 'code'>): ErrorPolicy {
  switch (e.code) {
    case 'network':
      return 'offline';
    case 'server':
    case 'rate':
      return 'backoff';
    case 'auth':
      return 'needs-auth';
    case 'quota':
      return 'drive-full';
    default:
      return 'error'; // forbidden, not-found, bad-response
  }
}
