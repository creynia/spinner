// The sign-in flow the UI drives (sync.md §5.1): one token source for the app, plus the "offer the
// redirect" state. Click handlers only: a popup needs a user gesture.
import { createStore, type Store } from '../../state/store';
import { GOOGLE_CLIENT_ID } from './config';
import { createDriveStore } from './drive';
import { AuthError, createGisTokenSource, type GisTokenSource } from './gis';

export interface AuthFlow {
  readonly source: GisTokenSource;
  /**
   * True once the popup failed in a way the redirect can fix: blocked, no answer in 120 s, or
   * closed twice. The Account card then shows "Sign in in this window".
   */
  readonly offerRedirect: Store<boolean>;
  /** `auto` flow: redirect on installed Android, popup elsewhere. Call inside a click. */
  acquire(silent: boolean): Promise<string>;
  /** "Sign in in this window" / "Try popup instead" (the gate's two buttons). */
  acquireVia(mode: 'popup' | 'redirect', silent: boolean): Promise<string>;
}

export function createAuthFlow(source: GisTokenSource): AuthFlow {
  const offerRedirect = createStore(false);
  let closes = 0;
  async function run(silent: boolean, mode: 'auto' | 'popup' | 'redirect'): Promise<string> {
    try {
      const token = await source.acquire({ silent, mode });
      closes = 0;
      offerRedirect.set(false);
      return token;
    } catch (e) {
      if (e instanceof AuthError) {
        if (e.code === 'popup-closed') closes += 1;
        if (e.code === 'popup-blocked' || e.code === 'timeout' || closes >= 2)
          offerRedirect.set(true);
      }
      throw e;
    }
  }
  return {
    source,
    offerRedirect,
    acquire: (silent) => run(silent, 'auto'),
    acquireVia: (mode, silent) => run(silent, mode),
  };
}

let shared: AuthFlow | null = null;
/** The app's one auth flow, created on first use from the build's client id. */
export function getAuth(): AuthFlow {
  shared ??= createAuthFlow(
    createGisTokenSource({
      clientId: GOOGLE_CLIENT_ID,
      whoAmI: async (token) => (await createDriveStore({ token: () => token }).about()).email,
    }),
  );
  return shared;
}
/** Test hook: replace (or reset with null) the shared flow. */
export function setAuthForTest(a: AuthFlow | null): void {
  shared?.source.dispose();
  shared = a;
}
