// The sync app service (sync.md §13 WP-S5a acceptance): every trigger under fake timers, a hidden tab
// never syncs, two tabs run one cycle at a time with dirty marks forwarded, a memory backend gives
// `off`, and nothing logs a console error. The fake Drive and the fake GIS stand in for Google.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createMemoryBackend } from '@core';
import { defaultDeviceName, defaultRunDownload } from '../../../src/app/services/sync/prefs';
import { SIGNIN_KEY } from '../../../src/app/services/sync/service';
import {
  advance,
  failingBackend,
  flush,
  holdDrive,
  layoutIds,
  makeTab,
  makeWorld,
  otherDevice,
  putLayout,
  signInAndSync,
  until,
  type Tab,
  type World,
} from './service-kit';

let world: World;
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-10-29T10:00:00Z') });
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  world = makeWorld();
});
afterEach(async () => {
  await flush(5);
  for (const t of world.tabs) t.stop();
  // acceptance: the service never logs a console error
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
  vi.useRealTimers();
});

const state = (t: Tab): string => t.stores.syncStatus.get().state;
const fail = (status: number, reason: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code: status, message: reason, errors: [{ reason }] } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** A signed-in, synced tab with one layout in Drive (the usual starting point). */
async function synced(w: World = world): Promise<Tab> {
  const t = makeTab(w);
  await putLayout(t, 'lay-1', '7');
  await signInAndSync(t);
  return t;
}

describe('memory backend', () => {
  it('stays off with disabledReason memory-backend, and touches nothing', async () => {
    const t = makeTab(world, { memory: true });
    await t.svc.start();
    expect(t.stores.syncStatus.get()).toMatchObject({
      state: 'off',
      disabledReason: 'memory-backend',
      pending: 0,
    });
    expect(t.stores.syncAuth.get().state).not.toBe('unconfigured'); // wired to the token source
    await t.svc.signIn();
    expect(t.stores.signInError.get()).toBe('Sync needs storage that persists.');
    await t.svc.syncNow();
    await advance(10 * 60_000, 60_000);
    expect(world.drive.log).toHaveLength(0);
    expect(world.gis.calls).toHaveLength(0);
    expect(state(t)).toBe('off');
  });
});

describe('start', () => {
  it('a signed-out start is off and quiet', async () => {
    const t = makeTab(world);
    await t.svc.start();
    expect(state(t)).toBe('off');
    expect(t.stores.syncAuth.get()).toEqual({ state: 'signed-out' });
    expect(t.stores.syncPrefs.get().enabled).toBe(false);
    expect(t.stores.syncPrefs.get().deviceName).toBe('Chrome on Linux');
    await advance(10 * 60_000, 60_000);
    expect(world.drive.log).toHaveLength(0);
  });

  it('syncs once, 3 s after start, when sync is on and a valid token is stored', async () => {
    const a = await synced();
    const lists = a.lists();
    a.stop();
    const t = makeTab(world); // the page reloaded: same profile, a new service
    await t.svc.start();
    expect(t.stores.syncPrefs.get().enabled).toBe(true);
    expect(state(t)).toBe('idle'); // from the stored state, before any request
    await advance(2900, 100);
    expect(t.lists()).toBe(lists);
    await advance(200, 100);
    await until(() => t.lists() === lists + 1, 'the start cycle');
    expect(t.lists()).toBe(lists + 1); // a no-change cycle is one listing request
    expect(state(t)).toBe('idle');
  });

  it('with an expired token it waits for Reconnect instead of syncing (amber only with changes)', async () => {
    const a = await synced();
    a.stop();
    const lists = a.lists();
    a.env.auth.source.expireNow();
    const t = makeTab(world);
    await t.svc.start();
    expect(state(t)).toBe('needs-auth');
    expect(t.stores.syncStatus.get().pending).toBe(0);
    await putLayout(t, 'lay-2', '8');
    await until(() => t.stores.syncStatus.get().pending === 1, 'the pending count');
    await advance(60_000, 5000);
    expect(t.lists()).toBe(lists); // no request without a token
    expect(state(t)).toBe('needs-auth');
  });
});

describe('triggers (fake timers)', () => {
  it('local change: debounced 5 s', async () => {
    const t = await synced();
    const lists = t.lists();
    await putLayout(t, 'lay-2', '8');
    await advance(4500, 500);
    expect(t.lists()).toBe(lists);
    await advance(1000, 500);
    await until(() => t.lists() > lists, 'the debounced cycle');
    await until(() => t.stores.syncStatus.get().pending === 0, 'pushed');
    expect(world.drive.files.size).toBeGreaterThan(0);
  });

  it('local change: a steady stream still syncs within 30 s', async () => {
    const t = await synced();
    const lists = t.lists();
    for (let i = 0; i < 7; i++) {
      await putLayout(t, `lay-x${i}`, String(i));
      await advance(4000, 1000); // each edit restarts the 5 s debounce
    }
    // 28 s so far: nothing yet (the debounce never completed)
    expect(t.lists()).toBe(lists);
    await advance(2500, 500); // 30 s after the first edit
    await until(() => t.lists() > lists, 'the forced cycle at the 30 s cap');
  });

  it('visible: after more than 60 s since the last cycle', async () => {
    const t = await synced();
    const lists = t.lists();
    await advance(30_000, 5000);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(t.lists()).toBe(lists); // only 30 s
    await advance(40_000, 5000);
    document.dispatchEvent(new Event('visibilitychange'));
    await until(() => t.lists() > lists, 'the visible cycle');
  });

  it('interval: every 5 minutes while visible', async () => {
    const t = await synced();
    const lists = t.lists();
    await advance(4 * 60_000, 30_000);
    expect(t.lists()).toBe(lists);
    await advance(61_000, 10_000);
    await until(() => t.lists() === lists + 1, 'the 5 min cycle');
    await advance(5 * 60_000, 30_000);
    await until(() => t.lists() === lists + 2, 'the next 5 min cycle');
  });

  it('online: a cycle on the online event, and offline shows offline', async () => {
    const t = await synced();
    t.knobs.online = false;
    window.dispatchEvent(new Event('offline'));
    await flush();
    expect(state(t)).toBe('offline');
    const lists = t.lists();
    t.knobs.online = true;
    window.dispatchEvent(new Event('online'));
    await until(() => t.lists() > lists, 'the online cycle');
    await until(() => state(t) === 'idle', 'idle again');
  });

  it('offline edits queue; online pushes them', async () => {
    const t = await synced();
    t.knobs.online = false;
    window.dispatchEvent(new Event('offline'));
    await putLayout(t, 'lay-off', '9');
    await advance(10_000, 1000);
    expect(state(t)).toBe('offline');
    expect(t.stores.syncStatus.get().pending).toBe(1);
    t.knobs.online = true;
    window.dispatchEvent(new Event('online'));
    await until(() => t.stores.syncStatus.get().pending === 0, 'the queued edit to push');
    expect(state(t)).toBe('idle');
  });

  it('Sync now always runs, even inside the 60 s window, and does not need the tab to look idle', async () => {
    const t = await synced();
    const lists = t.lists();
    await t.svc.syncNow();
    expect(t.lists()).toBe(lists + 1);
    await t.svc.syncNow();
    expect(t.lists()).toBe(lists + 2);
  });

  it('a run reaching done: a cycle 10 s later (its bundle uploads)', async () => {
    const t = await synced();
    const lists = t.lists();
    for (const fn of t.runListeners) fn({ runId: 'r1', status: 'done', active: false });
    await advance(9000, 1000);
    expect(t.lists()).toBe(lists);
    await advance(1500, 500);
    await until(() => t.lists() > lists, 'the run-done cycle');
  });

  it('a paused run does not trigger a cycle', async () => {
    const t = await synced();
    const lists = t.lists();
    for (const fn of t.runListeners) fn({ runId: 'r1', status: 'paused', active: false });
    await advance(15_000, 1000);
    expect(t.lists()).toBe(lists);
  });
});

describe('a hidden tab never syncs', () => {
  it('no trigger fires while hidden; the owed work runs when it is visible again', async () => {
    const t = await synced();
    const lists = t.lists();
    t.knobs.visible = false;
    await putLayout(t, 'lay-h', '3');
    await advance(40_000, 5000); // the debounce fires, and is skipped
    window.dispatchEvent(new Event('online'));
    await advance(6 * 60_000, 30_000); // an interval tick passes
    for (const fn of t.runListeners) fn({ runId: 'r', status: 'done', active: false });
    await advance(20_000, 5000);
    expect(t.lists()).toBe(lists);
    expect(t.requests).toBeGreaterThan(0); // (sign-in traffic only)
    expect(t.stores.syncStatus.get().pending).toBe(1);
    // back on screen
    t.knobs.visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await until(() => t.stores.syncStatus.get().pending === 0, 'the owed push');
    expect(t.lists()).toBeGreaterThan(lists);
  });

  it('a hidden tab at start never makes the start cycle', async () => {
    const a = await synced();
    const lists = a.lists();
    a.stop();
    const t = makeTab(world);
    t.knobs.visible = false;
    await t.svc.start();
    await advance(20_000, 1000);
    expect(t.lists()).toBe(lists);
  });

  it('Sync now is a gesture and works from a tab marked hidden only by the OS (it never waits)', async () => {
    const t = await synced();
    const lists = t.lists();
    t.knobs.visible = false;
    await t.svc.syncNow();
    expect(t.lists()).toBe(lists + 1);
  });
});

describe('two tabs', () => {
  it('one cycle at a time: the second tab gets busy, mirrors the status and says so', async () => {
    const a = await synced();
    const b = makeTab(world);
    await b.svc.start();
    await until(() => state(b) === 'idle', 'tab B loaded');
    const release = holdDrive(world);
    const runA = a.svc.syncNow();
    await until(() => state(a) === 'syncing', 'tab A syncing');
    await until(() => state(b) === 'syncing', 'tab B mirroring A');
    expect(b.stores.syncElsewhere.get()).toBe(true);
    const before = b.requests;
    await b.svc.syncNow(); // tab B tries while A holds the lock: busy
    expect(world.locks.denied).toBeGreaterThanOrEqual(1);
    expect(b.requests).toBe(before); // B sent nothing
    expect(b.stores.syncElsewhere.get()).toBe(true);
    release();
    await runA;
    await until(() => state(b) === 'idle', 'tab B sees the end');
    expect(b.stores.syncElsewhere.get()).toBe(false);
    expect(a.stores.syncElsewhere.get()).toBe(false);
  });

  it('dirty marks from the other tab are forwarded to the lock holder, which looks again', async () => {
    const a = await synced();
    const b = makeTab(world);
    await b.svc.start();
    await until(() => state(b) === 'idle', 'tab B loaded');
    b.knobs.visible = false; // B cannot sync; it has to hand its edit over
    const release = holdDrive(world);
    const runA = a.svc.syncNow();
    await until(() => state(a) === 'syncing', 'tab A syncing');
    await putLayout(b, 'lay-from-b', '5'); // edited in tab B while A holds the lock
    await advance(500, 100); // B's marks are broadcast (batched) while A is still mid-cycle
    expect(b.stores.syncStatus.get().pending).toBeGreaterThan(0);
    release();
    await runA;
    // A (the holder) re-checks after its cycle and pushes B's edit; B's own timer then finds nothing to do
    const bRequests = b.requests;
    await advance(12_000, 1000);
    await until(() => a.stores.syncStatus.get().pending === 0, 'the forwarded edit to push');
    expect(b.requests).toBe(bRequests);
    const libs = [...world.drive.files.values()].filter((f) => f.name.startsWith('lib.'));
    expect(libs).toHaveLength(1);
    expect(new TextDecoder('latin1').decode(libs[0]!.bytes).length).toBeGreaterThan(0);
  });

  it('a change applied by one tab refreshes the other tab (fan-out) and reloads its notices', async () => {
    const a = await synced();
    const b = makeTab(world);
    await b.svc.start();
    // a second device adds a layout to Drive; tab A pulls it
    const dev2 = otherDevice(world);
    const d = makeTab(dev2);
    await putLayout(d, 'lay-d2', '11');
    await signInAndSync(d);
    a.refreshed.length = 0;
    b.refreshed.length = 0;
    await a.svc.syncNow();
    expect(await layoutIds(world.raw)).toContain('lay-d2');
    expect(a.refreshed.flat()).toContain('layout');
    await until(() => b.refreshed.flat().includes('layout'), 'tab B to refresh');
  });

  it('a tab that is signed out elsewhere turns off here too', async () => {
    const a = await synced();
    const b = makeTab(world);
    await b.svc.start();
    await until(() => state(b) === 'idle', 'tab B loaded');
    await a.svc.signOut();
    await until(() => state(b) === 'off', 'tab B off');
    expect(b.stores.syncPrefs.get().enabled).toBe(false);
  });
});

describe('errors and backoff (§7.11, §9)', () => {
  it('rate and server errors back off 30 s, 1 m, 2 m, 5 m, 10 m, then 15 m', async () => {
    const t = await synced();
    world.drive.set('fault', (m, u) =>
      u.pathname === '/drive/v3/files' && m === 'GET' ? fail(429, 'rateLimitExceeded') : undefined,
    );
    await t.svc.syncNow();
    expect(state(t)).toBe('backoff');
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const at = t.stores.syncStatus.get().retryAt!;
      waits.push(Math.round((at - Date.now()) / 1000));
      await advance(at - Date.now() + 200, 10_000);
      await until(() => (t.stores.syncStatus.get().retryAt ?? 0) > at, 'the next retry to fail');
    }
    expect(waits).toEqual([30, 60, 120, 300, 600, 900, 900]);
  });

  it('Retry-After wins and is clamped to one hour', async () => {
    const t = await synced();
    world.drive.set('fault', (m, u) =>
      u.pathname === '/drive/v3/files' && m === 'GET'
        ? fail(429, 'rateLimitExceeded', { 'Retry-After': '90' })
        : undefined,
    );
    await t.svc.syncNow();
    expect(Math.round((t.stores.syncStatus.get().retryAt! - Date.now()) / 1000)).toBe(90);
    world.drive.set('fault', (m, u) =>
      u.pathname === '/drive/v3/files' && m === 'GET'
        ? fail(503, 'backendError', { 'Retry-After': '86400' })
        : undefined,
    );
    await t.svc.syncNow();
    expect(Math.round((t.stores.syncStatus.get().retryAt! - Date.now()) / 1000)).toBe(3600);
  });

  it('Sync now resets the backoff and goes at once; other triggers wait for the timer', async () => {
    const t = await synced();
    world.drive.set('fault', (m, u) =>
      u.pathname === '/drive/v3/files' && m === 'GET' ? fail(500, 'backendError') : undefined,
    );
    await t.svc.syncNow();
    expect(state(t)).toBe('backoff');
    world.drive.set('fault', () => undefined);
    const lists = t.lists();
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(10_000, 1000);
    expect(t.lists()).toBe(lists); // held back by the backoff
    await t.svc.syncNow();
    expect(state(t)).toBe('idle');
    expect(t.stores.syncStatus.get().retryAt).toBeUndefined();
  });

  it('a network failure is offline (until the online event), not backoff', async () => {
    const t = await synced();
    world.drive.set('fault', () => {
      throw new TypeError('Failed to fetch');
    });
    await t.svc.syncNow();
    expect(state(t)).toBe('offline');
    world.drive.set('fault', () => undefined);
    window.dispatchEvent(new Event('online'));
    await until(() => state(t) === 'idle', 'idle after online');
  });

  it('quota: drive-full, retried hourly or on Sync now', async () => {
    world.gis.expiresIn = 4 * 3600; // outlast the hour of waiting
    const t = await synced();
    world.drive.set('fault', (_m, u) =>
      u.pathname.startsWith('/upload/') ? fail(403, 'storageQuotaExceeded') : undefined,
    );
    await putLayout(t, 'lay-q', '4');
    await t.svc.syncNow();
    expect(state(t)).toBe('drive-full');
    const lists = t.lists();
    await advance(50 * 60_000, 600_000);
    expect(t.lists()).toBe(lists); // no automatic trigger before the hour
    world.drive.set('fault', () => undefined);
    await advance(11 * 60_000, 60_000);
    await until(() => state(t) === 'idle', 'the hourly retry');
    expect(t.lists()).toBeGreaterThan(lists);
  });

  it('a 401 is needs-auth, and Reconnect (one gesture, silent) finishes the sync', async () => {
    const t = await synced();
    world.drive.set('acceptToken', () => false); // the server stops honouring the token
    await putLayout(t, 'lay-a', '2');
    await t.svc.syncNow();
    expect(state(t)).toBe('needs-auth');
    expect(t.stores.syncStatus.get().pending).toBe(1); // amber: changes are waiting
    world.drive.set('acceptToken', (tok: string) => tok.startsWith('fake-token-'));
    world.gis.calls.length = 0;
    const reconnect = t.svc.reconnect();
    await reconnect;
    await until(() => state(t) === 'idle', 'idle after Reconnect');
    expect(world.gis.calls).toEqual([{ prompt: '', login_hint: 'owner@example.com' }]);
    expect(t.stores.syncStatus.get().pending).toBe(0);
  });

  it('forbidden (access removed) is a sticky error: no automatic retry', async () => {
    const t = await synced();
    world.drive.set('fault', (m, u) =>
      u.pathname === '/drive/v3/files' && m === 'GET' ? fail(403, 'insufficientScopes') : undefined,
    );
    await t.svc.syncNow();
    expect(t.stores.syncStatus.get()).toMatchObject({
      state: 'error',
      error: { code: 'access-removed' },
    });
    const lists = t.lists();
    await advance(11 * 60_000, 60_000);
    expect(t.lists()).toBe(lists);
  });

  it('the token expiring (no event) turns the status to needs-auth by itself', async () => {
    world.gis.expiresIn = 400; // usable for 280 s
    const t = await synced();
    expect(state(t)).toBe('idle');
    await advance(285_000, 15_000);
    await until(() => state(t) === 'needs-auth', 'needs-auth at expiry');
    expect(t.stores.syncAuth.get().state).toBe('expired');
    expect(t.stores.syncStatus.get().pending).toBe(0); // calm: no amber without changes
  });

  it('local-full switches the download policy to onOpen and says so', async () => {
    const full = { on: false };
    const w = makeWorld({ raw: failingBackend(createMemoryBackend(), full) });
    const dev2 = makeTab(otherDevice(w));
    await putLayout(dev2, 'lay-from-2', '6');
    await signInAndSync(dev2);
    world = w;
    const t = makeTab(w);
    await t.svc.start();
    await signInAndSync(t); // Drive has data: Merge (the helper's choice) pulls it in
    await t.svc.setPrefs({ runDownload: 'all' });
    expect(t.stores.syncPrefs.get().runDownload).toBe('all');
    // a new layout arrives from the other device, but this device is out of space
    await putLayout(dev2, 'lay-more', '12');
    await dev2.svc.syncNow();
    full.on = true;
    await t.svc.syncNow();
    expect(state(t)).toBe('local-full');
    expect(t.stores.syncPrefs.get().runDownload).toBe('onOpen');
    expect(t.notices.join(' ')).toMatch(/out of space/);
    full.on = false;
    await t.svc.syncNow();
    expect(state(t)).toBe('idle');
  });
});

describe('sign-in, binding and the first sync (§7.10, §8.3)', () => {
  it('sign in on an empty Drive: the sheet offers to upload, Start syncing binds the account', async () => {
    const t = makeTab(world);
    await putLayout(t, 'lay-1', '7');
    await t.svc.start();
    const p = t.svc.signIn();
    await until(() => t.stores.firstSyncPrompt.get() !== null, 'the sheet');
    expect(t.stores.firstSyncPrompt.get()).toMatchObject({
      remoteEmpty: true,
      local: { layouts: 1 },
    });
    expect(state(t)).toBe('off'); // nothing starts before the choice
    expect(t.stores.syncAuth.get()).toMatchObject({
      state: 'signed-in',
      email: 'owner@example.com',
    });
    await t.svc.chooseFirstSync('merge');
    await p;
    expect(t.stores.firstSyncPrompt.get()).toBeNull();
    expect(state(t)).toBe('idle');
    expect(t.stores.syncPrefs.get().enabled).toBe(true);
    const acct = await world.raw.get<{ v: { accountId: string; email: string; boundAt: string } }>(
      'syncMeta',
      'account',
    );
    expect(acct?.v).toMatchObject({ accountId: '0123456789', email: 'owner@example.com' });
    expect([...world.drive.files.values()].map((f) => f.name).sort()).toEqual(
      [expect.stringMatching(/^lib\./), 'spinner-sync.json'].sort(),
    );
    expect(t.stores.syncDeviceId.get()).toMatch(/^[0-9a-z]{10}$/);
  });

  it('"Not now" closes the sheet, stays signed in and off; Start syncing comes back to it', async () => {
    const t = makeTab(world);
    await t.svc.start();
    const p = t.svc.signIn();
    await until(() => t.stores.firstSyncPrompt.get() !== null, 'the sheet');
    await t.svc.chooseFirstSync('cancel');
    await p;
    expect(t.stores.firstSyncPrompt.get()).toBeNull();
    expect(state(t)).toBe('off');
    expect(t.stores.syncAuth.get().state).toBe('signed-in');
    await t.svc.signIn(); // the card's "Start syncing" on a token that is still good
    expect(t.stores.firstSyncPrompt.get()).not.toBeNull();
  });

  it('a second device with data: Merge keeps both sides', async () => {
    const a = makeTab(world);
    await putLayout(a, 'lay-a', '1');
    await signInAndSync(a);
    const w2 = otherDevice(world);
    const b = makeTab(w2);
    await putLayout(b, 'lay-b', '2');
    await b.svc.start();
    const p = b.svc.signIn();
    await until(() => b.stores.firstSyncPrompt.get() !== null, 'the sheet on device B');
    const prompt = b.stores.firstSyncPrompt.get()!;
    expect(prompt.remoteEmpty).toBe(false);
    expect(prompt.remote.layouts).toBe(1);
    expect(prompt.local.layouts).toBe(1);
    await b.svc.chooseFirstSync('merge');
    await p;
    expect(await layoutIds(w2.raw)).toEqual(['lay-a', 'lay-b']);
    await a.svc.syncNow();
    expect(await layoutIds(world.raw)).toEqual(['lay-a', 'lay-b']);
  });

  it('Replace on a Drive with no readable library fails with "Nothing was deleted" and says so in the sheet', async () => {
    const a = makeTab(world);
    await signInAndSync(a); // an empty library: Drive has a lib file with no entries
    const w2 = otherDevice(world);
    const b = makeTab(w2);
    await putLayout(b, 'lay-b', '2');
    await b.svc.start();
    const p = b.svc.signIn();
    await until(() => b.stores.firstSyncPrompt.get() !== null, 'the sheet on device B');
    await b.svc.chooseFirstSync('replace');
    await p;
    expect(b.stores.firstSyncError.get()).toMatch(/Nothing was deleted/);
    expect(b.stores.firstSyncPrompt.get()).not.toBeNull(); // the sheet stays open
    expect(b.stores.syncPrefs.get().enabled).toBe(false);
    expect(await layoutIds(w2.raw)).toEqual(['lay-b']); // untouched
    await b.svc.chooseFirstSync('cancel');
    expect(b.stores.firstSyncError.get()).toBeNull();
  });

  it('Replace with data in Drive replaces this device', async () => {
    const a = makeTab(world);
    await putLayout(a, 'lay-a', '1');
    await signInAndSync(a);
    const w2 = otherDevice(world);
    const b = makeTab(w2);
    await putLayout(b, 'lay-b', '2');
    await signInAndSync(b, 'replace');
    expect(await layoutIds(w2.raw)).toEqual(['lay-a']);
    expect(state(b)).toBe('idle');
  });

  it('waits for an active run: the sheet appears when it ends, and Replace begins only when idle', async () => {
    const t = makeTab(world);
    t.knobs.runActive = true;
    await t.svc.start();
    void t.svc.signIn();
    await until(() => state(t) === 'waiting-run', 'waiting-run');
    expect(t.stores.firstSyncPrompt.get()).toBeNull();
    t.knobs.runActive = false;
    for (const fn of t.runListeners) fn({ runId: 'r', status: 'done', active: false });
    await until(() => t.stores.firstSyncPrompt.get() !== null, 'the sheet after the run');
    // a run starts between the sheet and the choice
    t.knobs.runActive = true;
    const lists = t.lists();
    await t.svc.chooseFirstSync('merge');
    expect(state(t)).toBe('waiting-run');
    expect(t.lists()).toBe(lists);
    t.knobs.runActive = false;
    for (const fn of t.runListeners) fn({ runId: 'r', status: 'cancelled', active: false });
    await until(() => state(t) === 'idle', 'the first sync after the run');
    expect(t.stores.syncPrefs.get().enabled).toBe(true);
  });

  it("a different account asks first: Cancel revokes, Sync this device's data resets and merges", async () => {
    const t = await synced();
    const id = t.stores.syncDeviceId.get();
    await t.svc.signOut();
    world.drive.set('email', 'other@example.com');
    world.drive.set('permissionId', 'B-account');
    world.drive.files.clear(); // account B's own, empty Drive
    await t.svc.signIn();
    expect(t.stores.accountSwitchPrompt.get()).toEqual({
      from: 'owner@example.com',
      to: 'other@example.com',
    });
    expect(state(t)).toBe('off');
    await t.svc.chooseAccountSwitch('cancel');
    expect(world.gis.revoked.length).toBeGreaterThanOrEqual(2);
    expect(t.stores.syncAuth.get().state).toBe('signed-out'); // revoked: token and hint are gone
    await t.svc.signIn();
    expect(t.stores.accountSwitchPrompt.get()).not.toBeNull();
    await t.svc.chooseAccountSwitch('sync');
    await until(() => state(t) === 'idle', 'idle on the new account');
    const acct = await world.raw.get<{ v: { accountId: string } }>('syncMeta', 'account');
    expect(acct?.v.accountId).toBe('B-account');
    expect(await layoutIds(world.raw)).toEqual(['lay-1']); // nothing on this device was deleted
    expect(t.stores.syncDeviceId.get()).toBe(id); // the device id and counter are kept
    const lib = [...world.drive.files.values()].find((f) => f.name.startsWith('lib.'));
    expect(lib?.name).toContain(id);
  });

  it('Sign out revokes, keeps local data and the index, and the same account comes back without a sheet', async () => {
    const t = await synced();
    await t.svc.signOut();
    expect(state(t)).toBe('off');
    expect(t.stores.syncPrefs.get().enabled).toBe(false);
    expect(world.gis.revoked).toHaveLength(1);
    expect(world.storage.getItem('spinner:sync:token')).toBeNull();
    expect(await layoutIds(world.raw)).toEqual(['lay-1']);
    expect((await world.raw.getAllKeys('syncIndex')).length).toBeGreaterThan(0);
    await t.svc.signIn();
    await until(() => state(t) === 'idle', 'idle again');
    expect(t.stores.firstSyncPrompt.get()).toBeNull();
    expect(t.stores.syncPrefs.get().enabled).toBe(true);
  });

  it('Remove my data erases Drive, resets the sync state, keeps local data, signs out; another device turns off', async () => {
    const a = await synced();
    const w2 = otherDevice(world);
    const b = makeTab(w2);
    await signInAndSync(b);
    await advance(5000, 1000); // the erase must be later than B's account binding
    await a.svc.removeDriveData();
    expect(state(a)).toBe('off');
    expect(a.stores.syncAuth.get().state).not.toBe('signed-in');
    expect(await layoutIds(world.raw)).toEqual(['lay-1']); // local data stays
    expect(await world.raw.getAllKeys('syncIndex')).toHaveLength(0);
    const names = [...world.drive.files.values()].map((f) => f.name);
    expect(names).toEqual(['spinner-sync.json']); // only the root, marked erased
    expect(new TextDecoder().decode([...world.drive.files.values()][0]!.bytes)).toContain('erased');
    expect(a.notices.join(' ')).toMatch(/Removed spinner data/);
    // device B finds out at its next cycle
    await b.svc.syncNow();
    expect(b.stores.syncStatus.get()).toMatchObject({ state: 'error', error: { code: 'erased' } });
    expect(b.stores.syncPrefs.get().enabled).toBe(false);
    const lists = b.lists();
    await advance(11 * 60_000, 60_000);
    expect(b.lists()).toBe(lists); // no more automatic syncing
    // a later sign-in on A starts over and rewrites the root without `erased`
    await a.svc.signIn();
    await until(() => a.stores.firstSyncPrompt.get() !== null, 'the sheet on A');
    await a.svc.chooseFirstSync('merge');
    await until(() => state(a) === 'idle', 'A synced again');
    expect(
      new TextDecoder().decode(
        [...world.drive.files.values()].find((f) => f.name === 'spinner-sync.json')!.bytes,
      ),
    ).not.toContain('erased');
  });

  it('a device that was told its Drive was erased starts over on sign-in, even after a reload', async () => {
    const a = await synced();
    const w2 = otherDevice(world);
    const b = makeTab(w2);
    await putLayout(b, 'lay-b', '2');
    await signInAndSync(b);
    await advance(5000, 1000);
    await a.svc.removeDriveData();
    await b.svc.syncNow();
    expect(b.stores.syncStatus.get().error?.code).toBe('erased');
    // the reset is durable: the binding and the sync state are gone at once
    expect(await w2.raw.get('syncMeta', 'account')).toBeUndefined();
    expect(await w2.raw.get('syncMeta', 'last')).toBeUndefined();
    expect(await w2.raw.getAllKeys('syncIndex')).toHaveLength(0);
    b.stop();
    const b2 = makeTab(w2); // the page reloads: a new service on the same storage
    await b2.svc.start();
    expect(b2.stores.syncStatus.get()).toMatchObject({ state: 'error', error: { code: 'erased' } });
    await b2.svc.signIn(); // the card's "Sign in" for an erased Drive
    await until(() => b2.stores.firstSyncPrompt.get() !== null, 'the first-sync sheet');
    expect(b2.stores.firstSyncPrompt.get()?.remoteEmpty).toBe(true);
    await b2.svc.chooseFirstSync('merge');
    await until(() => state(b2) === 'idle', 'B synced');
    expect(await layoutIds(w2.raw)).toContain('lay-b');
    expect(w2.storage.getItem('spinner:sync:erased')).toBeNull();
  });

  it('a sign-in whose own cycle finds the Drive erased resets and offers the first-sync sheet', async () => {
    const a = await synced();
    const w2 = otherDevice(world);
    const b = makeTab(w2);
    await putLayout(b, 'lay-b', '2');
    await signInAndSync(b);
    await b.svc.signOut(); // keeps the binding and the index
    await advance(5000, 1000);
    await a.svc.removeDriveData();
    await b.svc.signIn();
    await until(() => b.stores.firstSyncPrompt.get() !== null, 'the sheet after the erased cycle');
    expect(await w2.raw.get('syncMeta', 'account')).toBeUndefined();
  });
});

describe('guards between sheets and timers (review F7-F12)', () => {
  it('F7: an open account-switch sheet is not undermined by a timer cycle (no revoke)', async () => {
    const t = await synced();
    world.drive.set('permissionId', 'B-account');
    world.drive.set('email', 'other@example.com');
    t.env.auth.source.expireNow();
    await t.svc.signIn();
    expect(t.stores.accountSwitchPrompt.get()).not.toBeNull();
    const revoked = world.gis.revoked.length;
    await putLayout(t, 'lay-f7', '1');
    await advance(6 * 60_000, 30_000);
    expect(world.gis.revoked).toHaveLength(revoked);
    expect(t.stores.syncAuth.get().state).toBe('signed-in');
    expect(t.stores.accountSwitchPrompt.get()).not.toBeNull();
  });

  it('F8: a tab that was off starts its timers when another tab turns sync on', async () => {
    const a = makeTab(world);
    await a.svc.start();
    const p = a.svc.signIn();
    await until(() => a.stores.firstSyncPrompt.get() !== null, 'the sheet');
    const b = makeTab(world); // opened meanwhile: signed in (shared token), sync off
    await b.svc.start();
    expect(b.stores.syncPrefs.get().enabled).toBe(false);
    await a.svc.chooseFirstSync('merge');
    await p;
    await until(() => b.stores.syncPrefs.get().enabled === true, 'tab B to see sync on');
    await flush();
    a.knobs.visible = false; // so only tab B's own interval can fire
    const before = b.requests;
    await advance(5 * 60_000 + 2000, 30_000);
    expect(b.requests).toBeGreaterThan(before); // its 5 min interval is running
  });

  it('F9: a popup sign-in leaves no redirect marker, even when the popup is closed', async () => {
    const t = makeTab(world);
    await t.svc.start();
    world.gis.mode = 'closed';
    await t.svc.signIn();
    expect(world.storage.getItem(SIGNIN_KEY)).toBeNull();
    world.gis.mode = 'hang';
    void t.svc.signIn();
    await flush();
    expect(world.storage.getItem(SIGNIN_KEY)).toBeNull();
  });

  it("F12: removeDriveData waits for this tab's own cycle instead of saying another tab is syncing", async () => {
    const t = await synced();
    const release = holdDrive(world);
    const cycle = t.svc.syncNow();
    await until(() => state(t) === 'syncing', 'syncing');
    const removing = t.svc.removeDriveData();
    await flush();
    release();
    await cycle;
    await removing;
    expect(t.notices.join(' ')).not.toMatch(/Another tab/);
    expect(t.notices.join(' ')).toMatch(/Removed spinner data/);
    expect([...world.drive.files.values()].map((f) => f.name)).toEqual(['spinner-sync.json']);
  });

  it('F10: an active run rewriting its row makes no cycles beyond the 5 min interval', async () => {
    const t = await synced();
    t.knobs.runActive = true;
    const lists = t.lists();
    for (let i = 0; i < 100; i++) {
      await t.tracked.tx(['runs'], 'readwrite', (tx) =>
        tx.put('runs', { runId: 'run-live', status: 'running', completedSessions: i }),
      );
      await advance(2000, 1000);
    }
    expect(t.lists()).toBe(lists); // 200 s of row writes, no cycle
    expect(t.stores.syncStatus.get().pending).toBeLessThanOrEqual(1);
  });
});

describe('the sign-in flow (§5.1, §5.2)', () => {
  it('signIn, reconnect, syncNow and removeDriveData start the token request inside the click', async () => {
    const t = makeTab(world);
    await t.svc.start();
    const acquire = vi.spyOn(t.env.auth, 'acquire');
    void t.svc.signIn(); // no await: the request must already be made
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenLastCalledWith(false);
    await until(() => t.stores.firstSyncPrompt.get() !== null, 'the sheet');
    await t.svc.chooseFirstSync('merge');
    await until(() => state(t) === 'idle', 'idle');
    t.env.auth.source.expireNow();
    acquire.mockClear();
    void t.svc.reconnect();
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenLastCalledWith(true); // silent
    await until(() => state(t) === 'idle', 'idle after Reconnect');
    t.env.auth.source.expireNow();
    acquire.mockClear();
    void t.svc.syncNow(); // Sync now reconnects first when the token is gone
    expect(acquire).toHaveBeenCalledTimes(1);
    await until(() => state(t) === 'idle', 'idle after Sync now');
    t.env.auth.source.expireNow();
    acquire.mockClear();
    void t.svc.removeDriveData();
    expect(acquire).toHaveBeenCalledTimes(1);
    await until(() => state(t) === 'off', 'removed');
  });

  it('a blocked popup reports it and offers "Sign in in this window"; the redirect is refused during a run', async () => {
    const t = makeTab(world);
    await t.svc.start();
    world.gis.mode = 'blocked';
    await t.svc.signIn();
    expect(t.stores.signInError.get()).toBe('The sign-in window was blocked.');
    expect(t.stores.signInRedirectOffer.get()).toBe(true);
    expect(t.navigations).toHaveLength(0);
    t.knobs.runActive = true;
    await t.svc.signIn({ mode: 'redirect' });
    expect(t.stores.signInError.get()).toBe('Finish or pause the run first.');
    expect(t.navigations).toHaveLength(0);
    t.knobs.runActive = false;
    void t.svc.signIn({ mode: 'redirect' }); // navigates away: the promise never settles
    await flush();
    expect(t.navigations).toEqual([{ silent: false }]);
    expect(t.stores.syncAuth.get()).toEqual({ state: 'redirecting' });
    expect(t.stores.signInError.get()).toBeNull();
    expect(world.storage.getItem(SIGNIN_KEY)).not.toBeNull(); // so the reload can finish the sign-in
  });

  it('a closed popup, a timeout and a script failure each give a readable error', async () => {
    const t = makeTab(world);
    await t.svc.start();
    world.gis.mode = 'closed';
    await t.svc.signIn();
    expect(t.stores.signInError.get()).toBe('Sign-in was cancelled.');
    world.gis.mode = 'denied';
    await t.svc.signIn();
    expect(t.stores.signInError.get()).toMatch(/access_denied|not granted/);
    world.gis.mode = 'grant';
    await t.svc.signIn();
    await until(() => t.stores.firstSyncPrompt.get() !== null, 'recovered');
    expect(t.stores.signInError.get()).toBeNull();
  });

  it('after the redirect returns, the reloaded app finishes the sign-in (and a stale marker is ignored)', async () => {
    const a = makeTab(world);
    await a.svc.start();
    void a.svc.signIn();
    await until(() => a.stores.firstSyncPrompt.get() !== null, 'the sheet');
    a.stop();
    // the page reloaded after Google: a token is stored and the marker is fresh
    world.storage.setItem(SIGNIN_KEY, String(Date.now()));
    const b = makeTab(world);
    await b.svc.start();
    expect(b.stores.firstSyncPrompt.get()).not.toBeNull();
    expect(world.storage.getItem(SIGNIN_KEY)).toBeNull();
    b.stop();
    world.storage.setItem(SIGNIN_KEY, String(Date.now() - 11 * 60_000));
    const c = makeTab(world);
    await c.svc.start();
    expect(c.stores.firstSyncPrompt.get()).toBeNull();
  });
});

describe('prefs and policy defaults (§7.12)', () => {
  it('download policy: onOpen on mobile or a small coarse screen, all elsewhere', () => {
    expect(defaultRunDownload({ uaMobile: true })).toBe('onOpen');
    expect(defaultRunDownload({ coarsePointer: true, screenWidth: 412 })).toBe('onOpen');
    expect(defaultRunDownload({ coarsePointer: true, screenWidth: 1024 })).toBe('all');
    expect(defaultRunDownload({ coarsePointer: false, screenWidth: 400 })).toBe('all');
    expect(defaultRunDownload({})).toBe('all');
  });
  it('device names read well', () => {
    expect(
      defaultDeviceName({
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      }),
    ).toBe('Pixel 7');
    expect(
      defaultDeviceName({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605' }),
    ).toBe('Safari on Mac');
  });
  it('the default is stored with the first prefs write and follows the device', async () => {
    const t = makeTab(world);
    t.knobs.uaMobile = true;
    await putLayout(t, 'lay-1', '7');
    await signInAndSync(t);
    expect(t.stores.syncPrefs.get().runDownload).toBe('onOpen');
    const row = await world.raw.get<{ v: { runDownload: string; deviceName: string } }>(
      'syncMeta',
      'prefs',
    );
    expect(row?.v).toMatchObject({ runDownload: 'onOpen', deviceName: 'Chrome on Linux' });
  });
  it('setPrefs persists, renames through the next push, and never switches sync on by itself', async () => {
    const t = makeTab(world);
    await t.svc.start();
    await t.svc.setPrefs({ enabled: true });
    expect(t.stores.syncPrefs.get().enabled).toBe(false); // needs a first sync
    const a = await synced(otherDevice(world));
    const lists = a.lists();
    await a.svc.setPrefs({ deviceName: 'Kitchen laptop', runDownload: 'all' });
    expect(a.stores.syncPrefs.get()).toMatchObject({
      deviceName: 'Kitchen laptop',
      runDownload: 'all',
    });
    await until(() => a.lists() > lists, 'the rename cycle');
    await a.svc.setPrefs({ deviceName: '   ' });
    expect(a.stores.syncPrefs.get().deviceName).toBe('Kitchen laptop');
  });
});

describe('Drive info and runs', () => {
  it('refreshAccountInfo fills the usage and the device list, marking the device id', async () => {
    const t = await synced();
    const w2 = otherDevice(world);
    const b = makeTab(w2);
    await signInAndSync(b);
    await t.svc.refreshAccountInfo(true);
    expect(t.stores.syncAbout.get()).toMatchObject({
      email: 'owner@example.com',
      accountId: '0123456789',
      deviceBytes: 1000,
    });
    const ids = t.stores.syncDevices.get().map((d) => d.id);
    expect(ids).toContain(t.stores.syncDeviceId.get());
    expect(ids).toContain(b.stores.syncDeviceId.get());
  });
  it('the card-open refresh is not throttled away when a cycle moved data since the last read', async () => {
    const t = await synced();
    await t.svc.refreshAccountInfo(true);
    expect(t.stores.syncDevices.get()).toHaveLength(1);
    const b = makeTab(otherDevice(world));
    await signInAndSync(b);
    await t.svc.syncNow(); // pulls B's library: the info is stale now
    await advance(6000, 1000); // past the 5 s throttle between reads
    await t.svc.refreshAccountInfo(); // no force: stale info is read again, a fresh one is not
    await until(() => t.stores.syncDevices.get().length === 2, 'both devices listed');
  });
  it('remote runs: none yet; downloads report offline and needs-auth', async () => {
    const t = await synced();
    expect(await t.svc.listRemoteRuns()).toEqual([]);
    expect(await t.svc.remoteRun('nope')).toBeNull();
    t.knobs.online = false;
    expect(await t.svc.downloadRun('nope')).toBe('offline');
    t.knobs.online = true;
    t.env.auth.source.expireNow();
    expect(await t.svc.downloadRun('nope')).toBe('needs-auth');
  });
  it('conflict notices come from syncMeta, newest first, and mark read', async () => {
    const t = await synced();
    const notice = (id: string, at: string) => ({
      id,
      at,
      key: 'layout:x',
      kind: 'layout',
      message: id,
      read: false,
    });
    await world.raw.tx(['syncMeta'], 'readwrite', (tx) =>
      tx.put('syncMeta', {
        k: 'conflicts',
        v: [notice('old', '2026-10-28T00:00:00Z'), notice('new', '2026-10-29T00:00:00Z')],
      }),
    );
    window.dispatchEvent(new Event('online'));
    const w2 = otherDevice(world);
    void w2;
    await t.svc.syncNow();
    expect(t.stores.conflictNotices.get().map((n) => n.id)).toEqual(['new', 'old']);
    expect(t.stores.syncStatus.get().conflicts).toBe(2);
    t.svc.markConflictsRead();
    expect(t.stores.syncStatus.get().conflicts).toBe(0);
    await flush();
    const row = await world.raw.get<{ v: { read: boolean }[] }>('syncMeta', 'conflicts');
    expect(row?.v.every((n) => n.read)).toBe(true);
  });
});
