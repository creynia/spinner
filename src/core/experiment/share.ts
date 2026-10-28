import type { ExperimentDefinition, Json, NormalizedDefinition } from '../contracts/experiment';
import { DEFINITION_SCHEMA, SHARE_LINK_MAX_CHARS } from '../contracts/experiment';
import {
  base64Decode,
  base64UrlEncode,
  compressBytes,
  decompressBytes,
  hasCompression,
} from './bytes';
import { canonicalJson } from './canonical';
import { sha256Hex, utf8Decode, utf8Encode } from './sha256';
import { DefinitionFormatError, migrateDefinition } from './migrate';

/** Largest inflated payload a link may carry (guards against decompression bombs). */
export const SHARE_INFLATED_MAX_BYTES = 1_048_576;
/** What the app says when `encodeShareLink` returns `tooLong` (§8.4). */
export const SHARE_FALLBACK_NOTICE = 'too long for a link: export the definition file';

/**
 * `#/define?d=<payload>&h=<first 12 hex of the id>` (§8.4). `'z'` + base64url(deflate-raw) when
 * `CompressionStream` exists, else `'j'` + base64url(utf8). Over 8000 payload characters there is
 * no link: the app offers the definition file instead.
 */
export async function encodeShareLink(
  d: NormalizedDefinition,
): Promise<{ hash: string } | { tooLong: true; chars: number }> {
  const json = canonicalJson(d as unknown as Json);
  const bytes = utf8Encode(json);
  let payload: string;
  if (hasCompression()) {
    try {
      payload = 'z' + base64UrlEncode(await compressBytes(bytes, 'deflate-raw'));
    } catch {
      payload = 'j' + base64UrlEncode(bytes);
    }
  } else {
    payload = 'j' + base64UrlEncode(bytes);
  }
  if (payload.length > SHARE_LINK_MAX_CHARS) return { tooLong: true, chars: payload.length };
  const h = (await sha256Hex(json)).slice(0, 12);
  return { hash: `#/define?d=${payload}&h=${h}` };
}

/**
 * Decodes `d` (and checks `h`). Throws `DefinitionFormatError` for a damaged or unsupported link.
 * `checkedOk` is `null` when there is no `h` or the payload's schema is not current; `false` is
 * "link damaged or edited". The result is migrated but not normalized: the caller normalizes,
 * validates and shows it as an unsaved draft.
 */
export async function decodeShareLink(
  hashParams: URLSearchParams,
): Promise<{ definition: ExperimentDefinition; checksumOk: boolean | null }> {
  const payload = hashParams.get('d');
  if (!payload) throw new DefinitionFormatError('link has no definition');
  const kind = payload[0];
  let bytes: Uint8Array;
  try {
    bytes = base64Decode(payload.slice(1));
  } catch {
    throw new DefinitionFormatError('link damaged: not base64');
  }
  if (kind === 'z') {
    if (!hasCompression())
      throw new DefinitionFormatError('this browser is too old to open this link');
    try {
      bytes = await decompressBytes(bytes, 'deflate-raw', SHARE_INFLATED_MAX_BYTES);
    } catch {
      throw new DefinitionFormatError('link damaged: cannot inflate');
    }
  } else if (kind !== 'j') {
    throw new DefinitionFormatError('link made with a newer version');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new DefinitionFormatError('link damaged: not JSON');
  }
  const definition = migrateDefinition(raw);
  const h = hashParams.get('h');
  let checksumOk: boolean | null = null;
  if (h && (raw as { schema?: unknown }).schema === DEFINITION_SCHEMA) {
    checksumOk = (await sha256Hex(canonicalJson(raw as Json))).startsWith(h.toLowerCase());
  }
  return { definition, checksumOk };
}

/** `definition.json`: pretty JSON with 2-space indentation and sorted keys (§10.3). */
export function exportDefinitionFile(d: NormalizedDefinition | ExperimentDefinition): string {
  return JSON.stringify(JSON.parse(canonicalJson(d as unknown as Json)), null, 2) + '\n';
}

/** The export-file fallback of a too-long link: parses, migrates; the caller normalizes. */
export function importDefinitionFile(text: string): ExperimentDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DefinitionFormatError('not a definition file: not JSON');
  }
  return migrateDefinition(raw);
}
