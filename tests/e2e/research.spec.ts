// Research screen (docs/design/research.md §10) at the four viewports: structure, chapter order,
// chapter links without a remount, the math toggle, deep links, the ladder calculator, "Open in
// Define", dark mode. Screenshots for the README: `SHOTS_DIR=<dir> npx playwright test research
// --project=phone --project=desktop` writes research-<size>-<scheme>.png (converted to webp by hand).
import { mkdirSync } from 'node:fs';
import { expect, screenCheck, test, type Page } from './helpers';

const CHAPTERS = [
  'start',
  'edge',
  'martingale',
  'levels',
  'placement',
  'curve',
  'shapes',
  'cashout',
  'limits',
  'try',
];
const SHOTS = process.env.SHOTS_DIR;
const URL = './?e2e#/research';

/** The chapter nav the CSS currently shows (chips on phones, the sticky column from 768px). */
const visibleNav = (page: Page) => page.locator('nav.research-nav:visible');

test('structure: one h1, ten chapters in order, each with an h2 and "The math"', async ({
  page,
  guard,
}) => {
  await page.goto(URL);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Research');
  const sections = page.locator('section.research-chapter');
  await expect(sections).toHaveCount(CHAPTERS.length);
  expect(await sections.evaluateAll((els) => els.map((e) => e.id))).toEqual(
    CHAPTERS.map((c) => `chapter-${c}`),
  );
  for (const c of CHAPTERS) {
    const s = page.locator(`#chapter-${c}`);
    await expect(s.locator('h2')).toHaveCount(1);
    await expect(s.locator('details.math > summary')).toHaveText('The math');
  }
  await screenCheck(page, guard, 'research');
});

test('tap targets are at least 44px tall', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('h1')).toBeVisible();
  const small = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll(
      'button, a, a.btn, a.chip, a.row-link, [role=tab], select, summary, input[type=range], input:not(.visually-hidden)',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) bad.push(`${el.tagName}.${el.className} ${Math.round(r.height)}`);
    }
    return bad;
  });
  expect(small).toEqual([]);
});

test('exactly one chapter nav is visible; the column is sticky', async ({ page }) => {
  await page.goto(URL);
  const wide = (page.viewportSize()?.width ?? 0) >= 768;
  await expect(visibleNav(page)).toHaveCount(1);
  await expect(visibleNav(page)).toHaveAttribute('aria-label', wide ? 'Chapter list' : 'Chapters');
  if (wide) {
    const top = () => visibleNav(page).evaluate((el) => Math.round(el.getBoundingClientRect().top));
    await page.evaluate('window.scrollTo(0, 2000)');
    // Sticky: it sticks near the top of the viewport instead of scrolling away.
    await expect.poll(top).toBeGreaterThanOrEqual(0);
    await expect.poll(top).toBeLessThan(40);
  }
});

test('a chapter link jumps without remounting the screen', async ({ page, guard }) => {
  await page.goto(URL);
  const calc = page.locator('#calc-c');
  await calc.scrollIntoViewIfNeeded();
  await calc.fill('12');
  await expect(calc).toHaveValue('12');
  const link = visibleNav(page).getByRole('link', { name: /Cash out/ });
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await expect(page).toHaveURL(/#\/research\?chapter=cashout$/);
  const h2 = page.locator('#chapter-cashout-h');
  await expect(h2).toBeFocused();
  await expect(h2).toBeInViewport();
  await expect(page.locator('#calc-c')).toHaveValue('12');
  await guard.check('after chip tap');
});

test('details.math opens and closes from the keyboard, and starts closed', async ({ page }) => {
  await page.goto(URL);
  const details = page.locator('details.math').first();
  const summary = details.locator('summary');
  await expect(details).not.toHaveAttribute('open', /.*/);
  await summary.scrollIntoViewIfNeeded();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('.math-body')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(details).not.toHaveAttribute('open', /.*/);
  await page.keyboard.press('Space');
  await expect(details).toHaveAttribute('open', '');
  await page.reload();
  await expect(page.locator('details.math[open]')).toHaveCount(0);
});

test('deep link ?chapter=cashout scrolls that chapter to the top', async ({ page, guard }) => {
  await page.goto(`${URL}?chapter=cashout`);
  const section = page.locator('#chapter-cashout');
  await expect(section).toBeInViewport();
  await expect
    .poll(() => section.evaluate((el) => Math.round(el.getBoundingClientRect().top)))
    .toBeLessThan(120);
  expect(await section.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
  await guard.check('deep link');
});

test('an unknown ?chapter= id opens at the top without errors', async ({ page, guard }) => {
  await page.goto(`${URL}?chapter=nope`);
  await expect(page.locator('h1')).toBeInViewport();
  expect(await page.evaluate('window.scrollY')).toBe(0);
  await guard.check('unknown chapter');
});

test('calculator: a result for the defaults, an error for an invalid input', async ({ page }) => {
  await page.goto(URL);
  const calc = page.getByRole('form', { name: 'Ladder calculator' });
  await calc.scrollIntoViewIfNeeded();
  const outputs = calc.locator('.research-calc-outputs');
  await expect(outputs).toContainText('Levels that fit');
  await expect(outputs).toContainText('Chance of ending ahead');
  await expect(outputs).not.toHaveAttribute('aria-disabled', 'true');
  await expect(calc.locator('.error')).toHaveCount(0);

  await page.locator('#calc-c').fill('40');
  await expect(calc.getByText('Pick 1 to 35 numbers.')).toBeVisible();
  await expect(page.locator('#calc-c')).toHaveAttribute('aria-invalid', 'true');
  // The last good result stays, greyed.
  await expect(outputs).toHaveAttribute('aria-disabled', 'true');

  await page.locator('#calc-c').fill('12');
  await expect(calc.getByText('Pick 1 to 35 numbers.')).toHaveCount(0);
  await expect(outputs).not.toHaveAttribute('aria-disabled', 'true');
});

test('"Open in Define" for the first candidate lands on a share link', async ({ page, guard }) => {
  await page.goto(URL);
  const button = page.getByRole('button', { name: /^Open in Define: / }).first();
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page).toHaveURL(/#\/define\?d=[^&]+&h=/);
  await expect(page.getByText('Loaded from a link. This is an unsaved draft.')).toBeVisible();
  await guard.check('define from share link');
});

test('dark mode: axe clean, no overflow', async ({ page, guard }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(URL);
  await expect(page.locator('h1')).toBeVisible();
  expect(await page.evaluate('getComputedStyle(document.body).backgroundColor')).not.toBe(
    'rgb(255, 255, 255)',
  );
  await screenCheck(page, guard, 'research dark');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`screenshot ${scheme}`, async ({ page }, info) => {
    test.skip(!SHOTS, 'screenshots only (set SHOTS_DIR=<dir>)');
    test.skip(!['phone', 'desktop'].includes(info.project.name), 'phone and desktop only');
    test.skip(scheme === 'dark' && info.project.name !== 'phone', 'dark only at 390');
    mkdirSync(SHOTS!, { recursive: true });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto(URL);
    await expect(page.locator('h1')).toBeVisible();
    const phone = info.project.name === 'phone';
    // The top of the page, not all ten chapters: a tall viewport instead of fullPage.
    const width = page.viewportSize()!.width;
    await page.setViewportSize({ width, height: phone ? 1900 : 1000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/research-${phone ? '390' : '1280'}-${scheme}.png` });
  });
}
