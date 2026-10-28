// Perf placeholder (WP0): proves the `perf` project runs and the worker answers. The integration WP
// replaces this with the reference-run budget test (harness-data-analysis.md §14.2) using
// PERF_BUDGET_MS (default 20000 locally; CI sets 60000).
import { expect, test } from '@playwright/test';

test('perf project loads the app and the worker pings', async ({ page }) => {
  await page.goto('./?e2e#/settings/benchmark');
  await expect(page.locator('h1')).toBeVisible();
  const pong = await page.evaluate<string>('window.__spinner.ping()');
  expect(pong).toBe('pong');
});
