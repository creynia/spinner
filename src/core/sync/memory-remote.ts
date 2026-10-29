// An in-memory RemoteStore for tests and the fuzz (sync.md §11.1). STUB from WP-S0; WP-S2b writes
// the body.
import type { RemoteError, RemoteStore } from '../contracts/sync';
import { notImplemented } from './stub';

export interface MemoryRemoteOptions {
  /**
   * Return an error to make the named operation fail (crash injection). `phase` is `'before'`
   * (the call has no effect) or `'after'` (the effect happened but the caller sees the error: a
   * lost response). A fault without a phase argument means `'before'`.
   */
  fault?: (op: string, name?: string, phase?: 'before' | 'after') => RemoteError | undefined;
  /**
   * Listing lag (S-B): a freshly created `lib.*` file is hidden from `list()` for this many calls,
   * as Drive listings can lag a create. `ownLib` comes from `syncMeta.files`, not the listing.
   */
  listingLag?: { ownLib: number };
  /** Awaited before every remote call: the fuzz interleaves other devices here (§11.1). */
  hook?: (op: string) => Promise<void>;
}

export function createMemoryRemote(_o?: MemoryRemoteOptions): RemoteStore {
  return notImplemented('S2b', 'createMemoryRemote');
}
