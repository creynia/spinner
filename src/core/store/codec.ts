// Typed-array codecs of the run bundle (harness-data-analysis.md §10.1): `le`, `zv`, `dzv`.
// Pure, deterministic, explicitly little-endian (DataView), so re-encoding reproduces the bytes.
import type { Dtype } from '../contracts/run';
import { base64Decode, base64Encode } from '../experiment';
import { allocate, bytesPerValue, type TypedArray } from './columns';

export type Encoding = 'le' | 'zv' | 'dzv';

export interface EncodedArray {
  name?: string;
  dtype: Dtype;
  shape: number[];
  encoding: Encoding;
  /** base64, RFC 4648 §4, padded. */
  data: string;
}

/** Largest magnitude zigzag-varint encodes exactly in a double (2v and -2v-1 stay below 2^53). */
const ZV_LIMIT = 2 ** 52 - 1;
/** Sanity cap on decoded values (a hostile `shape`). */
const MAX_VALUES = 2 ** 28;

class ByteWriter {
  buf = new Uint8Array(1 << 16);
  len = 0;
  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  /** Unsigned LEB128 of a non-negative integer below 2^53. */
  varint(x: number): void {
    this.ensure(9);
    while (x >= 128) {
      this.buf[this.len++] = (x % 128) | 128;
      x = Math.floor(x / 128);
    }
    this.buf[this.len++] = x;
  }
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

const zigzag = (v: number): number => (v >= 0 ? 2 * v : -2 * v - 1);
const unzigzag = (u: number): number => (u % 2 === 0 ? u / 2 : -(u + 1) / 2);

function leEncode(a: TypedArray, dtype: Dtype): Uint8Array {
  const out = new Uint8Array(a.length * bytesPerValue(dtype));
  const dv = new DataView(out.buffer);
  for (let i = 0; i < a.length; i++) {
    const v = a[i] as number;
    switch (dtype) {
      case 'u8':
        dv.setUint8(i, v);
        break;
      case 'u16':
        dv.setUint16(i * 2, v, true);
        break;
      case 'i32':
        dv.setInt32(i * 4, v, true);
        break;
      default:
        dv.setFloat64(i * 8, v, true);
    }
  }
  return out;
}

function leDecode(bytes: Uint8Array, dtype: Dtype, count: number): TypedArray {
  const out = allocate(dtype, count);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) {
    switch (dtype) {
      case 'u8':
        out[i] = dv.getUint8(i);
        break;
      case 'u16':
        out[i] = dv.getUint16(i * 2, true);
        break;
      case 'i32':
        out[i] = dv.getInt32(i * 4, true);
        break;
      default:
        out[i] = dv.getFloat64(i * 8, true);
    }
  }
  return out;
}

/** The default encoding of a summary column (§10.1): `f64` is always `le`. */
export function defaultEncoding(dtype: Dtype): Encoding {
  return dtype === 'f64' || dtype === 'u8' ? 'le' : 'zv';
}

export function encodeArray(
  a: TypedArray,
  dtype: Dtype,
  shape: number[],
  encoding: Encoding,
  name?: string,
): EncodedArray {
  const count = shape.reduce((x, y) => x * y, 1);
  if (a.length !== count) throw new Error(`array length ${a.length} does not match shape`);
  let enc: Encoding = encoding;
  let bytes: Uint8Array;
  if (enc !== 'le') {
    // `zv` needs integers within +-2^52; anything else (never produced by the harness) is `le`.
    let ok = dtype !== 'f64';
    for (let i = 0; ok && i < a.length; i++) {
      const v = a[i] as number;
      if (!Number.isInteger(v) || Math.abs(v) > ZV_LIMIT) ok = false;
    }
    if (!ok) enc = 'le';
  }
  if (enc === 'le') {
    bytes = leEncode(a, dtype);
  } else {
    const w = new ByteWriter();
    const last = shape.length > 0 ? (shape[shape.length - 1] as number) : 1;
    let prev = 0;
    for (let i = 0; i < a.length; i++) {
      const v = a[i] as number;
      if (enc === 'dzv') {
        if (i % last === 0) prev = 0;
        w.varint(zigzag(v - prev));
        prev = v;
      } else {
        w.varint(zigzag(v));
      }
    }
    bytes = w.bytes();
  }
  return {
    ...(name !== undefined ? { name } : {}),
    dtype,
    shape,
    encoding: enc,
    data: base64Encode(bytes),
  };
}

/** Decodes and validates one array; throws `Error` with a precise message on any mismatch. */
export function decodeArray(e: EncodedArray, what: string): TypedArray {
  if (typeof e !== 'object' || e === null) throw new Error(`${what}: not an encoded array`);
  if (!['i32', 'u8', 'u16', 'f64', 'f64i'].includes(e.dtype))
    throw new Error(`${what}: unknown dtype`);
  if (!['le', 'zv', 'dzv'].includes(e.encoding)) throw new Error(`${what}: unknown encoding`);
  if (!Array.isArray(e.shape) || !e.shape.every((n) => Number.isSafeInteger(n) && n >= 0)) {
    throw new Error(`${what}: bad shape`);
  }
  const count = e.shape.reduce((x, y) => x * y, 1);
  if (count > MAX_VALUES) throw new Error(`${what}: too large`);
  if (typeof e.data !== 'string') throw new Error(`${what}: data is not a string`);
  let bytes: Uint8Array;
  try {
    bytes = base64Decode(e.data);
  } catch {
    throw new Error(`${what}: data is not base64`);
  }
  if (e.encoding === 'le') {
    if (bytes.length !== count * bytesPerValue(e.dtype)) {
      throw new Error(`${what}: data length does not match shape`);
    }
    return leDecode(bytes, e.dtype, count);
  }
  const out = allocate(e.dtype, count);
  const last = e.shape.length > 0 ? (e.shape[e.shape.length - 1] as number) : 1;
  let p = 0;
  let prev = 0;
  for (let i = 0; i < count; i++) {
    let u = 0;
    let scale = 1;
    for (let k = 0; ; k++) {
      if (p >= bytes.length) throw new Error(`${what}: data length does not match shape`);
      if (k >= 8) throw new Error(`${what}: bad varint`);
      const b = bytes[p++] as number;
      u += (b & 127) * scale;
      scale *= 128;
      if (b < 128) break;
    }
    let v = unzigzag(u);
    if (e.encoding === 'dzv') {
      if (i % last === 0) prev = 0;
      v += prev;
      prev = v;
    }
    if (e.dtype !== 'f64i' && e.dtype !== 'f64') {
      const lo = e.dtype === 'i32' ? -2147483648 : 0;
      const hi = e.dtype === 'i32' ? 2147483647 : e.dtype === 'u16' ? 65535 : 255;
      if (v < lo || v > hi) throw new Error(`${what}: value out of range`);
    }
    out[i] = v;
  }
  if (p !== bytes.length) throw new Error(`${what}: data length does not match shape`);
  return out;
}
