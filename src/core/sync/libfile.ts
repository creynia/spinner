// The per-device library file (sync.md §6): canonical JSON, gzip.
import type { Json } from '../contracts/game';
import { DEVICE_ID_PATTERN, HLC_PATTERN, type DeviceId, type LibFileV1 } from '../contracts/sync';
import {
  canonicalJson,
  compressBytes,
  decompressBytes,
  isGzip,
  utf8Decode,
  utf8Encode,
} from '../experiment';

/** Why a lib file was refused. */
export type LibFileErrorCode =
  'not-gzip' | 'too-large' | 'bad-json' | 'bad-format' | 'newer-version' | 'bad-shape';

export class LibFileError extends Error {
  readonly code: LibFileErrorCode;
  constructor(code: LibFileErrorCode, message: string) {
    super(message);
    this.name = 'LibFileError';
    this.code = code;
  }
}

/** A lib file inflates to at most this many bytes (decompression-bomb guard). */
export const LIB_MAX_BYTES = 128 * 1024 * 1024;

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function encodeLib(f: LibFileV1): Promise<Uint8Array> {
  const sorted: LibFileV1 = { ...f, entries: [...f.entries].sort((a, b) => cmpStr(a.key, b.key)) };
  return compressBytes(utf8Encode(canonicalJson(sorted as unknown as Json)), 'gzip');
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export async function decodeLib(b: Uint8Array): Promise<LibFileV1> {
  if (!isGzip(b)) throw new LibFileError('not-gzip', 'lib file is not gzip');
  let text: string;
  try {
    text = utf8Decode(await decompressBytes(b, 'gzip', LIB_MAX_BYTES));
  } catch (e) {
    if (e instanceof RangeError) throw new LibFileError('too-large', 'lib file is too large');
    throw new LibFileError('bad-json', 'lib file does not inflate');
  }
  let f: unknown;
  try {
    f = JSON.parse(text);
  } catch {
    throw new LibFileError('bad-json', 'lib file is not JSON');
  }
  if (!isObj(f) || f.format !== 'spinner-sync-lib') {
    throw new LibFileError('bad-format', 'not a spinner-sync lib file');
  }
  if (typeof f.version === 'number' && f.version > 1) {
    throw new LibFileError('newer-version', `lib file version ${f.version} is newer than 1`);
  }
  const dev = f.device;
  if (
    f.version !== 1 ||
    !isObj(dev) ||
    typeof dev.id !== 'string' ||
    !DEVICE_ID_PATTERN.test(dev.id) ||
    typeof dev.name !== 'string' ||
    typeof f.hlc !== 'string' ||
    !HLC_PATTERN.test(f.hlc) ||
    typeof f.writtenAt !== 'string' ||
    !Array.isArray(f.entries) ||
    !f.entries.every((e) => isObj(e) && typeof e.key === 'string' && typeof e.kind === 'string')
  ) {
    throw new LibFileError('bad-shape', 'lib file has the wrong shape');
  }
  return f as unknown as LibFileV1;
}

/** `lib.<deviceId>.json.gz` */
export const LIB_NAME = (d: DeviceId): string => `lib.${d}.json.gz`;
export const ROOT_NAME = 'spinner-sync.json';
/** `run.<runId>.<digest first 16>.spinner.json.gz` */
export const runBundleName = (runId: string, digest: string): string =>
  `run.${runId}.${digest.slice(0, 16)}.spinner.json.gz`;
