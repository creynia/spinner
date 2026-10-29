// Version vectors (sync.md §7.4). STUB from WP-S0; WP-S2a writes the bodies.
import type { SyncEntry } from '../contracts/sync';
import { notImplemented } from './stub';

/** A descends from B iff vv(A) >= vv(B) pointwise (equal vectors descend from each other). */
export function descends(_a: SyncEntry, _b: SyncEntry): boolean {
  return notImplemented('S2a', 'descends');
}
/** Neither descends from the other. */
export function concurrent(_a: SyncEntry, _b: SyncEntry): boolean {
  return notImplemented('S2a', 'concurrent');
}
