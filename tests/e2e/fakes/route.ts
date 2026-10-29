/**
 * The three Google endpoints of sync.md §11.3, routed to fakes for a whole browser context:
 *  - `https://accounts.google.com/gsi/client` -> the fake GIS script (`window.__gisFake`);
 *  - `https://accounts.google.com/o/oauth2/v2/auth` -> the fake consent page (redirect flow);
 *  - `https://www.googleapis.com/**` -> ONE shared fake Drive in the test process.
 * Two `secondDevice` contexts that get the same `FakeDrive` act as two devices on one account.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, type Guard } from '../helpers';
import { routeAuthPage, type AuthPageLog, type AuthPageOptions } from './auth-page';
import { routeDrive, type FakeDrive } from './drive-server';
import { routeGis } from './gis-fake';

export interface RouteOptions {
  /** Also serve the fake consent page, and return its request log. Default false. */
  consent?: boolean | AuthPageOptions;
}

export async function routeGoogle(
  ctx: BrowserContext,
  drive: FakeDrive,
  o: RouteOptions = {},
): Promise<{ consent?: AuthPageLog }> {
  await routeDrive(ctx, drive);
  await routeGis(ctx);
  if (!o.consent) return {};
  return { consent: await routeAuthPage(ctx, o.consent === true ? {} : o.consent) };
}

export interface SecondDevice {
  page: Page;
  ctx: BrowserContext;
  guard: Guard;
}

export interface DeviceOptions extends RouteOptions {
  /** Behave like a phone: runs download when opened, not all at once (sync.md §7.12). */
  phone?: boolean;
}

/** A second browser profile: its own IndexedDB and localStorage, the same fake Drive. */
export async function secondDevice(
  browser: Browser,
  use: Record<string, unknown>,
  baseURL: string,
  drive: FakeDrive,
  o: DeviceOptions = {},
): Promise<SecondDevice> {
  const ctx = await browser.newContext({
    baseURL,
    ...(use.viewport ? { viewport: use.viewport as { width: number; height: number } } : {}),
    ...(use.userAgent ? { userAgent: use.userAgent as string } : {}),
    ...(use.isMobile !== undefined ? { isMobile: use.isMobile as boolean } : {}),
    ...(use.hasTouch !== undefined ? { hasTouch: use.hasTouch as boolean } : {}),
  });
  await routeGoogle(ctx, drive, o);
  const page = await ctx.newPage();
  const errors: string[] = [];
  await page.addInitScript((phone) => {
    if (phone) {
      Object.defineProperty(navigator, 'userAgentData', {
        value: { mobile: true, platform: 'Android' },
        configurable: true,
      });
    }
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  }, o.phone === true);
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const guard: Guard = {
    async check(state) {
      const [scroll, client] = await page.evaluate<[number, number]>(
        '[document.documentElement.scrollWidth, document.documentElement.clientWidth]',
      );
      expect(scroll, `device B ${state}: horizontal overflow`).toBeLessThanOrEqual(client);
      expect(errors, `device B ${state}: console errors`).toEqual([]);
    },
  };
  return { page, ctx, guard };
}
