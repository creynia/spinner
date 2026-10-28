// SplitMix64 with 64-bit values held as [hi, lo] uint32 pairs; no BigInt in the hot path.
// harness-data-analysis.md §1.2 (verified against a BigInt reference in the doc's review).

export const G_HI = 0x9e3779b9;
export const G_LO = 0x7f4a7c15;
/** ASCII "STRATEGY": XORed into the session seed to derive the strategy stream (§1.1). */
export const STRATEGY_SALT_HI = 0x53545241;
export const STRATEGY_SALT_LO = 0x54454759;

/** (a*b) mod 2^64 for a = (ah,al), b = (bh,bl); 16-bit limbs for the low product, Math.imul for the cross terms. */
function mul64(ah: number, al: number, bh: number, bl: number, out: Uint32Array): void {
  const a0 = al & 0xffff,
    a1 = al >>> 16,
    b0 = bl & 0xffff,
    b1 = bl >>> 16;
  const p00 = a0 * b0,
    p01 = a0 * b1,
    p10 = a1 * b0,
    p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  out[1] = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0; // lo
  out[0] =
    (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16) + Math.imul(ah, bl) + Math.imul(al, bh)) >>>
    0; // hi
}

function add64(ah: number, al: number, bh: number, bl: number, out: Uint32Array): void {
  const lo = (al + bl) >>> 0;
  out[0] = (ah + bh + (lo < al ? 1 : 0)) >>> 0;
  out[1] = lo;
}

/** mix64 of (h, l), written to `out` = [hi, lo]. `out` may alias nothing the caller still needs. */
export function mix64(h: number, l: number, out: Uint32Array): void {
  let nl = (l ^ ((l >>> 30) | (h << 2))) >>> 0,
    nh = (h ^ (h >>> 30)) >>> 0;
  mul64(nh, nl, 0xbf58476d, 0x1ce4e5b9, out);
  nh = out[0]!;
  nl = out[1]!;
  nl = (nl ^ ((nl >>> 27) | (nh << 5))) >>> 0;
  nh = (nh ^ (nh >>> 27)) >>> 0;
  mul64(nh, nl, 0x94d049bb, 0x133111eb, out);
  nh = out[0]!;
  nl = out[1]!;
  out[0] = (nh ^ (nh >>> 31)) >>> 0;
  out[1] = (nl ^ ((nl >>> 31) | (nh << 1))) >>> 0;
}

/** k-th SplitMix64 output (k >= 1) from state s = (sh, sl): mix64(s + k*gamma). k <= 2^32 - 1. */
export function splitmixAt(sh: number, sl: number, k: number, out: Uint32Array): void {
  mul64(0, k >>> 0, G_HI, G_LO, out); // k*gamma
  add64(sh, sl, out[0]!, out[1]!, out);
  mix64(out[0]!, out[1]!, out);
}
