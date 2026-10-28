// Run seed -> session seeds -> engine and strategy streams (harness-data-analysis.md §1.1).
//
//   base            = mix64(runSeed)                                  once per run
//   sessionSeed(i)  = SplitMix64 output number (i + 1) from state base = mix64(base + (i+1)*gamma)
//   engineRng(i)    = xoshiro128** seeded by seedXoshiro(sessionSeed(i))
//   strategyRng(i)  = xoshiro128** seeded by seedXoshiro(sessionSeed(i) XOR STRATEGY_SALT)
//   seedXoshiro(x)  : a = mix64(x + gamma), b = mix64(x + 2*gamma)
//                     s = [lo32(a), hi32(a), lo32(b), hi32(b)]; if all zero, s[0] = 1
//
// Session i depends only on (runSeed, i): not on worker count, batch, chunk or execution order.
import { STRATEGY_SALT_HI, STRATEGY_SALT_LO, mix64, splitmixAt } from './splitmix64';
import { Xoshiro128ss } from './xoshiro128ss';

export type RngStream = 'engine' | 'strategy';

const tmp = new Uint32Array(2);
const seed = new Uint32Array(2);

/** Largest session index: SplitMix64 output number i + 1 must fit the 32-bit multiplier. */
export const MAX_SESSION_INDEX = 0xfffffffe;

function checkIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > MAX_SESSION_INDEX) {
    throw new RangeError(`session index out of range: ${index}`);
  }
}

/** `mix64(runSeed)` as [hi, lo]; `runSeed` is a uint32 (definition.run.seed). */
export function runBase(runSeed: number, out: Uint32Array): void {
  if (!Number.isInteger(runSeed) || runSeed < 0 || runSeed > 0xffffffff) {
    throw new RangeError(`runSeed must be a uint32: ${runSeed}`);
  }
  mix64(0, runSeed >>> 0, out);
}

/** The 64-bit session seed for session `index` as [hi, lo]. */
export function sessionSeed(runSeed: number, index: number, out: Uint32Array): void {
  checkIndex(index);
  runBase(runSeed, tmp);
  splitmixAt(tmp[0]!, tmp[1]!, index + 1, out);
}

/** Seed `into` from the 64-bit value (hi, lo) (the xoshiro seeding rule above). */
export function seedXoshiro(hi: number, lo: number, into: Xoshiro128ss): Xoshiro128ss {
  const s = into.s;
  splitmixAt(hi, lo, 1, tmp);
  s[0] = tmp[1]!;
  s[1] = tmp[0]!;
  splitmixAt(hi, lo, 2, tmp);
  s[2] = tmp[1]!;
  s[3] = tmp[0]!;
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1;
  return into;
}

/**
 * The RNG of session `index` for `stream`, written into `into` (allocated when omitted), so a hot
 * loop reuses one object per stream and allocates nothing per session.
 */
export function sessionRng(
  runSeed: number,
  index: number,
  stream: RngStream,
  into: Xoshiro128ss = new Xoshiro128ss([1, 0, 0, 0]),
): Xoshiro128ss {
  sessionSeed(runSeed, index, seed);
  const hi = stream === 'engine' ? seed[0]! : (seed[0]! ^ STRATEGY_SALT_HI) >>> 0;
  const lo = stream === 'engine' ? seed[1]! : (seed[1]! ^ STRATEGY_SALT_LO) >>> 0;
  return seedXoshiro(hi, lo, into);
}
