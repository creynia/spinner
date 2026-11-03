// S2 (docs/testing/play-mobile.md): 150 real taps on Play must not move the page. Across Spin,
// Rebet & spin, chip changes, bet taps, x2 and Undo: scrollY stays put, the action bar and board do
// not move, the visual viewport never zooms, nothing overflows sideways, and the Spin button is
// always what sits under its own centre (nothing covers it).
import { expect, test, type Page } from '@playwright/test';

const SIZES = [
  { name: 'phone-360', width: 360, height: 780 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'pixel-pro', width: 412, height: 915 },
  { name: 'pixel-pro-chrome', width: 412, height: 780 },
  { name: 'phone-short', width: 412, height: 700 },
];
const TAPS = 150;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Snap {
  scrollY: number;
  scale: number;
  scrollW: number;
  clientW: number;
  bar: Rect | null;
  board: Rect | null;
  spinCovered: string | null;
}

const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const rect = (el: Element | null): Rect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const spin = document.querySelector('.play-spin');
    let spinCovered: string | null = 'no Spin button';
    if (spin) {
      const r = spin.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      spinCovered =
        hit && (hit === spin || spin.contains(hit)) ? null : (hit?.className ?? 'none').toString();
    }
    return {
      scrollY: window.scrollY,
      scale: window.visualViewport?.scale ?? 1,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      bar: rect(document.querySelector('.play-bar')),
      board: rect(document.querySelector('.play-board')),
      spinCovered,
    };
  });

const moved = (a: Rect | null, b: Rect | null): boolean =>
  !a ||
  !b ||
  Math.abs(a.x - b.x) > 1 ||
  Math.abs(a.y - b.y) > 1 ||
  Math.abs(a.w - b.w) > 1 ||
  Math.abs(a.h - b.h) > 1;

test.describe('S2 play tap stability', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'phone portrait sizes only');
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        /* none */
      }
    });
  });

  for (const size of SIZES) {
    test(`${size.name} ${size.width}x${size.height}: ${TAPS} taps do not move or zoom the page`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('#/play');
      await page.locator('.play-spin').waitFor();
      // The $25 chip first: the default table minimum outside is $25.
      await page.getByRole('radio', { name: /25/ }).first().tap();

      page.setDefaultTimeout(3000);
      const base = await snap(page);
      const problems = {
        scroll: [] as string[],
        bar: [] as string[],
        board: [] as string[],
        zoom: [] as string[],
        overflow: [] as string[],
        covered: [] as string[],
      };
      const labels: string[] = [];
      const check = async (label: string, i: number) => {
        const s = await snap(page);
        const tag = `#${i} after ${label}`;
        if (s.scrollY !== base.scrollY) problems.scroll.push(`${tag}: scrollY ${s.scrollY}`);
        if (moved(s.bar, base.bar)) problems.bar.push(`${tag}: ${JSON.stringify(s.bar)}`);
        if (moved(s.board, base.board)) problems.board.push(`${tag}: ${JSON.stringify(s.board)}`);
        if (s.scale !== 1) problems.zoom.push(`${tag}: scale ${s.scale}`);
        if (s.scrollW !== s.clientW) problems.overflow.push(`${tag}: ${s.scrollW}>${s.clientW}`);
        if (s.spinCovered !== null) problems.covered.push(`${tag}: ${s.spinCovered}`);
      };
      await check('load', 0);

      const act = async (name: string, fn: () => Promise<void>, i: number) => {
        labels.push(name);
        try {
          await fn();
        } catch (e) {
          // A tap that cannot land (covered, moving or off screen) is itself the bug.
          problems.covered.push(`#${i} ${name} tap blocked: ${String(e).split('\n')[0]}`);
        }
        await check(name, i);
      };
      const btn = (name: RegExp | string) =>
        page.getByRole('toolbar').getByRole('button', { name });
      const tapIf = async (name: RegExp | string) => {
        const b = btn(name);
        if (await b.isEnabled()) await b.tap();
      };
      const chips = ['5', '25', '100'];
      const cells = ['Red', 'Black', 'Even', 'Odd', '17'];

      for (let i = 1; i <= TAPS; i++) {
        // Out of money: rebuy so the session keeps going (not part of the tap budget checks).
        const rebuy = page.getByRole('button', { name: /^Rebuy/ });
        if (await rebuy.count()) await rebuy.tap();
        switch (i % 6) {
          case 1:
            await act(
              'cell',
              async () => {
                const c = cells[i % cells.length]!;
                await page.locator(`.play-board [aria-label^="${c}"]`).first().tap();
              },
              i,
            );
            break;
          case 2:
            await act(
              'chip',
              () =>
                page
                  .getByRole('radio', { name: new RegExp(chips[i % 3]!) })
                  .first()
                  .tap(),
              i,
            );
            break;
          case 3:
            await act('x2', () => tapIf('Double bets'), i);
            break;
          case 4:
            await act('undo', () => tapIf('Undo'), i);
            break;
          case 5:
            await act('chip25', () => page.getByRole('radio', { name: /25/ }).first().tap(), i);
            break;
          default:
            await act(
              'spin',
              async () => {
                const spin = page.locator('.play-spin');
                if (await spin.isEnabled()) await spin.tap();
                else {
                  await page.locator('.play-board [aria-label^="Red"]').first().tap();
                  await tapIf(/^Rebet/);
                }
              },
              i,
            );
        }
      }

      const first = (xs: string[]) => `${xs.length} of ${TAPS} taps: ${xs.slice(0, 3).join(' | ')}`;
      expect.soft(problems.scroll, `scrollY moved (${first(problems.scroll)})`).toEqual([]);
      expect.soft(problems.bar, `action bar moved (${first(problems.bar)})`).toEqual([]);
      expect.soft(problems.board, `board moved (${first(problems.board)})`).toEqual([]);
      expect.soft(problems.zoom, `page zoomed (${first(problems.zoom)})`).toEqual([]);
      expect
        .soft(problems.overflow, `horizontal overflow (${first(problems.overflow)})`)
        .toEqual([]);
      expect.soft(problems.covered, `Spin covered (${first(problems.covered)})`).toEqual([]);
    });
  }
});
