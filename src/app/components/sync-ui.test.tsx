// Sync UI component tests (sync.md §11.2): the service stub is overridden through its stores, and
// its actions are replaced with spies so we can assert they run synchronously inside the click.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncState, SyncStatus } from '@core';
import type * as SyncService from '../services/sync';
import type * as Gis from '../services/sync/gis';

const cfg = vi.hoisted(() => ({ id: '' }));
vi.mock('../services/sync/config', () => ({
  COMMITTED_CLIENT_ID: '',
  get GOOGLE_CLIENT_ID() {
    return cfg.id;
  },
}));
const spies = vi.hoisted(() => ({
  signIn: vi.fn(() => Promise.resolve()),
  reconnect: vi.fn(() => Promise.resolve()),
  syncNow: vi.fn(() => Promise.resolve()),
  chooseFirstSync: vi.fn((_c: string) => Promise.resolve()),
  chooseAccountSwitch: vi.fn((_c: string) => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
  removeDriveData: vi.fn(() => Promise.resolve()),
  setPrefs: vi.fn((_p: unknown) => Promise.resolve()),
  markConflictsRead: vi.fn(),
  testSignIn: vi.fn(() => Promise.resolve({ email: 'a@b.c', files: 3 })),
  expireTokenForTest: vi.fn(),
  resumeTestSignIn: vi.fn(() => Promise.resolve<{ email: string; files: number } | null>(null)),
  endTestSignIn: vi.fn(() => Promise.resolve()),
  preloadSignIn: vi.fn(),
  downloadRun: vi.fn(),
  remoteRun: vi.fn(() => Promise.resolve(null)),
  downloadAllRemote: vi.fn(() => Promise.resolve({ done: 2, skipped: 0 })),
  refreshAccountInfo: vi.fn(() => Promise.resolve()),
}));
// happy-dom cannot load accounts.google.com: any path that reaches the GIS loader gets a stub, so
// the Settings tests never print "Failed to load script" (sync.md §11.2).
vi.mock('../services/sync/gis', async (orig) => ({
  ...(await orig<typeof Gis>()),
  loadGis: vi.fn(() => Promise.reject(new Error('GIS is stubbed in unit tests'))),
}));
vi.mock('../services/sync', async (orig) => ({
  ...(await orig<typeof SyncService>()),
  ...spies,
}));

import * as sync from '../services/sync';
import { Account } from '../screens/Settings/Account';
import { SyncIndicator, statusView } from './SyncIndicator';
import { SyncSheets } from './SyncSheets';
import { RemoteRunCard } from './RemoteRunCard';

const base: SyncStatus = {
  state: 'off',
  pending: 0,
  remoteOnly: { runs: 0, bytes: 0 },
  conflicts: 0,
};
const setStatus = (p: Partial<SyncStatus>): void =>
  void act(() => sync.syncStatus.set({ ...base, ...p }));
const signedIn = () =>
  void act(() => sync.syncAuth.set({ state: 'signed-in', email: 'owner@gmail.com', expiresAt: 1 }));

beforeEach(() => {
  cfg.id = '';
  signedIn();
  void act(() => {
    sync.syncPrefs.set({ enabled: true, deviceName: 'Pixel 11', runDownload: 'onOpen' });
    sync.syncStatus.set(base);
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  void act(() => {
    sync.firstSyncPrompt.set(null);
    sync.accountSwitchPrompt.set(null);
    sync.conflictNotices.set([]);
    sync.syncDevices.set([]);
    sync.syncAbout.set(null);
    sync.syncAuth.set({ state: 'unconfigured' });
  });
});

const NOW = Date.parse('2026-01-01T12:00:00Z');
const TEXTS: [SyncState, Partial<SyncStatus>, string][] = [
  ['idle', { lastSyncedAt: '2026-01-01T11:58:00Z' }, 'Up to date · 2 minutes ago'],
  [
    'syncing',
    { progress: { phase: 'upload-runs', done: 3, total: 12, bytes: 14 * 1024 * 1024 } },
    'Syncing… uploading run 3 of 12 (14 MB)',
  ],
  ['offline', { pending: 4 }, 'Offline · 4 changes waiting'],
  ['needs-auth', { pending: 4 }, 'Sign-in expired · 4 changes waiting'],
  [
    'needs-auth',
    { pending: 0 },
    'Sync paused · sign in again to get changes from your other devices',
  ],
  ['waiting-run', {}, 'Waiting for the run to finish'],
  ['backoff', { retryAt: NOW + 110_000 }, 'Google Drive is busy · retrying in 2 min'],
  ['drive-full', {}, 'Your Google Drive is full'],
  ['local-full', {}, 'This device is out of space · runs stay in Drive'],
  [
    'error',
    { error: { code: 'newer-layout', message: 'x' } },
    'Drive data is from a newer spinner. Update the app.',
  ],
  [
    'error',
    { error: { code: 'access-removed', message: 'x' } },
    'Access was removed. Sign in again.',
  ],
];

describe('status text', () => {
  it.each(TEXTS)('%s renders %j as its line', (state, extra, text) => {
    expect(statusView({ ...base, state, ...extra }, undefined, NOW).text).toBe(text);
    setStatus({ state, ...extra });
    const { container } = render(<Account />);
    const line = container.querySelector('[data-sync-status]');
    expect(line?.getAttribute('data-sync-status')).toBe(state);
    // the live clock differs from NOW, so compare the stable prefix for the time-based lines
    expect(line?.textContent).toContain(text.split(' · ')[0]!);
  });

  it('needs-auth: Reconnect is primary with pending changes, secondary without', () => {
    setStatus({ state: 'needs-auth', pending: 2 });
    const { getByText, rerender } = render(<Account />);
    expect(getByText('Reconnect').className).toContain('btn-primary');
    setStatus({ state: 'needs-auth', pending: 0 });
    rerender(<Account />);
    expect(getByText('Reconnect').className).toContain('btn-secondary');
  });

  it('error branches are keyed by code, with their action', () => {
    setStatus({ state: 'error', error: { code: 'newer-layout', message: '' } });
    const a = render(<Account />);
    expect(a.getByText('Check for updates')).toBeTruthy();
    a.unmount();
    setStatus({ state: 'error', error: { code: 'access-removed', message: '' } });
    const b = render(<Account />);
    fireEvent.click(b.getByText('Sign in'));
    expect(spies.signIn).toHaveBeenCalledTimes(1);
    b.unmount();
    setStatus({ state: 'error', error: { code: 'unknown', message: 'Boom' } });
    const c = render(<Account />);
    expect(c.container.textContent).toContain('Sync problem: Boom');
  });

  it('drive-full links to Google storage and still offers Sync now; local-full links to the Library', () => {
    setStatus({ state: 'drive-full' });
    const a = render(<Account />);
    expect(a.getByText('Manage Google storage').getAttribute('href')).toContain('google.com');
    fireEvent.click(a.getByText('Sync now'));
    expect(spies.syncNow).toHaveBeenCalled();
    a.unmount();
    setStatus({ state: 'local-full' });
    const b = render(<Account />);
    expect(b.getByText('Library › Runs').getAttribute('href')).toBe('#/library');
  });

  it('erased from another device (token still valid): the card offers Sign in, which calls signIn()', () => {
    spies.signIn.mockClear();
    expect(
      statusView({ ...base, state: 'error', error: { code: 'erased', message: '' } }).action,
    ).toBe('signin');
    setStatus({ state: 'error', error: { code: 'erased', message: '' } });
    const a = render(<Account />);
    expect(a.container.textContent).toContain('removed from another device');
    // not a dead end any more: a way to start over, next to Sign out and Remove…
    expect(a.queryByText('Start syncing')).toBeNull();
    fireEvent.click(a.getByText('Sign in'));
    expect(spies.signIn).toHaveBeenCalledTimes(1);
    expect(a.getByText('Sign out')).toBeTruthy();
  });

  it('syncing and waiting-run offer no action', () => {
    setStatus({ state: 'syncing', progress: { phase: 'push', done: 1, total: 2 } });
    const { container, queryByText } = render(<Account />);
    expect(container.querySelector('progress')).not.toBeNull();
    expect(queryByText('Sync now')).toBeNull();
    expect(queryByText('Reconnect')).toBeNull();
  });
});

describe('Account card', () => {
  it('unconfigured: says so and offers no sign-in', () => {
    void act(() => sync.syncAuth.set({ state: 'unconfigured' }));
    const { container, queryByText } = render(<Account />);
    expect(container.textContent).toContain('Sync is not set up in this build.');
    expect(queryByText('Sign in with Google')).toBeNull();
  });

  it('signed out: signIn() runs synchronously inside the click', () => {
    void act(() => sync.syncAuth.set({ state: 'signed-out' }));
    const { getByText } = render(<Account />);
    let calledDuringClick = false;
    spies.signIn.mockImplementationOnce(() => {
      calledDuringClick = true;
      return Promise.resolve();
    });
    fireEvent.click(getByText('Sign in with Google'));
    expect(calledDuringClick).toBe(true);
  });

  it('reconnect() runs synchronously inside the click', () => {
    setStatus({ state: 'needs-auth', pending: 1 });
    const { getByText } = render(<Account />);
    let during = false;
    spies.reconnect.mockImplementationOnce(() => {
      during = true;
      return Promise.resolve();
    });
    fireEvent.click(getByText('Reconnect'));
    expect(during).toBe(true);
  });

  it('shows Drive usage, the remote-only runs and the download preference', async () => {
    setStatus({ state: 'idle', remoteOnly: { runs: 12, bytes: 31 * 1024 * 1024 } });
    void act(() =>
      sync.syncAbout.set({
        email: 'owner@gmail.com',
        displayName: 'O',
        accountId: 'x',
        usage: 182 * 1024 * 1024,
        limit: 15 * 1024 ** 3,
        deviceBytes: 96 * 1024 * 1024,
      }),
    );
    const { container, getByText, getByRole } = render(<Account />);
    expect(container.querySelector('[data-sync-usage]')?.textContent).toContain('182 MB of 15 GB');
    expect(container.querySelector('[data-sync-usage]')?.textContent).toContain('96 MB');
    expect(container.querySelector('[data-remote-only]')?.textContent).toBe(
      '12 runs only in Drive (31 MB)',
    );
    fireEvent.click(getByRole('radio', { name: 'All, in the background' }));
    expect(spies.setPrefs).toHaveBeenCalledWith({ runDownload: 'all' });
    fireEvent.click(getByText('Download all'));
    await waitFor(() => expect(spies.downloadAllRemote).toHaveBeenCalled());
  });

  it('lists devices, marking this one by device id (two devices may share a name)', () => {
    setStatus({ state: 'idle' });
    void act(() => {
      sync.syncDeviceId.set('b');
      sync.syncDevices.set([
        { id: 'a', name: 'Pixel 11', lastSyncedAt: new Date().toISOString(), appVersion: '1.0' },
        { id: 'b', name: 'Pixel 11', lastSyncedAt: '2020-01-01T00:00:00Z', appVersion: '1.0' },
      ]);
    });
    const { container } = render(<Account />);
    const items = [...container.querySelectorAll('[data-sync-devices] li')];
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).not.toContain('(this device)');
    expect(items[1]!.textContent).toContain('(this device)');
    void act(() => sync.syncDeviceId.set(''));
  });

  it('conflict notices open in a sheet and are marked read', () => {
    setStatus({ state: 'idle', conflicts: 1 });
    void act(() =>
      sync.conflictNotices.set([
        {
          id: 'n1',
          at: new Date().toISOString(),
          key: 'def:x',
          kind: 'def',
          message: 'Kept both.',
          read: false,
        },
      ]),
    );
    const { getByText, container } = render(<Account />);
    fireEvent.click(getByText('⚠ 1 notice ›'));
    expect(spies.markConflictsRead).toHaveBeenCalled();
    expect(container.querySelector('[data-sync-notices]')?.textContent).toContain('Kept both.');
  });

  it('memory backend: shows the note and no sign-in', () => {
    void act(() => sync.syncAuth.set({ state: 'signed-out' }));
    setStatus({ state: 'off', disabledReason: 'memory-backend' });
    const { container, queryByText } = render(<Account />);
    expect(container.querySelector('[data-sync-disabled]')?.textContent).toContain(
      'Sync needs storage that persists',
    );
    expect(queryByText('Sign in with Google')).toBeNull();
  });

  it('clock skew shows a warning naming the device', () => {
    setStatus({ state: 'idle', clockSkewDevice: 'Laptop' });
    const { container } = render(<Account />);
    expect(container.querySelector('[data-sync-skew]')?.textContent).toContain(
      "A device's clock looks wrong (Laptop)",
    );
  });

  it('Remove my data from Drive asks first', () => {
    setStatus({ state: 'idle' });
    const { getByText, getByRole } = render(<Account />);
    fireEvent.click(getByText('Remove my data from Drive…'));
    expect(getByRole('dialog').textContent).toContain('Your other devices stop syncing.');
    expect(spies.removeDriveData).not.toHaveBeenCalled();
    fireEvent.click(getByText('Remove from Drive'));
    expect(spies.removeDriveData).toHaveBeenCalled();
  });

  it('renames the device through setPrefs', () => {
    setStatus({ state: 'idle' });
    const { getByText, getByLabelText } = render(<Account />);
    fireEvent.click(getByText('Rename'));
    fireEvent.input(getByLabelText('Device name'), { target: { value: ' Phone ' } });
    fireEvent.click(getByText('Save'));
    expect(spies.setPrefs).toHaveBeenCalledWith({ deviceName: 'Phone' });
  });

  it('Test Google sign-in row only appears with a client id; Expire token now is wired', async () => {
    setStatus({ state: 'idle' });
    const a = render(<Account />);
    expect(a.queryByText('Test Google sign-in')).toBeNull();
    a.unmount();
    cfg.id = 'client.apps.googleusercontent.com';
    const b = render(<Account />);
    fireEvent.click(b.getByText('Test Google sign-in'));
    await waitFor(() =>
      expect(b.container.querySelector('[data-sync-test-result]')?.textContent).toContain(
        'Signed in as a@b.c. 3 files',
      ),
    );
    fireEvent.click(b.getByText('Expire token now'));
    expect(spies.expireTokenForTest).toHaveBeenCalled();
    // the service then reports expiry: the Reconnect path appears
    setStatus({ state: 'needs-auth', pending: 1 });
    void act(() => sync.syncAuth.set({ state: 'expired', email: 'owner@gmail.com' }));
    expect(b.getByText('Reconnect')).toBeTruthy();
  });
});

describe('Account: gate redirect return and End test', () => {
  it('on mount, shows the redirect-return result exactly as the popup path does', async () => {
    cfg.id = 'client.apps.googleusercontent.com';
    setStatus({ state: 'idle' });
    spies.resumeTestSignIn.mockResolvedValueOnce({ email: 'owner@gmail.com', files: 1 });
    const a = render(<Account />);
    await waitFor(() =>
      expect(a.container.querySelector('[data-sync-test-result]')?.textContent).toBe(
        'Signed in as owner@gmail.com. 1 file in the app folder.',
      ),
    );
    expect(spies.preloadSignIn).toHaveBeenCalled();
  });

  it('shows nothing when no gate redirect was in flight, and an error when the check fails', async () => {
    cfg.id = 'client.apps.googleusercontent.com';
    setStatus({ state: 'idle' });
    const a = render(<Account />);
    await act(() => Promise.resolve());
    expect(a.container.querySelector('[data-sync-test-result]')?.textContent).toBe('');
    a.unmount();
    spies.resumeTestSignIn.mockRejectedValueOnce(new Error('Drive said no'));
    const b = render(<Account />);
    await waitFor(() =>
      expect(b.container.querySelector('[data-sync-test-result]')?.textContent).toContain(
        'Sign-in test failed: Drive said no',
      ),
    );
  });

  it('does not resume without a client id', async () => {
    cfg.id = '';
    spies.resumeTestSignIn.mockClear();
    setStatus({ state: 'idle' });
    render(<Account />);
    await act(() => Promise.resolve());
    expect(spies.resumeTestSignIn).not.toHaveBeenCalled();
  });

  it('End test revokes through endTestSignIn', async () => {
    cfg.id = 'client.apps.googleusercontent.com';
    setStatus({ state: 'idle' });
    const a = render(<Account />);
    fireEvent.click(a.getByText('End test'));
    expect(spies.endTestSignIn).toHaveBeenCalled();
    await waitFor(() =>
      expect(a.container.querySelector('[data-sync-test-result]')?.textContent).toContain(
        'Test ended',
      ),
    );
  });
});

describe('SyncIndicator (§8.2)', () => {
  const amber: [SyncState, Partial<SyncStatus>, boolean][] = [
    ['idle', {}, false],
    ['syncing', {}, false],
    ['offline', { pending: 3 }, false],
    ['needs-auth', { pending: 0 }, false],
    ['needs-auth', { pending: 2 }, true],
    ['waiting-run', {}, false],
    ['backoff', {}, false],
    ['error', { error: { code: 'unknown', message: 'x' } }, true],
    ['drive-full', {}, true],
    ['local-full', {}, true],
  ];
  it.each(amber)('%s %j: amber is %s', (state, extra, isAmber) => {
    setStatus({ state, ...extra });
    const { container } = render(<SyncIndicator place="top" />);
    const btn = container.querySelector('button')!;
    expect(btn.classList.contains('attention')).toBe(isAmber);
    const text = statusView({ ...base, state, ...extra }).text;
    expect(btn.getAttribute('aria-label')).toBe(
      state === 'needs-auth' && isAmber ? `Reconnect: ${text}` : text,
    );
    expect(btn.textContent?.includes('Reconnect')).toBe(state === 'needs-auth' && isAmber);
  });

  it('is hidden when sync is off', () => {
    setStatus({ state: 'off' });
    const { container } = render(<SyncIndicator place="top" />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('needs-auth tap calls reconnect() in the click; otherwise it opens the Account card', () => {
    setStatus({ state: 'needs-auth', pending: 1 });
    const a = render(<SyncIndicator place="top" />);
    fireEvent.click(a.container.querySelector('button')!);
    expect(spies.reconnect).toHaveBeenCalledTimes(1);
    a.unmount();
    setStatus({ state: 'idle' });
    const b = render(<SyncIndicator place="top" />);
    fireEvent.click(b.container.querySelector('button')!);
    expect(spies.reconnect).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#/settings?account=1');
  });

  it('the live region announces only entering or leaving an attention state', () => {
    setStatus({ state: 'idle' });
    const { container } = render(<SyncIndicator place="top" />);
    const live = () => container.querySelector('[data-sync-live]')!.textContent;
    expect(live()).toBe('');
    setStatus({ state: 'syncing' });
    expect(live()).toBe('');
    setStatus({ state: 'drive-full' });
    expect(live()).toBe('Sync needs your attention');
    setStatus({ state: 'idle' });
    expect(live()).toBe('Sync is working again');
  });
});

describe('SyncIndicator: announcer on a direct mount into attention', () => {
  it('announces when it first appears already in an attention state', () => {
    setStatus({ state: 'error', error: { code: 'access-removed', message: 'x' } });
    const { container } = render(<SyncIndicator place="top" />);
    expect(container.querySelector('[data-sync-live]')!.textContent).toBe(
      'Sync needs your attention',
    );
  });
  it('stays silent when it first appears in a calm state', () => {
    setStatus({ state: 'idle' });
    const { container } = render(<SyncIndicator place="top" />);
    expect(container.querySelector('[data-sync-live]')!.textContent).toBe('');
  });
});

describe('Account card: S5a additions', () => {
  it('a failed popup switches the button to "Sign in in this window"', () => {
    void act(() => sync.syncAuth.set({ state: 'signed-out' }));
    cfg.id = 'cid';
    setStatus({ state: 'off' });
    void act(() => {
      sync.signInError.set('The sign-in window was blocked.');
      sync.signInRedirectOffer.set(true);
    });
    const { container, getByRole } = render(<Account />);
    expect(container.querySelector('[data-sign-in-error]')!.textContent).toContain('blocked');
    expect(container.querySelector('[data-redirect-note]')!.textContent).toContain(
      'nothing is lost',
    );
    expect(container.textContent).not.toContain('Sign in with Google');
    fireEvent.click(getByRole('button', { name: 'Sign in in this window' }));
    expect(spies.signIn).toHaveBeenCalledWith({ mode: 'redirect' });
    fireEvent.click(getByRole('button', { name: 'Try the pop-up again' }));
    expect(spies.signIn).toHaveBeenLastCalledWith({ mode: 'popup' });
    void act(() => {
      sync.signInError.set(null);
      sync.signInRedirectOffer.set(false);
    });
  });
  it('Sync now says "Syncing in another tab" while another tab holds the lock', () => {
    setStatus({ state: 'idle' });
    void act(() => sync.syncElsewhere.set(true));
    const { getByRole } = render(<Account />);
    const b = getByRole('button', { name: 'Syncing in another tab' });
    expect((b as HTMLButtonElement).disabled).toBe(true);
    void act(() => sync.syncElsewhere.set(false));
  });
  it('signed in but off (a past test sign-in): "Start syncing" starts the sign-in flow', () => {
    setStatus({ state: 'off' });
    const { getByRole } = render(<Account />);
    fireEvent.click(getByRole('button', { name: 'Start syncing' }));
    expect(spies.signIn).toHaveBeenCalledTimes(1);
  });
  it('the first-sync sheet shows why it did not start', () => {
    void act(() => {
      sync.firstSyncPrompt.set({
        remoteEmpty: false,
        remote: { experiments: 1, strategies: 0, layouts: 0, runs: 0, runBytes: 0 },
        local: { experiments: 1, strategies: 0, layouts: 0, runs: 0, runBytes: 0 },
      });
      sync.firstSyncError.set(
        'Drive has no readable library to replace this device with. Nothing was deleted.',
      );
    });
    const { container } = render(<SyncSheets />);
    expect(document.body.querySelector('[data-first-sync-error]')!.textContent).toContain(
      'Nothing was deleted',
    );
    void container;
    void act(() => sync.firstSyncError.set(null));
  });
});

describe('sheets', () => {
  const counts = { experiments: 5, strategies: 2, layouts: 0, runs: 2, runBytes: 2 * 1024 * 1024 };
  it('first sync with data in Drive: Merge, Replace asks again, Not now cancels', () => {
    void act(() =>
      sync.firstSyncPrompt.set({
        remoteEmpty: false,
        remote: {
          fromName: 'Laptop',
          syncedAt: new Date().toISOString(),
          experiments: 42,
          strategies: 9,
          layouts: 6,
          runs: 18,
          runBytes: 31 * 1024 * 1024,
        },
        local: counts,
      }),
    );
    const { getByText, container } = render(<SyncSheets />);
    const body = container.querySelector('[data-first-sync=existing]')!.textContent;
    expect(body).toContain('From Laptop · synced');
    expect(body).toContain('42 experiments · 9 strategies · 6 layouts');
    expect(body).toContain('18 runs (31 MB)');
    fireEvent.click(getByText("Replace this device's data"));
    expect(spies.chooseFirstSync).not.toHaveBeenCalled();
    fireEvent.click(getByText("Replace this device's data"));
    expect(spies.chooseFirstSync).toHaveBeenCalledWith('replace');
  });

  it('first sync: Merge and Not now', () => {
    void act(() =>
      sync.firstSyncPrompt.set({ remoteEmpty: false, remote: { ...counts }, local: counts }),
    );
    const a = render(<SyncSheets />);
    fireEvent.click(a.getByText('Merge both (recommended)'));
    expect(spies.chooseFirstSync).toHaveBeenCalledWith('merge');
    a.unmount();
    const b = render(<SyncSheets />);
    fireEvent.click(b.getByText('Not now'));
    expect(spies.chooseFirstSync).toHaveBeenLastCalledWith('cancel');
  });

  it('first sync with an empty Drive offers Start syncing', () => {
    void act(() =>
      sync.firstSyncPrompt.set({ remoteEmpty: true, remote: { ...counts }, local: counts }),
    );
    const { getByText, container } = render(<SyncSheets />);
    expect(container.textContent).toContain("Upload this device's library?");
    fireEvent.click(getByText('Start syncing'));
    expect(spies.chooseFirstSync).toHaveBeenCalledWith('merge');
  });

  it('account switch: sync or cancel', () => {
    void act(() => sync.accountSwitchPrompt.set({ from: 'a@x.com', to: 'b@x.com' }));
    const { getByText, container } = render(<SyncSheets />);
    expect(container.querySelector('[data-account-switch]')?.textContent).toContain('b@x.com');
    fireEvent.click(getByText("Sync this device's data to b@x.com"));
    expect(spies.chooseAccountSwitch).toHaveBeenCalledWith('sync');
  });

  it('account switch: cancel', () => {
    void act(() => sync.accountSwitchPrompt.set({ from: 'a@x.com', to: 'b@x.com' }));
    const { getByText } = render(<SyncSheets />);
    fireEvent.click(getByText('Cancel'));
    expect(spies.chooseAccountSwitch).toHaveBeenLastCalledWith('cancel');
  });
});

describe('RemoteRunCard (§8.4)', () => {
  const stub = {
    runId: 'r1',
    owner: 'dev-b',
    bundle: { name: 'n', bytes: 1.8 * 1024 * 1024, sha256: '' },
    verdict: {
      meanNet: -4100,
      halfWidth: 600,
      pAhead: 0.38,
      pBust: 0,
      n: 1,
      roundsPerSession: 1,
      roundsPerHour: 1,
    },
  };
  it('downloads with progress, Cancel aborts', async () => {
    let report: (d: number, t: number) => void = () => {};
    let signal: AbortSignal | undefined;
    spies.downloadRun.mockImplementation((_id: string, p: typeof report, s: AbortSignal) => {
      report = p;
      signal = s;
      return new Promise((r) => s.addEventListener('abort', () => r('missing')));
    });
    spies.remoteRun.mockResolvedValue(stub as never);
    void act(() =>
      sync.syncDevices.set([{ id: 'dev-b', name: 'Laptop', lastSyncedAt: '', appVersion: '1' }]),
    );
    const { container, getByText, findByText } = render(
      <RemoteRunCard runId="r1" name="Martingale red" />,
    );
    await findByText(/made on Laptop/);
    expect(container.textContent).toContain('mean −$41 ± $6 · P(ahead) 38%');
    expect(container.textContent).toContain('(1.8 MB)');
    void act(() => report(620, 1000));
    expect(container.textContent).toContain('Downloading 62%');
    fireEvent.click(getByText('Cancel'));
    expect(signal?.aborted).toBe(true);
    await findByText('Download cancelled.');
  });

  it.each([
    ['offline', "It will download when you're back online."],
    ['needs-auth', 'Reconnect and download'],
    ['missing', 'damaged or missing'],
    ['corrupt', 'damaged or missing'],
  ])('%s', async (result, text) => {
    spies.downloadRun.mockResolvedValue(result);
    spies.remoteRun.mockResolvedValue(stub as never);
    const { findByText, container } = render(<RemoteRunCard runId="r1" name="X" />);
    await findByText(new RegExp(text.replace(/[.']/g, '.')));
    expect(container.textContent).toContain(text);
  });

  it('Reconnect and download calls reconnect() in the click; ok notifies the screen', async () => {
    spies.downloadRun.mockResolvedValueOnce('needs-auth');
    const { findByText } = render(<RemoteRunCard runId="r1" name="X" />);
    fireEvent.click(await findByText('Reconnect and download'));
    expect(spies.reconnect).toHaveBeenCalledTimes(1);

    cleanup();
    const onDownloaded = vi.fn();
    spies.downloadRun.mockResolvedValueOnce('ok');
    const b = render(<RemoteRunCard runId="r1" name="X" onDownloaded={onDownloaded} />);
    await b.findByText('Downloaded.');
    expect(onDownloaded).toHaveBeenCalledTimes(1);
  });
});
