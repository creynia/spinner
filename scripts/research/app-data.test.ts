import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { downsample, findMeta, numericMeta, parseCurve, toRowStats } from './app-data';
import type { PathPoint, Report } from './run';

const point = (round: number): PathPoint => ({
  round,
  mean: round,
  p10: 0,
  p25: 0,
  p50: 0,
  p75: 0,
  p90: 0,
  ahead: 0.5,
});

describe('downsample', () => {
  // The runner's own spacing: every round to 50, then every 10th.
  const rounds = [...Array.from({ length: 51 }, (_, i) => i), ...[60, 70, 80, 90, 100, 110, 120]];
  const long = [...rounds, ...Array.from({ length: 38 }, (_, i) => 130 + i * 10)].map(point);

  it('keeps short paths whole', () => {
    expect(downsample(rounds.map(point), 60)).toHaveLength(rounds.length);
  });

  it('keeps round 0 and the last round, thins to the budget', () => {
    const out = downsample(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out[0]!.round).toBe(0);
    expect(out[out.length - 1]!.round).toBe(long[long.length - 1]!.round);
    expect(out.filter((p) => p.round <= 50).length).toBeLessThanOrEqual(16);
    expect(out.map((p) => p.round)).toEqual([...out.map((p) => p.round)].sort((a, b) => a - b));
  });

  it('honours a smaller budget', () => {
    expect(downsample(long, 40).length).toBeLessThanOrEqual(40);
  });
});

describe('parseCurve', () => {
  const md = [
    '## 1. Every ladder',
    '| id | family | c | p | q | B | qB/(1−q) | x | never-capped (src) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    '| e3a-L5 | E3 Martingale red $5 | 18 | 0.486 | 0.0357 | 31.0 | 1.15 | 7.85 | 0.000 (twin 2k) |',
    '| e4-corner-g-stop | E4 corner g (stop) | 4 | 0.108 | 0.0455 | 23.0 | 1.10 | 2.35 | 0.060 · |',
    '| e4-straights25-x2 | E4 x2 | 25 | 0.676 | — | — | — | — | — (P(ahead) only) |',
    '| d-a1-stopwin20 | E6 cash-out | 3 | 0.243 | 0.0049 | 258.1 | 1.28 | 0.47 | 0.933 (censored) |',
    '## 2. Collapse test',
    '| x | y | z | a | b | c | d | e | f |',
  ].join('\n');

  it('keeps fitted ladders and skips dashes, twins and censored rows', () => {
    expect(parseCurve(md)).toEqual([
      { id: 'e3a-L5', family: 'E3 Martingale red $5', x: 7.85, neverCapped: 0, k: 1.15 },
    ]);
  });

  it('reads the committed E5 table: 53 ladders', () => {
    const e5 = readFileSync(new URL('../../docs/research/briefs/E5.md', import.meta.url), 'utf8');
    expect(parseCurve(e5)).toHaveLength(53);
  });
});

describe('toRowStats', () => {
  it('counts strategy:cap-* endings as capRate and rounds money to cents', () => {
    const r = {
      id: 'x',
      sessions: 200,
      bankroll: 500000,
      maxRounds: 500,
      net: {
        mean: -12.6,
        meanCI: [-20.2, -5.1],
        sd: 99.5,
        median: 100,
        medianCI: [100, 100],
        q: { p10: -5, p90: 7 },
        cvar5: -300.4,
      },
      pWin: { p: 0.90284 },
      pBust: 0,
      endedBy: { rounds: 150, 'strategy:cap-q': 30, 'stop-win': 20 },
      rounds: { mean: 412.34 },
      wagered: { mean: 1000.5 },
      edge: { realized: -0.027049 },
      medianAheadUntil: null,
      medianPeak: { round: 4, net: 7.4 },
    } as unknown as Report;
    const s = toRowStats('f', r);
    expect(s.capRate).toBe(0.15);
    expect(s.mean).toBe(-13);
    expect(s.pWin).toBe(0.9028);
    expect(s.medianAheadUntil).toBeNull();
    expect(s.roundsMean).toBe(412.3);
  });
});

describe('meta', () => {
  it('keeps numbers, converts a stakes B to cycle profits and drops strings', () => {
    expect(numericMeta({ c: 12, p: 0.5, B: 172.92, BUnits: 'stakes', recovers: true })).toEqual({
      c: 12,
      p: 0.5,
      B: 86.46,
    });
    expect(numericMeta({ c: 3, B: 338.8, BUnits: 'profits' })).toEqual({ c: 3, B: 338.8 });
    expect(numericMeta(undefined)).toBeNull();
    expect(numericMeta({ note: 'x' })).toBeNull();
  });

  it('looks an id up in its own spec, then e6-full, then any spec, dropping @seed', () => {
    const specs = {
      'e8-seed3': [],
      'e6-full': [{ id: 'c9', meta: { q: 0.1 } }],
      'e7-c9': [{ id: 'e7-c9-W20', meta: { q: 0.2 } }, { id: 'flat' }],
    };
    expect(findMeta(specs, 'e8-seed3', 'c9@3')).toEqual({ q: 0.1 });
    expect(findMeta(specs, 'e7-c9', 'e7-c9-W20')).toEqual({ q: 0.2 });
    expect(findMeta(specs, 'e7-c9-holdout', 'e7-c9-W20@1')).toEqual({ q: 0.2 });
    expect(findMeta(specs, 'e7-c9', 'flat')).toBeNull();
    expect(findMeta(specs, 'e7-c9', 'nope')).toBeNull();
  });
});
