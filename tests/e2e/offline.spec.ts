// Offline (architecture.md §8.4): load, wait for the service worker to control the page, go
// offline, reload, and the app still renders and its worker chunk is served from the cache.
import { expect, pingWorker, test } from './helpers';

test('the app loads and works offline after the first visit', async ({ page, context, guard }) => {
  await page.goto('./?e2e#/');
  await expect(page.locator('h1')).toBeVisible();

  // The first visit installs and claims; wait until the page is controlled and the cache is full.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
    }
  });
  await expect
    .poll(() =>
      page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('spinner-'))),
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).toBeVisible();
  await expect(page).toHaveTitle(/\| spinner$/);
  // A real module worker still starts: the sim.worker chunk comes from the precache.
  expect(await pingWorker(page)).toBe('pong');
  await guard.check('offline reload');

  // Another route while offline (hash routing keeps the same document).
  await page.goto('./?e2e#/settings');
  await expect(page.locator('h1')).toBeVisible();
  await context.setOffline(false);
});
