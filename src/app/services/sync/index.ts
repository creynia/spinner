// The sync app service (sync.md §4.5): the stores the UI reads and the actions it calls, bound to
// the app's one `SyncService` (service.ts) on the real environment. The signatures of WP-S0's stub
// are kept; WP-S5a added the stores and options marked "S5a" below (all additive).
import {
  CORE_VERSION,
  type AuthState,
  type ConflictNotice,
  type FirstSyncPreview,
  type RunStub,
  type SyncAbout,
  type SyncDeviceInfo,
  type SyncDevicePrefs,
  type SyncKind,
  type SyncStatus,
} from '@core';
import { showToast } from '@core/ui';
import { clearRunCache } from '../../screens/Analyze/data';
import { libraryVersion } from '../../screens/Define/data';
import { refreshLibrary } from '../../state/library';
import type { Store } from '../../state/store';
import { getRepo, getTrackedBackend } from '../db';
import { game } from '../game';
import {
  clearVerdictCache,
  describeRun,
  isActive,
  isDryRunDefinition,
  onRunChange,
  refreshRuns,
} from '../runs';
import { loadSettings } from '../settings';
import { createSyncChannel } from './channel';
import { getAuth } from './flow';
import { createDriveStore } from './drive';
import { createSyncLock } from './lock';
import { readTraits } from './prefs';
import { createSyncService, createSyncStores, type SyncEnv, type SyncService } from './service';

const stores = createSyncStores();

export const syncStatus: Store<SyncStatus> = stores.syncStatus;
export const syncAuth: Store<AuthState> = stores.syncAuth;
export const conflictNotices: Store<ConflictNotice[]> = stores.conflictNotices;
export const syncPrefs: Store<SyncDevicePrefs> = stores.syncPrefs;
/** Non-null while the first-sync sheet is due (§8.3). */
export const firstSyncPrompt: Store<FirstSyncPreview | null> = stores.firstSyncPrompt;
/** Devices that have written a lib file (Account card). */
export const syncDevices: Store<SyncDeviceInfo[]> = stores.syncDevices;
/** The Drive account and storage, plus this device's bytes; null until known. */
export const syncAbout: Store<SyncAbout | null> = stores.syncAbout;
/** Non-null while the "this Drive belongs to another account" sheet is due (§7.10). */
export const accountSwitchPrompt: Store<{ from: string; to: string } | null> =
  stores.accountSwitchPrompt;
/** S5a: why the first sync or Replace did not start ("Nothing was deleted"); shown in the sheet. */
export const firstSyncError: Store<string | null> = stores.firstSyncError;
/** S5a: why the last sign-in or Reconnect failed; null when it did not. */
export const signInError: Store<string | null> = stores.signInError;
/** S5a: true once the popup failed in a way the redirect fixes ("Sign in in this window"). */
export const signInRedirectOffer: Store<boolean> = stores.signInRedirectOffer;
/** S5a: true while another tab holds the sync lock ("Syncing in another tab"). */
export const syncElsewhere: Store<boolean> = stores.syncElsewhere;
/** S5a: this device's id ('' until it has one), to mark "(this device)" in the device list. */
export const syncDeviceId: Store<string> = stores.syncDeviceId;

/** Re-reads what a sync cycle may have changed and drops the caches built from it (§7.11). */
function refreshAfter(kinds: SyncKind[]): void {
  if (kinds.length === 0) return;
  libraryVersion.update((v) => v + 1); // layouts, the Define lists
  clearRunCache();
  clearVerdictCache();
  void refreshRuns();
  void refreshLibrary();
  if (kinds.includes('setting')) void getRepo().then((r) => loadSettings(r));
}

function realEnv(): SyncEnv {
  return {
    stores,
    auth: getAuth(),
    async backend() {
      await getRepo(); // opens the store; null from getTrackedBackend() means memory
      return getTrackedBackend();
    },
    makeRemote: ({ token, sessions }) => createDriveStore({ token, sessions }),
    lock: createSyncLock(),
    channel: createSyncChannel(),
    tabId: Math.random().toString(36).slice(2),
    now: () => Date.now(),
    visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    traits: readTraits,
    isRunActive: isActive,
    onRunChange,
    describeRun,
    isDryRun: isDryRunDefinition,
    refresh: refreshAfter,
    notify: (message, action) => void showToast(message, action ? { action } : {}),
    async storageEstimate() {
      const e = await navigator.storage?.estimate?.();
      return { usage: e?.usage ?? 0, quota: e?.quota ?? null };
    },
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0',
    coreVersion: CORE_VERSION,
    gameId: game.plugin.id,
  };
}

let service: SyncService | null = null;
function svc(): SyncService {
  service ??= createSyncService(realEnv());
  return service;
}

/** Starts the service (main.tsx, after the first render): loads the state, wires the triggers. */
export function startSync(): Promise<void> {
  return svc().start();
}

/**
 * Click handlers only (a popup needs a user gesture). `signIn({ mode: 'redirect' })` is the
 * "Sign in in this window" fallback for a blocked or failed popup (§5.1).
 */
export function signIn(opts?: { mode?: 'auto' | 'popup' | 'redirect' }): Promise<void> {
  return svc().signIn(opts);
}
export function reconnect(): Promise<void> {
  return svc().reconnect();
}
export function syncNow(): Promise<void> {
  return svc().syncNow();
}
export function chooseFirstSync(choice: 'merge' | 'replace' | 'cancel'): Promise<void> {
  return svc().chooseFirstSync(choice);
}
export function signOut(): Promise<void> {
  return svc().signOut();
}
export function removeDriveData(): Promise<void> {
  return svc().removeDriveData();
}
export function setPrefs(p: Partial<SyncDevicePrefs>): Promise<void> {
  return svc().setPrefs(p);
}
export function remoteRun(runId: string): Promise<RunStub | null> {
  return svc().remoteRun(runId);
}
/** Every remote-only run stub (S5b's Library list). */
export function listRemoteRuns(): Promise<RunStub[]> {
  return svc().listRemoteRuns();
}
export function downloadRun(
  runId: string,
  onProgress?: (doneBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<'ok' | 'missing' | 'corrupt' | 'offline' | 'needs-auth'> {
  return svc().downloadRun(runId, onProgress, signal);
}
export function evictRun(runId: string): Promise<void> {
  return svc().evictRun(runId);
}
export function reuploadRun(runId: string): Promise<'uploaded' | 'unchanged'> {
  return svc().reuploadRun(runId);
}
export function markConflictsRead(): void {
  svc().markConflictsRead();
}
export function chooseAccountSwitch(choice: 'sync' | 'cancel'): Promise<void> {
  return svc().chooseAccountSwitch(choice);
}
/** Download every remote-only run that fits; `skipped` counts those already on this device. */
export function downloadAllRemote(
  onProgress?: (doneBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<{ done: number; skipped: number }> {
  return svc().downloadAllRemote(onProgress, signal);
}
/** S5a: Drive's account and storage, plus the device list, into their stores (throttled). */
export function refreshAccountInfo(force?: boolean): Promise<void> {
  return svc().refreshAccountInfo(force);
}

// WP-S3: the D23 gate (sign in, about, list) and its test hooks are real.
export {
  testSignIn,
  resumeTestSignIn,
  endTestSignIn,
  preloadSignIn,
  expireTokenForTest,
} from './test-signin';
