/* eslint-disable @typescript-eslint/require-await -- async stubs and fake method tables */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthFlow, setAuthForTest } from '../../../src/app/services/sync/flow';
import { createGisTokenSource, type GisConfig } from '../../../src/app/services/sync/gis';
import { createDriveStore } from '../../../src/app/services/sync/drive';
import { OAUTH_KEY, startRedirect, TOKEN_KEY } from '../../../src/app/services/sync/redirect';
import * as svc from '../../../src/app/services/sync';
import { processReturn } from '../../../src/oauth/return';
import { consentRedirect } from './fakes';
import { createFakeDrive } from './fakes';
import { isFakeToken } from './fakes';
import { bytes, freshGis } from './helpers';

let now = 1_000_000;
function setup(over: Partial<GisConfig> = {}) {
  const gis = freshGis();
  const drive = createFakeDrive({ acceptToken: (t) => isFakeToken(t), email: 'owner@example.com' });
  vi.stubGlobal('fetch', drive.fetch);
  const source = createGisTokenSource({
    clientId: 'cid',
    load: async () => gis.api,
    now: () => now,
    whoAmI: async (t) =>
      (await createDriveStore({ token: () => t, fetchImpl: drive.fetch }).about()).email,
    platform: () => ({ standalone: false, android: false }),
    ...over,
  });
  setAuthForTest(createAuthFlow(source));
  return { gis, drive, source };
}

beforeEach(() => {
  localStorage.clear();
  now = 1_000_000;
});
afterEach(() => {
  setAuthForTest(null);
  vi.unstubAllGlobals();
});

describe('testSignIn (D23 gate) through the fakes', () => {
  it('signs in with the popup, reads the account and lists the app folder', async () => {
    const { gis, drive } = setup();
    await createDriveStore({ token: () => 'fake-token-9', fetchImpl: drive.fetch }).create(
      'x',
      bytes(10),
    );
    await createDriveStore({ token: () => 'fake-token-9', fetchImpl: drive.fetch }).create(
      'y',
      bytes(10),
    );
    expect(await svc.testSignIn()).toEqual({ email: 'owner@example.com', files: 2 });
    expect(gis.ctl.calls).toEqual([{ prompt: 'select_account' }]);
    expect(drive.log.map((l) => l.path)).toContain('/drive/v3/about');
    expect(localStorage.getItem('spinner:sync:gate')).toBeNull();
  });

  it('an empty Drive says 0 files; a second tap reuses the valid token', async () => {
    const { gis } = setup();
    expect(await svc.testSignIn()).toEqual({ email: 'owner@example.com', files: 0 });
    expect(await svc.testSignIn()).toEqual({ email: 'owner@example.com', files: 0 });
    expect(gis.ctl.calls.length).toBe(1);
  });

  it('Expire token now, then the next sign-in is one silent Reconnect (no chooser, with the hint)', async () => {
    const { gis, source } = setup();
    await svc.testSignIn();
    svc.expireTokenForTest();
    expect(source.state).toEqual({ state: 'expired', email: 'owner@example.com' });
    expect(await svc.testSignIn()).toEqual({ email: 'owner@example.com', files: 0 });
    expect(gis.ctl.calls[1]).toEqual({ prompt: '', login_hint: 'owner@example.com' });
    expect(source.state.state).toBe('signed-in');
    expect(gis.ctl.revoked).toEqual([]); // the session stays for the Reconnect check
  });

  it('endTestSignIn revokes at Google and forgets the session', async () => {
    const { gis, source } = setup();
    await svc.testSignIn();
    await svc.endTestSignIn();
    expect(gis.ctl.revoked).toEqual(['fake-token-1']);
    expect(source.state.state).toBe('signed-out');
  });

  it('expireTokenForTest with no session is a no-op', () => {
    const { source } = setup();
    svc.expireTokenForTest();
    expect(source.state.state).toBe('signed-out');
  });

  it('surfaces popup errors to the row, and a revoked token as an auth error', async () => {
    const { gis, drive } = setup();
    gis.ctl.mode = 'blocked';
    await expect(svc.testSignIn()).rejects.toMatchObject({ code: 'popup-blocked' });
    gis.ctl.mode = 'grant';
    await svc.testSignIn();
    drive.set('fault', () => new Response('{}', { status: 401 }));
    await expect(svc.testSignIn()).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('testSignIn through the redirect', () => {
  it('goes to Google, comes back through the return page, and resumeTestSignIn finishes', async () => {
    const nav: string[] = [];
    const { source } = setup({
      platform: () => ({ standalone: true, android: true }),
      navigate: (o) =>
        void startRedirect(o, {
          now: () => now,
          state: () => 'S1',
          href: 'https://h.test/spinner/#/settings?account=1',
          assign: (u) => nav.push(u),
        }),
    });
    let settled = false;
    void svc.testSignIn().then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false); // the page is leaving
    expect(source.state).toEqual({ state: 'redirecting' });
    expect(Number(localStorage.getItem('spinner:sync:gate'))).toBeGreaterThan(0); // a timestamp
    expect(nav.length).toBe(1);
    // Google answers; the return page runs in a fresh page load
    const back = consentRedirect(new URL(nav[0]!), 1);
    const frag = new URL(back).hash;
    const out = await processReturn({
      hash: frag,
      storage: localStorage,
      now,
      origin: 'https://h.test',
      fetchImpl: ((u: string, i: RequestInit) =>
        createFakeDrive({ acceptToken: isFakeToken, email: 'owner@example.com' }).fetch(
          u,
          i,
        )) as typeof fetch,
      broadcast: () => undefined,
      scrub: () => undefined,
    });
    expect(out).toMatchObject({ ok: true, goTo: 'https://h.test/spinner/#/settings?account=1' });
    expect(localStorage.getItem(OAUTH_KEY)).toBeNull();
    // the reloaded app: a new token source reads localStorage; the Account card resumes the gate
    setup({ platform: () => ({ standalone: true, android: true }) });
    localStorage.setItem(TOKEN_KEY, localStorage.getItem(TOKEN_KEY)!); // untouched by setup
    expect(await svc.resumeTestSignIn()).toEqual({ email: 'owner@example.com', files: 0 });
    expect(await svc.resumeTestSignIn()).toBeNull(); // once
  });

  it('a cancelled redirect leaves a flag that expires after 10 minutes (no stale result)', async () => {
    setup();
    // a token is present (signed in earlier), and a gate flag from a redirect that never came back
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ token: 'fake-token-1', expiresAt: Date.now() + 3_600_000, email: 'a@b.c' }),
    );
    setup();
    localStorage.setItem('spinner:sync:gate', String(Date.now() - 11 * 60_000));
    expect(await svc.resumeTestSignIn()).toBeNull();
    localStorage.setItem('spinner:sync:gate', '1'); // the old format never resumes either
    expect(await svc.resumeTestSignIn()).toBeNull();
  });

  it('resumeTestSignIn is null when no gate redirect was in flight', async () => {
    setup();
    expect(await svc.resumeTestSignIn()).toBeNull();
  });
});
