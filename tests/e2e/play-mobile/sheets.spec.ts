// S5 (docs/testing/play-mobile.md): the Play sheets (Layouts, More, Session, Save as layout) fit
// the phone viewport and scroll internally; closing one restores the page scroll and the action
// bar; in landscape Spin, Rebet and x2 stay reachable without page zoom.
import { expect, test, type Page } from '@playwright/test';
import { gotoPlay, LANDSCAPE, mustRect, VIEWPORTS, fmt, type Rect } from './helpers';

test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name !== 'phone', 'phone viewports only');
});

interface SheetCase {
  name: string;
  open: (page: Page) => Promise<void>;
  dialog: string;
  needsBet?: boolean;
}

const SHEETS: SheetCase[] = [
  {
    name: 'Layouts',
    dialog: 'Place a layout',
    open: async (page) => {
      await page.getByRole('button', { name: 'Layouts', exact: true }).tap();
    },
  },
  {
    name: 'More',
    dialog: 'Play',
    open: async (page) => {
      await page.getByRole('button', { name: 'More play actions' }).tap();
    },
  },
  {
    name: 'Session',
    dialog: 'Session',
    open: async (page) => {
      await page.getByRole('button', { name: 'More play actions' }).tap();
      await page.getByRole('button', { name: /^Session:/ }).tap();
    },
  },
  {
    name: 'Save as layout',
    dialog: 'Save as layout',
    needsBet: true,
    open: async (page) => {
      await page.getByRole('button', { name: 'More play actions' }).tap();
      await page.getByRole('button', { name: 'Save bets as layout' }).tap();
    },
  },
];

async function placeBet(page: Page): Promise<void> {
  await page.getByRole('radio', { name: /25/ }).first().tap();
  await page.locator('.play-board [aria-label^="Red"]').first().tap();
  await expect(page.getByRole('button', { name: 'Clear' })).toBeEnabled();
}

const scale = (page: Page): Promise<number> =>
  page.evaluate(() => window.visualViewport?.scale ?? 1);

for (const size of VIEWPORTS) {
  test.describe(`S5 sheets ${size.name} ${size.width}x${size.height}`, () => {
    for (const sheet of SHEETS) {
      test(`${sheet.name} sheet fits and scrolls internally`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await gotoPlay(page);
        if (sheet.needsBet) await placeBet(page);
        await sheet.open(page);
        const dlg = page.getByRole('dialog', { name: sheet.dialog, exact: true });
        await expect(dlg).toBeVisible();

        const info = await dlg.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const head = el.querySelector('.sheet-head button')!.getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            height: r.height,
            scrollH: el.scrollHeight,
            clientH: el.clientHeight,
            overflowY: cs.overflowY,
            closeTop: head.top,
            closeBottom: head.bottom,
            vw: document.documentElement.clientWidth,
            vh: window.innerHeight,
            docW: document.documentElement.scrollWidth,
          };
        });
        const where = `${info.top.toFixed(0)}-${info.bottom.toFixed(0)} in ${size.height}`;
        expect(info.top, `sheet top on screen (${where})`).toBeGreaterThanOrEqual(0);
        expect(info.bottom, `sheet bottom on screen (${where})`).toBeLessThanOrEqual(info.vh + 1);
        expect(info.left).toBeGreaterThanOrEqual(-1);
        expect(info.right).toBeLessThanOrEqual(info.vw + 1);
        expect(info.docW, 'no horizontal overflow with the sheet open').toBeLessThanOrEqual(
          info.vw,
        );
        // The Close button is always on screen, so the sheet can be dismissed without zooming.
        expect(info.closeTop).toBeGreaterThanOrEqual(0);
        expect(info.closeBottom).toBeLessThanOrEqual(info.vh + 1);
        // Content taller than the sheet scrolls inside it, never the page behind.
        if (info.scrollH > info.clientH + 1) {
          expect(['auto', 'scroll']).toContain(info.overflowY);
        }
        expect(await scale(page), 'no page zoom').toBe(1);
      });

      test(`${sheet.name} sheet: closing restores scrollY and the bar`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await gotoPlay(page);
        if (sheet.needsBet) await placeBet(page);
        // Scroll the page a little when it can scroll at all.
        await page.evaluate(() => {
          const max = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo(0, Math.min(60, Math.max(0, max)));
        });
        const y0 = await page.evaluate(() => window.scrollY);
        const bar0 = await mustRect(page, '.play-bar');
        const board0 = await mustRect(page, '.play-board');

        await sheet.open(page);
        await expect(page.getByRole('dialog', { name: sheet.dialog, exact: true })).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'Close' }).tap();
        await expect(page.getByRole('dialog')).toHaveCount(0);

        const y1 = await page.evaluate(() => window.scrollY);
        const bar1 = await mustRect(page, '.play-bar');
        const board1 = await mustRect(page, '.play-board');
        expect(y1, 'scrollY after closing').toBe(y0);
        const same = (a: Rect, b: Rect) =>
          Math.abs(a.top - b.top) <= 1 && Math.abs(a.left - b.left) <= 1;
        expect(same(bar1, bar0), `bar ${fmt(bar0)} -> ${fmt(bar1)}`).toBe(true);
        expect(same(board1, board0), `board ${fmt(board0)} -> ${fmt(board1)}`).toBe(true);
        expect(await scale(page), 'no page zoom').toBe(1);
      });
    }
  });
}

test.describe(`S5 landscape ${LANDSCAPE.width}x${LANDSCAPE.height}`, () => {
  test('Spin, Rebet and x2 are reachable without page zoom', async ({ page }) => {
    await page.setViewportSize({ width: LANDSCAPE.width, height: LANDSCAPE.height });
    await gotoPlay(page);
    await placeBet(page);
    await page.getByRole('toolbar').getByRole('button', { name: 'Spin', exact: true }).tap();
    // Wait for the result so Rebet becomes available.
    await expect(page.getByRole('button', { name: /^Rebet \$/ })).toBeEnabled();
    await placeBet(page);

    for (const name of [/^Rebet/, 'Double bets', /^Spin$|^Rebet & spin$/]) {
      const b = page.getByRole('toolbar').getByRole('button', { name });
      await expect(b).toBeEnabled();
      await b.scrollIntoViewIfNeeded();
      const r = await b.evaluate((el) => {
        const q = el.getBoundingClientRect();
        const hit = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
        return {
          top: q.top,
          bottom: q.bottom,
          left: q.left,
          right: q.right,
          hitIsSelf: hit === el || el.contains(hit),
          hit: String(hit?.className ?? 'none'),
          vw: document.documentElement.clientWidth,
          vh: window.innerHeight,
        };
      });
      const label = String(name);
      expect(r.hitIsSelf, `${label} covered by ${r.hit}`).toBe(true);
      expect(r.top, `${label} top`).toBeGreaterThanOrEqual(0);
      expect(r.bottom, `${label} bottom`).toBeLessThanOrEqual(r.vh + 1);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(r.vw + 1);
      expect(await scale(page), `${label}: no page zoom`).toBe(1);
    }
    // And all three actually work with a plain tap.
    const toolbar = page.getByRole('toolbar');
    await toolbar.getByRole('button', { name: 'Double bets' }).tap();
    await toolbar.getByRole('button', { name: /^Spin$|^Rebet & spin$/ }).tap();
    expect(await scale(page)).toBe(1);
  });

  test('a Layouts sheet in landscape keeps Close on screen', async ({ page }) => {
    await page.setViewportSize({ width: LANDSCAPE.width, height: LANDSCAPE.height });
    await gotoPlay(page);
    await page.getByRole('button', { name: 'Layouts', exact: true }).tap();
    const dlg = page.getByRole('dialog', { name: 'Place a layout', exact: true });
    await expect(dlg).toBeVisible();
    const close = await dlg.getByRole('button', { name: 'Close' }).boundingBox();
    expect(close).not.toBeNull();
    expect(close!.y).toBeGreaterThanOrEqual(0);
    expect(close!.y + close!.height).toBeLessThanOrEqual(LANDSCAPE.height + 1);
  });
});
