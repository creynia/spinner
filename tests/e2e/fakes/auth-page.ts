/**
 * The fake consent page for the redirect flow (sync.md §11.3): `https://accounts.google.com/o/oauth2/v2/auth`
 * answers with a 302 back to the `redirect_uri` with the token in the fragment, as Google's
 * implicit grant does. No UI: the real page is Google's.
 */
import type { BrowserContext, Page } from '@playwright/test';

export interface AuthPageOptions {
  /** `grant` (default), or an `error` fragment such as access_denied, or a wrong-scope grant. */
  outcome?: 'grant' | 'error' | 'noscope' | 'badstate';
  error?: string;
  /** Tokens are `<prefix><1000 + n>`, so they never collide with the GIS fake's. */
  tokenPrefix?: string;
}

export interface AuthPageLog {
  /** The query params of every authorization request, in order. */
  requests: Record<string, string>[];
}

/** Pure: the `Location` the fake consent page answers with. */
export function consentRedirect(url: URL, n: number, o: AuthPageOptions = {}): string {
  const redirect = url.searchParams.get('redirect_uri') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const frag = new URLSearchParams();
  if (o.outcome === 'error') {
    frag.set('error', o.error ?? 'access_denied');
    frag.set('state', state);
  } else {
    // 1000+ keeps these apart from the GIS fake's fake-token-1, -2, ...
    frag.set('access_token', `${o.tokenPrefix ?? 'fake-token-'}${1000 + n}`);
    frag.set('token_type', 'Bearer');
    frag.set('expires_in', '3599');
    frag.set(
      'scope',
      o.outcome === 'noscope' ? 'email' : 'https://www.googleapis.com/auth/drive.appdata',
    );
    frag.set('state', o.outcome === 'badstate' ? `${state}x` : state);
  }
  return `${redirect}#${frag}`;
}

export async function routeAuthPage(
  target: BrowserContext | Page,
  o: AuthPageOptions = {},
): Promise<AuthPageLog> {
  const log: AuthPageLog = { requests: [] };
  await target.route('https://accounts.google.com/o/oauth2/v2/auth**', (route) => {
    const url = new URL(route.request().url());
    log.requests.push(Object.fromEntries(url.searchParams.entries()));
    return route.fulfill({
      status: 302,
      headers: { Location: consentRedirect(url, log.requests.length, o) },
    });
  });
  return log;
}
