import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import raw from './data.json';
import data, { candidate, path, row, rowsOf } from './data';
import type { ResearchData } from './dataTypes';

// The generated JSON must satisfy the app's types (a compile-time check through this assignment).
const typed: ResearchData = raw as unknown as ResearchData;

/** Chapter data keys of docs/research/app-plan.md §3. */
const CHAPTER_ROWS: Record<string, string[]> = {
  start: ['observations:flat-red', 'e7-c9:e7-c9-W20-SLhalf'],
  edge: ['e1-spread:e1-red', 'e1-spread:e1-red12-dozen3-13', 'e1-spread:e1-straights25'],
  martingale: [
    'observations:flat-red',
    'observations:martingale-red',
    'observations:fibonacci-red',
  ],
  levels: [
    ...['L5', 'L6', 'L7', 'L8', 'L9', 'L10'].map((l) => `e3a-levels:e3a-${l}`),
    'observations:martingale-red-br10k',
  ],
  placement: [
    'e4-corner:e4-corner-g',
    'e4-corner:e4-corner-g-stop',
    'e4-corner:e4-corner-x2',
    'e4-dozen:e4-dozen-g',
    'e4-dozen:e4-dozen-g-stop',
    'e4-dozen:e4-dozen-x2',
    'e4-dozen:e4-dozen-g-u5',
    'e4-dozen:e4-dozen-g-u5-stop',
    'e4-dozen:e4-dozen-x2-u5',
    'e4-sixline:e4-sixline-g',
    'e4-sixline:e4-sixline-g-stop',
    'e4-sixline:e4-sixline-x2',
    'e4-straights25:e4-straights25-g',
    'e4-straights25:e4-straights25-g-stop',
    'e4-straights25:e4-straights25-x2',
    'e4-straights35:e4-straights35-g',
    'e4-straights35:e4-straights35-g-stop',
    'e4-straights35:e4-straights35-x2',
    'e4-two-dozens:e4-two-dozens-g',
    'e4-two-dozens:e4-two-dozens-g-stop',
    'e4-two-dozens:e4-two-dozens-x2',
  ],
  shapes: [
    ...['a1-streets-w27', 'b3-two-streets-l29', 'c9-streets-to12-stack'].flatMap((id) => [
      `e6-full:${id}@20261031`,
      `e6-full:${id}@1`,
      `e6-full:${id}@2`,
      `e8-seed3:${id}@3`,
    ]),
  ],
  cashout: [
    ...['W5', 'W10', 'W20', 'W50', 'W100', 'W20-SLhalf', 'nostop'].map((w) => `e7-c9:e7-c9-${w}`),
    ...['W5', 'W10', 'W20', 'W50', 'W100'].flatMap((w) => [
      `e7-mart:e7m-reset-${w}`,
      `e7-mart:e7m-stop-${w}`,
      `e7b-mart-L7stop:e7b-L7stop-${w}`,
    ]),
    'e7-mart:e7m-reset-W20-SLhalf',
    'e7-mart:e7m-stop-W20-SLhalf',
    'e7b-mart-L7stop:e7b-L8reset-W20',
  ],
  limits: [
    ...['flat-red', 'b3-two-streets-l29', 'c9-streets-to12-stack', 'a1-streets-w27'].flatMap(
      (id) => [
        `e8-br10k:e8-br10k-${id}`,
        `e8-partage:e8-lp-${id}`,
        `e8-length:e8-S250-${id}`,
        `e8-length:e8-S1000-${id}`,
      ],
    ),
    'e8-american:e8-am-flat-red',
    'e8-american:e8-am-b3-two-streets-l29',
    'e8-american:e8-am-c9-streets-to12-stack',
    'e8-american:e8-am-a1-streets-w27',
  ],
};

/** Rows a chart draws as a line band. */
const CHAPTER_PATHS = [
  'observations:flat-red',
  'observations:martingale-red',
  'observations:fibonacci-red',
  'e3a-levels:e3a-L5',
  'e3a-levels:e3a-L10',
  'e6-full:a1-streets-w27@20261031',
  'e6-full:b3-two-streets-l29@20261031',
  'e6-full:c9-streets-to12-stack@20261031',
  'e7-c9:e7-c9-W20-SLhalf',
  'e7-mart:e7m-reset-W20',
  'e8-length:e8-S1000-c9-streets-to12-stack',
  'e8-american:e8-am-flat-red',
];

const CANDIDATE_IDS = [
  'keeper-b3-two-streets-l29',
  'keeper-c9-streets-to12-cashout',
  'keeper-c9-streets-to12-stack',
];

const isNumbers = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n));

describe('research data.json', () => {
  it('is within the 150 KB budget', () => {
    const bytes = statSync(join(process.cwd(), 'src/app/screens/Research/data.json')).size;
    expect(bytes).toBeLessThanOrEqual(150 * 1024);
  });

  it('parses into the schema', () => {
    expect(typed.generatedFrom.length).toBeGreaterThan(0);
    for (const [key, r] of Object.entries(typed.rows)) {
      expect(key).toBe(`${r.file}:${r.id}`);
      for (const f of ['sessions', 'bankroll', 'maxRounds', 'mean', 'median', 'sd', 'p10', 'p90'])
        expect(Number.isFinite(r[f as 'mean']), `${key}.${f}`).toBe(true);
      for (const f of ['cvar5', 'pWin', 'pBust', 'capRate', 'wagerMean', 'roundsMean'])
        expect(Number.isFinite(r[f as 'pWin']), `${key}.${f}`).toBe(true);
      expect(r.meanCI).toHaveLength(2);
      expect(r.medianCI).toHaveLength(2);
      expect(r.pWin).toBeGreaterThanOrEqual(0);
      expect(r.pWin).toBeLessThanOrEqual(1);
      expect(r.capRate).toBeGreaterThanOrEqual(0);
      expect(r.capRate).toBeLessThanOrEqual(1);
      expect(r.medianAheadUntil === null || Number.isFinite(r.medianAheadUntil)).toBe(true);
      expect(Number.isFinite(r.medianPeak.round)).toBe(true);
      expect(Number.isFinite(r.medianPeak.net)).toBe(true);
    }
    for (const [key, p] of Object.entries(typed.paths)) {
      expect(key in typed.rows, `${key} has a row`).toBe(true);
      const n = p.rounds.length;
      expect(n).toBeGreaterThan(1);
      expect(n).toBeLessThanOrEqual(60);
      expect(p.rounds[0]).toBe(0);
      expect(p.rounds[n - 1]).toBe(typed.rows[key]!.maxRounds);
      for (const series of [p.p10, p.p50, p.p90, p.mean, p.ahead, p.p25, p.p75]) {
        if (series === undefined) continue;
        expect(isNumbers(series)).toBe(true);
        expect(series).toHaveLength(n);
      }
      expect([...p.rounds].sort((a, b) => a - b)).toEqual(p.rounds);
    }
    expect(typed.curve).toHaveLength(53);
    for (const c of typed.curve) {
      expect(c.id).not.toBe('');
      expect(c.x).toBeGreaterThan(0);
      expect(c.k).toBeGreaterThanOrEqual(1);
      expect(c.neverCapped).toBeGreaterThanOrEqual(0);
      expect(c.neverCapped).toBeLessThanOrEqual(1);
    }
    expect(typed.candidates.map((c) => c.id)).toEqual(CANDIDATE_IDS);
    for (const c of typed.candidates) {
      expect(c.rows.length).toBeGreaterThan(0);
      for (const key of c.rows) expect(key in typed.rows).toBe(true);
      expect(c.session).toEqual({ bankroll: 500000, maxRounds: 500 });
    }
  });

  it('resolves every chapter data key', () => {
    for (const [chapter, keys] of Object.entries(CHAPTER_ROWS)) {
      for (const key of keys) expect(row(key).sessions, `${chapter}: ${key}`).toBeGreaterThan(0);
    }
    for (const key of CHAPTER_PATHS) expect(path(key).rounds.length, key).toBeGreaterThan(1);
    expect(data.curve.length).toBeGreaterThan(0);
    for (const id of CANDIDATE_IDS) expect(candidate(id).rows.length).toBeGreaterThan(0);
  });

  it('has the rows of every listed results file', () => {
    expect(rowsOf('observations')).toHaveLength(11);
    expect(rowsOf('e6-full')).toHaveLength(27);
    expect(rowsOf('e7-c9-holdout')).toHaveLength(2);
    expect(rowsOf('e7-c9-seed3')).toHaveLength(1);
    expect(rowsOf('nope')).toEqual([]);
  });

  it('throws a clear error for a missing key', () => {
    expect(() => row('observations:nope')).toThrow(/no row "observations:nope"/);
    expect(() => path('e4-corner:e4-corner-g')).toThrow(/no path/);
    expect(() => candidate('nope')).toThrow(/no candidate "nope"/);
  });

  it('keeps pinned values', () => {
    const m = row('observations:martingale-red');
    expect(m.median).toBe(-500000);
    expect(m.medianAheadUntil).toBe(290);
    const c9 = row('e7-c9:e7-c9-W20-SLhalf');
    expect(c9.median).toBe(28600);
    expect(Math.abs(c9.pWin - 0.903)).toBeLessThanOrEqual(0.0005);
    expect(Math.abs(row('e1-spread:e1-red').mean - -33821)).toBeLessThanOrEqual(1);
    // ended by strategy:cap-q: 3271 of 10000 sessions
    expect(row('e6-full:c9-streets-to12-stack@20261031').capRate).toBeCloseTo(0.3271, 4);
  });

  it('carries the candidates the Try-it chapter opens', () => {
    const cash = candidate('keeper-c9-streets-to12-cashout');
    expect(cash.rows[0]).toBe('e7-c9:e7-c9-W20-SLhalf');
    expect(cash.rules).toEqual({
      preset: 'european',
      overrides: { limits: { outside: { min: 100 }, inside: { minTotal: 100 } } },
    });
    expect(candidate('keeper-b3-two-streets-l29').rows).toHaveLength(4);
  });
});
