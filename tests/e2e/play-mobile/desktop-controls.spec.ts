// S6 (docs/testing/play-mobile.md): on desktop the action bar sits directly under the board, in
// the left column and left of the Stats panel, and does not move as the session grows.
import { expect, test } from '@playwright/test';
import { fmt, gotoPlay, mustRect } from './helpers';

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];
const SPINS = 300;

test.describe('S6 desktop controls', () => {
  for (const size of SIZES) {
    test(`${size.width}x${size.height}: bar under the board and static over ${SPINS} spins`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'desktop project only');
      test.setTimeout(240_000);
      await page.setViewportSize(size);
      await gotoPlay(page);

      // Placement: inside the board column, left of Stats, close under the table card.
      const bar = await mustRect(page, '.play-bar');
      const table = await mustRect(page, '.play-table');
      const side = await mustRect(page, '.play-side');
      const where = `bar ${fmt(bar)} table ${fmt(table)} stats ${fmt(side)}`;
      expect(bar.left, where).toBeGreaterThanOrEqual(table.left - 1);
      expect(bar.right, where).toBeLessThanOrEqual(table.right + 1);
      expect(bar.right, where).toBeLessThanOrEqual(side.left);
      expect(bar.top, where).toBeGreaterThanOrEqual(table.bottom - 1);
      expect(bar.top - table.bottom, where).toBeLessThanOrEqual(24);

      // A session: $25 on Red, then Rebet + Space, with the Stats panel visible.
      await page.getByRole('radio', { name: /25/ }).first().click();
      await page.locator('.play-board [aria-label^="Red"]').first().click();
      await expect(page.locator('#play-stats-body')).toBeVisible();
      await page.evaluate('window.scrollTo(0, 0)');
      const before = await mustRect(page, '.play-bar');
      const scrollBefore = await page.evaluate<number>('window.scrollY');

      await page.keyboard.press('Space');
      for (let i = 1; i < SPINS; i++) {
        await page.keyboard.press('r');
        await page.keyboard.press('Space');
      }
      await expect(page.getByText(`Spin ${SPINS}`).first()).toBeVisible();

      const after = await mustRect(page, '.play-bar');
      const scrollAfter = await page.evaluate<number>('window.scrollY');
      const label = `before ${fmt(before)} after ${fmt(after)}`;
      expect(Math.abs(after.top - before.top), label).toBeLessThanOrEqual(1);
      expect(Math.abs(after.left - before.left), label).toBeLessThanOrEqual(1);
      expect(Math.abs(after.width - before.width), label).toBeLessThanOrEqual(1);
      expect(Math.abs(after.height - before.height), label).toBeLessThanOrEqual(1);
      expect(scrollAfter, `scrollY ${scrollBefore} -> ${scrollAfter}`).toBe(scrollBefore);
      await page.screenshot({ path: `test-results/desktop-${size.width}-after-${SPINS}.png` });
    });
  }
});
