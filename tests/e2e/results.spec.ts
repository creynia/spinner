// ui-results at the four viewports with REAL runs (the app's own pool and workers): Run (live,
// pause, interrupted reload, resume), every Analyze tab, Export, Compare, Sweep. Each state: no
// horizontal overflow, no console errors, axe clean, tap targets >= 44 px.
// SHOTS_DIR=<dir> saves screenshots built from these real runs.
import { mkdirSync } from 'node:fs';
import { expect, expectAxeClean, test, type Page } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

interface StartOpts {
  name?: string;
  strategy?: 'flat' | 'martingale';
  sessions?: number;
  maxRounds?: number;
  seed?: number;
}
declare global {
  interface Window {
    __results: { start(o?: StartOpts): Promise<string> };
  }
}

async function start(page: Page, o: StartOpts): Promise<string> {
  await page.goto('./?e2e#/');
  await page.waitForFunction('window.__results !== undefined');
  return page.evaluate((x) => window.__results.start(x), o);
}
const go = (page: Page, hash: string) => page.evaluate((h) => void (location.hash = h), hash);

async function tapTargets(page: Page, state: string): Promise<void> {
  const small = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll(
      'button, a.btn, a.chip, a.row-link, a.session-link, [role=tab], select, input:not(.visually-hidden)',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) bad.push(`${el.tagName}.${el.className} ${Math.round(r.height)}`);
    }
    return bad;
  });
  expect(small, `${state}: small tap targets`).toEqual([]);
}

async function shot(page: Page, name: string, info: { project: { name: string } }): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}-${info.project.name}.png`, fullPage: true });
}

async function state(page: Page, guard: { check(s: string): Promise<void> }, label: string) {
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')]
      .filter((el) => {
        if (el.getBoundingClientRect().right <= w + 1) return false;
        // inside a component-level scroller (or visually hidden): allowed
        for (let p: Element | null = el.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (/auto|scroll|hidden/.test(cs.overflowX) || p.classList.contains('visually-hidden'))
            return false;
        }
        return true;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName}.${String(el.getAttribute('class'))}`);
  });
  expect(wide, `${label}: elements wider than the viewport`).toEqual([]);
  await guard.check(label);
  await expectAxeClean(page, label);
  await tapTargets(page, label);
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

test('a real run goes from Run to every Analyze tab', async ({ page, guard }, info) => {
  test.setTimeout(120_000);
  const runId = await start(page, { strategy: 'martingale', sessions: 3000, maxRounds: 120 });
  await go(page, `#/run/${runId}`);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('[role=progressbar]')).toBeVisible();
  await expect(page.locator('[data-status=done]')).toBeVisible({ timeout: 90_000 });
  await state(page, guard, 'run done');
  await expect(page.getByRole('link', { name: 'Analyze', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('[data-verdict]')).toBeVisible();
  for (const [id, label] of TABS) {
    await page.getByRole('tab', { name: label }).click();
    await expect(page.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
    if (id === 'overview') await expect(page.locator('[data-verdict]')).toBeVisible();
    if (id === 'sessions') await expect(page.locator('tr.session-row').first()).toBeVisible();
    await state(page, guard, `analyze ${id}`);
    await shot(page, `analyze-${id}`, info);
  }
  // Export: a real file comes back.
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'summaries.csv' }).click();
  expect((await csv).suggestedFilename()).toMatch(/\.summaries\.csv$/);
  // Sessions: a row opens Watch.
  await page.getByRole('tab', { name: 'Sessions' }).click();
  await page.locator('a.session-link').first().click();
  await expect(page).toHaveURL(/#\/watch\/.+\/\d+$/);
});

test('live run: charts update, pause, interrupted reload offers Resume', async ({
  page,
  guard,
}, info) => {
  test.setTimeout(120_000);
  const runId = await start(page, { sessions: 60_000, maxRounds: 300 });
  await go(page, `#/run/${runId}`);
  await expect(page.locator('[data-status=running]')).toBeVisible();
  await expect(async () => {
    const v = await page.locator('[role=progressbar]').getAttribute('aria-valuenow');
    expect(Number(v)).toBeGreaterThan(0);
  }).toPass({ timeout: 60_000 });
  await expect(page.locator('.live-panel svg').first()).toBeVisible({ timeout: 30_000 });
  await state(page, guard, 'run mid-run');
  await shot(page, 'run-mid', info);
  await expect(page.locator('[data-field=rate]')).toContainText('sessions/s');
  // "Time spent" moves while the run is going (it was 0 s until the first pause).
  await expect(page.locator('dt:has-text("Time spent") + dd')).not.toHaveText('0 s', {
    timeout: 15_000,
  });
  // Reload while running: the run comes back as interrupted, with Resume.
  await page.reload();
  await expect(page.locator('[data-warning=interrupted]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await state(page, guard, 'run interrupted');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('[data-status=running]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('[data-status=paused]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-status=cancelled]')).toBeVisible({ timeout: 30_000 });
  await state(page, guard, 'run cancelled');
});

test('compare two runs (paired) and sweep a setting', async ({ page, guard }) => {
  test.setTimeout(180_000);
  const a = await start(page, { name: 'Flat A', strategy: 'flat', sessions: 600, maxRounds: 60 });
  await go(page, `#/run/${a}`);
  await expect(page.locator('[data-status=done]')).toBeVisible({ timeout: 60_000 });
  const b = await page.evaluate((o) => window.__results.start(o), {
    name: 'Martingale B',
    strategy: 'martingale',
    sessions: 600,
    maxRounds: 60,
  } as StartOpts);
  await go(page, `#/run/${b}`);
  await expect(page.locator('[data-status=done]')).toBeVisible({ timeout: 60_000 });

  await go(page, `#/compare?runs=${a},${b}`);
  await expect(page.locator('[data-method=paired]')).toBeVisible();
  await expect(page.locator('[data-method-label]')).toContainText('Paired by session');
  await state(page, guard, 'compare');

  await go(page, `#/sweep/new?run=${a}`);
  await page.locator('#sw-path').selectOption('/session/maxRounds');
  await page.locator('#sw-values').fill('20, 40, 60');
  await state(page, guard, 'sweep form');
  await page.getByRole('button', { name: 'Create and run' }).click();
  await expect(page.locator('[data-sweep-progress]')).toContainText('3 of 3', { timeout: 120_000 });
  await expect(page.locator('[data-variants]')).toBeVisible();
  await state(page, guard, 'sweep done');
});
