// The inert app-service stub from WP-S0 (sync.md §4.5): what WP-S4 builds against.
import { describe, expect, it } from 'vitest';
import { GOOGLE_CLIENT_ID } from '../../src/app/services/sync/config';
import * as svc from '../../src/app/services/sync';

describe('sync service stub', () => {
  it('starts off, unconfigured and quiet', () => {
    expect(svc.syncStatus.get()).toEqual({
      state: 'off',
      pending: 0,
      remoteOnly: { runs: 0, bytes: 0 },
      conflicts: 0,
    });
    expect(svc.syncAuth.get()).toEqual({ state: 'unconfigured' });
    expect(svc.conflictNotices.get()).toEqual([]);
    expect(svc.syncPrefs.get().enabled).toBe(false);
    expect(svc.firstSyncPrompt.get()).toBeNull();
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
    expect(await svc.remoteRun('r')).toBeNull();
    expect(await svc.downloadRun('r')).toBe('missing');
    expect(svc.syncStatus.get().state).toBe('off');
    expect(svc.syncPrefs.get().enabled).toBe(false);
  });
  it('testSignIn is the one stub that rejects (WP-S3)', async () => {
    await expect(svc.testSignIn()).rejects.toThrow('not implemented (WP-S3)');
  });
  it('has no client id until WP-S3 commits one, and honours the env override', () => {
    expect(typeof GOOGLE_CLIENT_ID).toBe('string');
  });
});
