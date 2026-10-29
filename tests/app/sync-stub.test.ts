// The service module before `startSync()` runs (what a component test or the first paint sees):
// every store is at its quiet default and nothing reaches out. The real behaviour is covered by
// tests/app/sync/service.test.ts.
import { describe, expect, it } from 'vitest';
import { COMMITTED_CLIENT_ID, GOOGLE_CLIENT_ID } from '../../src/app/services/sync/config';
import * as svc from '../../src/app/services/sync';

describe('sync service before it starts', () => {
  it('starts off and quiet', () => {
    expect(svc.syncStatus.get()).toEqual({
      state: 'off',
      pending: 0,
      remoteOnly: { runs: 0, bytes: 0 },
      conflicts: 0,
    });
    expect(svc.conflictNotices.get()).toEqual([]);
    expect(svc.syncPrefs.get().enabled).toBe(false);
    expect(svc.firstSyncPrompt.get()).toBeNull();
    expect(svc.accountSwitchPrompt.get()).toBeNull();
    expect(svc.syncDevices.get()).toEqual([]);
    expect(svc.syncAbout.get()).toBeNull();
    expect(svc.firstSyncError.get()).toBeNull();
    expect(svc.signInError.get()).toBeNull();
    expect(svc.signInRedirectOffer.get()).toBe(false);
    expect(svc.syncElsewhere.get()).toBe(false);
    expect(svc.syncDeviceId.get()).toBe('');
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
