// The D23 sign-in gate (sync.md §1 D23, §11.4): sign in, call `about`, list the app folder. The
// Account card's "Test Google sign-in" row (WP-S4) calls `testSignIn()`; its "Expire token now"
// button calls `expireTokenForTest()`.
//
// The session is deliberately left in place (not revoked) so the next tap, after "Expire token
// now", exercises the real Reconnect path: a silent re-acquire with the stored email hint. Sign out
// (WP-S5a's `signOut`, or `endTestSignIn()` here) revokes the grant.
import { createDriveStore } from './drive';
import { GOOGLE_CLIENT_ID } from './config';
import { getAuth } from './flow';
import { loadGis } from './gis';

/** Set while a redirect round trip for the gate is under way (survives the page leaving). */
const GATE_KEY = 'spinner:sync:gate';

const flag = {
  get(): boolean {
    try {
      return localStorage.getItem(GATE_KEY) === '1';
    } catch {
      return false;
    }
  },
  set(on: boolean): void {
    try {
      if (on) localStorage.setItem(GATE_KEY, '1');
      else localStorage.removeItem(GATE_KEY);
    } catch {
      // storage blocked
    }
  },
};

export interface TestSignInResult {
  email: string;
  files: number;
}

async function check(): Promise<TestSignInResult> {
  const { source } = getAuth();
  const drive = createDriveStore({ token: () => source.current() });
  const about = await drive.about();
  const files = await drive.list();
  return { email: about.email, files: files.length };
}

/**
 * Sign in with Google (the flow `auto` picks), then read the account and list the appDataFolder.
 * With a still-valid token it just checks; with an expired one it reconnects silently (one tap, no
 * questions). In a redirect flow the page leaves and this promise never settles: call
 * `resumeTestSignIn()` when the Account card mounts to finish after the return.
 */
export async function testSignIn(): Promise<TestSignInResult> {
  const auth = getAuth();
  if (!auth.source.current()) {
    const silent = auth.source.state.state === 'expired';
    flag.set(true);
    try {
      await auth.acquire(silent); // never settles when it navigates away
    } finally {
      flag.set(false);
    }
  }
  flag.set(false);
  return check();
}

/**
 * After a redirect round trip started by `testSignIn()`: the token is in localStorage and the
 * flag is set. Returns the result once, or null when no gate redirect was in flight.
 */
export async function resumeTestSignIn(): Promise<TestSignInResult | null> {
  if (!flag.get() || !getAuth().source.current()) return null;
  flag.set(false);
  return check();
}

/**
 * Loads the GIS script ahead of the tap, so the popup opens inside the click's user activation.
 * Failures are ignored here (the tap reports them). Without `eager` it loads only when sign-in is
 * already in play (a token, an email hint or a gate redirect in flight), so opening Settings
 * doesn't contact Google for people who never use sync; the card calls it with `eager` when the
 * pointer or focus reaches the test block. Never while offline.
 */
export function preloadSignIn(opts: { eager?: boolean } = {}): void {
  if (!GOOGLE_CLIENT_ID) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const s = getAuth().source.state.state;
  if (!opts.eager && !flag.get() && s !== 'signed-in' && s !== 'expired') return;
  loadGis().catch(() => undefined);
}

/** Revokes the grant at Google and forgets the session (the gate's clean-up). */
export async function endTestSignIn(): Promise<void> {
  flag.set(false);
  await getAuth().source.revoke();
}

/** Test hook (D23): make the stored token look expired, so the next sign-in is a Reconnect. */
export function expireTokenForTest(): void {
  getAuth().source.expireNow();
}
