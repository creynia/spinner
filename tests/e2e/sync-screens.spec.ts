// WP-S5b end to end, at the four viewports, on the real app service and the fake Drive with two
// browser contexts: a run done on device A shows as remote on B (Home and Library, with the badge),
// B opens it in Analyze (RemoteRunCard) which downloads it, "Remove download" returns it to remote,
// and Compare on B with A's remote run downloads it first, then compares. Screenshots go to
// test-results/s5b/. axe runs and no state may overflow horizontally.
import type { Page } from '@playwright/test';
import { expect, screenCheck, test } from './helpers';
import { createFakeDrive, routeDrive } from './fakes/drive-server';
import { secondDevice as newDevice } from './fakes/route';
import { isFakeToken, routeGis } from './fakes/gis-fake';

const status = (page: Page) => page.locator('[data-sync-status]');

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
  const b = await newDevice(browser, info.project.use, baseURL!, drive, { phone: true });
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

  // ---- Re-upload on A repairs a damaged bundle in Drive; B then downloads it and analyzes it
  await bp.goto('./?e2e#/library?tab=runs');
  await bp.getByRole('button', { name: `Remove download of ${NAME}` }).click();
  await expect(libRow()).toHaveCount(1, { timeout: 30_000 });
  const bundleFile = () => [...drive.files.values()].find((f) => f.name.startsWith('run.'))!;
  const goodBytes = Buffer.from(bundleFile().bytes);
  bundleFile().bytes = new Uint8Array(goodBytes.length).fill(7); // same size, other bytes
  await bp.goto(`./?e2e#/analyze/${runA}`);
  await expect(bp.locator('[data-remote-run="missing"]')).toBeVisible({ timeout: 30_000 });
  await screenCheck(bp, b.guard, 'B: the damaged bundle is explained');
  await shot(bp, '6-analyze-damaged');
  await page.goto('./?e2e#/library?tab=runs');
  await page.getByRole('button', { name: `Re-upload ${NAME}` }).click();
  await expect(page.getByText(`Uploaded ${NAME} to your Google Drive again.`)).toBeVisible({
    timeout: 30_000,
  });
  expect(Buffer.compare(Buffer.from(bundleFile().bytes), goodBytes)).toBe(0);
  await bp.goto('./?e2e#/'); // leave the card, so the next visit mounts a fresh one
  await bp.goto(`./?e2e#/analyze/${runA}`);
  await expect(bp.getByRole('heading', { level: 1, name: `Analyze: ${NAME}` })).toBeVisible({
    timeout: 60_000,
  });
  await screenCheck(bp, b.guard, 'B: analyzed after the re-upload');
  await shot(bp, '7-analyze-after-reupload');

  // ---- Compare while B is offline: the failure names the run and the reason; Retry works online
  await bp.goto('./?e2e#/library?tab=runs');
  await bp.getByRole('button', { name: `Remove download of ${NAME}` }).click();
  await expect(libRow()).toHaveCount(1, { timeout: 30_000 });
  await b.ctx.setOffline(true);
  await bp.evaluate((h) => void (location.hash = h), `#/compare?runs=${runA},${runB}`);
  const failure = bp.locator('[data-download-failed]');
  await expect(failure).toContainText(`Couldn't download ${NAME} from Drive: you're offline.`, {
    timeout: 30_000,
  });
  await expect(bp.locator('.compare')).toHaveCount(0); // the baseline never silently changes
  await screenCheck(bp, b.guard, 'B: compare offline names the failed download');
  await shot(bp, '8-compare-offline');
  await b.ctx.setOffline(false);
  await bp.getByRole('button', { name: 'Retry' }).click();
  await expect(bp.locator('.compare')).toBeVisible({ timeout: 60_000 });
  await expect(failure).toHaveCount(0);
  await b.ctx.close();
});
