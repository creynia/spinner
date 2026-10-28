import { describe, expect, it } from 'vitest';
import { SESSION_VECTORS } from './__fixtures__/vectors';
import {
  G_HI,
  G_LO,
  STRATEGY_SALT_HI,
  STRATEGY_SALT_LO,
  Xoshiro128ss,
  mix64,
  runBase,
  seedXoshiro,
  sessionRng,
  sessionSeed,
  splitmixAt,
} from './index';

const M64 = (1n << 64n) - 1n;
const hex64 = (hi: number, lo: number): string =>
  `0x${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
const hex32 = (x: number): string => x.toString(16).padStart(8, '0');

/** BigInt reference implementation of mix64 (harness-data-analysis.md §1.1). */
function mix64Ref(z: bigint): bigint {
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
  return z ^ (z >> 31n);
}
const GAMMA = 0x9e3779b97f4a7c15n;

function mix(hi: number, lo: number): string {
  const out = new Uint32Array(2);
  mix64(hi, lo, out);
  return hex64(out[0]!, out[1]!);
}

describe('SplitMix64', () => {
  it('has the documented constants', () => {
    expect(hex64(G_HI, G_LO)).toBe('0x9e3779b97f4a7c15');
    expect(hex64(STRATEGY_SALT_HI, STRATEGY_SALT_LO)).toBe('0x5354524154454759');
  });
  it('mix64(0) and mix64(1)', () => {
    expect(mix(0, 0)).toBe('0x0000000000000000');
    expect(mix(0, 1)).toBe('0x5692161d100b05e5');
  });
  it('outputs 1..3 from state 0', () => {
    const out = new Uint32Array(2);
    const got: string[] = [];
    for (let k = 1; k <= 3; k++) {
      splitmixAt(0, 0, k, out);
      got.push(hex64(out[0]!, out[1]!));
    }
    expect(got).toEqual(['0xe220a8397b1dcdaf', '0x6e789e6aa1b965f4', '0x06c45d188009454f']);
  });
  it('matches the BigInt reference on 20,000 pseudo-random inputs', () => {
    const r = new Xoshiro128ss([1, 2, 3, 4]);
    const out = new Uint32Array(2);
    for (let i = 0; i < 20_000; i++) {
      const hi = r.next(),
        lo = r.next();
      mix64(hi, lo, out);
      expect(hex64(out[0]!, out[1]!)).toBe(
        `0x${mix64Ref((BigInt(hi) << 32n) | BigInt(lo))
          .toString(16)
          .padStart(16, '0')}`,
      );
    }
  });
  it('splitmixAt matches the BigInt reference on 20,000 inputs', () => {
    const r = new Xoshiro128ss([9, 8, 7, 6]);
    const out = new Uint32Array(2);
    for (let i = 0; i < 20_000; i++) {
      const hi = r.next(),
        lo = r.next(),
        k = r.next() || 1;
      splitmixAt(hi, lo, k, out);
      const state = (BigInt(hi) << 32n) | BigInt(lo);
      const want = mix64Ref((state + BigInt(k) * GAMMA) & M64);
      expect(hex64(out[0]!, out[1]!)).toBe(`0x${want.toString(16).padStart(16, '0')}`);
    }
  });
});

describe('xoshiro128**', () => {
  it('reproduces the official sequence from state [1,2,3,4]', () => {
    const r = new Xoshiro128ss([1, 2, 3, 4]);
    expect([0, 1, 2, 3, 4, 5].map(() => r.next())).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492,
    ]);
  });
  it('below(n) uses the documented rejection limits', () => {
    for (const [n, limit] of [
      [37, 4294967289],
      [38, 4294967290],
      [39, 4294967274],
    ] as const) {
      expect(0x100000000 - (0x100000000 % n)).toBe(limit);
    }
  });
  it('below(n) rejects u >= limit and redraws', () => {
    // A stub whose first draw is rejected for n = 37 (u = 4294967289 >= limit) then accepted.
    const r = new Xoshiro128ss([1, 2, 3, 4]);
    const seq: number[] = [4294967289, 74];
    let i = 0;
    r.next = () => seq[i++]!;
    expect(r.below(37)).toBe(74 % 37);
    expect(i).toBe(2);
  });
  it('below validates n', () => {
    const r = new Xoshiro128ss([1, 2, 3, 4]);
    expect(() => r.below(0)).toThrow(RangeError);
    expect(() => r.below(Number.NaN)).toThrow(RangeError);
    expect(r.below(1)).toBe(0);
    expect(r.below(2 ** 32)).toBeGreaterThanOrEqual(0);
  });
  it('float53 is in [0, 1) and consumes exactly two draws', () => {
    const a = new Xoshiro128ss([1, 2, 3, 4]);
    const b = a.clone();
    const x = a.float53();
    b.next();
    b.next();
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(1);
  });
  it('snapshot returns a copy; an all-zero state is repaired', () => {
    const r = new Xoshiro128ss([0, 0, 0, 0]);
    expect(r.snapshot()).toEqual([1, 0, 0, 0]);
    const snap = r.snapshot();
    r.next();
    expect(snap).toEqual([1, 0, 0, 0]);
  });
  it('below(37) is uniform over 1e6 draws (chi-square, 36 df)', () => {
    const r = sessionRng(42, 0, 'engine');
    const counts = new Array<number>(37).fill(0);
    const N = 1_000_000;
    for (let i = 0; i < N; i++) counts[r.below(37)]!++;
    const expected = N / 37;
    const chi = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    // p = 1e-4 critical value for 36 degrees of freedom is about 71.
    expect(chi).toBeLessThan(75);
  });
});

describe('session streams (harness-data-analysis.md §1.3 vectors)', () => {
  it.each(SESSION_VECTORS.map((v) => [`runSeed ${v.runSeed} session ${v.index}`, v] as const))(
    '%s',
    (_name, v) => {
      const base = new Uint32Array(2);
      runBase(v.runSeed, base);
      expect(hex64(base[0]!, base[1]!)).toBe(v.base);

      const seed = new Uint32Array(2);
      sessionSeed(v.runSeed, v.index, seed);
      expect(hex64(seed[0]!, seed[1]!)).toBe(v.sessionSeed);

      const engine = sessionRng(v.runSeed, v.index, 'engine');
      expect(Array.from(engine.s, hex32)).toEqual(v.engineState);
      const first3 = engine.clone();
      expect([first3.next(), first3.next(), first3.next()]).toEqual(v.u32);
      const e37 = engine.clone();
      expect(Array.from({ length: 10 }, () => e37.below(37))).toEqual(v.spins37);
      const e38 = engine.clone();
      expect(Array.from({ length: 10 }, () => e38.below(38))).toEqual(v.spins38);

      const strategy = sessionRng(v.runSeed, v.index, 'strategy');
      expect(hex32(strategy.s[0]!)).toBe(v.stratS0);
    },
  );

  it('reuses the target object and is independent of call order', () => {
    const into = new Xoshiro128ss([1, 0, 0, 0]);
    const a = sessionRng(7, 5, 'engine', into);
    expect(a).toBe(into);
    const snap = a.snapshot();
    sessionRng(7, 6, 'engine', into);
    sessionRng(7, 5, 'engine', into);
    expect(into.snapshot()).toEqual(snap);
  });
  it('the strategy stream differs from the engine stream', () => {
    expect(sessionRng(1, 0, 'strategy').snapshot()).not.toEqual(
      sessionRng(1, 0, 'engine').snapshot(),
    );
  });
  it('seedXoshiro is the documented rule', () => {
    const a = seedXoshiro(0, 0xe220a839, new Xoshiro128ss([1, 0, 0, 0]));
    const out = new Uint32Array(2);
    splitmixAt(0, 0xe220a839, 1, out);
    expect([a.s[0], a.s[1]]).toEqual([out[1], out[0]]);
  });
  it('rejects bad seeds and indices', () => {
    expect(() => sessionRng(-1, 0, 'engine')).toThrow(RangeError);
    expect(() => sessionRng(2 ** 32, 0, 'engine')).toThrow(RangeError);
    expect(() => sessionRng(1, -1, 'engine')).toThrow(RangeError);
    expect(() => sessionRng(1, 1.5, 'engine')).toThrow(RangeError);
  });
});
