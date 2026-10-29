// The sync app service (sync.md §4.5). An INERT stub from WP-S0: the stores hold their idle
// defaults and every action resolves without doing anything, so WP-S4 builds the UI against it.
// WP-S5a replaces the bodies; WP-S3 makes `testSignIn` real. Signatures are frozen.
import type {
  AuthState,
  ConflictNotice,
  FirstSyncPreview,
  RunStub,
  SyncDevicePrefs,
  SyncStatus,
} from '@core';
import { createStore, type Store } from '../../state/store';

export const syncStatus: Store<SyncStatus> = createStore<SyncStatus>({
  state: 'off',
  pending: 0,
  remoteOnly: { runs: 0, bytes: 0 },
  conflicts: 0,
});
export const syncAuth: Store<AuthState> = createStore<AuthState>({ state: 'unconfigured' });
export const conflictNotices: Store<ConflictNotice[]> = createStore<ConflictNotice[]>([]);
export const syncPrefs: Store<SyncDevicePrefs> = createStore<SyncDevicePrefs>({
  enabled: false,
  deviceName: '',
  runDownload: 'onOpen',
});
/** Non-null while the first-sync sheet is due (§8.3). */
export const firstSyncPrompt: Store<FirstSyncPreview | null> = createStore<FirstSyncPreview | null>(
  null,
);

/** Click handlers only (a popup needs a user gesture). */
export function signIn(): Promise<void> {
  return Promise.resolve();
}
export function reconnect(): Promise<void> {
  return Promise.resolve();
}
export function syncNow(): Promise<void> {
  return Promise.resolve();
}
export function chooseFirstSync(_choice: 'merge' | 'replace' | 'cancel'): Promise<void> {
  return Promise.resolve();
}
export function signOut(): Promise<void> {
  return Promise.resolve();
}
export function removeDriveData(): Promise<void> {
  return Promise.resolve();
}
export function setPrefs(_p: Partial<SyncDevicePrefs>): Promise<void> {
  return Promise.resolve();
}
export function remoteRun(_runId: string): Promise<RunStub | null> {
  return Promise.resolve(null);
}
export function downloadRun(
  _runId: string,
  _onProgress?: (doneBytes: number, totalBytes: number) => void,
  _signal?: AbortSignal,
): Promise<'ok' | 'missing' | 'corrupt' | 'offline' | 'needs-auth'> {
  return Promise.resolve('missing');
}
export function evictRun(_runId: string): Promise<void> {
  return Promise.resolve();
}
export function markConflictsRead(): void {
  // inert until WP-S5a
}
/** The D23 gate: sign in with Google and list the appDataFolder (WP-S3 implements). */
export function testSignIn(): Promise<{ email: string; files: number }> {
  return Promise.reject(new Error('not implemented (WP-S3): testSignIn'));
}
