// An in-memory RemoteStore for tests and the fuzz (sync.md §11.1). STUB from WP-S0; WP-S2b writes
// the body.
import type { RemoteError, RemoteStore } from '../contracts/sync';
import { notImplemented } from './stub';

export interface MemoryRemoteOptions {
  /** Return an error to make the named operation fail (crash injection). */
  fault?: (op: string, name?: string) => RemoteError | undefined;
  /** Awaited before every remote call: the fuzz interleaves other devices here (§11.1). */
  hook?: (op: string) => Promise<void>;
}

export function createMemoryRemote(_o?: MemoryRemoteOptions): RemoteStore {
  return notImplemented('S2b', 'createMemoryRemote');
}
