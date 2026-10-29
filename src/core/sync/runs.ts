// Run stubs and bundles (sync.md §7.6). STUB from WP-S0; WP-S2c writes the bodies.
import type { SyncCtx } from './ctx';
import type { DownloadRunOptions } from './engine';
import { notImplementedAsync } from './stub';

/** Upload bundles of finished local runs, before the lib file that references them. */
export function uploadPendingRuns(_ctx: SyncCtx, _deadline: number): Promise<void> {
  return notImplementedAsync('S2c', 'uploadPendingRuns');
}
export function downloadRun(
  _ctx: SyncCtx,
  _runId: string,
  _opts?: DownloadRunOptions,
): Promise<'ok' | 'missing' | 'corrupt'> {
  return notImplementedAsync('S2c', 'downloadRun');
}
/** Drop a run's results from this device; the stub and `definitions.runIds` stay. */
export function evictRun(_ctx: SyncCtx, _runId: string): Promise<void> {
  return notImplementedAsync('S2c', 'evictRun');
}
