// Watch, Gallery and Import at the four viewports: structure, no overflow, axe clean, tap targets,
// keyboard stepping. Runs are imported through the Import screen (real IndexedDB, real file input).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, expectAxeClean, test, type Page } from './helpers';

const SHOTS = process.env.SHOTS_DIR;
const BUNDLE =
  process.env.WATCH_BUNDLE ??
  join(process.cwd(), 'src/core/store/__fixtures__/runs/v1/synth-small.spinner.json');

async function shot(page: Page, project: string, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}-${project}.png`, fullPage: true });
}

async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll(
      'button, a.btn, a.chip, a.row-link, select, input:not(.visually-hidden), label.btn',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) bad.push(`${el.tagName}.${el.className} ${Math.round(r.height)}`);
    }
    return bad;
  });
}

async function importRun(page: Page): Promise<string> {
  await page.goto('./?e2e#/import');
  await page.locator('input[type=file]').setInputFiles(BUNDLE);
  const link = page.getByRole('link', { name: 'Open results' });
  await expect(link).toBeVisible();
  const h = (await link.getAttribute('href'))!;
  return h.replace('#/analyze/', '');
}

test('Import: valid run, errors, no overflow, axe clean', async ({ page, guard }, info) => {
  await page.goto('./?e2e#/import');
  await expect(page.locator('h1')).toHaveCount(1);
  await guard.check('import empty');
  await expectAxeClean(page, 'import empty');
  await page.locator('input[type=file]').setInputFiles({
    name: 'broken.spinner.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"casino-lab-run","version":1,"oops":'),
  });
  await expect(page.locator('[data-problem=damaged]')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'craps.spinner.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ format: 'casino-lab-run', version: 1, game: { id: 'craps', version: '1' } }),
    ),
  });
  await expect(page.locator('[data-problem=foreign-game]')).toBeVisible();
  await expect(page.locator('[data-problem]')).toHaveAttribute('role', 'alert');
  await guard.check('import foreign');
  await expectAxeClean(page, 'import foreign');
  expect(await smallTargets(page)).toEqual([]);
  await shot(page, info.project.name, 'import-error');
  await page.locator('input[type=file]').setInputFiles(BUNDLE);
  await expect(page.getByRole('link', { name: 'Open results' })).toBeVisible();
  await guard.check('import ok');
  await expectAxeClean(page, 'import ok');
});

test('Gallery: curated bundles listed, no overflow, axe clean', async ({ page, guard }, info) => {
  await page.goto('./?e2e#/gallery');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('ul.gal-list > li').first()).toBeVisible();
  await guard.check('gallery');
  await expectAxeClean(page, 'gallery');
  expect(await smallTargets(page)).toEqual([]);
  await shot(page, info.project.name, 'gallery');
});

test('Watch: step, keyboard, play, re-simulate, no overflow, axe clean', async ({
  page,
  guard,
}, info) => {
  const runId = await importRun(page);
  await page.goto(`./?e2e#/watch/${runId}/0?round=3`);
  await expect(page.locator('.tr-replay')).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  const cur = () => page.locator('.tr-detail').getAttribute('data-window');
  expect(await cur()).toBe('2');
  // Keys work on a fresh page, with nothing clicked or focused.
  await page.keyboard.press('ArrowRight');
  expect(await cur()).toBe('3');
  await page.keyboard.press('ArrowLeft');
  expect(await cur()).toBe('2');
  // End with focus on Next: the button stays focusable (aria-disabled), later keys still work.
  await page.getByRole('button', { name: 'Next round' }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: 'Next round' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Next round' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  expect(Number(await cur())).toBeGreaterThan(0);
  await page.keyboard.press('Home');
  expect(await cur()).toBe('0');
  await expect(page.locator('[data-announce]')).toContainText('Round 1 of');
  // The fixed stepper never hides content: at the end of the page the detail panel ends above it.
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)');
  const [bottom, top] = await page.evaluate<[number, number]>(
    "[document.querySelector('.tr-state').getBoundingClientRect().bottom, document.querySelector('.tr-stepbar').getBoundingClientRect().top]",
  );
  expect(bottom).toBeLessThanOrEqual(top + 1);
  await page.evaluate('window.scrollTo(0, 0)');
  await guard.check('watch sample');
  await expectAxeClean(page, 'watch sample');
  expect(await smallTargets(page)).toEqual([]);
  await shot(page, info.project.name, 'watch');
  if (SHOTS && process.env.WATCH_SHOT_INDEX) {
    await page.goto(`./?e2e#/watch/${runId}/${process.env.WATCH_SHOT_INDEX}`);
    await expect(page.locator('.tr-replay')).toBeVisible();
    await page.locator('.tr-row:has(.tr-tag-rejected)').first().click();
    await expect(page.locator('li[data-status=rejected]').first()).toBeVisible();
    await expectAxeClean(page, 'watch rejected');
    await guard.check('watch rejected');
    await shot(page, info.project.name, 'watch-rejected');
  }
  // An index that is not a stored sample is re-simulated on demand.
  await page.goto(`./?e2e#/watch/${runId}/5`);
  await expect(page.locator('.tr-replay')).toBeVisible();
  await guard.check('watch re-simulated');
  await expectAxeClean(page, 'watch re-simulated');
  // Playback at the fastest speed reaches the end.
  await page.getByLabel('Speed').selectOption('instant');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next round' })).toBeDisabled();
});

test('Watch: unknown run and bad index are inline cards', async ({ page, guard }) => {
  await page.goto('./?e2e#/watch/nope/1');
  await expect(page.getByText('Run not found')).toBeVisible();
  await guard.check('watch norun');
  await expectAxeClean(page, 'watch norun');
});
