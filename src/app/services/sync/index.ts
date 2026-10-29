// The sync app service (sync.md §4.5). An INERT stub from WP-S0: the stores hold their idle
// defaults and every action resolves without doing anything, so WP-S4 builds the UI against it.
// WP-S5a replaces the bodies; WP-S3 made `testSignIn` and `expireTokenForTest` real. Signatures are frozen.
import type {
  AuthState,
  ConflictNotice,
  FirstSyncPreview,
  RunStub,
  SyncAbout,
  SyncDeviceInfo,
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

/** Devices that have written a lib file (Account card). */
export const syncDevices: Store<SyncDeviceInfo[]> = createStore<SyncDeviceInfo[]>([]);
/** The Drive account and storage, plus this device's bytes; null until known. */
export const syncAbout: Store<SyncAbout | null> = createStore<SyncAbout | null>(null);
/** Non-null while the "this Drive belongs to another account" sheet is due (§7.10). */
export const accountSwitchPrompt: Store<{ from: string; to: string } | null> = createStore<{
  from: string;
  to: string;
} | null>(null);

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
/** Every remote-only run stub (S5b's Library list). */
export function listRemoteRuns(): Promise<RunStub[]> {
  return Promise.resolve([]);
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
export function chooseAccountSwitch(_choice: 'sync' | 'cancel'): Promise<void> {
  return Promise.resolve();
}
/** Download every remote-only run; `skipped` counts those already on this device. */
export function downloadAllRemote(
  _onProgress?: (doneBytes: number, totalBytes: number) => void,
  _signal?: AbortSignal,
): Promise<{ done: number; skipped: number }> {
  return Promise.resolve({ done: 0, skipped: 0 });
}

// WP-S3: the D23 gate (sign in, about, list) and its test hooks are real.
export {
  testSignIn,
  resumeTestSignIn,
  endTestSignIn,
  preloadSignIn,
  expireTokenForTest,
} from './test-signin';
