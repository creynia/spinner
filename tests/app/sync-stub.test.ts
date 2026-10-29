// The inert app-service stub from WP-S0 (sync.md §4.5): what WP-S4 builds against.
import { describe, expect, it } from 'vitest';
import { COMMITTED_CLIENT_ID, GOOGLE_CLIENT_ID } from '../../src/app/services/sync/config';
import * as svc from '../../src/app/services/sync';

describe('sync service stub', () => {
  it('starts off, unconfigured and quiet', () => {
    expect(svc.syncStatus.get()).toEqual({
      state: 'off',
      pending: 0,
      remoteOnly: { runs: 0, bytes: 0 },
      conflicts: 0,
    });
    expect(svc.syncAuth.get()).toEqual({ state: 'unconfigured' }); // S5a wires it to the token source
    expect(svc.conflictNotices.get()).toEqual([]);
    expect(svc.syncPrefs.get().enabled).toBe(false);
    expect(svc.firstSyncPrompt.get()).toBeNull();
    expect(svc.accountSwitchPrompt.get()).toBeNull();
    expect(svc.syncDevices.get()).toEqual([]);
    expect(svc.syncAbout.get()).toBeNull();
  });
  it('every action resolves and changes nothing', async () => {
    await svc.signIn();
    await svc.reconnect();
    await svc.syncNow();
    await svc.chooseFirstSync('cancel');
    await svc.signOut();
    await svc.removeDriveData();
    await svc.setPrefs({ enabled: true });
    await svc.evictRun('r');
    svc.markConflictsRead();
    await svc.chooseAccountSwitch('cancel');
    expect(await svc.downloadAllRemote()).toEqual({ done: 0, skipped: 0 });
    expect(await svc.remoteRun('r')).toBeNull();
    expect(await svc.downloadRun('r')).toBe('missing');
    expect(svc.syncStatus.get().state).toBe('off');
    expect(svc.syncPrefs.get().enabled).toBe(false);
  });
  it('has the committed client id, and honours the env override', () => {
    expect(COMMITTED_CLIENT_ID).toBe(
      '136534818548-gt8occ10t0m2kjgnvv8sgmpu61eqi3gn.apps.googleusercontent.com',
    );
    expect(typeof GOOGLE_CLIENT_ID).toBe('string');
    // no VITE_GOOGLE_CLIENT_ID in the test environment: the default applies
    expect(GOOGLE_CLIENT_ID).toBe(import.meta.env.VITE_GOOGLE_CLIENT_ID || COMMITTED_CLIENT_ID);
  });
});
