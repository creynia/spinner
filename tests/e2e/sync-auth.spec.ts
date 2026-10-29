// The redirect sign-in round trip through the built `oauth-return.html` (sync.md §5.4, §11.3),
// against the fake consent page and the fake Drive. The CSP is enforced by the guard fixture: any
// securitypolicyviolation fails the test. (The Test sign-in row itself is WP-S4's; its UI e2e
// arrives with it.)
import { expect, expectAxeClean, test, type Page } from './helpers';
import { routeAuthPage } from './fakes/auth-page';
import { createFakeDrive, routeDrive } from './fakes/drive-server';
import { isFakeToken, routeGis } from './fakes/gis-fake';

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

// ---- the Test Google sign-in row (D23), driven through the real Account card -----------------
// The build carries the committed client id, so the row shows. The GIS script, the consent page and
// Drive are all fakes; the CSP is enforced by the guard.

const GATE_OK = 'Signed in as owner@example.com. 0 files in the app folder.';
type GisCalls = { prompt?: string; login_hint?: string }[];
const gisCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __gisFake: { calls: GisCalls } }).__gisFake.calls);
const gisRevoked = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __gisFake: { revoked: string[] } }).__gisFake.revoked,
  );

test.describe('Test Google sign-in row: popup', () => {
  test('sign in, Expire token now, tap again to Reconnect, End test', async ({
    page,
    context,
    guard,
  }) => {
    const drive = createFakeDrive({ acceptToken: isFakeToken, email: 'owner@example.com' });
    await routeDrive(context, drive);
    await routeGis(context);
    await page.goto('./?e2e#/settings?account=1');
    const result = page.locator('[data-sync-test-result]');
    const test1 = page.getByRole('button', { name: 'Test Google sign-in' });

    await test1.click();
    await expect(result).toHaveText(GATE_OK);
    expect(await gisCalls(page)).toEqual([{ prompt: 'select_account' }]);
    await guard.check('popup: signed in');
    await expectAxeClean(page, 'popup: signed in');

    await page.getByRole('button', { name: 'Expire token now' }).click();
    await test1.click();
    await expect(result).toHaveText(GATE_OK);
    // the Reconnect: silent, with the email hint, no chooser
    expect(await gisCalls(page)).toEqual([
      { prompt: 'select_account' },
      { prompt: '', login_hint: 'owner@example.com' },
    ]);

    await page.getByRole('button', { name: 'End test' }).click();
    await expect(result).toContainText('Test ended');
    expect(await gisRevoked(page)).toHaveLength(1);
    expect(await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
    await guard.check('popup: ended');
  });

  test('a blocked popup reports the failure on the row', async ({ page, context, guard }) => {
    await routeDrive(context, createFakeDrive({ acceptToken: isFakeToken }));
    await routeGis(context);
    await page.goto('./?e2e#/settings?account=1');
    await page.getByRole('button', { name: 'Test Google sign-in' }).click(); // loads the fake
    await expect(page.locator('[data-sync-test-result]')).toHaveText(GATE_OK);
    await page.getByRole('button', { name: 'End test' }).click();
    await page.evaluate(
      () => ((window as unknown as { __gisFake: { mode: string } }).__gisFake.mode = 'blocked'),
    );
    await page.getByRole('button', { name: 'Test Google sign-in' }).click();
    await expect(page.locator('[data-sync-test-result]')).toContainText(
      'Sign-in test failed: The sign-in window was blocked.',
    );
    await guard.check('popup blocked');
  });
});

test.describe('Test Google sign-in row: redirect (installed Android app)', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });

  test('redirect is the default, the return finishes the check, and Reconnect is a second hop', async ({
    page,
    context,
    guard,
  }) => {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q: string) =>
        q.includes('display-mode: standalone')
          ? ({
              matches: true,
              media: q,
              onchange: null,
              addEventListener() {},
              removeEventListener() {},
              addListener() {},
              removeListener() {},
              dispatchEvent: () => false,
            } as MediaQueryList)
          : real(q);
    });
    const drive = createFakeDrive({ acceptToken: isFakeToken, email: 'owner@example.com' });
    await routeDrive(context, drive);
    await routeGis(context);
    const consent = await routeAuthPage(context);
    await page.goto('./?e2e#/settings?account=1');
    const result = page.locator('[data-sync-test-result]');

    await page.getByRole('button', { name: 'Test Google sign-in' }).click();
    await expect(result).toHaveText(GATE_OK); // after Google, the return page, and a reload
    expect(consent.requests).toHaveLength(1);
    expect(consent.requests[0]).toMatchObject({ prompt: 'select_account', response_type: 'token' });
    expect(page.url()).not.toContain('access_token');
    expect(page.url()).toContain('settings');
    expect(await gisCalls(page)).toEqual([]); // no popup was opened
    await guard.check('redirect: back in the app');
    await expectAxeClean(page, 'redirect: back in the app');

    await page.getByRole('button', { name: 'Expire token now' }).click();
    await page.getByRole('button', { name: 'Test Google sign-in' }).click();
    await expect(result).toHaveText(GATE_OK);
    expect(consent.requests).toHaveLength(2);
    expect(consent.requests[1]).toMatchObject({ prompt: '', login_hint: 'owner@example.com' });
    await guard.check('redirect: reconnected');
  });
});
