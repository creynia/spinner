// Fingerprints and entry construction (sync.md §7.2). STUB from WP-S0; WP-S2a writes the bodies.
import type { Json } from '../contracts/game';
import type { DeviceId, Hlc, SyncEntry, SyncKind, SyncValueByKind } from '../contracts/sync';
import { notImplemented, notImplementedAsync } from './stub';

/** The value that is hashed: volatile fields left out, unknown keys kept. */
export function fingerprintValue(_kind: SyncKind, _value: unknown): Json {
  return notImplemented('S2a', 'fingerprintValue');
}

/** basis = base?.hlc, vv = base.vv + self (a fresh `vvCounter` value is the caller's to pass in). */
export function entryOf<K extends SyncKind>(
  _kind: K,
  _id: string,
  _value: SyncValueByKind[K] | null,
  _hlc: Hlc,
  _base: SyncEntry | undefined,
  _self: DeviceId,
): Promise<SyncEntry<K>> {
  return notImplementedAsync('S2a', 'entryOf');
}

export function verifyEntry(
  _e: SyncEntry,
): Promise<'ok' | 'bad-hash' | 'bad-id' | 'unknown-kind' | 'newer'> {
  return notImplementedAsync('S2a', 'verifyEntry');
}

/** Highest record schema `v` per kind this build understands; newer entries are kept opaque. */
export const SUPPORTED_V: Record<SyncKind, number> = {
  def: 1,
  strategy: 1,
  layout: 1,
  group: 1,
  setting: 1,
  run: 1,
};
