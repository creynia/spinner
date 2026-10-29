// WP-S6: every scenario of sync.md §11.3 (required on phone-360 and desktop; it runs on all four),
// with the REAL app service, the fake GIS and ONE shared fake Drive (fakes/route.ts). Two browser
// contexts act as two devices on one account. The CSP is enforced by the guard fixture (any
// violation fails), axe runs at each screen and no state may overflow horizontally.
//
// Scenario numbers below are §11.3's. Earlier packages covered parts of #1, #3, #8 and #9 in
// sync-service.spec.ts and sync-auth.spec.ts (all four viewports); this file runs each scenario
// through, end to end, and adds #4, #5, #10 and #11.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, screenCheck, test } from './helpers';
import { createFakeDrive, type FakeDrive } from './fakes/drive-server';
import { isFakeToken } from './fakes/gis-fake';
import { routeGoogle, secondDevice } from './fakes/route';

test.use({ actionTimeout: 20_000 });

// ---- helpers ------------------------------------------------------------------------------------

type Bridge = {
  syncStatus: { get(): { lastSyncedAt?: string; pending: number; state: string } };
  expireTokenForTest(): void;
};
const bridge = (page: Page) =>
  page.evaluate(() => {
    const b = (window as unknown as { __spinnerSync: Bridge }).__spinnerSync;
    return b.syncStatus.get();
  });
const status = (page: Page) => page.locator('[data-sync-status]');
const indicator = (page: Page) => page.locator('[data-sync-indicator]:visible');
const row = (page: Page, name: string) =>
  page.locator('li.lay-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
const runRow = (page: Page, list: string, name: string) =>
  page.locator(`ul[aria-label="${list}"] li`).filter({ hasText: name });

const newDrive = (): FakeDrive =>
  createFakeDrive({ acceptToken: isFakeToken, email: 'owner@example.com' });

async function openAccount(page: Page): Promise<void> {
  await page.goto('./?e2e#/settings?account=1');
  await expect(page.getByRole('heading', { name: 'Account and sync' })).toBeVisible();
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

async function renameLayout(page: Page, from: string, to: string): Promise<void> {
  await page.goto('./?e2e#/library?tab=layouts');
  await page.getByRole('button', { name: `More actions for ${from}` }).click();
  await page.getByRole('button', { name: `Rename ${from}` }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill(to);
  await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(row(page, to)).toBeVisible();
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

/** Signs in on the Account card. `choice` answers the first-sync sheet, when there is one. */
async function signIn(page: Page, choice: string): Promise<void> {
  await openAccount(page);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await page.getByRole('dialog').getByRole('button', { name: choice }).click();
  await expect(status(page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
}

/** "Sync now" on the Account card; resolves when a cycle has finished after the click. */
async function syncNow(page: Page): Promise<void> {
  await openAccount(page);
  const before = (await bridge(page)).lastSyncedAt;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect
    .poll(async () => (await bridge(page)).lastSyncedAt, { timeout: 30_000 })
    .not.toBe(before);
  await expect(status(page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
}

/** Clicks "Sync now" without waiting for the cycle. */
async function clickSyncNow(page: Page): Promise<void> {
  await openAccount(page);
  await page.getByRole('button', { name: 'Sync now' }).click();
}

/** Waits until the device has nothing pending and is idle again. */
async function expectSettled(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const st = await bridge(page);
        return `${st.state}/${st.pending}`;
      },
      { timeout: 30_000 },
    )
    .toBe('idle/0');
}

/**
 * Holds a device's Drive uploads and updates (everything under /upload/) while `on()` is set,
 * after the engine has listed and pulled, so a test can order two devices' writes.
 */
async function holdWrites(ctx: BrowserContext) {
  let holding = false;
  let count = 0;
  let gate: Promise<void> = Promise.resolve();
  let open = (): void => {};
  await ctx.route('https://www.googleapis.com/upload/**', async (route) => {
    if (holding) {
      count++;
      await gate;
    }
    await route.fallback();
  });
  return {
    on(): void {
      holding = true;
      count = 0;
      gate = new Promise<void>((resolve) => (open = resolve));
    },
    release(): void {
      holding = false;
      open();
    },
    get count(): number {
      return count;
    },
  };
}

/** The run's meta as stored on a device (IndexedDB `spinner` / `runs`), or null. */
const localRun = (page: Page, id: string) =>
  page.evaluate(
    (runId) =>
      new Promise<{ resultsDigest?: string; status: string } | null>((resolve, reject) => {
        const open = indexedDB.open('spinner');
        open.onerror = () => reject(open.error ?? new Error('indexedDB'));
        open.onsuccess = () => {
          const get = open.result.transaction('runs').objectStore('runs').get(runId);
          get.onsuccess = () => {
            open.result.close();
            resolve((get.result as { resultsDigest?: string; status: string }) ?? null);
          };
          get.onerror = () => reject(get.error ?? new Error('indexedDB'));
        };
      }),
    id,
  );

/** Edits the library strategy `e2e-conflict` through the Define JSON tab and saves it. */
/** Opens Define and its Run section (collapsed on phones), where "Compare with…" lives. */
async function openCompareSheet(page: Page): Promise<void> {
  await page.goto('./?e2e#/define');
  const run = page.locator('button[aria-expanded]', { hasText: /^Run/ }).first();
  if ((await run.count()) && (await run.getAttribute('aria-expanded')) === 'false')
    await run.click();
  await page.getByRole('button', { name: /^Compare with/ }).click();
}

async function saveStrategy(page: Page, name: string): Promise<void> {
  await page.goto('./?e2e#/define');
  await page.getByRole('radio', { name: 'JSON' }).click();
  const area = page.getByLabel('Strategy JSON');
  const doc = JSON.parse(await area.inputValue()) as { id: string; name: string };
  doc.id = 'e2e-conflict';
  doc.name = name;
  await area.fill(JSON.stringify(doc));
  await page.getByRole('button', { name: 'Save strategy' }).click();
  await expect(page.getByText('Strategy saved to your library').first()).toBeVisible();
}
const strategyNames = async (page: Page): Promise<string[]> => {
  await page.goto('./?e2e#/library?tab=strategies');
  await expect(page.locator('ul[aria-label="Saved strategies"]')).toBeVisible();
  return (await page.locator('ul[aria-label="Saved strategies"] li .row-title').allTextContents())
    .map((t) => t.trim())
    .sort();
};

// ---- #1, #2, #3, #5 ------------------------------------------------------------------------------

test('#1 #2 #3 #5: first upload, a merging second device, a layout edit, a run delete', async ({
  page,
  context,
  browser,
  baseURL,
  guard,
}, info) => {
  test.setTimeout(240_000);
  const drive = newDrive();
  await routeGoogle(context, drive);

  // 1. A signs in, the Drive is empty, Start: a definition, a layout and a small done run upload
  const NAME = 'Drive demo';
  const runA = await finishedRun(page, `{ name: '${NAME}', sessions: 30, maxRounds: 20, seed: 3 }`);
  const nameA = await addLayout(page, 0);
  await openAccount(page);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  const sheet = page.getByRole('dialog', { name: "Upload this device's library?" });
  await expect(sheet).toBeVisible();
  await screenCheck(page, guard, 'A: first-sync sheet (empty Drive)');
  await sheet.getByRole('button', { name: 'Start syncing' }).click();
  await expect(status(page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
  await expect
    .poll(() => [...drive.files.values()].some((f) => f.name.startsWith('run.')), {
      timeout: 60_000,
    })
    .toBe(true);
  const names = [...drive.files.values()].map((f) => f.name);
  expect(names).toContain('spinner-sync.json');
  expect(names.filter((n) => n.startsWith('lib.'))).toHaveLength(1);
  expect(names.filter((n) => n.startsWith('run.'))).toHaveLength(1);
  await screenCheck(page, guard, 'A: uploaded');
  const homeA = await (async () => {
    await page.goto('./?e2e#/');
    const li = runRow(page, 'Recent runs', NAME);
    await expect(li).toHaveCount(1);
    return (await li.locator('.row-sub').innerText()).trim();
  })();

  // 2. B (with local data) chooses Merge; A's run shows with its verdict and badge everywhere
  const b = await secondDevice(browser, info.project.use, baseURL!, drive, { phone: true });
  const bp = b.page;
  const nameB = await addLayout(bp, 1);
  expect(nameB).not.toBe(nameA);
  await openAccount(bp);
  await bp.getByRole('button', { name: 'Sign in with Google' }).click();
  const sheetB = bp.getByRole('dialog', { name: 'Your Drive already has data' });
  await expect(sheetB).toBeVisible();
  await screenCheck(bp, b.guard, 'B: first-sync sheet (Drive has data)');
  await sheetB.getByRole('button', { name: 'Merge both (recommended)' }).click();
  await expect(status(bp)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
  await bp.goto('./?e2e#/library?tab=layouts');
  await expect(row(bp, nameA)).toBeVisible(); // A's layout arrived
  await expect(row(bp, nameB)).toBeVisible();

  const inDrive = (list: string) => runRow(bp, list, NAME).filter({ hasText: 'In Drive' });
  await expect(async () => {
    await bp.goto('./?e2e#/');
    await expect(inDrive('Recent runs')).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  // Home: badge and the same verdict line as on A
  expect((await inDrive('Recent runs').locator('.row-sub').innerText()).trim()).toBe(homeA);
  expect(homeA).not.toMatch(/^[\d,]+ sessions$/); // a verdict, not the fallback
  await screenCheck(bp, b.guard, 'B: Home lists the remote run');
  // Library
  await bp.goto('./?e2e#/library?tab=runs');
  await expect(inDrive('Runs')).toHaveCount(1);
  await screenCheck(bp, b.guard, 'B: Library lists the remote run');
  // the Compare picker
  await bp.goto('./?e2e#/compare');
  await expect
    .poll(
      async () =>
        (await bp.getByLabel('Finished runs').locator('option').allTextContents()).some(
          (o) => o.includes(NAME) && o.includes('☁'),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await screenCheck(bp, b.guard, 'B: Compare picker lists the remote run');
  // Define's compare sheet
  await openCompareSheet(bp);
  const cmp = bp.getByRole('dialog', { name: 'Compare with a run' });
  await expect(
    cmp.locator('button', { hasText: NAME }).filter({ hasText: 'In Drive' }),
  ).toHaveCount(1);
  await screenCheck(bp, b.guard, "B: Define's compare sheet lists the remote run");
  await bp.keyboard.press('Escape');

  // opening it downloads it, and the numbers match (same digest)
  expect(await localRun(bp, runA)).toBeNull();
  await bp.goto(`./?e2e#/analyze/${runA}`);
  await expect(bp.getByRole('heading', { level: 1, name: `Analyze: ${NAME}` })).toBeVisible({
    timeout: 60_000,
  });
  const onA = await localRun(page, runA);
  const onB = await localRun(bp, runA);
  expect(onB?.status).toBe('done');
  expect(onB?.resultsDigest).toBeTruthy();
  expect(onB?.resultsDigest).toBe(onA?.resultsDigest);
  await screenCheck(bp, b.guard, 'B: analyzed after the download');

  // 3. A edits a layout; Sync now on B shows the edit
  await renameLayout(page, nameA, 'Renamed on A');
  await syncNow(page);
  await syncNow(bp);
  await bp.goto('./?e2e#/library?tab=layouts');
  await expect(row(bp, 'Renamed on A')).toBeVisible({ timeout: 15_000 });
  await expect(row(bp, nameA)).toHaveCount(0);
  await screenCheck(bp, b.guard, 'B: received the layout edit');

  // 5. A deletes the run and syncs; it is gone on B, though B had downloaded it
  await page.goto('./?e2e#/library?tab=runs');
  await page.getByRole('button', { name: `Delete run ${NAME}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await syncNow(page);
  await page.goto('./?e2e#/library?tab=runs');
  await expect(runRow(page, 'Runs', NAME)).toHaveCount(0);
  await syncNow(bp);
  await expect(async () => {
    await bp.goto('./?e2e#/library?tab=runs');
    await expect(bp.getByRole('heading', { name: 'Library' })).toBeVisible();
    await expect(runRow(bp, 'Runs', NAME)).toHaveCount(0, { timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  expect(await localRun(bp, runA)).toBeNull();
  await bp.goto('./?e2e#/');
  await expect(runRow(bp, 'Recent runs', NAME)).toHaveCount(0);
  await screenCheck(bp, b.guard, 'B: the deleted run is gone');
  await b.ctx.close();
});

// ---- #4 -------------------------------------------------------------------------------------------

test('#4 (B1): the same strategy edited on both devices keeps both versions, one notice each, and a View toast', async ({
  page,
  context,
  browser,
  baseURL,
  guard,
}, info) => {
  test.setTimeout(240_000);
  const drive = newDrive();
  await routeGoogle(context, drive);
  await saveStrategy(page, 'Base strategy');
  await signIn(page, 'Start syncing');

  const b = await secondDevice(browser, info.project.use, baseURL!, drive);
  const bp = b.page;
  await addLayout(bp, 1); // local data, so the Merge choice is offered
  await signIn(bp, 'Merge both (recommended)');
  await expect.poll(() => strategyNames(bp), { timeout: 30_000 }).toEqual(['Base strategy']);

  // The B1 race: hold both devices' Drive writes until both have listed, so both push before
  // either pulls. Then hold them again while each pulls the other's unresolved lib.
  const hold = {
    a: await holdWrites(context),
    b: await holdWrites(b.ctx),
  };
  hold.a.on();
  hold.b.on();
  await saveStrategy(page, 'Edited on A');
  await saveStrategy(bp, 'Edited on B');
  await expect
    .poll(() => Math.min(hold.a.count, hold.b.count), { timeout: 30_000 })
    .toBeGreaterThan(0);
  hold.a.release();
  hold.b.release();
  for (const p of [page, bp]) await expectSettled(p);

  hold.a.on();
  hold.b.on();
  await clickSyncNow(page);
  await clickSyncNow(bp);
  await expect
    .poll(() => Math.min(hold.a.count, hold.b.count), { timeout: 30_000 })
    .toBeGreaterThan(0);
  hold.a.release();
  hold.b.release();
  for (const p of [page, bp]) await expectSettled(p);

  // the toast says both versions were kept, and View leads to the notices
  await expect(bp.getByText(/changed on two devices; both versions were kept/)).toBeVisible();
  await screenCheck(bp, b.guard, 'B: the conflict toast');
  await bp.getByRole('button', { name: 'View' }).click();
  await expect(bp).toHaveURL(/#\/settings\?account=1&notices=1/);
  await expect(bp.getByRole('dialog', { name: 'Notices' })).toBeVisible();
  // settle: both devices see the resolved libs
  await syncNow(page);
  await syncNow(bp);
  await syncNow(page);

  // the winner keeps the id; the loser is a conflicted copy named after its content
  for (const [label, p, g] of [
    ['A', page, guard],
    ['B', bp, b.guard],
  ] as const) {
    const shown = await strategyNames(p);
    expect(shown, `${label}: both versions survive`).toHaveLength(2);
    expect(
      shown.filter((n) => /\(conflict [0-9a-f]{6}\)$/.test(n)),
      label,
    ).toHaveLength(1);
    expect(shown.join('|'), label).toMatch(/Edited on A/);
    expect(shown.join('|'), label).toMatch(/Edited on B/);
    await screenCheck(p, g, `${label}: Library → Strategies with the conflicted copy`);
  }
  // one notice each, and the "View" toast leads to it
  for (const [label, p, g] of [
    ['A', page, guard],
    ['B', bp, b.guard],
  ] as const) {
    await p.goto('./?e2e#/settings?account=1&notices=1');
    const items = p.getByRole('dialog', { name: 'Notices' }).locator('[data-sync-notices] li');
    await expect(items, `${label}: one notice`).toHaveCount(1);
    await expect(items.first()).toContainText('Edited on');
    await screenCheck(p, g, `${label}: notices`);
  }

  await b.ctx.close();
});

// ---- #6 -------------------------------------------------------------------------------------------

test('#6: offline edits queue and push when the device comes back online', async ({
  page,
  context,
  browser,
  baseURL,
  guard,
}, info) => {
  test.setTimeout(180_000);
  const drive = newDrive();
  await routeGoogle(context, drive);
  const nameA = await addLayout(page, 0);
  await signIn(page, 'Start syncing');
  const b = await secondDevice(browser, info.project.use, baseURL!, drive);
  await b.page.goto('./?e2e#/library?tab=layouts');
  await signIn(b.page, 'Merge both (recommended)').catch(() =>
    expect(status(b.page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 }),
  );
  await b.page.goto('./?e2e#/library?tab=layouts');
  await expect(row(b.page, nameA)).toBeVisible({ timeout: 30_000 });

  await b.ctx.setOffline(true);
  await renameLayout(b.page, nameA, 'Edited offline');
  await openAccount(b.page);
  await expect(status(b.page)).toHaveAttribute('data-sync-status', 'offline', { timeout: 30_000 });
  await expect(status(b.page)).toContainText('1 change waiting');
  await screenCheck(b.page, b.guard, 'B: offline with a change waiting');
  const libBefore = [...drive.files.values()].map((f) => `${f.name}@${f.version}`).sort();

  await b.ctx.setOffline(false);
  await expect(status(b.page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 60_000 });
  expect((await bridge(b.page)).pending).toBe(0);
  expect([...drive.files.values()].map((f) => `${f.name}@${f.version}`).sort()).not.toEqual(
    libBefore,
  );
  await screenCheck(b.page, b.guard, 'B: back online, pushed');
  await syncNow(page);
  await page.goto('./?e2e#/library?tab=layouts');
  await expect(row(page, 'Edited offline')).toBeVisible({ timeout: 15_000 });
  await screenCheck(page, guard, 'A: received the offline edit');
  await b.ctx.close();
});

// ---- #7 -------------------------------------------------------------------------------------------

test('#7: token expiry with pending changes shows amber Reconnect (one tap finishes the sync); with nothing pending there is no amber', async ({
  page,
  context,
  browser,
  baseURL,
  guard,
}, info) => {
  test.setTimeout(180_000);
  const drive = newDrive();
  await routeGoogle(context, drive);
  const nameA = await addLayout(page, 0);
  await signIn(page, 'Start syncing');
  const expire = () =>
    page.evaluate(() =>
      (window as unknown as { __spinnerSync: Bridge }).__spinnerSync.expireTokenForTest(),
    );

  // nothing pending: paused, quiet, no amber
  await expire();
  await expect(indicator(page)).toHaveAttribute('data-sync-indicator', 'needs-auth');
  await expect(indicator(page)).not.toHaveClass(/attention/);
  await expect(indicator(page)).not.toContainText('Reconnect');
  await openAccount(page);
  await expect(status(page)).toContainText('Sync paused');
  await expect(status(page)).not.toHaveClass(/attention/);
  await screenCheck(page, guard, 'A: expired, nothing pending (no amber)');

  // a pending change turns it amber
  await renameLayout(page, nameA, 'Edited while expired');
  await expect(indicator(page)).toHaveClass(/attention/, { timeout: 30_000 });
  await expect(indicator(page)).toContainText('Reconnect');
  await openAccount(page);
  await expect(status(page)).toContainText('Sign-in expired · 1 change waiting');
  await screenCheck(page, guard, 'A: expired with a change waiting (amber)');

  // one tap
  const issued = await page.evaluate(
    () => (window as unknown as { __gisFake: { issued: string[] } }).__gisFake.issued.length,
  );
  await indicator(page).click();
  await expect(status(page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
  expect(
    await page.evaluate(
      () => (window as unknown as { __gisFake: { issued: string[] } }).__gisFake.issued.length,
    ),
  ).toBe(issued + 1);
  await expect.poll(async () => (await bridge(page)).pending, { timeout: 30_000 }).toBe(0);
  await expect(indicator(page)).not.toHaveClass(/attention/);
  await screenCheck(page, guard, 'A: reconnected, synced');

  // the edit really reached Drive: a second device sees it
  const b = await secondDevice(browser, info.project.use, baseURL!, drive);
  await addLayout(b.page, 1);
  await signIn(b.page, 'Merge both (recommended)');
  await b.page.goto('./?e2e#/library?tab=layouts');
  await expect(row(b.page, 'Edited while expired')).toBeVisible({ timeout: 30_000 });
  await b.ctx.close();
});

// ---- #8 -------------------------------------------------------------------------------------------

test.describe('#8: redirect sign-in', () => {
  test('a blocked popup falls back to a redirect round trip through oauth-return.html', async ({
    page,
    context,
    guard,
  }) => {
    test.setTimeout(120_000);
    const drive = newDrive();
    const { consent } = await routeGoogle(context, drive, { consent: true });
    await addLayout(page, 0);
    await openAccount(page);
    await page.getByRole('button', { name: 'Sign in with Google' }).click(); // loads the fake GIS
    await expect(page.getByRole('dialog', { name: "Upload this device's library?" })).toBeVisible();
    await page.getByRole('button', { name: 'Not now' }).click();
    // sign out, block the popup, sign in again
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.evaluate(
      () => ((window as unknown as { __gisFake: { mode: string } }).__gisFake.mode = 'blocked'),
    );
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await expect(page.locator('[data-sign-in-error]')).toContainText(
      'The sign-in window was blocked.',
    );
    await screenCheck(page, guard, 'popup blocked: the redirect is offered');
    await page.getByRole('button', { name: 'Sign in in this window' }).click();
    const sheet = page.getByRole('dialog', { name: /library\?|Your Drive already has data/ });
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    expect(consent!.requests).toHaveLength(1);
    expect(page.url()).not.toContain('access_token');
    await screenCheck(page, guard, 'redirect: back with the sheet');
  });

  test.describe('installed Android app', () => {
    test.use({
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    });

    test('display-mode: standalone on Android makes the redirect the default', async ({
      page,
      context,
      guard,
    }) => {
      test.setTimeout(120_000);
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
      const drive = newDrive();
      const { consent } = await routeGoogle(context, drive, { consent: true });
      await addLayout(page, 0);
      await openAccount(page);
      await page.getByRole('button', { name: 'Sign in with Google' }).click();
      const sheet = page.getByRole('dialog', { name: "Upload this device's library?" });
      await expect(sheet).toBeVisible({ timeout: 30_000 }); // after Google, the return page, a reload
      expect(consent!.requests).toHaveLength(1);
      expect(consent!.requests[0]).toMatchObject({
        prompt: 'select_account',
        response_type: 'token',
      });
      expect(
        await page.evaluate(
          () => (window as unknown as { __gisFake?: { calls: unknown[] } }).__gisFake?.calls ?? [],
        ),
      ).toEqual([]); // no popup was opened
      expect(page.url()).not.toContain('access_token');
      await screenCheck(page, guard, 'standalone: redirect sign-in returned');
      await sheet.getByRole('button', { name: 'Start syncing' }).click();
      await expect(status(page)).toHaveAttribute('data-sync-status', 'idle', { timeout: 30_000 });
    });
  });
});

// ---- #9 -------------------------------------------------------------------------------------------

test('#9: Remove my data from Drive on A turns B off', async ({
  page,
  context,
  browser,
  baseURL,
  guard,
}, info) => {
  test.setTimeout(180_000);
  const drive = newDrive();
  await routeGoogle(context, drive);
  await addLayout(page, 0);
  await signIn(page, 'Start syncing');
  const b = await secondDevice(browser, info.project.use, baseURL!, drive);
  await addLayout(b.page, 1);
  await signIn(b.page, 'Merge both (recommended)');

  await openAccount(page);
  await page.getByRole('button', { name: 'Remove my data from Drive…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove from Drive?' });
  await screenCheck(page, guard, 'A: remove confirmation');
  await confirm.getByRole('button', { name: 'Remove from Drive' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible({
    timeout: 30_000,
  });
  expect([...drive.files.values()].map((f) => f.name)).toEqual(['spinner-sync.json']);

  await openAccount(b.page);
  await b.page.getByRole('button', { name: 'Sync now' }).click();
  await expect(b.page.locator('[data-sync-status]')).toContainText('removed from another device', {
    timeout: 30_000,
  });
  // sync is off here (state error/erased): it says so, offers a way back, and stops syncing
  await expect(b.page.locator('[data-sync-status]')).toContainText('Sync is off here');
  await expect(b.page.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
  await expect(b.page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(indicator(b.page)).toHaveClass(/attention/);
  const calls = drive.log.length;
  await b.page.goto('./?e2e#/library?tab=layouts');
  await addLayout(b.page, 2); // a new local edit does not talk to Drive any more
  await b.page.waitForTimeout(7000); // longer than the 5 s change debounce
  expect(drive.log.length).toBe(calls);
  await screenCheck(b.page, b.guard, 'B: turned off by the erase');
  await b.page.goto('./?e2e#/library?tab=layouts');
  await expect(b.page.locator('li.lay-card h3', { hasText: /^Copy of/ })).not.toHaveCount(0);
  await b.ctx.close();
});

// ---- #10, #11 -------------------------------------------------------------------------------------

test('#10 #11: a sweep on B reuses A’s remote done variant runs; a paused remote run is greyed and does not open', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(300_000);
  const drive = newDrive();
  await routeGoogle(context, drive);
  const common = 'sessions: 30, seed: 3';
  const base = await finishedRun(page, `{ name: 'Sweep base', ${common}, maxRounds: 10 }`);
  const v20 = await finishedRun(page, `{ name: 'Sweep v20', ${common}, maxRounds: 20 }`);
  const v30 = await finishedRun(page, `{ name: 'Sweep v30', ${common}, maxRounds: 30 }`);
  // a run that is paused on A (a stub only): start it long, pause it, reload so it is not active
  const longId = await page.evaluate<string>(
    `window.__results.start({ name: 'Paused demo', sessions: 60000, maxRounds: 300, seed: 9 })`,
  );
  await page.goto(`./?e2e#/run/${longId}`);
  await expect(page.locator('[data-status=running]')).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    const v = await page.locator('[role=progressbar]').getAttribute('aria-valuenow');
    expect(Number(v)).toBeGreaterThan(0);
  }).toPass({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('[data-status=paused]')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await signIn(page, 'Start syncing');
  await syncNow(page);
  await expect
    .poll(() => [...drive.files.values()].filter((f) => f.name.startsWith('run.')).length, {
      timeout: 90_000,
    })
    .toBe(3);

  // ---- B: everything is remote
  const b = await secondDevice(browser, info.project.use, baseURL!, drive, { phone: true });
  const bp = b.page;
  await addLayout(bp, 1);
  await signIn(bp, 'Merge both (recommended)');
  await expect(async () => {
    await syncNow(bp);
    await bp.goto('./?e2e#/library?tab=runs');
    await expect(runRow(bp, 'Runs', 'Sweep v30')).toHaveCount(1, { timeout: 2000 });
    await expect(runRow(bp, 'Runs', 'Paused demo')).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 60_000 });

  // 11. the paused run is greyed with its status, and nothing opens
  const paused = runRow(bp, 'Runs', 'Paused demo');
  await expect(paused.locator('.row-stub')).toHaveCount(1);
  await expect(paused).toContainText(/Paused on .+ · \d+%/);
  await expect(paused.locator('a')).toHaveCount(0);
  await expect(paused.getByRole('button', { name: /Delete run/ })).toHaveCount(0);
  await screenCheck(bp, b.guard, 'B: the paused remote run is greyed');
  await paused.locator('.row-stub').click({ force: true });
  expect(bp.url()).toContain('library');
  await bp.goto('./?e2e#/');
  await expect(runRow(bp, 'Recent runs', 'Paused demo').locator('.row-stub')).toHaveCount(1);
  await expect(runRow(bp, 'Recent runs', 'Paused demo').locator('a')).toHaveCount(0);
  await screenCheck(bp, b.guard, 'B: Home greys the paused run too');
  await openCompareSheet(bp);
  const sheet = bp.getByRole('dialog', { name: 'Compare with a run' });
  await expect(sheet.locator('button', { hasText: 'Paused demo' })).toBeDisabled();
  await bp.keyboard.press('Escape');

  // 10. a sweep over maxRounds 20 and 30 reuses A's two done variants: no new run starts
  const localIds = () =>
    bp.evaluate(
      () =>
        new Promise<string[]>((resolve, reject) => {
          const open = indexedDB.open('spinner');
          open.onerror = () => reject(open.error ?? new Error('indexedDB'));
          open.onsuccess = () => {
            const k = open.result.transaction('runs').objectStore('runs').getAllKeys();
            k.onsuccess = () => {
              open.result.close();
              resolve(k.result.map(String));
            };
          };
        }),
    );
  expect(await localIds()).toEqual([]); // nothing is local on B yet
  await bp.goto('./?e2e#/sweep/new');
  const pick = async (label: string, test: (t: string, v: string) => boolean) => {
    const sel = bp.getByLabel(label, { exact: true });
    const opts = await sel
      .locator('option')
      .evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent ?? '']));
    const hit = opts.find(([v, t]) => test(t!, v!));
    expect(hit, `${label}: ${JSON.stringify(opts)}`).toBeTruthy();
    await sel.selectOption(hit![0]!);
  };
  await pick('Experiment', (t) => t.startsWith('Sweep base'));
  await pick('Setting to vary', (_, v) => v.endsWith('/maxRounds'));
  await bp.getByLabel('Values').fill('20, 30');
  await screenCheck(bp, b.guard, 'B: new sweep over maxRounds');
  await bp.getByRole('button', { name: 'Create and run' }).click();
  await expect(bp).toHaveURL(/#\/sweep\/(?!new)/);
  await expect(bp.locator('[data-sweep-progress]')).toContainText('2 of 2 variants finished', {
    timeout: 90_000,
  });
  const links = await bp
    .locator('ul[aria-label="Variants"] a')
    .evaluateAll((as) =>
      as.map((a) => decodeURIComponent((a.getAttribute('href') ?? '').split('/').pop() ?? '')),
    );
  expect(links).toEqual([v20, v30]); // A's runs, not new ones
  await expect(bp.getByRole('alert')).toHaveCount(0);
  await screenCheck(bp, b.guard, 'B: the sweep reused the remote variants');
  // nothing new was run here: every run B holds is one of A's
  expect((await localIds()).filter((id) => ![base, v20, v30].includes(id))).toEqual([]);
  await bp.goto('./?e2e#/library?tab=runs');
  await expect(
    bp.locator('ul[aria-label="Runs"] li').filter({ hasText: 'maxRounds=' }),
  ).toHaveCount(0);
  await b.ctx.close();
});
