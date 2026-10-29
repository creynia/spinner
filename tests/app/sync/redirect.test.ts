/* eslint-disable @typescript-eslint/unbound-method -- async stubs and fake method tables */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_ENDPOINT,
  buildAuthUrl,
  chooseFlow,
  detectPlatform,
  DRIVE_APPDATA_SCOPE,
  HINT_KEY,
  OAUTH_KEY,
  CHANNEL,
  returnUri,
  STATE_TTL_MS,
  startRedirect,
  TOKEN_KEY,
  randomState,
} from '../../../src/app/services/sync/redirect';
import { RETURN_KEYS } from '../../../src/oauth/return';

beforeEach(() => localStorage.clear());

describe('flow choice (sync.md §5.1)', () => {
  it('auto: only installed Android gets the redirect', () => {
    expect(chooseFlow('auto', { standalone: true, android: true })).toBe('redirect');
    expect(chooseFlow('auto', { standalone: true, android: false })).toBe('popup');
    expect(chooseFlow('auto', { standalone: false, android: true })).toBe('popup');
    expect(chooseFlow('auto', { standalone: false, android: false })).toBe('popup');
  });
  it('explicit modes win', () => {
    expect(chooseFlow('redirect', { standalone: false, android: false })).toBe('redirect');
    expect(chooseFlow('popup', { standalone: true, android: true })).toBe('popup');
  });
  it('detects display-mode and the Android user agent', () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('standalone'),
    })) as typeof matchMedia;
    try {
      const ua = vi_ua('Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120');
      expect(detectPlatform()).toEqual({ standalone: true, android: true });
      ua();
      const ua2 = vi_ua('Mozilla/5.0 (X11; Linux x86_64) Chrome/120');
      expect(detectPlatform()).toEqual({ standalone: true, android: false });
      ua2();
    } finally {
      window.matchMedia = mm;
    }
  });
});

function vi_ua(ua: string): () => void {
  const orig = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  return () => {
    delete (navigator as { userAgent?: string }).userAgent;
    if (orig) Object.defineProperty(Navigator.prototype, 'userAgent', orig);
  };
}

describe('redirect start', () => {
  it('builds the authorization URL from the spec', () => {
    const u = new URL(
      buildAuthUrl({
        clientId: 'cid',
        redirectUri: 'https://creynia.github.io/spinner/oauth-return.html',
        state: 'abc',
        loginHint: 'o@x.com',
        silent: false,
      }),
    );
    expect(u.origin + u.pathname).toBe(AUTH_ENDPOINT);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'cid',
      redirect_uri: 'https://creynia.github.io/spinner/oauth-return.html',
      response_type: 'token',
      scope: DRIVE_APPDATA_SCOPE,
      include_granted_scopes: 'true',
      state: 'abc',
      login_hint: 'o@x.com',
      prompt: 'select_account',
    });
    const silent = new URL(
      buildAuthUrl({ clientId: 'c', redirectUri: 'r', state: 's', silent: true }),
    );
    expect(silent.searchParams.get('prompt')).toBe('');
    expect(silent.searchParams.has('login_hint')).toBe(false);
  });

  it('resolves the return page next to the app, dropping hash and query', () => {
    expect(returnUri('https://creynia.github.io/spinner/#/settings?account=1')).toBe(
      'https://creynia.github.io/spinner/oauth-return.html',
    );
    expect(returnUri('http://localhost:4173/spinner/index.html?e2e')).toBe(
      'http://localhost:4173/spinner/oauth-return.html',
    );
  });

  it('stores state, return target and time in localStorage, then navigates', () => {
    let went = '';
    const url = startRedirect(
      { clientId: 'cid', silent: true, loginHint: 'o@x.com' },
      {
        now: () => 5000,
        state: () => 'fixed-state',
        href: 'https://h.test/spinner/#/settings?account=1',
        assign: (u) => (went = u),
      },
    );
    expect(went).toBe(url);
    expect(JSON.parse(localStorage.getItem(OAUTH_KEY)!)).toEqual({
      state: 'fixed-state',
      returnTo: 'https://h.test/spinner/#/settings?account=1',
      at: 5000,
      silent: true,
    });
    expect(new URL(url).searchParams.get('state')).toBe('fixed-state');
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(
      'https://h.test/spinner/oauth-return.html',
    );
  });

  it('state has 128 random bits and differs each time', () => {
    const a = randomState();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomState()).not.toBe(a);
  });

  it('shares its storage constants with the return page (two copies pinned together)', () => {
    expect(RETURN_KEYS).toEqual({
      token: TOKEN_KEY,
      hint: HINT_KEY,
      oauth: OAUTH_KEY,
      channel: CHANNEL,
      scope: DRIVE_APPDATA_SCOPE,
      ttlMs: STATE_TTL_MS,
    });
  });
});
