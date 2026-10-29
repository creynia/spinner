/**
 * `TokenSource` over Google Identity Services' token model (sync.md §5.1, §5.2) with the redirect
 * fallback (§5.4). The GIS script loads lazily (an offline start never waits on
 * accounts.google.com). The token and its expiry live in memory and in localStorage, so an app
 * restart within the hour stays silent; the CSP is the defence. There is no refresh token.
 */
import type { AuthState, TokenSource } from '@core';
import {
  CHANNEL,
  chooseFlow,
  DRIVE_APPDATA_SCOPE,
  HINT_KEY,
  OAUTH_KEY,
  startRedirect,
  TOKEN_KEY,
  type Platform,
} from './redirect';

export { DRIVE_APPDATA_SCOPE };

/** The slice of the GIS API we use (developers.google.com/identity/oauth2/web/reference/js-reference). */
export interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}
export interface GisTokenClient {
  requestAccessToken(o?: {
    prompt?: '' | 'none' | 'consent' | 'select_account';
    login_hint?: string;
  }): void;
}
export interface GisOauth2 {
  initTokenClient(c: {
    client_id: string;
    scope: string;
    callback: (r: GisTokenResponse) => void;
    error_callback?: (e: {
      type: 'popup_failed_to_open' | 'popup_closed' | 'unknown';
      message?: string;
    }) => void;
    prompt?: string;
    login_hint?: string;
  }): GisTokenClient;
  hasGrantedAllScopes(r: GisTokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } };
  }
}

export const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Treat a token as expired a little early so a request never starts with seconds left. */
export const SKEW_MS = 120_000;
/** No answer from the popup within this long: the app offers the redirect (sync.md §5.1). */
export const ACQUIRE_TIMEOUT_MS = 120_000;
/** Revoking at Google may not hang the sign-out button. */
export const REVOKE_TIMEOUT_MS = 5_000;

export type AuthErrorCode =
  | 'popup-blocked'
  | 'popup-closed'
  | 'denied'
  | 'scope'
  | 'script'
  | 'unconfigured'
  | 'timeout'
  | 'run-active';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

let scriptPromise: Promise<GisOauth2> | null = null;
/** Injects the GIS script once. Tests answer the URL with a fake (Playwright `page.route`). */
export function loadGis(doc: Document = document, timeoutMs = 15_000): Promise<GisOauth2> {
  scriptPromise ??= new Promise<GisOauth2>((resolve, reject) => {
    const ready = window.google?.accounts?.oauth2;
    if (ready) return resolve(ready);
    const s = doc.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    const fail = (m: string): void => {
      clearTimeout(t);
      scriptPromise = null; // allow a retry
      s.remove();
      reject(new AuthError('script', m));
    };
    const t = setTimeout(() => fail('timed out loading Google sign-in'), timeoutMs);
    s.onload = () => {
      clearTimeout(t);
      const g = window.google?.accounts?.oauth2;
      if (g) resolve(g);
      else fail('Google sign-in did not load');
    };
    s.onerror = () => fail('could not reach accounts.google.com');
    doc.head.appendChild(s);
  });
  return scriptPromise;
}
/** Test hook: forget the cached script promise. */
export function resetGisLoaderForTest(): void {
  scriptPromise = null;
}

interface Stored {
  token: string;
  expiresAt: number;
  email: string;
}
const isStored = (v: unknown): v is Stored =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Stored).token === 'string' &&
  (v as Stored).token !== '' &&
  Number.isFinite((v as Stored).expiresAt) &&
  typeof (v as Stored).email === 'string';

function read(st: Storage | undefined, k: string): unknown {
  try {
    const raw = st?.getItem(k);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}
function write(st: Storage | undefined, k: string, v: unknown): void {
  try {
    if (v === null) st?.removeItem(k);
    else st?.setItem(k, JSON.stringify(v));
  } catch {
    // storage blocked: memory only
  }
}

/** Seconds of token life from a Google response: finite and positive, else the usual 3599. */
export function ttlSeconds(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 3599;
}

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

export interface GisTokenSource extends TokenSource {
  /** Test hook: make the stored token look expired (the Reconnect path). */
  expireNow(): void;
  /** Drops the cross-tab listeners. */
  dispose(): void;
}

export interface GisConfig {
  clientId: string;
  load?: () => Promise<GisOauth2>;
  now?: () => number;
  /** Fetches the account email after a grant (Drive `about`); the scope gives no id token. */
  whoAmI: (token: string) => Promise<string>;
  /** Popup silence limit; default `ACQUIRE_TIMEOUT_MS`. */
  timeoutMs?: number;
  storage?: Storage;
  platform?: () => Platform;
  /** The redirect is refused while a run is active: the navigation would pause it. */
  isRunActive?: () => boolean;
  /** Starts the redirect; default `startRedirect`. Tests capture the URL instead of navigating. */
  navigate?: (o: { clientId: string; silent: boolean; loginHint?: string }) => void;
}

export function createGisTokenSource(cfg: GisConfig): GisTokenSource {
  const now = cfg.now ?? Date.now;
  const load = cfg.load ?? (() => loadGis());
  let local: Storage | undefined;
  try {
    local = cfg.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  } catch {
    local = undefined; // storage access can throw (blocked site data)
  }
  const subs = new Set<(s: AuthState) => void>();
  let redirecting = false;

  const fromStorage = (): Stored | null => {
    const v = read(local, TOKEN_KEY);
    return isStored(v) ? v : null;
  };
  let mem: Stored | null = fromStorage();
  const hint = (): string | undefined => {
    if (mem?.email) return mem.email;
    const h = read(local, HINT_KEY) as { email?: unknown } | null;
    return typeof h?.email === 'string' && h.email ? h.email : undefined;
  };

  /** The token is kept until it expires; then only the email hint stays (here and in storage). */
  function dropExpired(): void {
    if (!mem || mem.expiresAt - SKEW_MS > now()) return;
    write(local, TOKEN_KEY, null);
    if (!read(local, HINT_KEY)) write(local, HINT_KEY, { email: mem.email });
    mem = null;
  }
  dropExpired();

  function state(): AuthState {
    dropExpired();
    if (!cfg.clientId) return { state: 'unconfigured' };
    if (redirecting) return { state: 'redirecting' };
    if (mem && mem.expiresAt - SKEW_MS > now())
      return { state: 'signed-in', email: mem.email, expiresAt: mem.expiresAt };
    const h = hint();
    return h ? { state: 'expired', email: h } : { state: 'signed-out' };
  }
  const emit = (): void => {
    const s = state();
    for (const fn of subs) fn(s);
  };
  const sameState = (a: AuthState, b: AuthState): boolean =>
    JSON.stringify(a) === JSON.stringify(b);

  /** Another tab, or the redirect return page, wrote the token: pick it up. */
  const reload = (): void => {
    const before = state();
    mem = fromStorage();
    redirecting = false;
    if (!sameState(before, state())) emit();
  };
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === TOKEN_KEY || e.key === HINT_KEY) reload();
  };
  let channel: BroadcastChannel | undefined;
  const onMessage = (e: MessageEvent): void => {
    if ((e.data as { type?: string } | null)?.type === 'token') reload();
  };
  const onPageShow = (e: PageTransitionEvent): void => {
    if (e.persisted && redirecting) reload(); // back from Google via bfcache
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onPageShow);
    try {
      channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL);
      channel?.addEventListener('message', onMessage);
    } catch {
      channel = undefined;
    }
  }

  async function popup(silent: boolean): Promise<string> {
    const g = await load();
    // `load()` resolves at once when the script is in, so the popup still opens inside the click's
    // user activation. The Account card preloads the script when it renders (sync.md §5.2).
    const resp = await new Promise<GisTokenResponse>((resolve0, reject0) => {
      const timer = setTimeout(
        () => reject0(new AuthError('timeout', 'Google sign-in did not answer.')),
        cfg.timeoutMs ?? ACQUIRE_TIMEOUT_MS,
      );
      const resolve = (r: GisTokenResponse): void => (clearTimeout(timer), resolve0(r));
      const reject = (e: unknown): void => (clearTimeout(timer), reject0(asError(e)));
      const client = g.initTokenClient({
        client_id: cfg.clientId,
        scope: DRIVE_APPDATA_SCOPE,
        callback: resolve,
        error_callback: (e) =>
          reject(
            e.type === 'popup_failed_to_open'
              ? new AuthError('popup-blocked', 'The sign-in window was blocked.')
              : new AuthError('popup-closed', 'Sign-in was cancelled.'),
          ),
      });
      const h = hint();
      client.requestAccessToken({
        prompt: silent ? '' : 'select_account',
        ...(h ? { login_hint: h } : {}),
      });
    });
    if (resp.error || !resp.access_token)
      throw new AuthError(
        'denied',
        resp.error_description ?? resp.error ?? 'Access was not granted.',
      );
    // "Includes", not "equals": with include_granted_scopes Google reports every scope this client
    // was ever granted, so an exact match would reject a valid grant.
    if (!g.hasGrantedAllScopes(resp, DRIVE_APPDATA_SCOPE))
      throw new AuthError('scope', 'spinner needs permission to keep its own data in your Drive.');
    const expiresAt = now() + ttlSeconds(resp.expires_in) * 1000;
    const email = await cfg.whoAmI(resp.access_token);
    mem = { token: resp.access_token, expiresAt, email };
    write(local, TOKEN_KEY, mem);
    write(local, HINT_KEY, { email });
    emit();
    return resp.access_token;
  }

  function redirect(silent: boolean): Promise<string> {
    if (cfg.isRunActive?.())
      return Promise.reject(new AuthError('run-active', 'Finish or pause the run first.'));
    redirecting = true;
    emit();
    const h = hint();
    const o = { clientId: cfg.clientId, silent, ...(h ? { loginHint: h } : {}) };
    try {
      (cfg.navigate ?? ((x) => void startRedirect(x, local ? { storage: local } : {})))(o);
    } catch (e) {
      redirecting = false;
      emit();
      return Promise.reject(asError(e));
    }
    // The page is leaving: the promise never settles. After the return the app reads the token
    // from localStorage at start-up.
    return new Promise<string>(() => undefined);
  }

  return {
    get state() {
      return state();
    },
    current() {
      return state().state === 'signed-in' ? mem!.token : null;
    },
    acquire({ silent, mode = 'auto' }) {
      if (!cfg.clientId)
        return Promise.reject(new AuthError('unconfigured', 'Sync is not set up in this build.'));
      const platform = cfg.platform?.();
      return chooseFlow(mode, platform) === 'redirect' ? redirect(silent) : popup(silent);
    },
    async revoke() {
      const t = mem?.token;
      // Local first (F4): the user is signed out at once, however slow or absent Google is.
      mem = null;
      write(local, TOKEN_KEY, null);
      write(local, HINT_KEY, null);
      write(local, OAUTH_KEY, null);
      emit();
      try {
        channel?.postMessage({ type: 'token' });
      } catch {
        // closed channel
      }
      if (!t) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          load().then((g) => new Promise<void>((r) => g.revoke(t, r))),
          new Promise<void>((r) => (timer = setTimeout(r, REVOKE_TIMEOUT_MS))),
        ]);
      } catch {
        // offline: the token dies within the hour anyway; the grant stays listed at Google
      } finally {
        clearTimeout(timer);
      }
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    expireNow() {
      if (!mem) return;
      mem = { ...mem, expiresAt: now() - 1 };
      write(local, TOKEN_KEY, mem);
      emit();
    },
    dispose() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener('pageshow', onPageShow);
      }
      channel?.removeEventListener('message', onMessage);
      channel?.close();
    },
  };
}
