// WP0 smoke (architecture.md §12.1): every route renders one h1, a real module worker answers
// `ping` under /spinner/, no horizontal overflow, no console errors, axe clean. Runs on all four
// projects (phone-360, phone, phone-landscape, desktop). Navigation is relative to the base URL
// (`./?e2e#/...`) so an absolute-URL bug fails here, not on Pages. `?e2e` installs the test hook in
// the production build (architecture.md §6.7).
import { expect, expectAxeClean, pingWorker, test } from './helpers';

/** Every address of architecture.md §6.2 plus the benchmark route and a NotFound. */
const ROUTES = [
  '#/',
  '#/define',
  '#/define/abc123',
  '#/define?d=xyz',
  '#/run/r1',
  '#/analyze/r1?tab=risk',
  '#/watch/r1/4?round=2',
  '#/compare?runs=a,b',
  '#/sweep/g1',
  '#/library?tab=runs',
  '#/gallery',
  '#/gallery/b1',
  '#/import',
  '#/settings',
  '#/settings/benchmark',
  '#/more',
  '#/no/such/page',
];

for (const route of ROUTES) {
  test(`${route} renders an h1, no overflow, axe clean`, async ({ page, guard }) => {
    await page.goto(`./?e2e${route}`);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page).toHaveTitle(/\| spinner$/);
    await guard.check(route);
    await expectAxeClean(page, route);
  });
}

test('a real module worker answers ping with pong under /spinner/', async ({ page, guard }) => {
  await page.goto('./?e2e#/');
  await expect(page.locator('h1')).toBeVisible();
  expect(await pingWorker(page)).toBe('pong');
  expect(new URL(page.url()).pathname).toBe('/spinner/');
  await guard.check('after ping');
});

test('navigation works: phone tab bar or desktop rail reaches Define', async ({ page, guard }) => {
  await page.goto('./?e2e#/');
  const nav = page.getByRole('navigation').getByRole('link', { name: 'Define' });
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page).toHaveURL(/#\/define$/);
  await expect(page.locator('h1')).toHaveText('Define');
  await guard.check('define');
});

test('tap targets in the navigation are at least 44px', async ({ page }) => {
  await page.goto('./?e2e#/');
  const links = page.getByRole('navigation').getByRole('link');
  const count = await links.count();
  expect(count).toBe(4);
  for (let i = 0; i < count; i++) {
    const box = await links.nth(i).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
});
