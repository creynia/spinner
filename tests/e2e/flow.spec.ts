// The whole app end to end (PLAYBOOK §12): Home -> Define -> Quick check -> Run -> Analyze (every
// tab) -> Sessions -> Watch -> Export -> Import (same context says "already", a fresh context
// imports) -> Analyze of the imported run. Real runs, real workers, real IndexedDB. Every screen:
// axe, no console errors, no horizontal overflow. SHOTS_DIR=<dir> saves screenshots.
import { mkdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, screenCheck, test, type Page } from './helpers';

const SHOTS = process.env.SHOTS_DIR;
async function shot(page: Page, name: string, project: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}-${project}.png`, fullPage: true });
}

const TABS = [
  ['overview', 'Overview'],
  ['paths', 'Paths'],
  ['risk', 'Risk'],
  ['money', 'Where the money went'],
  ['convergence', 'Convergence'],
  ['sessions', 'Sessions'],
  ['export', 'Export'],
] as const;

async function expandCards(page: Page): Promise<void> {
  for (const name of ['Session', 'Run']) {
    const t = page.getByRole('button', { name: new RegExp(`^${name}`) });
    if (await t.count()) {
      if ((await t.first().getAttribute('aria-expanded')) === 'false') await t.first().click();
    }
  }
}
const actions = (page: Page) => page.getByRole('region', { name: 'Actions' });

test('Home to Define to Run to Analyze to Watch to Export to Import', async ({
  page,
  guard,
  browser,
}, info) => {
  test.setTimeout(420_000);
  const project = info.project.name;

  // Home
  await page.goto('./?e2e#/');
  await expect(page.locator('h1')).toHaveText('spinner');
  await screenCheck(page, guard, 'home');
  await shot(page, 'home', project);
  await page.getByRole('link', { name: 'New experiment' }).first().click();

  // Define: pick a preset, edit one value
  await expect(page).toHaveURL(/#\/define/);
  await page.getByRole('button', { name: 'Presets' }).click();
  await page.getByRole('button', { name: /^Martingale: red/ }).click();
  await expandCards(page);
  await page.locator('#rounds').fill('200');
  await page.locator('#sessions').fill('2000');
  await page.locator('#seed').fill('31');
  await page.locator('#exp-name').fill('Flow Martingale');
  await screenCheck(page, guard, 'define');
  await shot(page, 'define', project);

  // Quick check
  await actions(page).getByRole('button', { name: 'Quick check' }).click();
  await expect(page.locator('.define-verdict')).toContainText('P(ahead)', { timeout: 30_000 });
  await screenCheck(page, guard, 'define quick check');

  // Run
  await actions(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page).toHaveURL(/#\/run\/[^/]+$/, { timeout: 30_000 });
  await expect(page.locator('[role=progressbar]')).toBeVisible();
  await screenCheck(page, guard, 'run');
  await expect(page.locator('[data-status=done]')).toBeVisible({ timeout: 240_000 });
  await screenCheck(page, guard, 'run done');
  await page.getByRole('link', { name: 'Analyze', exact: true }).click();

  // Analyze: every tab
  await expect(page.locator('[data-verdict]')).toBeVisible();
  await expect(page.locator('[data-imported]')).toHaveCount(0);
  for (const [id, label] of TABS) {
    await page.getByRole('tab', { name: label }).click();
    await expect(page.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
    if (id === 'overview') await expect(page.locator('[data-verdict]')).toBeVisible();
    await screenCheck(page, guard, `analyze ${id}`);
  }

  // Export (still on the Export tab)
  const gzDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download run file' }).click();
  const gz = await gzDl;
  expect(gz.suggestedFilename()).toMatch(/^flow-martingale-[0-9a-z]{8}\.spinner\.json\.gz$/);
  const bundlePath = await gz.path();
  const bundle = JSON.parse(gunzipSync(readFileSync(bundlePath)).toString()) as {
    format: string;
    meta: { sessions: number };
  };
  expect(bundle.format).toBe('casino-lab-run');
  expect(bundle.meta.sessions).toBe(2000);
  const csvDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'summaries.csv' }).click();
  const csv = await csvDl;
  expect(csv.suggestedFilename()).toMatch(/\.summaries\.csv$/);
  expect(
    readFileSync(await csv.path(), 'utf8')
      .trim()
      .split('\n').length,
  ).toBe(2001);

  // Sessions -> Watch
  await page.getByRole('tab', { name: 'Sessions' }).click();
  await page.locator('a.session-link').first().click();
  await expect(page).toHaveURL(/#\/watch\/.+\/\d+$/);
  await expect(page.locator('.tr-replay')).toBeVisible();
  const cur = () => page.locator('.tr-detail').getAttribute('data-window');
  const first = Number(await cur());
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next round' }).click();
  expect(Number(await cur())).toBe(first + 3);
  await screenCheck(page, guard, 'watch');

  // Import into the same context: already present
  await page.goto('./?e2e#/import');
  await page.locator('input[type=file]').setInputFiles(bundlePath);
  await expect(page.locator('[data-result=run]')).toContainText('Already in your library');
  await screenCheck(page, guard, 'import again');

  // Import into a fresh context: imported, and Analyze marks it
  const ctx = await browser.newContext({ ...info.project.use });
  const fresh = await ctx.newPage();
  const errors: string[] = [];
  fresh.on('pageerror', (e) => errors.push(e.message));
  fresh.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await fresh.goto('./?e2e#/import');
  await fresh.locator('input[type=file]').setInputFiles(bundlePath);
  await expect(fresh.locator('[data-result=run]')).toContainText('Imported');
  await expect(fresh.locator('[data-result=run]')).not.toContainText('Already');
  await fresh.getByRole('link', { name: 'Open results' }).click();
  await expect(fresh.locator('[data-verdict]')).toBeVisible();
  await expect(fresh.locator('[data-imported]')).toContainText('imported');
  for (const [, label] of TABS) {
    await fresh.getByRole('tab', { name: label }).click();
    await expect(fresh.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
  }
  await fresh.getByRole('tab', { name: 'Sessions' }).click();
  await fresh.locator('a.session-link').first().click();
  await expect(fresh.locator('.tr-replay')).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});
