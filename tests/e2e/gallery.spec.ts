// Gallery with the committed curated bundles: the build's gallery/index.json lists them with
// headline numbers, the screen shows them, and one opens read-only on Analyze (marked imported).
import { expect, screenCheck, test } from './helpers';

interface Index {
  entries: { slug: string; title: string; sessions: number; maxRounds: number; bytes: number }[];
}

test('the gallery lists the curated bundles and opens one', async ({ page, guard, request }) => {
  const res = await request.get('./gallery/index.json');
  expect(res.ok()).toBe(true);
  const index = (await res.json()) as Index;
  expect(index.entries.length).toBeGreaterThanOrEqual(4);
  for (const e of index.entries) {
    expect(e.sessions).toBe(10_000);
    expect(e.maxRounds).toBe(500);
    expect(e.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  }

  await page.goto('./?e2e#/gallery');
  await expect(page.locator('ul.gal-list > li')).toHaveCount(index.entries.length);
  await expect(page.locator('ul.gal-list > li').first()).toContainText('Chance of finishing ahead');
  await screenCheck(page, guard, 'gallery');

  await page.getByRole('button', { name: `Open ${index.entries[0]!.title}` }).click();
  await expect(page).toHaveURL(/#\/analyze\//, { timeout: 30_000 });
  await expect(page.locator('[data-verdict]')).toBeVisible();
  await expect(page.locator('[data-imported]')).toContainText('imported');
  await screenCheck(page, guard, 'gallery bundle on analyze');
});
