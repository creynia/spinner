// Rename an experiment from the Library and from Analyze, then confirm the new name in Home,
// Library, Define and Analyze after a reload, with the definition id and run id unchanged.
// Four viewports; axe and no horizontal overflow at every state. SHOTS_DIR=<dir> saves screenshots.
import { mkdirSync } from 'node:fs';
import { expect, screenCheck, test, type Page } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

const go = (page: Page, hash: string) => page.evaluate((h) => void (location.hash = h), hash);

test('rename an experiment from Library and from Analyze', async ({ page, guard }, info) => {
  await page.goto('./?e2e#/');
  await page.waitForFunction('window.__results !== undefined');
  const runId = await page.evaluate<string>(
    "window.__results.start({ name: 'E2E original', sessions: 40, maxRounds: 30 })",
  );
  await go(page, `#/run/${runId}`);
  await expect(page.locator('[data-status=done]')).toBeVisible({ timeout: 60_000 });
  const shot = async (name: string) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}-${info.project.name}.png` });
  };

  // --- Library -> Definitions: Rename opens a labelled sheet; Esc cancels and returns focus.
  await go(page, '#/library?tab=definitions');
  const rename = page.getByRole('button', { name: 'Rename E2E original' });
  await expect(rename).toBeVisible();
  const href = await page
    .locator('li.lib-row', { hasText: 'E2E original' })
    .locator('a.row-link')
    .getAttribute('href');
  const definitionId = /define\/([0-9a-f]{64})/.exec(href ?? '')?.[1];
  expect(definitionId).toBeTruthy();
  await rename.focus();
  await rename.click();
  const dlg = page.getByRole('dialog', { name: 'Rename experiment' });
  const input = dlg.getByLabel('Name');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('E2E original');
  await screenCheck(page, guard, 'rename sheet');
  await shot('rename-sheet');
  await input.fill('discarded');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(rename).toBeFocused();
  await expect(page.getByText('E2E original').first()).toBeVisible();

  // --- an empty name is refused inline; Enter saves a valid one.
  await rename.click();
  await input.fill('   ');
  await input.press('Enter');
  await expect(dlg.getByRole('alert')).toContainText('Enter a name');
  await screenCheck(page, guard, 'rename sheet error');
  await input.fill('  E2E from library ');
  await input.press('Enter');
  await expect(dlg).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rename E2E from library' })).toBeFocused();
  await screenCheck(page, guard, 'library after rename');

  // --- Analyze: rename from the results header.
  await go(page, `#/analyze/${runId}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Analyze: E2E from library' }),
  ).toBeVisible();
  const aRename = page.getByRole('button', { name: 'Rename E2E from library' });
  await aRename.click();
  const sheet = page.getByRole('dialog', { name: 'Rename experiment' });
  await sheet.getByRole('textbox', { name: 'Name' }).fill('E2E from analyze');
  await sheet.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Analyze: E2E from analyze' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename E2E from analyze' })).toBeFocused();
  await screenCheck(page, guard, 'analyze after rename');
  await shot('rename-analyze');

  // --- after a reload the new name is everywhere, and the ids did not change.
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Analyze: E2E from analyze' }),
  ).toBeVisible();
  await go(page, '#/');
  await expect(page.getByRole('list', { name: 'Recent runs' })).toContainText('E2E from analyze');
  await expect(page.getByRole('list', { name: 'Recent definitions' })).toContainText(
    'E2E from analyze',
  );
  await expect(page.getByText('E2E original')).toHaveCount(0);
  await screenCheck(page, guard, 'home');
  await go(page, '#/library?tab=definitions');
  await expect(page.getByRole('list', { name: 'Saved definitions' })).toContainText(
    'E2E from analyze',
  );
  await expect(
    page.locator('li.lib-row', { hasText: 'E2E from analyze' }).locator('a.row-link'),
  ).toHaveAttribute('href', new RegExp(`define/${definitionId}`));
  await go(page, '#/library?tab=runs');
  await expect(page.getByRole('list', { name: 'Runs' })).toContainText('E2E from analyze');
  await go(page, `#/define/${definitionId}`);
  await expect(page.getByLabel('Experiment name')).toHaveValue('E2E from analyze');
  await screenCheck(page, guard, 'define');
  // Define renames the saved definition in place too (Enter in the name field).
  await page.getByLabel('Experiment name').fill('E2E from define');
  await page.getByLabel('Experiment name').press('Enter');
  await go(page, '#/library?tab=definitions');
  await expect(page.getByRole('list', { name: 'Saved definitions' })).toContainText(
    'E2E from define',
  );
  await go(page, `#/define/${definitionId}`);
  await go(page, `#/analyze/${runId}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Analyze: E2E from define' }),
  ).toBeVisible();
  expect(runId.startsWith(definitionId!.slice(0, 16))).toBe(true);
});
