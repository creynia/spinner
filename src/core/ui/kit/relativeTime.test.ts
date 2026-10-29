import { describe, expect, it } from 'vitest';
import { relativeTime, runTimestamp } from './RelativeTime';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const S = 1000;
const M = 60 * S;
const H = 60 * M;

describe('relativeTime', () => {
  it('says "just now" under 5 s and for the future', () => {
    expect(relativeTime(ago(0), NOW)).toBe('just now');
    expect(relativeTime(ago(4 * S), NOW)).toBe('just now');
    expect(relativeTime(ago(-90 * S), NOW)).toBe('just now');
  });
  it('counts seconds, minutes and hours with singulars', () => {
    expect(relativeTime(ago(5 * S), NOW)).toBe('5 seconds ago');
    expect(relativeTime(ago(59 * S), NOW)).toBe('59 seconds ago');
    expect(relativeTime(ago(60 * S), NOW)).toBe('1 minute ago');
    expect(relativeTime(ago(36 * M), NOW)).toBe('36 minutes ago');
    expect(relativeTime(ago(59 * M + 59 * S), NOW)).toBe('59 minutes ago');
    expect(relativeTime(ago(60 * M), NOW)).toBe('1 hour ago');
    expect(relativeTime(ago(2 * H), NOW)).toBe('2 hours ago');
    expect(relativeTime(ago(23 * H + 59 * M), NOW)).toBe('23 hours ago');
  });
  it('gives only the date from 24 h on', () => {
    expect(relativeTime(ago(24 * H), NOW, 'en-US')).toBe('Oct 27, 2026');
    expect(relativeTime(ago(24 * H), NOW, 'en-GB')).toBe('27 Oct 2026');
    expect(relativeTime(ago(40 * 24 * H), NOW, 'en-US')).toMatch(/^Sep \d+, 2026$/);
  });
  it('is relative under 24 h even across midnight', () => {
    const now = Date.parse('2026-10-28T01:00:00Z');
    expect(relativeTime('2026-10-27T23:00:00Z', now, 'en-US')).toBe('2 hours ago');
  });
  it('tolerates a bad timestamp', () => {
    expect(relativeTime('nope', NOW)).toBe('');
  });
});

describe('runTimestamp', () => {
  it('prefers finishedAt, then startedAt, then createdAt', () => {
    expect(runTimestamp({ createdAt: 'c', timing: { startedAt: 's', finishedAt: 'f' } })).toBe('f');
    expect(runTimestamp({ createdAt: 'c', timing: { startedAt: 's' } })).toBe('s');
    expect(runTimestamp({ createdAt: 'c', timing: {} })).toBe('c');
  });
});
