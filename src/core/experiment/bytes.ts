// Byte helpers shared by the definition layer and the store: base64 (RFC 4648 §4 and §5),
// and compression through the platform streams. No Node APIs.

const B64S = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64 = Array.from(B64S);
const B64_REV = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_REV[B64S.charCodeAt(i)] = i;
B64_REV['-'.charCodeAt(0)] = 62;
B64_REV['_'.charCodeAt(0)] = 63;

/** Standard base64 with padding. */
export function base64Encode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    chunk +=
      (B64[v >> 18] as string) +
      (B64[(v >> 12) & 63] as string) +
      (B64[(v >> 6) & 63] as string) +
      (B64[v & 63] as string);
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  if (i + 1 === n) {
    const v = (bytes[i] as number) << 16;
    chunk += (B64[v >> 18] as string) + (B64[(v >> 12) & 63] as string) + '==';
  } else if (i + 2 === n) {
    const v = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    chunk +=
      (B64[v >> 18] as string) +
      (B64[(v >> 12) & 63] as string) +
      (B64[(v >> 6) & 63] as string) +
      '=';
  }
  parts.push(chunk);
  return parts.join('');
}

/** Base64url (RFC 4648 §5), no padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes standard or url-safe base64, with or without padding. Throws on invalid input. */
export function base64Decode(s: string): Uint8Array {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 61) end--;
  if (s.length - end > 2) throw new Error('invalid base64: too much padding');
  if (end % 4 === 1) throw new Error('invalid base64: bad length');
  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < end; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? (B64_REV[c] as number) : -1;
    if (v < 0) throw new Error('invalid base64: bad character');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

export type CompressionFormat = 'gzip' | 'deflate-raw';

/** True when the platform has both `CompressionStream` and `DecompressionStream`. */
export function hasCompression(): boolean {
  const g = globalThis as Record<string, unknown>;
  return typeof g.CompressionStream === 'function' && typeof g.DecompressionStream === 'function';
}

export async function compressBytes(
  bytes: Uint8Array,
  format: CompressionFormat,
): Promise<Uint8Array> {
  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  const done = (async () => {
    await writer.write(bytes as unknown as BufferSource);
    await writer.close();
  })();
  const out = new Response(cs.readable).arrayBuffer();
  const [buf] = await Promise.all([out, done]);
  return new Uint8Array(buf);
}

/** Inflates `bytes`; rejects when the output would exceed `maxBytes` (decompression bombs). */
export async function decompressBytes(
  bytes: Uint8Array,
  format: CompressionFormat,
  maxBytes: number,
): Promise<Uint8Array> {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  const writing = (async () => {
    try {
      await writer.write(bytes as unknown as BufferSource);
      await writer.close();
    } catch {
      // the reader reports the error
    }
  })();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RangeError('decompressed data is too large');
      }
      chunks.push(value);
    }
  } finally {
    await writing;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}
