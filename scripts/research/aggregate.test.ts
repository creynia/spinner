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
    rejectedRounds: 3,
    adjustedRounds: 7,
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
    expect(r).toMatchObject({
      file: 'f.json',
      S: 500,
      pAhead: 0.31,
      median: 2500,
      bust: 0.05,
      rejected: 3,
      adjusted: 7,
      edgeZ: null,
    });
  });

  it("divides B by the payout m = (36 − c)/c when meta.BUnits is 'stakes'", () => {
    // e4-dozen-g: B = 172.92 level-0 stakes, c = 12, m = 2, p = 0.32432, S = 500.
    const meta = { c: 12, p: 0.32432, B: 172.92 };
    const stakes = toRow('f.json', report({ ...meta, BUnits: 'stakes' }));
    expect(stakes.x).toBeCloseTo((0.32432 * 500) / (172.92 / 2), 12);
    expect(stakes.x!).toBeCloseTo(1.9, 1);
    expect(stakes.B).toBeCloseTo(86.46, 12);
    // e4-corner-g: B = 187.84, c = 4, m = 8.
    expect(
      toRow('f.json', report({ c: 4, p: 0.10811, B: 187.84, BUnits: 'stakes' })).x!,
    ).toBeCloseTo(2.3, 1);
    // 'profits' and an absent BUnits leave B alone; stakes without c gives no x.
    const plain = (0.32432 * 500) / 172.92;
    expect(toRow('f.json', report({ ...meta, BUnits: 'profits' })).x).toBeCloseTo(plain, 12);
    expect(toRow('f.json', report(meta)).x).toBeCloseTo(plain, 12);
    expect(toRow('f.json', report({ p: 0.3, B: 10, BUnits: 'stakes' })).x).toBeNull();
  });

  it('takes the residual edge z when the report has one', () => {
    const r = toRow('f.json', {
      ...report(),
      edge: { residual: { mean: -10, sd: 1000, z: -1.25 } },
    } as unknown as Report);
    expect(r.edgeZ).toBe(-1.25);
  });

  it('leaves p, B, x blank without meta', () => {
    const r = toRow('f.json', report());
    expect([r.p, r.B, r.x, r.expNegX]).toEqual([null, null, null, null]);
    expect(formatCsv([r]).split('\n')[1]).toBe(
      'f.json,martingale-red@1,1000,,,500,,0.31,,2500,-34000,-255000,0.05,295,3,7,',
    );
  });
});
