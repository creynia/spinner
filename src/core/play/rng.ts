// Random sources for play mode. The default draws every spin from the platform CSPRNG
// (crypto.getRandomValues), buffered, with the same unbiased rejection rule as Xoshiro128ss.below;
// a seeded session uses xoshiro128** so it can be replayed exactly.
import type { Rng } from '../contracts/game';
import { Xoshiro128ss, seedXoshiro } from '../rng';
import type { PlayRngSpec } from './types';

const BUFFER = 256;

type Fill = (a: Uint32Array) => void;

function platformFill(): Fill {
  const c = (globalThis as { crypto?: { getRandomValues?(a: Uint32Array): Uint32Array } }).crypto;
  if (!c || typeof c.getRandomValues !== 'function')
    throw new Error('play: crypto.getRandomValues is not available');
  return (a) => void c.getRandomValues!(a);
}

/** Uniform uint32s from the platform CSPRNG. Stateless as far as callers can tell. */
export class CryptoRng implements Rng {
  private readonly buf = new Uint32Array(BUFFER);
  private pos = BUFFER;
  private readonly fill: Fill;

  /** `fill` is for tests; the default is `crypto.getRandomValues`. */
  constructor(fill?: Fill) {
    this.fill = fill ?? platformFill();
  }

  next(): number {
    if (this.pos >= BUFFER) {
      this.fill(this.buf);
      this.pos = 0;
    }
    return this.buf[this.pos++]! >>> 0;
  }

  /** Uniform in [0, n), 1 <= n <= 2^32, by rejection (no modulo bias). */
  below(n: number): number {
    if (!(n >= 1 && n <= 0x100000000)) throw new RangeError('below(n) needs 1 <= n <= 2^32');
    const limit = 0x100000000 - (0x100000000 % n);
    for (;;) {
      const u = this.next();
      if (u < limit) return u % n;
    }
  }

  /** Uniform double in [0, 1) with 53 random bits (two draws, as Xoshiro128ss.float53). */
  float53(): number {
    const a = this.next() >>> 5,
      b = this.next() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** There is no state to replay; four zero words keep the `Rng` snapshot shape. */
  snapshot(): readonly number[] {
    return [0, 0, 0, 0];
  }
}

/** A random uint32 from the platform CSPRNG (a fresh seed for a seeded session). */
export function randomSeed(): number {
  const a = new Uint32Array(1);
  platformFill()(a);
  return a[0]! >>> 0;
}

/** The xoshiro128** state words a seeded session starts from. */
export function seededState(seed: number): number[] {
  return [...seedXoshiro(0, seed >>> 0, new Xoshiro128ss([1, 0, 0, 0])).snapshot()];
}

/** The Rng for the next spin of a session with `spec` (seeded: continue from `state`). */
export function rngFor(spec: PlayRngSpec, state?: readonly number[]): Rng {
  if (spec.kind === 'crypto') return new CryptoRng();
  return new Xoshiro128ss(state && state.length === 4 ? state : seededState(spec.seed));
}
