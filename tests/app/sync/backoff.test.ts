import { describe, expect, it } from 'vitest';
import { RemoteError } from '@core';
import { BACKOFF_STEPS_MS, backoffDelay, policyOf } from '../../../src/app/services/sync/backoff';

describe('backoff', () => {
  it('follows 30 s, 1 m, 2 m, 5 m, 10 m, then 15 m', () => {
    expect(BACKOFF_STEPS_MS).toEqual([30_000, 60_000, 120_000, 300_000, 600_000, 900_000]);
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 6, 50].map((a) => backoffDelay(a, { random: mid }))).toEqual([
      30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 900_000, 900_000,
    ]);
  });
  it('jitters by +-20 %', () => {
    expect(backoffDelay(2, { random: () => 0 })).toBe(96_000);
    expect(backoffDelay(2, { random: () => 0.999999 })).toBe(144_000);
  });
  it('Retry-After wins and is not jittered', () => {
    expect(backoffDelay(0, { retryAfterMs: 3000, random: () => 0 })).toBe(3000);
    expect(backoffDelay(0, { retryAfterMs: 0, random: () => 0.5 })).toBe(30_000);
  });
  it('maps error codes to the engine policy', () => {
    const p = (c: ConstructorParameters<typeof RemoteError>[0]) =>
      policyOf(new RemoteError(c, 0, ''));
    expect([
      p('network'),
      p('server'),
      p('rate'),
      p('auth'),
      p('quota'),
      p('forbidden'),
      p('not-found'),
      p('bad-response'),
    ]).toEqual([
      'offline',
      'backoff',
      'backoff',
      'needs-auth',
      'drive-full',
      'error',
      'error',
      'error',
    ]);
  });
});
