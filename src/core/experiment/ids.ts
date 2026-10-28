import type { DefinitionId, Json, NormalizedDefinition, SimKey } from '../contracts/experiment';
import { canonicalJson } from './canonical';
import { sha256Hex } from './sha256';

/** `hex(sha256(utf8(canonicalJson(normalized))))`: the whole definition, names included (§8.3). */
export function definitionId(d: NormalizedDefinition): Promise<DefinitionId> {
  return sha256Hex(canonicalJson(d as unknown as Json));
}

/**
 * Ignores `name`, `notes`, `tags` and the strategy's `name`, `notes`, `tags`; includes the game
 * and core versions (§8.3). Finds "you already ran this" and lets a sweep reuse a finished run.
 */
export function simKey(
  d: NormalizedDefinition,
  gameVersion: string,
  coreVersion: string,
): Promise<SimKey> {
  const definition: Record<string, unknown> = { ...d };
  for (const k of ['name', 'notes', 'tags']) delete definition[k];
  const strategy: Record<string, unknown> = { ...d.strategy };
  for (const k of ['name', 'notes', 'tags']) delete strategy[k];
  definition.strategy = strategy;
  return sha256Hex(canonicalJson({ definition, gameVersion, coreVersion } as unknown as Json));
}

/** The key under which results must be identical (§8.3). */
export function runKey(
  definitionId: DefinitionId,
  gameVersion: string,
  coreVersion: string,
): Promise<string> {
  return sha256Hex(canonicalJson({ definitionId, gameVersion, coreVersion }));
}

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

/** 5 bytes -> 8 lowercase Crockford base32 characters. */
export function crockfordBase32(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | (bytes[i] as number);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out;
}

export const RUN_ID_PATTERN = /^[0-9a-f]{16}-[0-9a-hjkmnp-tv-z]{8}$/;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/**
 * `definitionId[0..16] + '-' + crockfordBase32(5 random bytes)`, for example
 * `f8126470b3609e8a-7k2m9qxd` (reconciliation E4). `random` is injectable for tests.
 */
export function newRunId(
  id: DefinitionId,
  random: (n: number) => Uint8Array = randomBytes,
): string {
  return `${id.slice(0, 16)}-${crockfordBase32(random(5))}`;
}

/** The 8-character suffix of a run id. */
export function runId8(runId: string): string {
  const i = runId.lastIndexOf('-');
  return runId.slice(i + 1);
}
