// First sync and re-seed (sync.md §7.3, §7.9, §8.3). STUB from WP-S0; WP-S2c writes the bodies.
import type { CycleResult, FirstSyncPreview } from '../contracts/sync';
import type { SyncCtx } from './ctx';
import { notImplementedAsync } from './stub';

export function previewFirst(_ctx: SyncCtx): Promise<FirstSyncPreview> {
  return notImplementedAsync('S2c', 'previewFirst');
}
export function beginFirst(_ctx: SyncCtx, _choice: 'merge' | 'replace'): Promise<CycleResult> {
  return notImplementedAsync('S2c', 'beginFirst');
}
/** Own lib file missing: keep `syncIndex` and `vvCounter`, rewrite the lib, no false copies. */
export function reseed(_ctx: SyncCtx): Promise<void> {
  return notImplementedAsync('S2c', 'reseed');
}
