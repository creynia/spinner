// Oracle tests on `coin` (p = 18/37): gambler's ruin, and the martingale identities that tie the
// analytic expected loss and variance columns to the realised nets.
import { describe, expect, it } from 'vitest';
import { ENDED_BY } from '../contracts/run';
import { FLAT_COIN, STAGED_COIN, coinDefinition, runCoinToEnd } from '../testing';

const p = 18 / 37;
const q = 19 / 37;
const r = q / p;

/** P(ruin before reaching b | start a), absorbing barriers 0 and b. */
const pRuin = (a: number, b: number): number => (r ** a - r ** b) / (1 - r ** b);
/** Expected number of rounds until absorption. */
const duration = (a: number, b: number): number =>
  a / (q - p) - (b / (q - p)) * ((1 - r ** a) / (1 - r ** b));

/** Wilson score interval. */
function wilson(k: number, n: number, z: number): [number, number] {
  const ph = k / n;
  const d = 1 + (z * z) / n;
  const c = ph + (z * z) / (2 * n);
  const w = z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}

function meanSe(xs: ArrayLike<number>): { mean: number; se: number } {
  const n = xs.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += xs[i]!;
  const mean = s / n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (xs[i]! - mean) ** 2;
  return { mean, se: Math.sqrt(ss / (n - 1) / n) };
}

describe("gambler's ruin on coin", () => {
  for (const [a, b] of [
    [10, 20],
    [5, 25],
    [20, 24],
    [40, 80],
  ] as const) {
    it(`flat $1, start ${a} units, target ${b}: P(bust) in the Wilson interval, duration within 3 SE`, async () => {
      const n = b >= 80 ? 6000 : 20_000;
      const data = await runCoinToEnd(
        coinDefinition({
          strategy: FLAT_COIN,
          sessions: n,
          maxRounds: b >= 80 ? 40_000 : 5000,
          bankroll: a * 100,
          stopWin: (b - a) * 100,
          seed: 20_261_028 + a,
          sampleSessions: 0,
        }),
        { workers: 2 },
      );
      let busts = 0;
      let wins = 0;
      for (let i = 0; i < n; i++) {
        const e = data.summary.endedBy[i];
        if (e === ENDED_BY.bust) busts++;
        else if (e === ENDED_BY['stop-win']) wins++;
      }
      expect(busts + wins).toBe(n); // nobody hit the 5000-round cap
      const [lo, hi] = wilson(busts, n, 3.29); // 99.9%
      const expected = pRuin(a, b);
      expect(expected).toBeGreaterThanOrEqual(lo);
      expect(expected).toBeLessThanOrEqual(hi);

      const { mean, se } = meanSe(data.summary.roundsPlayed);
      expect(Math.abs(mean - duration(a, b))).toBeLessThan(3 * se);
    });
  }
});

describe('martingale identities (staged strategy, busts and stops included)', () => {
  it('net + expected loss has mean 0; its square has the mean of the summed variance', async () => {
    const n = 20_000;
    const data = await runCoinToEnd(
      coinDefinition({
        strategy: STAGED_COIN,
        sessions: n,
        maxRounds: 150,
        bankroll: 5000,
        seed: 99,
        sampleSessions: 0,
      }),
      { workers: 2 },
    );
    const s = data.summary;
    const m = new Float64Array(n);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      m[i] = s.net[i]! + s.expectedLoss[i]!;
      d[i] = m[i]! ** 2 - s.variance[i]!;
    }
    const mm = meanSe(m);
    expect(Math.abs(mm.mean)).toBeLessThan(3.5 * mm.se);
    const dd = meanSe(d);
    expect(Math.abs(dd.mean)).toBeLessThan(3.5 * dd.se);
    // The stake pattern is real: the strategy changes stages and sometimes walks away.
    expect(data.chunkStats.transitions.some((x) => x > 0)).toBe(true);
  });
});
