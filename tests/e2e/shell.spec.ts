// app-shell screens (Home, Settings, More, NotFound) at the four viewports: structure, no overflow,
// axe clean, tap targets, theme, framing persistence, disclaimer placement, storage banner.
import { mkdirSync } from 'node:fs';
import { expect, expectAxeClean, test } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

for (const route of ['#/', '#/settings', '#/more', '#/research', '#/nope']) {
  test(`${route}: one h1, no overflow, axe clean, tap targets >= 44px`, async ({
    page,
    guard,
  }, info) => {
    await page.goto(`./?e2e${route}`);
    await expect(page.locator('h1')).toHaveCount(1);
    await guard.check(route);
    await expectAxeClean(page, route);
    const small = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll(
        'button, a, a.btn, a.chip, a.row-link, [role=tab], select, input:not(.visually-hidden)',
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 43.5) bad.push(`${el.tagName}.${el.className} ${Math.round(r.height)}`);
      }
      return bad;
    });
    expect(small).toEqual([]);
    if (SHOTS && (route === '#/' || route === '#/settings')) {
      mkdirSync(SHOTS, { recursive: true });
      const kind = info.project.name === 'desktop' ? 'desktop' : info.project.name;
      await page.screenshot({
        path: `${SHOTS}/${route === '#/' ? 'home' : 'settings'}-${kind}.png`,
        fullPage: true,
      });
    }
  });
}

test('Home: empty states, primary actions, presets; no disclaimer', async ({ page }) => {
  await page.goto('./?e2e#/');
  await expect(page.getByRole('link', { name: 'New experiment' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import' }).first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Strategy presets' }).getByRole('link')).toHaveCount(
    12,
  );
  await expect(page.getByText('No runs yet')).toBeVisible();
  await expect(page.getByText('house edge')).toHaveCount(0);
  await page.getByRole('link', { name: 'Flat: red' }).click();
  await expect(page).toHaveURL(/#\/define\?preset=flat-red$/);
});

test('Settings: theme applies and persists; framing persists; disclaimer shown', async ({
  page,
  guard,
}) => {
  await page.goto('./?e2e#/settings');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectAxeClean(page, 'dark settings');
  await page.getByRole('radio', { name: 'Per hour' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: 'Per hour' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('#about')).toContainText('Every roulette bet has a house edge');
  await guard.check('settings');
});

test('Settings: delete-all asks for confirmation in a dialog', async ({ page }) => {
  await page.goto('./?e2e#/settings');
  await page.getByRole('button', { name: 'Delete everything on this device' }).click();
  const dlg = page.getByRole('dialog', { name: 'Delete everything on this device?' });
  await expect(dlg).toBeVisible();
  await expectAxeClean(page, 'dialog');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});

test('reduced motion disables transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?e2e#/settings');
  const d = await page
    .locator('.toggle-thumb, .seg')
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(['0s', '0.000001s', '1e-06s']).toContain(d);
});
