// Library → Layouts tab at the four viewports: built-ins, duplicate, create by taps, save, rename,
// export, re-import ("already in your library") and delete; axe and no overflow at every state.
// Screenshots go to SHOTS_DIR when set.
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, screenCheck, test, type Page } from './helpers';

const SHOTS = process.env.SHOTS_DIR;
const row = (page: Page, name: string) =>
  page.locator('li.lay-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

test('Layouts tab: create, save, rename, duplicate, export, re-import, delete', async ({
  page,
  guard,
}, info) => {
  await page.goto('./?e2e#/library?tab=layouts');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Layouts', selected: true })).toBeVisible();
  await expect(page.locator('li.lay-card')).toHaveCount(6);
  await expect(page.getByText('Built-in').first()).toBeVisible();
  await screenCheck(page, guard, 'layouts list');
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/library-layouts-${info.project.name}.png` });
  }

  // Duplicate a built-in.
  await page.getByRole('button', { name: 'Duplicate to edit James Bond' }).click();
  await expect(row(page, 'Copy of James Bond')).toBeVisible();
  await expect(row(page, 'Copy of James Bond').getByText('Built-in')).toHaveCount(0);

  // Create by taps.
  await page.getByRole('button', { name: 'New layout' }).click();
  await expect(page).toHaveURL(/edit=new/);
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  const board = page.locator('.le-board');
  await board.locator('[data-bet="red"]').first().click();
  await board.locator('[data-bet="red"]').first().click();
  await board.locator('[data-bet="dozen:2"]').first().click();
  await expect(page.getByText(/3 chips · 2 spots/)).toBeVisible();
  await screenCheck(page, guard, 'editor');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('E2E layout');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved E2E layout')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/tab=layouts$/);
  await expect(row(page, 'E2E layout')).toBeVisible();
  await expect(row(page, 'E2E layout')).toContainText('2 spots');
  await screenCheck(page, guard, 'layouts list after save');

  // Rename.
  await page.getByRole('button', { name: 'Rename E2E layout' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('E2E renamed');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(row(page, 'E2E renamed')).toBeVisible();

  // Export.
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export E2E renamed' }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/\.layout\.json$/);
  const file = await download.path();
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ format: 'casino-lab-layout' });

  // Re-import: already in the library.
  await page.goto('./?e2e#/import');
  await page.locator('[data-file-input]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: readFileSync(file),
  });
  await expect(page.locator('[data-item="exists"]')).toContainText('Already in your library');
  await screenCheck(page, guard, 'import result');

  // Delete with confirm.
  await page.goto('./?e2e#/library?tab=layouts');
  await page.getByRole('button', { name: 'Delete E2E renamed' }).click();
  await expect(page.getByRole('dialog')).toContainText('Stages that used it keep their copy');
  await screenCheck(page, guard, 'delete confirm');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row(page, 'E2E renamed')).toHaveCount(0);

  // The exported file now imports as new.
  await page.goto('./?e2e#/import');
  await page.locator('[data-file-input]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: readFileSync(file),
  });
  await expect(page.locator('[data-item="imported"]')).toBeVisible();
});
