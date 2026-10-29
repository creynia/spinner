/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- async stubs and fake method tables */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACQUIRE_TIMEOUT_MS,
  AuthError,
  createGisTokenSource,
  DRIVE_APPDATA_SCOPE,
  loadGis,
  resetGisLoaderForTest,
  SKEW_MS,
  type GisConfig,
} from '../../../src/app/services/sync/gis';
import { HINT_KEY, TOKEN_KEY } from '../../../src/app/services/sync/redirect';
import { freshGis } from './helpers';

const sources: { dispose(): void }[] = [];
let now = 1_000_000;
beforeEach(() => {
  localStorage.clear();
  now = 1_000_000;
});
afterEach(() => {
  for (const s of sources.splice(0)) s.dispose();
});

function make(over: Partial<GisConfig> = {}) {
  const gis = freshGis();
  const src = createGisTokenSource({
    clientId: 'cid',
    load: async () => gis.api,
    now: () => now,
    whoAmI: async () => 'owner@example.com',
    platform: () => ({ standalone: false, android: false }),
    ...over,
  });
  sources.push(src);
  return { gis, src };
}

describe('GIS token source', () => {
  it('signs in, expires after about an hour, reconnects silently with the email hint, revokes', async () => {
    const { gis, src } = make();
    expect(src.state.state).toBe('signed-out');
    expect(src.current()).toBeNull();
    expect(await src.acquire({ silent: false })).toBe('fake-token-1');
    expect(gis.ctl.calls[0]).toEqual({ prompt: 'select_account' });
    expect(src.state).toMatchObject({ state: 'signed-in', email: 'owner@example.com' });
    expect(src.current()).toBe('fake-token-1');
    now += 3599_000 - 60_000; // inside the 2-minute skew
    expect(src.current()).toBeNull();
    expect(src.state).toEqual({ state: 'expired', email: 'owner@example.com' });
    expect(await src.acquire({ silent: true })).toBe('fake-token-2');
    expect(gis.ctl.calls[1]).toEqual({ prompt: '', login_hint: 'owner@example.com' });
    await src.revoke();
    expect(gis.ctl.revoked).toEqual(['fake-token-2']);
    expect(src.state.state).toBe('signed-out');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
  });

  it('asks for exactly the drive.appdata scope, in the click (requestAccessToken is called synchronously after load)', async () => {
    const seen: string[] = [];
    const { gis } = make();
    const orig = gis.api.initTokenClient;
    gis.api.initTokenClient = (c) => (seen.push(c.scope, c.client_id), orig(c));
    const src = createGisTokenSource({
      clientId: 'cid',
      load: async () => gis.api,
      whoAmI: async () => 'a',
    });
    sources.push(src);
    await src.acquire({ silent: false, mode: 'popup' });
    expect(seen).toEqual([DRIVE_APPDATA_SCOPE, 'cid']);
  });

  it('keeps the token in localStorage until expiry and restores it after a reload', async () => {
    const a = make();
    await a.src.acquire({ silent: false });
    const stored = JSON.parse(localStorage.getItem(TOKEN_KEY)!) as {
      token: string;
      expiresAt: number;
      email: string;
    };
    expect(stored).toEqual({
      token: 'fake-token-1',
      expiresAt: now + 3599_000,
      email: 'owner@example.com',
    });
    // reload within the hour: silent, signed in, no GIS involved
    now += 30 * 60_000;
    const b = createGisTokenSource({ clientId: 'cid', now: () => now, whoAmI: async () => 'x' });
    sources.push(b);
    expect(b.state).toMatchObject({ state: 'signed-in', email: 'owner@example.com' });
    expect(b.current()).toBe('fake-token-1');
    // reload after expiry: the token is dropped, the email hint stays
    now += 31 * 60_000;
    const c = createGisTokenSource({ clientId: 'cid', now: () => now, whoAmI: async () => 'x' });
    sources.push(c);
    expect(c.state).toEqual({ state: 'expired', email: 'owner@example.com' });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(HINT_KEY)!)).toEqual({ email: 'owner@example.com' });
  });

  it('ignores junk in localStorage', () => {
    localStorage.setItem(TOKEN_KEY, '{"token":5}');
    localStorage.setItem(HINT_KEY, 'not json');
    const s = createGisTokenSource({ clientId: 'cid', now: () => now, whoAmI: async () => 'x' });
    sources.push(s);
    expect(s.state.state).toBe('signed-out');
  });

  it('expireNow makes the token look expired (Reconnect path) and notifies subscribers', async () => {
    const { gis, src } = make();
    const states: string[] = [];
    src.subscribe((s) => states.push(s.state));
    await src.acquire({ silent: false });
    src.expireNow();
    expect(src.current()).toBeNull();
    expect(src.state).toEqual({ state: 'expired', email: 'owner@example.com' });
    expect(states).toEqual(['signed-in', 'expired']);
    await src.acquire({ silent: true });
    expect(gis.ctl.calls[1]).toEqual({ prompt: '', login_hint: 'owner@example.com' });
    expect(states).toEqual(['signed-in', 'expired', 'signed-in']);
  });

  it('refuses a grant without drive.appdata, and reports blocked, closed, denied popups', async () => {
    const m1 = make();
    m1.gis.ctl.mode = 'noscope';
    await expect(m1.src.acquire({ silent: false })).rejects.toMatchObject({ code: 'scope' });
    expect(m1.src.current()).toBeNull();
    const m2 = make();
    m2.gis.ctl.mode = 'blocked';
    await expect(m2.src.acquire({ silent: true })).rejects.toMatchObject({ code: 'popup-blocked' });
    m2.gis.ctl.mode = 'closed';
    await expect(m2.src.acquire({ silent: false })).rejects.toMatchObject({ code: 'popup-closed' });
    m2.gis.ctl.mode = 'denied';
    await expect(m2.src.acquire({ silent: false })).rejects.toMatchObject({ code: 'denied' });
    expect(m2.src.state.state).toBe('signed-out');
  });

  it('times out when the popup never answers (120 s default), without hanging', async () => {
    expect(ACQUIRE_TIMEOUT_MS).toBe(120_000);
    const m = make({ timeoutMs: 20 });
    m.gis.ctl.mode = 'hang';
    await expect(m.src.acquire({ silent: true })).rejects.toMatchObject({ code: 'timeout' });
    // a late callback after the timeout does not sign anyone in
    expect(m.src.state.state).toBe('signed-out');
  });

  it('uses the 120 s default timer (fake timers)', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const m = make();
      m.gis.ctl.mode = 'hang';
      const p = m.src.acquire({ silent: false, mode: 'popup' });
      const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(119_000);
      let settled = false;
      void p.catch(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_500);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports unconfigured when the build has no client id', async () => {
    const off = createGisTokenSource({ clientId: '', whoAmI: async () => 'x' });
    sources.push(off);
    expect(off.state.state).toBe('unconfigured');
    await expect(off.acquire({ silent: false })).rejects.toMatchObject({ code: 'unconfigured' });
    await expect(off.acquire({ silent: false })).rejects.toBeInstanceOf(AuthError);
  });

  it('revokes offline: local state is cleared even when GIS cannot load', async () => {
    const { src } = make();
    await src.acquire({ silent: false });
    const off = createGisTokenSource({
      clientId: 'cid',
      now: () => now,
      load: () => Promise.reject(new AuthError('script', 'offline')),
      whoAmI: async () => 'x',
    });
    sources.push(off);
    expect(off.state.state).toBe('signed-in');
    await expect(off.revoke()).resolves.toBeUndefined();
    expect(off.state.state).toBe('signed-out');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
  });

  it('picks up a token written by another tab (storage event) and by the return page (broadcast)', async () => {
    const { src } = make();
    const seen: string[] = [];
    src.subscribe((s) => seen.push(s.state));
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ token: 'other', expiresAt: now + 3_000_000, email: 'o@x' }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_KEY }));
    expect(src.current()).toBe('other');
    expect(seen).toEqual(['signed-in']);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(HINT_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_KEY }));
    expect(src.state.state).toBe('signed-out');
    expect(seen).toEqual(['signed-in', 'signed-out']);
    // unrelated keys are ignored
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    expect(seen.length).toBe(2);
    // the return page broadcasts after it stored the token
    const ch = new BroadcastChannel('spinner-sync');
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ token: 'ret', expiresAt: now + 3_000_000, email: 'o@x' }),
    );
    ch.postMessage({ type: 'token' });
    await new Promise((r) => setTimeout(r, 20));
    ch.close();
    expect(src.current()).toBe('ret');
  });

  it('skew: the token counts as expired two minutes early', async () => {
    const { src } = make();
    await src.acquire({ silent: false });
    now += 3599_000 - SKEW_MS - 1;
    expect(src.current()).toBe('fake-token-1');
    now += 2;
    expect(src.current()).toBeNull();
  });
});

describe('flow choice inside acquire', () => {
  it('auto: installed Android goes to the redirect, desktop and Chrome tabs to the popup', async () => {
    const nav: { silent: boolean; loginHint?: string }[] = [];
    const mk = (standalone: boolean, android: boolean) => {
      const m = make({
        platform: () => ({ standalone, android }),
        navigate: (o) => void nav.push(o),
      });
      return m;
    };
    const droid = mk(true, true);
    void droid.src.acquire({ silent: false }); // never settles: the page leaves
    await Promise.resolve();
    expect(nav).toEqual([{ clientId: 'cid', silent: false }]);
    expect(droid.src.state).toEqual({ state: 'redirecting' });
    expect(droid.gis.ctl.calls).toEqual([]);
    for (const [s, a] of [
      [false, true],
      [true, false],
      [false, false],
    ] as const) {
      const m = mk(s, a);
      await m.src.acquire({ silent: false });
      expect(m.gis.ctl.calls.length).toBe(1);
    }
    expect(nav.length).toBe(1);
  });

  it('explicit modes override the platform', async () => {
    const nav: unknown[] = [];
    const a = make({
      platform: () => ({ standalone: true, android: true }),
      navigate: (o) => void nav.push(o),
    });
    await a.src.acquire({ silent: false, mode: 'popup' });
    expect(a.gis.ctl.calls.length).toBe(1);
    expect(nav.length).toBe(0);
    const b = make({
      platform: () => ({ standalone: false, android: false }),
      navigate: (o) => void nav.push(o),
    });
    void b.src.acquire({ silent: true, mode: 'redirect' });
    await Promise.resolve();
    expect(nav).toEqual([{ clientId: 'cid', silent: true, loginHint: 'owner@example.com' }]); // hint from a's sign-in
  });

  it('carries the email hint into the redirect, and refuses it while a run is active', async () => {
    localStorage.setItem(HINT_KEY, JSON.stringify({ email: 'owner@example.com' }));
    const nav: unknown[] = [];
    const m = make({ navigate: (o) => void nav.push(o) });
    void m.src.acquire({ silent: true, mode: 'redirect' });
    await Promise.resolve();
    expect(nav).toEqual([{ clientId: 'cid', silent: true, loginHint: 'owner@example.com' }]);
    const busy = make({ isRunActive: () => true, navigate: (o) => void nav.push(o) });
    await expect(busy.src.acquire({ silent: false, mode: 'redirect' })).rejects.toMatchObject({
      code: 'run-active',
    });
    expect(nav.length).toBe(1);
    expect(busy.src.state.state).toBe('expired'); // not 'redirecting'
  });

  it('a failing navigation puts the state back', async () => {
    const m = make({
      navigate: () => {
        throw new Error('nope');
      },
    });
    await expect(m.src.acquire({ silent: false, mode: 'redirect' })).rejects.toThrow('nope');
    expect(m.src.state.state).toBe('signed-out');
  });
});

describe('loadGis', () => {
  // happy-dom would try to fetch a real <script src>; a stub document captures the element instead.
  function stubDoc() {
    const els: {
      src?: string;
      async?: boolean;
      onload?: () => void;
      onerror?: () => void;
      removed?: boolean;
      remove(): void;
    }[] = [];
    const doc = {
      createElement: () => {
        const e = {
          remove() {
            e.removed = true;
          },
        } as (typeof els)[number];
        els.push(e);
        return e;
      },
      head: { appendChild: () => undefined },
    } as unknown as Document;
    return { doc, els };
  }

  it('injects the script once, resolves when it defines google.accounts.oauth2, and retries after an error', async () => {
    delete (window as { google?: unknown }).google;
    resetGisLoaderForTest();
    const { doc, els } = stubDoc();
    const p = loadGis(doc, 1000);
    expect(els[0]!.src).toBe('https://accounts.google.com/gsi/client');
    expect(loadGis(doc, 1000)).toBe(p);
    els[0]!.onerror?.();
    await expect(p).rejects.toMatchObject({ code: 'script' });
    expect(els[0]!.removed).toBe(true);
    const p2 = loadGis(doc, 1000);
    expect(p2).not.toBe(p);
    freshGis();
    els[1]!.onload?.();
    await expect(p2).resolves.toBeTruthy();
    resetGisLoaderForTest();
  });

  it('fails when the script loads but defines nothing, and when it never loads', async () => {
    delete (window as { google?: unknown }).google;
    resetGisLoaderForTest();
    const a = stubDoc();
    const p = loadGis(a.doc, 1000);
    a.els[0]!.onload?.();
    await expect(p).rejects.toMatchObject({ code: 'script' });
    await expect(loadGis(stubDoc().doc, 15)).rejects.toMatchObject({ code: 'script' });
    resetGisLoaderForTest();
  });

  it('resolves at once when GIS is already present', async () => {
    resetGisLoaderForTest();
    const { api } = freshGis();
    await expect(loadGis(stubDoc().doc, 1000)).resolves.toBe(api);
    resetGisLoaderForTest();
  });
});
