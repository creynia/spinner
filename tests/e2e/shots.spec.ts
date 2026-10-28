// Screenshots for the README and review, from REAL runs (no mock data). Not part of the normal
// suite: `SHOTS=<dir> PORT=<p> npx playwright test shots --project=phone --project=desktop`.
// Light at 390x844 and 1280x800, plus dark at 390.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './helpers';

const DIR = process.env.SHOTS;
test.skip(!DIR, 'screenshots only (set SHOTS=<dir>)');

interface Start {
  name: string;
  strategy?: 'flat' | 'martingale';
  sessions: number;
  maxRounds: number;
  seed?: number;
}
const go = (page: Page, hash: string) => page.evaluate((h) => void (location.hash = h), hash);

async function startRun(page: Page, o: Start, wait = true): Promise<string> {
  const id = await page.evaluate((x) => window.__results.start(x), o);
  await go(page, `#/run/${id}`);
  if (wait) await expect(page.locator('[data-status=done]')).toBeVisible({ timeout: 240_000 });
  return id;
}

for (const scheme of ['light', 'dark'] as const) {
  test(`screenshots ${scheme}`, async ({ page }, info) => {
    test.skip(scheme === 'dark' && info.project.name !== 'phone', 'dark only at 390');
    test.skip(!['phone', 'desktop'].includes(info.project.name), 'phone and desktop only');
    test.setTimeout(600_000);
    mkdirSync(DIR!, { recursive: true });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const size = info.project.name === 'phone' ? '390' : '1280';
    const shot = async (name: string) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${DIR}/${name}-${size}-${scheme}.png`, fullPage: true });
    };

    await page.goto('./?e2e#/');
    await page.waitForFunction('window.__results !== undefined');
    const flat = await startRun(page, {
      name: 'Flat on red',
      strategy: 'flat',
      sessions: 10_000,
      maxRounds: 500,
      seed: 2026,
    });
    const mart = await startRun(page, {
      name: 'Martingale on red',
      strategy: 'martingale',
      sessions: 10_000,
      maxRounds: 500,
      seed: 2026,
    });

    await go(page, '#/');
    await expect(page.locator('.row-sub').first()).toContainText('P(ahead)');
    await shot('home');

    await go(page, '#/define?preset=james-bond');
    await expect(page.locator('li.bstage').first()).toBeVisible();
    await shot('define');

    // Run mid-run
    const live = await startRun(
      page,
      { name: 'Martingale, long run', strategy: 'martingale', sessions: 150_000, maxRounds: 500 },
      false,
    );
    await expect(page.locator('.live-panel svg').first()).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      const v = await page.locator('[role=progressbar]').getAttribute('aria-valuenow');
      expect(Number(v)).toBeGreaterThan(5);
    }).toPass({ timeout: 120_000 });
    await shot('run');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[data-status=cancelled]')).toBeVisible({ timeout: 30_000 });
    void live;

    for (const tab of ['overview', 'paths', 'risk']) {
      await go(page, `#/analyze/${mart}?tab=${tab}`);
      await expect(page.locator('[data-verdict]').or(page.locator('svg').first())).toBeVisible();
      await shot(`analyze-${tab}`);
    }

    await go(page, `#/analyze/${mart}?tab=sessions`);
    await page.locator('a.session-link').first().click();
    await expect(page.locator('.tr-replay')).toBeVisible();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next round' }).click();
    await shot('watch');

    await go(page, `#/compare?runs=${flat},${mart}`);
    await expect(page.locator('[data-method=paired]')).toBeVisible();
    await shot('compare');

    await go(page, '#/gallery');
    await expect(page.locator('h1')).toBeVisible();
    await shot('gallery');
  });
}
