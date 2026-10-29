/* eslint-disable @typescript-eslint/require-await -- async stubs and fake method tables */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processReturn, type ReturnEnv } from '../../../src/oauth/return';
import { OAUTH_KEY, TOKEN_KEY, HINT_KEY } from '../../../src/app/services/sync/redirect';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const NOW = 1_000_000_000;
const ORIGIN = 'https://h.test';

function env(
  over: Partial<ReturnEnv> = {},
  rec: object | null = {
    state: 'S',
    returnTo: 'https://h.test/spinner/#/settings?account=1',
    at: NOW - 1000,
  },
) {
  localStorage.clear();
  if (rec) localStorage.setItem(OAUTH_KEY, JSON.stringify(rec));
  const calls = { scrub: 0, broadcast: 0, fetched: [] as string[] };
  const e: ReturnEnv = {
    hash: `#access_token=tok&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(SCOPE)}&state=S`,
    storage: localStorage,
    now: NOW,
    origin: ORIGIN,
    fetchImpl: (async (u: string, i?: RequestInit) => {
      calls.fetched.push(`${u} ${(i?.headers as Record<string, string>).Authorization}`);
      return new Response(JSON.stringify({ user: { emailAddress: 'owner@example.com' } }));
    }) as typeof fetch,
    broadcast: () => void calls.broadcast++,
    scrub: () => void calls.scrub++,
    ...over,
  };
  return { e, calls };
}

beforeEach(() => localStorage.clear());

describe('oauth-return entry', () => {
  it('stores the token like the popup flow, broadcasts, scrubs and returns to the app', async () => {
    const { e, calls } = env();
    const r = await processReturn(e);
    expect(r).toEqual({
      ok: true,
      goTo: 'https://h.test/spinner/#/settings?account=1',
      email: 'owner@example.com',
    });
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY)!)).toEqual({
      token: 'tok',
      expiresAt: NOW + 3599_000,
      email: 'owner@example.com',
    });
    expect(JSON.parse(localStorage.getItem(HINT_KEY)!)).toEqual({ email: 'owner@example.com' });
    expect(localStorage.getItem(OAUTH_KEY)).toBeNull(); // single use
    expect(calls).toMatchObject({ scrub: 1, broadcast: 1 });
    expect(calls.fetched[0]).toContain('https://www.googleapis.com/drive/v3/about');
    expect(calls.fetched[0]).toContain('Bearer tok');
  });

  it('rejects a state mismatch: no token, record deleted, fragment scrubbed', async () => {
    const { e, calls } = env({
      hash: '#access_token=tok&expires_in=3599&scope=' + SCOPE + '&state=OTHER',
    });
    const r = await processReturn(e);
    expect(r.ok).toBe(false);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(OAUTH_KEY)).toBeNull();
    expect(calls.scrub).toBe(1);
    expect(calls.fetched).toEqual([]); // the token is never used
    expect(calls.broadcast).toBe(0);
  });

  it('rejects a return with no stored record, an empty state, or junk storage', async () => {
    expect((await processReturn(env({}, null).e)).ok).toBe(false);
    const empty = env(
      { hash: '#access_token=tok&scope=' + SCOPE },
      { state: '', returnTo: '', at: NOW },
    );
    expect((await processReturn(empty.e)).ok).toBe(false);
    const junk = env();
    localStorage.setItem(OAUTH_KEY, '{nope');
    expect((await processReturn(junk.e)).ok).toBe(false);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('rejects after the 10 minute TTL, accepts just inside it', async () => {
    const late = env({}, { state: 'S', returnTo: '', at: NOW - 10 * 60_000 - 1 });
    const r = await processReturn(late.e);
    expect(r).toMatchObject({ ok: false });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    const ok = env({}, { state: 'S', returnTo: '', at: NOW - 10 * 60_000 });
    expect((await processReturn(ok.e)).ok).toBe(true);
  });

  it('shows Google errors without storing anything', async () => {
    const denied = env({ hash: '#error=access_denied&state=S' });
    const r = await processReturn(denied.e);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.message).toMatch(/did not give spinner access/);
    const other = await processReturn(env({ hash: '#error=server_error&state=S' }).e);
    expect(other.ok === false && other.message).toContain('server_error');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('rejects a grant without drive.appdata, or without a token', async () => {
    const e1 = env({ hash: '#access_token=tok&expires_in=3599&scope=email&state=S' });
    expect((await processReturn(e1.e)).ok).toBe(false);
    expect(e1.calls.fetched).toEqual([]);
    expect((await processReturn(env({ hash: '#state=S&scope=' + SCOPE }).e)).ok).toBe(false);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('does not store a token it could not attach an account to', async () => {
    const off = env({
      fetchImpl: () => Promise.reject(new TypeError('offline')),
    });
    expect((await processReturn(off.e)).ok).toBe(false);
    const bad = env({
      fetchImpl: async () => new Response('{}', { status: 401 }),
    });
    expect((await processReturn(bad.e)).ok).toBe(false);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('only returns to the same origin; otherwise the settings fallback', async () => {
    const evil = env({}, { state: 'S', returnTo: 'https://evil.test/x', at: NOW });
    expect(await processReturn(evil.e)).toMatchObject({ ok: true, goTo: './#/settings?account=1' });
    const none = env({}, { state: 'S', returnTo: 5, at: NOW });
    expect(await processReturn(none.e)).toMatchObject({ ok: true, goTo: './#/settings?account=1' });
  });

  it('tolerates blocked storage', async () => {
    const { e } = env();
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect((await processReturn({ ...e, storage: blocked })).ok).toBe(false);
  });
});

describe('oauth-return page boot', () => {
  it('does nothing on import unless the page marks itself', async () => {
    const spy = vi.spyOn(history, 'replaceState');
    await import('../../../src/oauth/return');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
