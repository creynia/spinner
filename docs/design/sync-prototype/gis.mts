/**
 * PROTOTYPE of `src/app/services/sync/gis.ts` (sync.md §5.1): a `TokenSource` over Google Identity
 * Services' token model. The script is loaded lazily, only when the user signs in or reconnects,
 * so an offline start never waits on accounts.google.com. The token and its expiry live in memory
 * and localStorage (review should-fix 2: an app restart within the hour stays silent; the CSP is
 * the defence), together with the email hint.
 */
import type { AuthState, TokenSource } from './contracts-sync.mts';

/** The slice of the GIS API we use (https://developers.google.com/identity/oauth2/web/reference/js-reference). */
export interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}
export interface GisTokenClient {
  requestAccessToken(o?: { prompt?: '' | 'none' | 'consent' | 'select_account'; login_hint?: string }): void;
}
export interface GisOauth2 {
  initTokenClient(c: {
    client_id: string;
    scope: string;
    callback: (r: GisTokenResponse) => void;
    error_callback?: (e: { type: 'popup_failed_to_open' | 'popup_closed' | 'unknown'; message?: string }) => void;
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

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'spinner:sync:token'; // localStorage { token, expiresAt, email }
const HINT_KEY = 'spinner:sync:hint'; // localStorage: { email } only, not a secret
/** Treat a token as expired a little early so a request never starts with seconds left. */
const SKEW_MS = 120_000;

export class AuthError extends Error {
  constructor(
    readonly code: 'popup-blocked' | 'popup-closed' | 'denied' | 'scope' | 'script' | 'unconfigured' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

let scriptPromise: Promise<GisOauth2> | null = null;
/** Injects the GIS script once. Tests replace the URL's response (Playwright `page.route`). */
export function loadGis(doc: Document = document, timeoutMs = 15_000): Promise<GisOauth2> {
  scriptPromise ??= new Promise<GisOauth2>((resolve, reject) => {
    const ready = window.google?.accounts?.oauth2;
    if (ready) return resolve(ready);
    const s = doc.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    const t = setTimeout(() => fail('timed out loading Google sign-in'), timeoutMs);
    const fail = (m: string): void => {
      clearTimeout(t);
      scriptPromise = null; // allow a retry
      s.remove();
      reject(new AuthError('script', m));
    };
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

interface Stored {
  token: string;
  expiresAt: number;
  email: string;
}
const read = <T,>(st: Storage | undefined, k: string): T | null => {
  try {
    const raw = st?.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const write = (st: Storage | undefined, k: string, v: unknown): void => {
  try {
    if (v === null) st?.removeItem(k);
    else st?.setItem(k, JSON.stringify(v));
  } catch {
    // storage blocked: memory only
  }
};

export function createGisTokenSource(cfg: {
  clientId: string;
  load?: () => Promise<GisOauth2>;
  now?: () => number;
  /** Fetches the account email after a grant (Drive `about`); the scope gives no id token. */
  whoAmI: (token: string) => Promise<string>;
  /** No answer from the popup within this long -> AuthError 'timeout' (the app then offers the redirect). */
  timeoutMs?: number;
}): TokenSource {
  const now = cfg.now ?? Date.now;
  const load = cfg.load ?? (() => loadGis());
  const local = typeof localStorage === 'undefined' ? undefined : localStorage;
  let mem: Stored | null = read<Stored>(local, TOKEN_KEY);
  const hint = (): string | undefined => mem?.email ?? read<{ email: string }>(local, HINT_KEY)?.email;
  const subs = new Set<(s: AuthState) => void>();

  function state(): AuthState {
    if (!cfg.clientId) return { state: 'unconfigured' };
    if (mem && mem.expiresAt - SKEW_MS > now()) return { state: 'signed-in', email: mem.email, expiresAt: mem.expiresAt };
    const h = hint();
    return h ? { state: 'expired', email: h } : { state: 'signed-out' };
  }
  const emit = (): void => {
    const s = state();
    for (const fn of subs) fn(s);
  };

  return {
    get state() {
      return state();
    },
    current() {
      const s = state();
      return s.state === 'signed-in' ? mem!.token : null;
    },
    async acquire({ silent }) {
      if (!cfg.clientId) throw new AuthError('unconfigured', 'Sync is not set up in this build.');
      const g = await load();
      // NOTE: `load()` resolves immediately once the script is in, so the popup still opens inside
      // the click's user activation. The first sign-in preloads the script on Account card render.
      const resp = await new Promise<GisTokenResponse>((resolve0, reject0) => {
        const timer = setTimeout(
          () => reject0(new AuthError('timeout', 'Google sign-in did not answer.')),
          cfg.timeoutMs ?? 120_000,
        );
        const resolve = (r: GisTokenResponse): void => (clearTimeout(timer), resolve0(r));
        const reject = (e: unknown): void => (clearTimeout(timer), reject0(e));
        const client = g.initTokenClient({
          client_id: cfg.clientId,
          scope: DRIVE_APPDATA_SCOPE,
          callback: resolve,
          error_callback: (e) =>
            reject(
              new AuthError(
                e.type === 'popup_failed_to_open' ? 'popup-blocked' : 'popup-closed',
                e.type === 'popup_failed_to_open' ? 'The sign-in window was blocked.' : 'Sign-in was cancelled.',
              ),
            ),
        });
        const h = hint();
        client.requestAccessToken({ prompt: silent ? '' : 'select_account', ...(h ? { login_hint: h } : {}) });
      });
      if (resp.error || !resp.access_token) throw new AuthError('denied', resp.error_description ?? resp.error ?? 'Access was not granted.');
      if (!g.hasGrantedAllScopes(resp, DRIVE_APPDATA_SCOPE))
        throw new AuthError('scope', 'spinner needs permission to keep its own data in your Drive.');
      const expiresAt = now() + Number(resp.expires_in ?? 3599) * 1000;
      const email = await cfg.whoAmI(resp.access_token);
      mem = { token: resp.access_token, expiresAt, email };
      write(local, TOKEN_KEY, mem);
      write(local, HINT_KEY, { email });
      emit();
      return resp.access_token;
    },
    async revoke() {
      const t = mem?.token;
      mem = null;
      write(local, TOKEN_KEY, null);
      write(local, HINT_KEY, null);
      if (t) {
        try {
          const g = await load();
          await new Promise<void>((r) => g.revoke(t, r));
        } catch {
          // offline: the token dies within the hour anyway; the grant stays listed at Google
        }
      }
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
