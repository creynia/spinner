// Entry of `oauth-return.html` (sync.md §5.4): the redirect sign-in lands here with the token in
// the URL fragment. It runs before and apart from the app, so it imports nothing from src/app
// (the layering rule allows only core contracts, src/pwa and itself). The storage keys and formats
// repeat services/sync/redirect.ts; tests/app/sync/return.test.ts pins them together.

const TOKEN_KEY = 'spinner:sync:token';
const HINT_KEY = 'spinner:sync:hint';
const OAUTH_KEY = 'spinner:sync:oauth';
const CHANNEL = 'spinner-sync';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const STATE_TTL_MS = 10 * 60_000;
const ABOUT = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)';
/** Pinned against services/sync/redirect.ts by tests/app/sync/return.test.ts. */
export const RETURN_KEYS = {
  token: TOKEN_KEY,
  hint: HINT_KEY,
  oauth: OAUTH_KEY,
  channel: CHANNEL,
  scope: SCOPE,
  ttlMs: STATE_TTL_MS,
} as const;
const FALLBACK_RETURN = './#/settings?account=1';

/** Same rule as gis.ts `ttlSeconds` (this entry cannot import src/app): finite and positive, else 3599. */
function ttlSeconds(v: string | null): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 3599;
}

export type ReturnOutcome =
  { ok: true; goTo: string; email: string } | { ok: false; message: string };

export interface ReturnEnv {
  /** `location.hash`, with or without the leading `#`. */
  hash: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now: number;
  origin: string;
  fetchImpl: typeof fetch;
  /** Posts `{ type: 'token' }` to the other windows; failures are ignored. */
  broadcast: () => void;
  /** Called before the redirect, so the token is out of the address bar and history. */
  scrub: () => void;
}

const fail = (message: string): ReturnOutcome => ({ ok: false, message });

/** Only a same-origin target is followed (the record lives in localStorage, but be strict). */
function safeReturn(returnTo: unknown, origin: string): string {
  if (typeof returnTo !== 'string' || returnTo === '') return FALLBACK_RETURN;
  try {
    return new URL(returnTo, origin).origin === origin ? returnTo : FALLBACK_RETURN;
  } catch {
    return FALLBACK_RETURN;
  }
}

type Rec = { state?: unknown; returnTo?: unknown; at?: unknown };
function readRecord(storage: ReturnEnv['storage']): Rec | null {
  try {
    const raw = storage.getItem(OAUTH_KEY);
    return raw ? (JSON.parse(raw) as Rec) : null;
  } catch {
    return null;
  }
}

export async function processReturn(env: ReturnEnv): Promise<ReturnOutcome> {
  const params = new URLSearchParams(env.hash.replace(/^#/, ''));
  // The state record is single-use: removed whatever happens next.
  const rec = readRecord(env.storage);
  try {
    env.storage.removeItem(OAUTH_KEY);
  } catch {
    // storage blocked
  }
  env.scrub();

  const state = params.get('state');
  if (!rec || typeof rec.state !== 'string' || rec.state === '' || state !== rec.state)
    return fail('This sign-in did not start in spinner, or it was started in another browser.');
  if (typeof rec.at !== 'number' || env.now - rec.at > STATE_TTL_MS || env.now < rec.at - 60_000)
    return fail('This sign-in took too long. Try again.');
  const err = params.get('error');
  if (err)
    return fail(
      err === 'access_denied'
        ? 'Google did not give spinner access. Nothing was changed.'
        : `Google reported an error (${err}).`,
    );
  const token = params.get('access_token');
  if (!token) return fail('Google did not return an access token.');
  // "Includes", not "equals": include_granted_scopes makes Google list every scope granted so far.
  if (!(params.get('scope') ?? '').split(/[ ,]+/).includes(SCOPE))
    return fail('spinner needs permission to keep its own data in your Drive.');

  const expiresAt = env.now + ttlSeconds(params.get('expires_in')) * 1000;
  let email = '';
  try {
    const res = await env.fetchImpl(ABOUT, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok)
      email = ((await res.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? '';
  } catch {
    // offline or blocked: handled below
  }
  if (!email) return fail('Signed in, but spinner could not read your Google account. Try again.');
  try {
    env.storage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt, email }));
    env.storage.setItem(HINT_KEY, JSON.stringify({ email }));
  } catch {
    return fail('This browser blocked storage, so spinner could not keep the sign-in.');
  }
  env.broadcast();
  return { ok: true, goTo: safeReturn(rec.returnTo, env.origin), email };
}

function boot(): void {
  const msg = document.getElementById('msg');
  const back = document.getElementById('back');
  void processReturn({
    hash: location.hash,
    storage: localStorage,
    now: Date.now(),
    origin: location.origin,
    fetchImpl: fetch.bind(globalThis),
    broadcast: () => {
      try {
        const ch = new BroadcastChannel(CHANNEL);
        ch.postMessage({ type: 'token' });
        ch.close();
      } catch {
        // no BroadcastChannel
      }
    },
    scrub: () => history.replaceState(null, '', location.pathname + location.search),
  }).then(
    (r) => {
      if (r.ok) {
        if (msg) msg.textContent = 'Signed in. Going back to spinner.';
        location.replace(r.goTo);
      } else {
        const h = document.querySelector('h1');
        if (h) h.textContent = 'Sign-in did not finish';
        if (msg) msg.textContent = r.message;
        back?.removeAttribute('hidden');
      }
    },
    () => {
      if (msg) msg.textContent = 'Something went wrong. Try again from spinner.';
      back?.removeAttribute('hidden');
    },
  );
}

if (typeof document !== 'undefined' && document.body?.hasAttribute('data-oauth-return')) boot();
