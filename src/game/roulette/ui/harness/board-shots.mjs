/* global document, DOMPoint */
// ChipBoard e2e on the board-only harness page: real taps and long-press in Chromium, axe, overflow
// and screenshots at the four viewports (run through the resource baton):
//   res browser l3b -- env PORT=5264 node src/game/roulette/ui/harness/board-shots.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import preact from '@preact/preset-vite';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const out =
  process.argv[2] ??
  '/tmp/claude-0/-home-user-spinner/828ad1c6-cbad-5e73-b247-9a1c047fbf35/scratchpad/shots/chip-board';
const port = Number(process.env.PORT ?? 5264);
mkdirSync(out, { recursive: true });

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  plugins: [preact()],
  resolve: {
    alias: [
      { find: /^@core$/, replacement: `${root}src/core/index.ts` },
      { find: /^@core\//, replacement: `${root}src/core/` },
      { find: /^@game\//, replacement: `${root}src/game/` },
    ],
  },
  server: { port, strictPort: true, host: '127.0.0.1' },
});
await server.listen();

const VIEWPORTS = [
  { name: '360', width: 360, height: 780, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '844x390', width: 844, height: 390, mobile: true },
  { name: '1280', width: 1280, height: 800, mobile: false },
];
const failures = [];
const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
        deviceScaleFactor: 2,
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(
        `http://127.0.0.1:${port}/src/game/roulette/ui/harness/board.html?theme=${theme}&empty=1`,
      );
      await page.waitForSelector('.rl-board--place');
      const tag = `${vp.name}-${theme}`;
      const check = async (state) => {
        const axe = await new AxeBuilder({ page }).analyze();
        for (const v of axe.violations)
          failures.push(`${tag} ${state}: axe ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`);
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (over > 0) failures.push(`${tag} ${state}: horizontal scroll by ${over}px`);
      };
      const count = async () => Number(await page.textContent('#count'));
      const svg = page.locator('.rl-board--place');
      await svg.scrollIntoViewIfNeeded();
      await check('empty');

      // toBoard against getScreenCTM: the CSS box and the viewBox agree.
      const drift = await svg.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const v = el.viewBox.baseVal;
        const m = el.getScreenCTM();
        const pt = new DOMPoint(v.x + v.width / 2, v.y + v.height / 2).matrixTransform(m);
        return Math.hypot(pt.x - (r.left + r.width / 2), pt.y - (r.top + r.height / 2));
      });
      if (drift > 1)
        failures.push(`${tag}: toBoard drifts ${drift.toFixed(2)}px from getScreenCTM`);

      // Tap the centre of a number cell: a straight chip lands there.
      const centre = async () => {
        const rect = page.locator('.rl-board--place [data-pocket="17"] rect');
        await rect.scrollIntoViewIfNeeded();
        const b = await rect.boundingBox();
        return [b.x + b.width / 2, b.y + b.height / 2];
      };
      const tap17 = async () => page.mouse.click(...(await centre()));
      await tap17();
      if ((await count()) !== 1) failures.push(`${tag}: centre tap did not add a chip`);
      const spot = await page.getAttribute(
        '.rl-board--place .rl-chip:not(.rl-chip--ghost)',
        'data-spot',
      );
      if (spot !== 'straight:17') failures.push(`${tag}: centre tap placed ${spot}`);
      // A tap that lands on the chip goes to the board underneath.
      await tap17();
      if ((await count()) !== 2) failures.push(`${tag}: tap on a chip did not stack`);

      // Remove mode, then back to Add.
      await page.click('#tool-remove');
      await tap17();
      if ((await count()) !== 1) failures.push(`${tag}: Remove did not remove`);
      await check('remove');
      await page.click('#tool-add');

      // Bet-type lock: Split, then a tap anywhere in a cell is a split.
      await page.click('[role=radio][aria-label="2, split"]');
      await tap17();
      const kinds = await page.$$eval('.rl-board--place .rl-chip[data-spot]', (els) =>
        els.map((e) => e.getAttribute('data-spot')),
      );
      if (!kinds.some((k) => k?.startsWith('split:')))
        failures.push(`${tag}: split lock placed ${kinds}`);
      await page.click('[role=radio][aria-label="Auto"]');
      await check('chips');

      // Long-press (touch devices): the sheet opens and no chip is added.
      const before = await count();
      await page.locator('.rl-board--place [data-pocket="17"]').scrollIntoViewIfNeeded();
      const now = await page.locator('.rl-board--place [data-pocket="17"] rect').boundingBox();
      const cdp = vp.mobile ? await context.newCDPSession(page) : null;
      if (cdp) {
        const cx = now.x + now.width / 2;
        const cy = now.y + now.height / 2;
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: cx, y: cy }],
        });
        await page.waitForTimeout(650);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForSelector('.rl-sheet');
        if ((await count()) !== before) failures.push(`${tag}: long-press added a chip`);
      } else {
        await page.focus('.rl-board--place [data-pocket="17"]');
        await page.keyboard.press('Enter');
        await page.waitForSelector('.rl-sheet');
      }
      const rowMin = await page.evaluate(() =>
        Math.min(
          ...[...document.querySelectorAll('.rl-row--steps')].map(
            (e) => e.getBoundingClientRect().height,
          ),
        ),
      );
      if (rowMin < 48) failures.push(`${tag}: sheet row ${rowMin}px < 48`);
      await page.click('.rl-sheet [data-bet-row="straight:17"] button[aria-label^="Add"]');
      if ((await count()) !== before + 1) failures.push(`${tag}: sheet stepper did not add`);
      await check('sheet');
      await page.screenshot({ path: `${out}/${tag}-sheet.png` });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.rl-sheet'));

      // Call bets tab.
      await page.click('[role=tab]:nth-child(2)');
      await page.click('[data-bet="voisins"] button[aria-label^="Add"]');
      await check('calls');
      await page.click('[role=tab]:nth-child(1)');
      if (!(await page.$('.rl-board--place .rl-chip--ghost')))
        failures.push(`${tag}: no ghost chips for voisins`);
      await check('ghosts');
      await page.screenshot({ path: `${out}/${tag}-board.png`, fullPage: true });
      if (errors.length) failures.push(`${tag}: console errors ${errors.join(' | ')}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (failures.length) {
  console.error(`FAILURES (${failures.length})\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('board shots clean');
