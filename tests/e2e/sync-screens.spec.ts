// WP-S5b end to end, at the four viewports, on the real app service and the fake Drive with two
// browser contexts: a run done on device A shows as remote on B (Home and Library, with the badge),
// B opens it in Analyze (RemoteRunCard) which downloads it, "Remove download" returns it to remote,
// and Compare on B with A's remote run downloads it first, then compares. Screenshots go to
// test-results/s5b/. axe runs and no state may overflow horizontally.
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, screenCheck, test, type Guard } from './helpers';
import { createFakeDrive, routeDrive, type FakeDrive } from './fakes/drive-server';
import { isFakeToken, routeGis } from './fakes/gis-fake';

const status = (page: Page) => page.locator('[data-sync-status]');

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
    // device B behaves like a phone: runs download when opened, not all at once (sync.md §7.12)
    Object.defineProperty(navigator, 'userAgentData', {
      value: { mobile: true, platform: 'Android' },
      configurable: true,
    });
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

/** Starts a small real run and waits until it is done (the Library links to Analyze then). */
async function finishedRun(page: Page, opts: string): Promise<string> {
  await page.goto('./?e2e#/');
  await page.waitForFunction('window.__results !== undefined');
  const id = await page.evaluate<string>(`window.__results.start(${opts})`);
  await expect(async () => {
    await page.evaluate(() => void (location.hash = '#/'));
    await page.evaluate(() => void (location.hash = '#/library?tab=runs'));
    await expect(page.locator(`a[href$="/analyze/${id}"]`)).toHaveCount(1, { timeout: 1500 });
  }).toPass({ timeout: 60_000 });
  return id;
}

async function signIn(page: Page, choice: string): Promise<void> {
  await page.goto('./?e2e#/settings?account=1');
  await expect(page.getByRole('heading', { name: 'Account and sync' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await page.getByRole('dialog').getByRole('button', { name: choice }).click();
  await expect(status(page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
}

const NAME = 'Remote demo';

test('a run made on device A is remote on B: Analyze downloads it, Remove download, Compare', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const shot = (p: Page, label: string) =>
    p.screenshot({ path: `test-results/s5b/${info.project.name}-${label}.png`, fullPage: true });
  const drive = createFakeDrive({ acceptToken: isFakeToken, email: 'owner@example.com' });
  await routeDrive(context, drive);
  await routeGis(context);

  // ---- device A: a finished run, then sign in; the run uploads in the background
  const runA = await finishedRun(page, `{ name: '${NAME}', sessions: 30, maxRounds: 20, seed: 3 }`);
  await signIn(page, 'Start syncing');
  await expect
    .poll(() => [...drive.files.values()].some((f) => f.name.startsWith('run.')), {
      timeout: 60_000,
    })
    .toBe(true);

  // ---- device B: signs in to that Drive; the run is listed, not downloaded
  const b = await secondDevice(browser, info.project.use, baseURL!, drive);
  const bp = b.page;
  await bp.goto('./?e2e#/');
  await signIn(bp, 'Merge both (recommended)').catch(async () => {
    // an empty device has no choice to make: the sign-in just starts syncing
    await expect(status(bp)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
  });
  const libRow = () =>
    bp
      .locator('ul[aria-label="Runs"] li')
      .filter({ hasText: NAME })
      .filter({ hasText: 'In Drive' });
  await expect(async () => {
    await bp.goto('./?e2e#/settings?account=1');
    await bp.getByRole('button', { name: 'Sync now' }).click();
    await bp.goto('./?e2e#/library?tab=runs');
    await expect(libRow()).toHaveCount(1, { timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  await expect(libRow().locator('a')).toHaveAttribute('href', new RegExp(`/analyze/${runA}$`));
  await expect(bp.getByRole('button', { name: /Remove download/ })).toHaveCount(0);
  await screenCheck(bp, b.guard, 'B: Library lists the remote run');
  await shot(bp, '1-library-remote');
  await bp.goto('./?e2e#/');
  await expect(
    bp
      .locator('ul[aria-label="Recent runs"] li')
      .filter({ hasText: NAME })
      .filter({ hasText: 'In Drive' }),
  ).toHaveCount(1);
  await screenCheck(bp, b.guard, 'B: Home lists the remote run');
  await shot(bp, '2-home-remote');

  // ---- B opens it in Analyze: the card downloads it, then the analysis shows
  await bp.goto(`./?e2e#/analyze/${runA}`);
  await expect(bp.getByRole('heading', { level: 1, name: `Analyze: ${NAME}` })).toBeVisible({
    timeout: 60_000,
  });
  await expect(bp.locator('[data-remote-run]')).toHaveCount(0);
  await screenCheck(bp, b.guard, 'B: analyzed after the download');
  await shot(bp, '3-analyze-downloaded');

  // ---- Remove download returns it to remote
  await bp.goto('./?e2e#/library?tab=runs');
  const remove = bp.getByRole('button', { name: `Remove download of ${NAME}` });
  await expect(remove).toBeVisible();
  await expect(libRow()).toHaveCount(0);
  await remove.click();
  await expect(libRow()).toHaveCount(1, { timeout: 30_000 });
  await expect(remove).toHaveCount(0);
  await screenCheck(bp, b.guard, 'B: back to remote after Remove download');
  await shot(bp, '4-library-removed');

  // ---- Compare on B with A's remote run: it downloads first, then compares
  const runB = await finishedRun(bp, `{ name: 'B local', sessions: 30, maxRounds: 20, seed: 5 }`);
  await bp.evaluate((h) => void (location.hash = h), `#/compare?runs=${runB},${runA}`);
  await expect(bp.locator('.compare')).toBeVisible({ timeout: 60_000 });
  await expect(bp.locator('.run-chip')).toHaveCount(2);
  await screenCheck(bp, b.guard, 'B: compared after downloading');
  await shot(bp, '5-compare-downloaded');
  await bp.goto('./?e2e#/library?tab=runs');
  await expect(bp.getByRole('button', { name: `Remove download of ${NAME}` })).toBeVisible();
  await expect(libRow()).toHaveCount(0); // it is on this device now
  await b.ctx.close();
});
