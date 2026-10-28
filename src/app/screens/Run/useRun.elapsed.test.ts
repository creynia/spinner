import { describe, expect, it } from 'vitest';
import { elapsedNow } from './useRun';

describe('elapsedNow', () => {
  it('is the stored total when no segment is running', () => {
    expect(elapsedNow(5000, null, 99_999)).toBe(5000);
  });
  it('adds the running segment to the stored total', () => {
    expect(elapsedNow(5000, 10_000, 13_500)).toBe(8500);
  });
  it('never goes backwards when the clock does', () => {
    expect(elapsedNow(0, 10_000, 9_000)).toBe(0);
  });
});
