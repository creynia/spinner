// Version vectors (sync.md §7.4).
import type { SyncEntry } from '../contracts/sync';

/** A descends from B iff vv(A) >= vv(B) pointwise (equal vectors descend from each other). */
export function descends(a: SyncEntry, b: SyncEntry): boolean {
  for (const [d, n] of Object.entries(b.vv)) if ((a.vv[d] ?? 0) < n) return false;
  return true;
}
/** Neither descends from the other. */
export function concurrent(a: SyncEntry, b: SyncEntry): boolean {
  return !descends(a, b) && !descends(b, a);
}
