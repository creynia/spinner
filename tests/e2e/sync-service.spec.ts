// WP-S5a end to end, at the four viewports, with the REAL app service: sign in with the fake GIS
// popup, the first sync (Merge) on two devices (two browser contexts) that share one fake Drive, an
// edit made on one device reaching the other, Sign out, and Remove my data from Drive. The popup
// falls back to a redirect round trip when it is blocked. The CSP is enforced (any violation fails),
// axe runs and no state may overflow horizontally.
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, expectAxeClean, screenCheck, test, type Guard } from './helpers';
import { routeAuthPage } from './fakes/auth-page';
import { createFakeDrive, routeDrive, type FakeDrive } from './fakes/drive-server';
import { gisFakeScript, isFakeToken, routeGis } from './fakes/gis-fake';

const row = (page: Page, name: string) =>
  page.locator('li.lay-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
const status = (page: Page) => page.locator('[data-sync-status]');

/** A second browser profile: its own IndexedDB and localStorage, the same fake Drive. */
async function secondDevice(
  browser: Browser,
  use: Record<string, unknown>,
  baseURL: string,
  drive: FakeDrive,
): Promise<{ page: Page; ctx: BrowserContext; guard: Guard }> {
  const ctx = await browser.newContext({
    baseURL,
    ...(use.viewport ? { viewport: use.viewport as { width: number; height: number } } : {}),
    ...(use.userAgent ? { userAgent: use.userAgent as string } : {}),
    ...(use.isMobile !== undefined ? { isMobile: use.isMobile as boolean } : {}),
    ...(use.hasTouch !== undefined ? { hasTouch: use.hasTouch as boolean } : {}),
  });
  await routeDrive(ctx, drive);
  await routeGis(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
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

/** Duplicates the n-th built-in layout and returns the copy's name. */
async function addLayout(page: Page, n: number): Promise<string> {
  await page.goto('./?e2e#/library?tab=layouts');
  await expect(page.locator('li.lay-card').first()).toBeVisible();
  await page
    .getByRole('button', { name: /^Duplicate to edit/ })
    .nth(n)
    .click();
  const copy = page.locator('li.lay-card h3', { hasText: /^Copy of/ }).first();
  await expect(copy).toBeVisible();
  return (await copy.textContent())!.trim();
}

async function openAccount(page: Page): Promise<void> {
  await page.goto('./?e2e#/settings?account=1');
  await expect(page.getByRole('heading', { name: 'Account and sync' })).toBeVisible();
}

const gis = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __gisFake: { calls: unknown[]; revoked: string[] } }).__gisFake,
  );

test('sign in, first sync, an edit reaches the other device, Sign out, Remove my data', async ({
  page,
  context,
  browser,
  baseURL,
  guard,
}, info) => {
  test.setTimeout(180_000);
  const drive = createFakeDrive({ acceptToken: isFakeToken, email: 'owner@example.com' });
  await routeDrive(context, drive);
  await routeGis(context);

  // ---- device A: some local data, then the real sign-in
  const nameA = await addLayout(page, 0);
  await openAccount(page);
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await screenCheck(page, guard, 'A: signed out');
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  const sheet = page.getByRole('dialog', { name: "Upload this device's library?" });
  await expect(sheet).toBeVisible(); // the Drive is empty
  await expect(sheet).toContainText('Runs upload in the background.');
  await screenCheck(page, guard, 'A: first-sync sheet (empty Drive)');
  await sheet.getByRole('button', { name: 'Start syncing' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(status(page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
  await expect(status(page)).toContainText('Up to date');
  await expect(page.locator('[data-account-email]')).toHaveText('owner@example.com');
  await screenCheck(page, guard, 'A: synced');
  const names = [...drive.files.values()].map((f) => f.name).sort();
  expect(names).toEqual([expect.stringMatching(/^lib\..+\.json\.gz$/), 'spinner-sync.json']);

  // ---- device B: its own data, signs in to a Drive that already has A's
  const b = await secondDevice(browser, info.project.use, baseURL!, drive);
  const nameB = await addLayout(b.page, 1);
  expect(nameB).not.toBe(nameA);
  await openAccount(b.page);
  await b.page.getByRole('button', { name: 'Sign in with Google' }).click();
  const sheetB = b.page.getByRole('dialog', { name: 'Your Drive already has data' });
  await expect(sheetB).toBeVisible();
  await expect(sheetB.locator('[data-first-sync="existing"]')).toBeVisible();
  await screenCheck(b.page, b.guard, 'B: first-sync sheet (Drive has data)');
  await expectAxeClean(b.page, 'B: first-sync sheet axe');
  await sheetB.getByRole('button', { name: 'Merge both (recommended)' }).click();
  await expect(status(b.page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
  await b.guard.check('B: merged');
  await b.page.goto('./?e2e#/library?tab=layouts');
  await expect(row(b.page, nameA)).toBeVisible(); // A's layout arrived
  await expect(row(b.page, nameB)).toBeVisible();

  // ---- an edit on A (rename) syncs by itself (5 s debounce) and reaches B on its Sync now
  const lib = () => [...drive.files.values()].filter((f) => f.name.startsWith('lib.'));
  const before = lib().map((f) => `${f.name}@${f.version}`);
  await page.goto('./?e2e#/library?tab=layouts');
  await page.getByRole('button', { name: `More actions for ${nameA}` }).click();
  await page.getByRole('button', { name: `Rename ${nameA}` }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Renamed on A');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(row(page, 'Renamed on A')).toBeVisible();
  await expect
    .poll(
      () =>
        lib()
          .map((f) => `${f.name}@${f.version}`)
          .join(),
      { timeout: 30_000 },
    )
    .not.toBe(before.join());
  await openAccount(b.page);
  await b.page.getByRole('button', { name: 'Sync now' }).click();
  await b.page.goto('./?e2e#/library?tab=layouts');
  await expect(row(b.page, 'Renamed on A')).toBeVisible({ timeout: 15_000 });
  await expect(row(b.page, nameA)).toHaveCount(0);
  await b.guard.check('B: received the edit');

  // ---- the Account card knows both devices and marks its own by id
  await openAccount(page);
  await expect(page.locator('[data-sync-devices] li')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('[data-sync-devices] li', { hasText: '(this device)' })).toHaveCount(1);
  await screenCheck(page, guard, 'A: account card with devices');

  // ---- Sign out on A: revoked, local data kept
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  expect((await gis(page)).revoked).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('spinner:sync:token'))).toBeNull();
  await page.goto('./?e2e#/library?tab=layouts');
  await expect(row(page, 'Renamed on A')).toBeVisible();
  await openAccount(page);
  await screenCheck(page, guard, 'A: signed out again');

  // ---- Remove my data from Drive on B: erased, B signed out, local data stays
  await openAccount(b.page);
  await b.page.getByRole('button', { name: 'Remove my data from Drive…' }).click();
  const confirm = b.page.getByRole('dialog', { name: 'Remove from Drive?' });
  await screenCheck(b.page, b.guard, 'B: remove confirmation');
  await confirm.getByRole('button', { name: 'Remove from Drive' }).click();
  await expect(b.page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible({
    timeout: 30_000,
  });
  expect([...drive.files.values()].map((f) => f.name)).toEqual(['spinner-sync.json']);
  await b.page.goto('./?e2e#/library?tab=layouts');
  await expect(row(b.page, 'Renamed on A')).toBeVisible();
  await expect(row(b.page, nameB)).toBeVisible();

  // ---- A signs in again and is told the Drive data was removed from another device
  await openAccount(page);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(status(page)).toHaveAttribute('data-sync-status', 'error', { timeout: 30_000 });
  await expect(status(page)).toContainText('removed from another device');
  await screenCheck(page, guard, 'A: told the Drive was erased');
  await b.ctx.close();
});

test('a blocked popup falls back to "Sign in in this window", and the return finishes the sign-in', async ({
  page,
  context,
  guard,
}) => {
  test.setTimeout(120_000);
  const drive = createFakeDrive({ acceptToken: isFakeToken, email: 'owner@example.com' });
  await routeDrive(context, drive);
  // the fake GIS script, set to a blocked popup from the start
  await context.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `${gisFakeScript()};window.__gisFake.mode='blocked';`,
    }),
  );
  const consent = await routeAuthPage(context);
  await addLayout(page, 0);
  await openAccount(page);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.locator('[data-sign-in-error]')).toContainText(
    'The sign-in window was blocked.',
  );
  const redirect = page.getByRole('button', { name: 'Sign in in this window' });
  await expect(redirect).toBeVisible();
  await expect(page.locator('[data-redirect-note]')).toContainText('nothing is lost');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0);
  await screenCheck(page, guard, 'popup blocked: the redirect is offered');
  await redirect.click();
  // Google (fake), the return page, and the app reloads and finishes the sign-in
  const sheet = page.getByRole('dialog', { name: "Upload this device's library?" });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  expect(consent.requests).toHaveLength(1);
  expect(consent.requests[0]).toMatchObject({ prompt: 'select_account', response_type: 'token' });
  expect(page.url()).not.toContain('access_token');
  await screenCheck(page, guard, 'redirect: back with the sheet');
  await sheet.getByRole('button', { name: 'Start syncing' }).click();
  await expect(status(page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
  await screenCheck(page, guard, 'redirect: synced');
});
