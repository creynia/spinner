// Anonymous, cookieless usage counts via GoatCounter (docs/analytics.md). One request per page
// view or event to creynia.goatcounter.com, as an image beacon (CSP img-src only): no script is
// loaded, nothing is stored on the device, and no identifier is sent. Off unless the page is
// served over https from creynia.com, so dev, preview, tests and forks never count. Also off for
// automated browsers and when the browser sends Do Not Track or Global Privacy Control.

export const COUNT_URL = 'https://creynia.goatcounter.com/count';
const HOSTS = ['creynia.com', 'www.creynia.com'];

export interface Hit {
  /** Page path ('/spinner/#/run/:runId') or event name ('spinner:run-start'). */
  path: string;
  title?: string;
  referrer?: string;
  event?: boolean;
}

interface EnvLike {
  location: { hostname: string; protocol: string };
  navigator: { webdriver?: boolean; doNotTrack?: string | null; globalPrivacyControl?: boolean };
}

export function analyticsEnabled(env: EnvLike = globalThis): boolean {
  try {
    if (!env?.location || !env.navigator) return false;
    const { location: l, navigator: n } = env;
    if (l.protocol !== 'https:' || !HOSTS.includes(l.hostname)) return false;
    return !n.webdriver && n.doNotTrack !== '1' && n.globalPrivacyControl !== true;
  } catch {
    return false;
  }
}

/** The beacon URL for one hit (GoatCounter's /count API). */
export function countUrl(hit: Hit, screenWidth?: number): string {
  const q = new URLSearchParams({ p: hit.path });
  if (hit.title) q.set('t', hit.title);
  if (hit.referrer) q.set('r', hit.referrer);
  if (hit.event) q.set('e', 'true');
  if (screenWidth) q.set('s', String(Math.round(screenWidth)));
  q.set('rnd', Math.random().toString(36).slice(2, 8));
  return `${COUNT_URL}?${q.toString()}`;
}

function send(hit: Hit): void {
  if (!analyticsEnabled()) return;
  try {
    new Image().src = countUrl(hit, window.screen?.width);
  } catch {
    /* never let analytics break the app */
  }
}

/** The referrer, only when it is another site (internal navigation is not a source). */
function externalReferrer(): string | undefined {
  try {
    const r = document.referrer;
    return r && new URL(r).origin !== location.origin ? r : undefined;
  } catch {
    return undefined;
  }
}

let lastPath = '';
let firstHit = true;

/**
 * Count a view of `path` once (repeats of the same path in a row are ignored). The page title is
 * not sent: the path pattern is all that is counted.
 */
export function trackPage(path: string): void {
  if (path === lastPath) return;
  lastPath = path;
  send({ path, referrer: firstHit ? externalReferrer() : undefined });
  firstHit = false;
}

/** Count a named event, e.g. trackEvent('run-start'). Prefixed with the app name. */
export function trackEvent(name: string): void {
  send({ path: `spinner:${name}`, title: name, event: true });
}

/**
 * The page path for a route pattern: '/spinner/' or '/spinner/#/run/:runId'. Pass the matched
 * route *pattern* (never the live hash), so run, definition and group ids and query strings are
 * never sent; an unknown route counts as '/404'.
 */
export function pagePath(pathname: string, pattern: string | null): string {
  const base = pathname.replace(/index\.html$/, '');
  if (pattern === null) return `${base}#/404`;
  return pattern === '/' ? base : `${base}#${pattern}`;
}
