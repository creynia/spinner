// xoshiro128**: mutable and allocation-free (harness-data-analysis.md §1.2). The step and the
// `below` rejection rule are identical to the sibling apps, so a pocket drawn from a given state is
// the same in every app of the family.
import type { Rng } from '../contracts/game';

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

export class Xoshiro128ss implements Rng {
  readonly s = new Uint32Array(4);

  constructor(state?: ArrayLike<number>) {
    if (state) this.setState(state);
  }

  /** Overwrite the four state words (reduced mod 2^32). An all-zero state is replaced by [1,0,0,0]. */
  setState(state: ArrayLike<number>): this {
    if (state.length !== 4) throw new RangeError('xoshiro128** state needs 4 words');
    for (let i = 0; i < 4; i++) this.s[i] = state[i]!;
    if ((this.s[0]! | this.s[1]! | this.s[2]! | this.s[3]!) === 0) this.s[0] = 1;
    return this;
  }

  copyFrom(other: Xoshiro128ss): this {
    this.s.set(other.s);
    return this;
  }

  clone(): Xoshiro128ss {
    return new Xoshiro128ss(this.s);
  }

  /** Next uint32. */
  next(): number {
    const s = this.s;
    const s0 = s[0]!,
      s1 = s[1]!;
    const r = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    const n2 = (s[2]! ^ s0) >>> 0,
      n3 = (s[3]! ^ s1) >>> 0;
    s[1] = s1 ^ n2;
    s[0] = s0 ^ n3;
    s[2] = n2 ^ t;
    s[3] = rotl(n3, 11); // Uint32Array stores mod 2^32
    return r;
  }

  /** Uniform in [0, n), 1 <= n <= 2^32, by rejection (`u >= 2^32 - 2^32 mod n` is redrawn). */
  below(n: number): number {
    if (!(n >= 1 && n <= 0x100000000)) throw new RangeError('below(n) needs 1 <= n <= 2^32');
    const limit = 0x100000000 - (0x100000000 % n);
    for (;;) {
      const u = this.next();
      if (u < limit) return u % n;
    }
  }

  /** Uniform double in [0, 1) with 53 random bits; consumes exactly two `next()` calls. */
  float53(): number {
    const a = this.next() >>> 5,
      b = this.next() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** Copy of the state words, for traces and tests. */
  snapshot(): [number, number, number, number] {
    const s = this.s;
    return [s[0]!, s[1]!, s[2]!, s[3]!];
  }
}
