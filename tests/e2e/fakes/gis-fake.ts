/**
 * A fake `google.accounts.oauth2` (sync.md §11.3). `installGisFake` is self-contained, so the same
 * code runs in a unit test (`installGisFake()` on the happy-dom window) and in the browser
 * (`gisFakeScript()` is served for `https://accounts.google.com/gsi/client`). Behaviour is steered
 * through `window.__gisFake`.
 */
import type { BrowserContext, Page } from '@playwright/test';

export type GisFakeMode =
  | 'grant' // callback with a token
  | 'blocked' // error_callback popup_failed_to_open
  | 'closed' // error_callback popup_closed
  | 'hang' // never answers
  | 'denied' // callback with error: access_denied
  | 'noscope'; // token without drive.appdata

export interface GisFakeControls {
  mode: GisFakeMode;
  /** Every `requestAccessToken` call's options, in order. */
  calls: { prompt?: string; login_hint?: string }[];
  /** Every token revoked. */
  revoked: string[];
  /** Tokens handed out so far (`fake-token-1`, ...). */
  issued: string[];
  /** `expires_in` of the next grants. */
  expiresIn: number;
}

declare global {
  interface Window {
    __gisFake?: GisFakeControls;
  }
}

export function installGisFake(): GisFakeControls {
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const w = window as unknown as {
    __gisFake?: GisFakeControls;
    google?: unknown;
  };
  const ctl: GisFakeControls = {
    mode: 'grant',
    calls: [],
    revoked: [],
    issued: [],
    expiresIn: 3599,
  };
  w.__gisFake = ctl;
  type Resp = Record<string, unknown>;
  w.google = {
    accounts: {
      oauth2: {
        initTokenClient: (c: {
          callback: (r: Resp) => void;
          error_callback?: (e: { type: string }) => void;
        }) => ({
          requestAccessToken: (o?: { prompt?: string; login_hint?: string }) => {
            ctl.calls.push(o ?? {});
            queueMicrotask(() => {
              switch (ctl.mode) {
                case 'blocked':
                  return c.error_callback?.({ type: 'popup_failed_to_open' });
                case 'closed':
                  return c.error_callback?.({ type: 'popup_closed' });
                case 'hang':
                  return;
                case 'denied':
                  return c.callback({ error: 'access_denied' });
                default: {
                  const t = `fake-token-${ctl.issued.length + 1}`;
                  ctl.issued.push(t);
                  return c.callback({
                    access_token: t,
                    expires_in: ctl.expiresIn,
                    scope: ctl.mode === 'noscope' ? 'email' : SCOPE,
                  });
                }
              }
            });
          },
        }),
        hasGrantedAllScopes: (r: Resp, ...s: string[]) =>
          s.every((x) => (typeof r.scope === 'string' ? r.scope : '').split(' ').includes(x)),
        revoke: (t: string, done?: () => void) => {
          ctl.revoked.push(t);
          done?.();
        },
      },
    },
  };
  return ctl;
}

/** The script text served as the GIS client: installs the fake, then fires `load`. */
export function gisFakeScript(): string {
  return `(${installGisFake.toString()})();`;
}

/** Serves the fake for `https://accounts.google.com/gsi/client` on a page or a whole context. */
export async function routeGis(target: BrowserContext | Page): Promise<void> {
  await target.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: gisFakeScript(),
    }),
  );
}

/** Tokens the fake GIS or the fake consent page hand out. */
export const isFakeToken = (t: string): boolean => /^fake-token-\d+$/.test(t);
