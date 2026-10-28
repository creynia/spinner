// Reload mid-run -> Resume -> completes with the same resultsDigest as an uninterrupted run of the
// same definition and seed. Each run lives in its own browser context (its own IndexedDB), and the
// digest is read from the exported run file.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Browser, TestInfo } from '@playwright/test';
import { expect, test, type Page } from './helpers';

const OPTS = {
  name: 'Resume check',
  strategy: 'martingale',
  sessions: 100_000,
  maxRounds: 200,
  seed: 77,
} as const;

async function digestOf(page: Page, runId: string): Promise<string> {
  await page.evaluate((id) => void (location.hash = `#/analyze/${id}?tab=export`), runId);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download run file' }).click();
  const file = await (await dl).path();
  const b = JSON.parse(gunzipSync(readFileSync(file)).toString()) as {
    meta: { resultsDigest: string; sessions: number };
  };
  expect(b.meta.sessions).toBe(OPTS.sessions);
  return b.meta.resultsDigest;
}

async function fresh(browser: Browser, info: TestInfo): Promise<Page> {
  const ctx = await browser.newContext({ ...info.project.use });
  const page = await ctx.newPage();
  await page.goto('./?e2e#/');
  await page.waitForFunction('window.__results !== undefined');
  return page;
}

test('a run reloaded mid-way and resumed has the same digest as an uninterrupted one', async ({
  browser,
}, info) => {
  test.setTimeout(480_000);

  const a = await fresh(browser, info);
  const idA = await a.evaluate((o) => window.__results.start(o), OPTS);
  await a.evaluate((id) => void (location.hash = `#/run/${id}`), idA);
  await expect(a.locator('[data-status=done]')).toBeVisible({ timeout: 300_000 });
  const whole = await digestOf(a, idA);
  await a.context().close();

  const b = await fresh(browser, info);
  const idB = await b.evaluate((o) => window.__results.start(o), OPTS);
  await b.evaluate((id) => void (location.hash = `#/run/${id}`), idB);
  await expect(async () => {
    const v = await b.locator('[role=progressbar]').getAttribute('aria-valuenow');
    expect(Number(v)).toBeGreaterThan(0);
  }).toPass({ timeout: 120_000 });
  await b.reload();
  await expect(b.locator('[data-warning=interrupted]')).toBeVisible({ timeout: 60_000 });
  await b.getByRole('button', { name: 'Resume' }).click();
  await expect(b.locator('[data-status=done]')).toBeVisible({ timeout: 300_000 });
  const resumed = await digestOf(b, idB);
  await b.context().close();

  expect(resumed).toBe(whole);
});
