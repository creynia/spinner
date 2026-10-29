// The redirect sign-in flow, app side (sync.md §5.4), and the storage keys shared with the
// `oauth-return.html` entry. `src/oauth/return.ts` may not import from src/app, so it repeats these
// constants; tests/app/sync/redirect.test.ts pins both copies together.

export const TOKEN_KEY = 'spinner:sync:token'; // localStorage { token, expiresAt, email }
export const HINT_KEY = 'spinner:sync:hint'; // localStorage { email }: not a secret
export const OAUTH_KEY = 'spinner:sync:oauth'; // localStorage { state, returnTo, at, silent }
export const CHANNEL = 'spinner-sync'; // BroadcastChannel name
export const STATE_TTL_MS = 10 * 60_000;
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const RETURN_PAGE = 'oauth-return.html';

export interface RedirectRecord {
  state: string;
  returnTo: string;
  at: number;
  silent: boolean;
}

export interface Platform {
  standalone: boolean;
  android: boolean;
}

/** Reads the display mode and user agent (sync.md §5.1). */
export function detectPlatform(): Platform {
  let standalone = false;
  try {
    standalone =
      typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  } catch {
    // no matchMedia: treat as a browser tab
  }
  const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  return { standalone, android };
}

/** `auto` picks the redirect for an installed Android app, the popup everywhere else. */
export function chooseFlow(
  mode: 'auto' | 'popup' | 'redirect',
  p: Platform = detectPlatform(),
): 'popup' | 'redirect' {
  if (mode === 'redirect') return 'redirect';
  if (mode === 'auto' && p.standalone && p.android) return 'redirect';
  return 'popup';
}

/** `<origin><base>oauth-return.html`, resolved against the current document. */
export function returnUri(href: string = location.href): string {
  return new URL(RETURN_PAGE, href).href;
}

export function randomState(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function buildAuthUrl(o: {
  clientId: string;
  redirectUri: string;
  state: string;
  loginHint?: string | undefined;
  silent: boolean;
}): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'token',
    scope: DRIVE_APPDATA_SCOPE,
    include_granted_scopes: 'true',
    state: o.state,
    prompt: o.silent ? '' : 'select_account',
  });
  if (o.loginHint) q.set('login_hint', o.loginHint);
  return `${AUTH_ENDPOINT}?${q}`;
}

export interface RedirectDeps {
  storage?: Storage;
  now?: () => number;
  state?: () => string;
  href?: string;
  assign?: (url: string) => void;
}

/**
 * Stores the in-flight state in localStorage (it must survive a Custom Tab or new-window hop) and
 * navigates to Google. Returns the URL it navigated to.
 */
export function startRedirect(
  o: { clientId: string; silent: boolean; loginHint?: string | undefined },
  d: RedirectDeps = {},
): string {
  const storage = d.storage ?? localStorage;
  const href = d.href ?? location.href;
  const rec: RedirectRecord = {
    state: (d.state ?? randomState)(),
    returnTo: href,
    at: (d.now ?? Date.now)(),
    silent: o.silent,
  };
  storage.setItem(OAUTH_KEY, JSON.stringify(rec));
  const url = buildAuthUrl({
    clientId: o.clientId,
    redirectUri: returnUri(href),
    state: rec.state,
    loginHint: o.loginHint,
    silent: o.silent,
  });
  (d.assign ?? ((u: string) => location.assign(u)))(url);
  return url;
}
