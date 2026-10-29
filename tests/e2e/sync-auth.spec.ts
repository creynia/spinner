// The redirect sign-in round trip through the built `oauth-return.html` (sync.md §5.4, §11.3),
// against the fake consent page and the fake Drive. The CSP is enforced by the guard fixture: any
// securitypolicyviolation fails the test. (The Test sign-in row itself is WP-S4's; its UI e2e
// arrives with it.)
import { expect, expectAxeClean, test, type Page } from './helpers';
import { routeAuthPage } from './fakes/auth-page';
import { createFakeDrive, routeDrive } from './fakes/drive-server';
import { isFakeToken } from './fakes/gis-fake';

const OAUTH_KEY = 'spinner:sync:oauth';
const TOKEN_KEY = 'spinner:sync:token';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

/** What `startRedirect` does, from the test: a record in localStorage, then the authorize URL. */
async function startFakeRedirect(
  page: Page,
  baseURL: string,
  rec: { state: string; at?: number } = { state: 'state-1' },
): Promise<string> {
  await page.goto('./');
  const back = new URL('#/settings?account=1', baseURL).href;
  await page.evaluate(([key, r]) => localStorage.setItem(key, JSON.stringify(r)), [
    OAUTH_KEY,
    { state: rec.state, returnTo: back, at: rec.at ?? Date.now(), silent: false },
  ] as const);
  const q = new URLSearchParams({
    client_id: 'cid',
    redirect_uri: new URL('oauth-return.html', baseURL).href,
    response_type: 'token',
    scope: SCOPE,
    state: rec.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

test.describe('redirect sign-in round trip', () => {
  test('stores the token, scrubs the fragment and lands in Settings', async ({
    page,
    context,
    baseURL,
    guard,
  }) => {
    const drive = createFakeDrive({ acceptToken: isFakeToken, email: 'owner@example.com' });
    await routeDrive(context, drive);
    const consent = await routeAuthPage(context);
    const authorize = await startFakeRedirect(page, baseURL!);
    await page.goto(authorize);
    await page.waitForURL(/#\/settings\?account=1$/);
    expect(page.url()).not.toContain('access_token');
    const stored = await page.evaluate(
      (k) =>
        JSON.parse(localStorage.getItem(k) ?? 'null') as {
          token: string;
          email: string;
          expiresAt: number;
        },
      TOKEN_KEY,
    );
    expect(stored.email).toBe('owner@example.com');
    expect(isFakeToken(stored.token)).toBe(true);
    expect(stored.expiresAt).toBeGreaterThan(Date.now() + 3_000_000);
    expect(await page.evaluate((k) => localStorage.getItem(k), OAUTH_KEY)).toBeNull();
    expect(consent.requests).toHaveLength(1);
    expect(drive.log.map((l) => l.path)).toEqual(['/drive/v3/about']);
    await guard.check('after the redirect round trip');
  });

  for (const [name, opts, text, seed] of [
    ['denied', { outcome: 'error' as const }, /did not give spinner access/, undefined],
    ['state mismatch', { outcome: 'badstate' as const }, /did not start in spinner/, undefined],
    ['wrong scope', { outcome: 'noscope' as const }, /permission to keep its own data/, undefined],
    ['expired state (TTL)', {}, /took too long/, Date.now() - 11 * 60_000],
  ] as const) {
    test(`${name}: a plain page with a way back, and no token stored`, async ({
      page,
      context,
      baseURL,
      guard,
    }) => {
      await routeDrive(context, createFakeDrive({ acceptToken: isFakeToken }));
      await routeAuthPage(context, opts);
      await page.goto(
        await startFakeRedirect(page, baseURL!, {
          state: 'state-2',
          ...(seed ? { at: seed } : {}),
        }),
      );
      await expect(page.locator('#msg')).toContainText(text);
      await expect(page.getByRole('heading', { name: 'Sign-in did not finish' })).toBeVisible();
      const back = page.getByRole('link', { name: 'Back to spinner' });
      await expect(back).toBeVisible();
      expect(await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
      expect(await page.evaluate((k) => localStorage.getItem(k), OAUTH_KEY)).toBeNull();
      expect(page.url()).not.toContain('access_token');
      await guard.check(`return page: ${name}`);
      await expectAxeClean(page, `return page: ${name}`);
      await back.click();
      await expect(page.locator('#app')).toBeAttached();
    });
  }

  test('opened with no sign-in in flight (a stray visit)', async ({ page, guard }) => {
    await page.goto('./oauth-return.html');
    await expect(page.locator('#msg')).toContainText(/did not start in spinner/);
    await guard.check('stray visit');
    await expectAxeClean(page, 'stray visit');
  });

  test('carries the production CSP and runs no inline script', async ({ page }) => {
    await page.goto('./oauth-return.html');
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp).toContain("script-src 'self' https://accounts.google.com/gsi/client");
    expect(await page.locator('script:not([src])').count()).toBe(0);
  });
});
