import { describe, expect, it } from 'vitest';
import { formatCsv, toRow } from './aggregate';
import type { Report } from './run';

const report = (meta?: Report['meta']): Report =>
  ({
    id: 'martingale-red@1',
    meta,
    sessions: 1000,
    maxRounds: 500,
    pBust: 0.05,
    medianAheadUntil: 295,
    net: { median: 2500, mean: -34000, cvar5: -255000 },
    path: [
      { round: 0, ahead: 0 },
      { round: 500, ahead: 0.31 },
    ],
  }) as unknown as Report;

describe('aggregate toRow', () => {
  it('computes x = p·S/B, e^-x and takes P(ahead) from the last path point', () => {
    const r = toRow('f.json', report({ c: 18, p: 0.4865, B: 255, q: 0.0048 }));
    expect(r.x).toBeCloseTo((0.4865 * 500) / 255, 12);
    expect(r.expNegX).toBeCloseTo(Math.exp(-r.x!), 12);
    expect(r).toMatchObject({ file: 'f.json', S: 500, pAhead: 0.31, median: 2500, bust: 0.05 });
  });

  it('leaves p, B, x blank without meta', () => {
    const r = toRow('f.json', report());
    expect([r.p, r.B, r.x, r.expNegX]).toEqual([null, null, null, null]);
    expect(formatCsv([r]).split('\n')[1]).toBe(
      'f.json,martingale-red@1,1000,,,500,,0.31,,2500,-34000,-255000,0.05,295',
    );
  });
});
