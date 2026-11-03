// S1: Play fits one phone screen with nothing overlapping (docs/testing/play-mobile.md).
import { expect, test } from '@playwright/test';
import {
  VIEWPORTS,
  fmt,
  gotoPlay,
  insideViewport,
  mustRect,
  noHorizontalOverflow,
  overlaps,
  rectOf,
  type Rect,
} from './helpers';

const PARTS: Array<[string, string]> = [
  ['session strip', '.play-head'],
  ['result line', '.play-result'],
  ['board', '.play-board .rl-chipboard'],
  ['chip rack', '.chip-rack'],
  ['action bar', '.play-bar'],
];

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'phone', 'portrait phone sizes loop inside');
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoPlay(page);
    });

    test('every part is inside the viewport at scrollY 0', async ({ page }) => {
      expect(await page.evaluate('window.scrollY')).toBe(0);
      const bad: string[] = [];
      for (const [name, sel] of PARTS) {
        const r = await mustRect(page, sel);
        if (!insideViewport(r, vp.width, vp.height)) {
          bad.push(`${name} ${fmt(r)} outside ${vp.width}x${vp.height}`);
        }
      }
      expect(bad, 'parts outside the viewport').toEqual([]);
    });

    test('nothing overlaps (bar never covers board or rack)', async ({ page }) => {
      const rects: Array<[string, Rect]> = [];
      for (const [name, sel] of PARTS) rects.push([name, await mustRect(page, sel)]);
      const clashes: string[] = [];
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const [an, ar] = rects[i]!;
          const [bn, br] = rects[j]!;
          if (overlaps(ar, br)) clashes.push(`${an} ${fmt(ar)} overlaps ${bn} ${fmt(br)}`);
        }
      }
      expect(clashes, 'overlapping parts').toEqual([]);
    });

    test('the app nav bar does not cover the action bar', async ({ page }) => {
      const bar = await mustRect(page, '.play-bar');
      const nav = await rectOf(page, '.tabbar');
      expect(nav, 'tab bar exists on phones').not.toBeNull();
      expect(overlaps(bar, nav!), `bar ${fmt(bar)} vs nav ${fmt(nav!)}`).toBe(false);
      const spin = await mustRect(page, '.play-spin');
      expect(overlaps(spin, nav!), `Spin ${fmt(spin)} vs nav ${fmt(nav!)}`).toBe(false);
      expect(spin.bottom, 'Spin above the viewport bottom').toBeLessThanOrEqual(vp.height + 1);
    });

    test('the Spin button is the topmost element at its centre', async ({ page }) => {
      const spin = await mustRect(page, '.play-spin');
      const hit = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x!, y!);
          return !!el?.closest('.play-spin');
        },
        [spin.left + spin.width / 2, spin.top + spin.height / 2],
      );
      expect(hit, `Spin centre ${fmt(spin)} is covered`).toBe(true);
    });

    test('no horizontal overflow', async ({ page }) => {
      await noHorizontalOverflow(page, vp.name);
    });
  });
}
