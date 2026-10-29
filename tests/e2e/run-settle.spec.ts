// Regression: a quick run can finish between the Run screen's first render and its subscribe to the
// controller. The screen must still reach Done (it used to stay on "Running 100%" about 15% of the time).
// RUN_SETTLE_N raises the count for a soak (default 5 keeps CI quick).
import { expect, test } from './helpers';

const N = Number(process.env.RUN_SETTLE_N ?? 5);

test(`${N} quick 30-session runs each reach Done on the Run screen`, async ({ page }) => {
  test.setTimeout(60_000 + N * 15_000);
  await page.goto('./?e2e#/');
  await page.waitForFunction('window.__results !== undefined');
  const stuck: number[] = [];
  for (let i = 0; i < N; i++) {
    // Navigate in the same task as the start, so the Run screen mounts while the run is mid-flight.
    await page.evaluate(async (seed) => {
      const id = await window.__results.start({
        name: `Settle ${seed}`,
        strategy: 'martingale',
        sessions: 30,
        maxRounds: 50,
        seed,
      });
      location.hash = `#/run/${id}`;
    }, 1000 + i);
    try {
      await expect(page.locator('[data-status=done]')).toBeVisible({ timeout: 10_000 });
    } catch {
      stuck.push(i);
    }
    // Leave the screen so the next run mounts a fresh Run screen (first render, then effects).
    await page.evaluate(() => void (location.hash = '#/'));
    await expect(page.locator('h1')).toHaveText('spinner');
  }
  expect(stuck, 'runs stuck short of Done').toEqual([]);
});
