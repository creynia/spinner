// Erase the remote, reset local sync state (sync.md §7.10). STUB from WP-S0; WP-S2c writes the bodies.
import type { SyncCtx } from './ctx';
import { notImplementedAsync } from './stub';

export function eraseRemote(_ctx: SyncCtx): Promise<void> {
  return notImplementedAsync('S2c', 'eraseRemote');
}
/** Clears syncIndex/syncDirty and the sync metadata, but never `vvCounter` (N1). */
export function resetLocalSyncState(_ctx: SyncCtx): Promise<void> {
  return notImplementedAsync('S2c', 'resetLocalSyncState');
}
