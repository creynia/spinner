// The per-device library file (sync.md §6). STUB from WP-S0; WP-S2a writes the bodies.
import type { DeviceId, LibFileV1 } from '../contracts/sync';
import { notImplemented, notImplementedAsync } from './stub';

export function encodeLib(_f: LibFileV1): Promise<Uint8Array> {
  return notImplementedAsync('S2a', 'encodeLib');
}
export function decodeLib(_b: Uint8Array): Promise<LibFileV1> {
  return notImplementedAsync('S2a', 'decodeLib');
}
/** `lib.<deviceId>.json.gz` */
export const LIB_NAME = (_d: DeviceId): string => notImplemented('S2a', 'LIB_NAME');
export const ROOT_NAME = 'spinner-sync.json';
/** `run.<runId>.<digest first 16>.spinner.json.gz` */
export const runBundleName = (_runId: string, _digest: string): string =>
  notImplemented('S2a', 'runBundleName');
