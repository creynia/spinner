import type { Json } from '../contracts/experiment';

/**
 * Canonical JSON: RFC 8785 (JCS) restricted to our value space (harness-data-analysis.md §8.2).
 * Keys sorted by UTF-16 code units, no whitespace, numbers via `JSON.stringify` (so `-0` is `0`),
 * `undefined` members omitted. Throws on `NaN` and `±Infinity`.
 */
export function canonicalJson(v: Json): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number':
      if (!Number.isFinite(v)) throw new Error('canonicalJson: non-finite number');
      return JSON.stringify(Object.is(v, -0) ? 0 : v);
    case 'string':
    case 'boolean':
      return JSON.stringify(v);
    case 'undefined':
      throw new Error('canonicalJson: undefined at the top level or in an array');
  }
  if (Array.isArray(v)) {
    let out = '[';
    for (let i = 0; i < v.length; i++) out += (i > 0 ? ',' : '') + canonicalJson(v[i] as Json);
    return out + ']';
  }
  const obj = v as { [k: string]: Json | undefined };
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  let out = '{';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i] as string;
    out += (i > 0 ? ',' : '') + JSON.stringify(k) + ':' + canonicalJson(obj[k] as Json);
  }
  return out + '}';
}
