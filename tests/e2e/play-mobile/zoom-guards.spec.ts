// S3: zoom guards on the Play screen (docs/testing/play-mobile.md).
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, gotoPlay } from './helpers';

const INTERACTIVE =
  'button, a[href], [role=button], [role=radio], [role=tab], [role=switch], [role=checkbox], [role=slider], ' +
  'input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), .rl-cell, [data-bet]';
const TEXT_FIELDS =
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea';

/** Elements under `root` that are interactive but whose computed touch-action is not `manipulation`. */
async function badTouchAction(page: Page, root: string): Promise<string[]> {
  return page.evaluate(
    ([rootSel, sel]) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll(`${rootSel} :is(${sel}), ${rootSel}:is(${sel})`)) {
        // The effective touch-action is the intersection along the ancestor chain, so a parent that
        // sets manipulation also covers its children (e.g. SVG cells inside the board).
        let ta = 'auto';
        for (let p: Element | null = el; p; p = p.parentElement) {
          const v = getComputedStyle(p).touchAction;
          if (v === 'manipulation' || v === 'none') {
            ta = v;
            break;
          }
        }
        if (ta !== 'manipulation' && ta !== 'none') {
          const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20);
          out.push(
            `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '')} "${label}" touch-action:${ta}`,
          );
        }
      }
      return out;
    },
    [root, INTERACTIVE],
  );
}

async function smallFields(page: Page, root: string): Promise<string[]> {
  return page.evaluate(
    ([rootSel, sel]) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll(`${rootSel} :is(${sel})`)) {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) {
          out.push(
            `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '')} font-size:${fs}px`,
          );
        }
      }
      return out;
    },
    [root, TEXT_FIELDS],
  );
}

async function tooWide(page: Page, root: string, vw: number): Promise<string[]> {
  return page.evaluate(
    ([rootSel, w]) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll(`${rootSel}, ${rootSel} *`)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.width > (w as number) + 1) {
          out.push(
            `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '')} width ${r.width.toFixed(0)}`,
          );
        }
      }
      return out.slice(0, 8);
    },
    [root, vw],
  );
}

test.beforeEach(({ browserName }, testInfo) => {
  void browserName;
  test.skip(testInfo.project.name !== 'phone', 'portrait phone sizes loop inside');
});

test('viewport meta is width=device-width, initial-scale=1 and does not allow scaling away', async ({
  page,
}) => {
  await gotoPlay(page);
  const content = await page.locator('meta[name=viewport]').getAttribute('content');
  const parts = (content ?? '').split(',').map((p) => p.trim().replace(/\s+/g, ''));
  expect(parts).toContain('width=device-width');
  expect(parts).toContain('initial-scale=1');
  expect(content ?? '').not.toMatch(/maximum-scale\s*=\s*(?!1\b)[0-9.]+/);
});

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoPlay(page);
    });

    test('Play screen interactive elements use touch-action: manipulation', async ({ page }) => {
      expect(await page.locator('.play button').count(), 'play buttons rendered').toBeGreaterThan(
        5,
      );
      expect(await badTouchAction(page, '.play')).toEqual([]);
    });

    test('bottom tab bar links use touch-action: manipulation', async ({ page }) => {
      expect(await badTouchAction(page, '.tabbar')).toEqual([]);
    });

    test('nothing in Play is wider than the viewport', async ({ page }) => {
      expect(await tooWide(page, '.play', vp.width)).toEqual([]);
    });

    test('rapid taps on Spin do not change visual viewport scale', async ({ page }) => {
      const spin = page
        .locator('.play-bar button.primary, .play-bar button:has-text("pin")')
        .last();
      await page
        .locator('.play-board .rl-chipboard')
        .click({ position: { x: 20, y: 20 }, force: true });
      for (let i = 0; i < 4; i++) await spin.dispatchEvent('click');
      expect(await page.evaluate('window.visualViewport.scale')).toBe(1);
    });

    for (const sheet of ['Session options', 'More play actions', 'Layouts']) {
      test(`${sheet} sheet: touch-action and 16px fields`, async ({ page }) => {
        const trigger =
          sheet === 'More play actions'
            ? page.getByRole('button', { name: sheet })
            : page.getByRole('button', { name: sheet, exact: false }).first();
        if (sheet === 'Session options') {
          await page.getByRole('button', { name: 'More play actions' }).click();
          await page.getByRole('button', { name: /^Session/ }).click();
        } else {
          await trigger.click();
        }
        await page.locator('.sheet').waitFor();
        expect.soft(await badTouchAction(page, '.sheet')).toEqual([]);
        expect.soft(await smallFields(page, '.sheet')).toEqual([]);
        expect.soft(await tooWide(page, '.sheet', vp.width)).toEqual([]);
      });
    }
  });
}
