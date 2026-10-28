import { describe, expect, it } from 'vitest';
import { checkpointSchedule, chunkSizeFor, sampleIndices, HarnessConfigError } from './schedule';

const range = (a: number, b: number): number[] =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('checkpointSchedule (harness doc §4 vectors)', () => {
  it('(500, 10000): K = 128, D = 33', () => {
    const tail = [
      42, 43, 44, 45, 47, 48, 49, 51, 52, 54, 55, 57, 59, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78,
      81, 83, 86, 88, 91, 93, 96, 99, 102, 105, 108, 111, 114, 118, 121, 125, 128, 132, 136, 140,
      144, 148, 153, 157, 162, 167, 171, 176, 182, 187, 192, 198, 204, 210, 216, 222, 229, 236, 243,
      250, 257, 265, 272, 280, 289, 297, 306, 315, 324, 333, 343, 353, 364, 374, 385, 397, 408, 420,
      433, 445, 458, 472, 486, 500,
    ];
    const s = checkpointSchedule(500, 10_000, 'auto');
    expect(Array.from(s)).toEqual([...range(0, 40), ...tail]);
    expect(s.length).toBe(128);
  });

  it('(100, 10000) is every round, 0..100', () => {
    expect(Array.from(checkpointSchedule(100, 10_000, 'auto'))).toEqual(range(0, 100));
  });

  it('(128, 10000) is 0..126, 128', () => {
    expect(Array.from(checkpointSchedule(128, 10_000, 'auto'))).toEqual([...range(0, 126), 128]);
  });

  it('(10000, 10000): 128 points; entries 30..44 and the last five', () => {
    const s = checkpointSchedule(10_000, 10_000, 'auto');
    expect(s.length).toBe(128);
    expect(Array.from(s.slice(30, 45))).toEqual([
      30, 31, 32, 34, 36, 38, 41, 43, 46, 49, 52, 55, 59, 62, 66,
    ]);
    expect(Array.from(s.slice(-5))).toEqual([7852, 8341, 8861, 9413, 10000]);
  });

  it('(500, 100000): K = 41, D = 11, the list contains 11 (corrected vector)', () => {
    const tail = [
      11, 13, 15, 17, 19, 22, 25, 28, 32, 37, 42, 48, 54, 62, 71, 81, 92, 105, 119, 136, 155, 176,
      201, 229, 261, 297, 338, 385, 439, 500,
    ];
    const s = checkpointSchedule(500, 100_000, 'auto');
    expect(Array.from(s)).toEqual([...range(0, 10), ...tail]);
    expect(s.length).toBe(41);
  });

  it('is strictly increasing, starts at 0 and ends at maxRounds for many shapes', () => {
    for (const maxRounds of [1, 2, 15, 16, 17, 33, 100, 129, 1000, 99_999, 100_000]) {
      for (const sessions of [1, 100, 10_000, 100_000]) {
        const s = checkpointSchedule(maxRounds, sessions, 'auto');
        expect(s[0]).toBe(0);
        expect(s[s.length - 1]).toBe(maxRounds);
        for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!);
        expect(s.length * sessions).toBeLessThanOrEqual(Math.max(4_194_304, 16 * sessions));
      }
    }
  });

  it('custom: sorted, deduplicated, clipped, 0 and maxRounds added', () => {
    expect(Array.from(checkpointSchedule(100, 10, [50, 10, 10, 500, -3, 20]))).toEqual([
      0, 10, 20, 50, 100,
    ]);
  });

  it('custom: more than 512 entries or over 32 MB is checkpoints-too-many', () => {
    const many = range(0, 600);
    expect(() => checkpointSchedule(1000, 10, many)).toThrow(HarnessConfigError);
    try {
      checkpointSchedule(1000, 10, many);
    } catch (e) {
      expect((e as HarnessConfigError).code).toBe('checkpoints-too-many');
    }
    expect(() => checkpointSchedule(1000, 100_000, range(0, 100))).toThrow(/too large/);
  });
});

describe('chunkSizeFor (harness doc §5.3)', () => {
  it('pins the documented vectors', () => {
    expect(chunkSizeFor(1)).toBe(64);
    expect(chunkSizeFor(100)).toBe(64);
    expect(chunkSizeFor(500)).toBe(32);
    expect(chunkSizeFor(1000)).toBe(16);
    expect(chunkSizeFor(10_000)).toBe(1);
    expect(chunkSizeFor(100_000)).toBe(1);
  });
});

describe('sampleIndices (harness doc §5.6)', () => {
  it('N = 10000, S = 24', () => {
    expect(sampleIndices(10_000, 24)).toEqual([
      ...range(0, 7),
      312,
      937,
      1562,
      2187,
      2812,
      3437,
      4062,
      4687,
      5312,
      5937,
      6562,
      7187,
      7812,
      8437,
      9062,
      9687,
    ]);
  });
  it('N = 200, S = 24: the collision with the head is filled by index 8', () => {
    expect(sampleIndices(200, 24)).toEqual([
      ...range(0, 8),
      18,
      31,
      43,
      56,
      68,
      81,
      93,
      106,
      118,
      131,
      143,
      156,
      168,
      181,
      193,
    ]);
  });
  it('N = 10, S = 24 is every session', () => {
    expect(sampleIndices(10, 24)).toEqual(range(0, 9));
  });
  it('S = 0 is empty; the result is ascending, unique and exactly min(S, N) long', () => {
    expect(sampleIndices(1000, 0)).toEqual([]);
    for (const [n, s] of [
      [1, 5],
      [7, 3],
      [50, 100],
      [10_000, 100],
      [100_000, 1],
    ] as const) {
      const r = sampleIndices(n, s);
      expect(r.length).toBe(Math.min(n, s));
      expect(new Set(r).size).toBe(r.length);
      expect([...r].sort((a, b) => a - b)).toEqual(r);
      expect(r[r.length - 1]!).toBeLessThan(n);
    }
  });
});
