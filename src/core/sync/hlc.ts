// Hybrid logical clock (sync.md §7.1). STUB from WP-S0; WP-S2a writes the bodies.
import type { DeviceId, Hlc } from '../contracts/sync';
import { notImplemented } from './stub';

export interface HlcClock {
  /** Mint an HLC from an edit time (`syncDirty.last`), not the push time. */
  tickAt(editMs: number): Hlc;
  /** Fold a remote HLC into the clock. */
  recv(remote: Hlc): void;
  readonly last: Hlc;
}

export function createClock(_device: DeviceId, _now: () => number, _last?: Hlc): HlcClock {
  return notImplemented('S2a', 'createClock');
}
export function hlcDevice(_h: Hlc): DeviceId {
  return notImplemented('S2a', 'hlcDevice');
}
export function hlcWall(_h: Hlc): number {
  return notImplemented('S2a', 'hlcWall');
}
/** String order is causal order; negative, zero or positive like `Array.sort`. */
export function cmpHlc(_a: Hlc, _b: Hlc): number {
  return notImplemented('S2a', 'cmpHlc');
}
