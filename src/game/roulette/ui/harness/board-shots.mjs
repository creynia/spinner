/* global document, DOMPoint, window */
// ChipBoard e2e inside the real LayoutEditor: whole-table fit, real taps, long-press, the mode
// control, axe, overflow and screenshots at the four viewports (run through the resource baton):
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
        `http://127.0.0.1:${port}/src/game/roulette/ui/harness/editor.html?theme=${theme}&empty=1`,
      );
      await page.waitForSelector('.rl-board--place');
      await page.waitForTimeout(200);
      const tag = `${vp.name}-${theme}`;
      console.log('running', tag);
      const check = async (state) => {
        const axe = await new AxeBuilder({ page }).analyze();
        for (const v of axe.violations)
          failures.push(`${tag} ${state}: axe ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`);
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (over > 0) failures.push(`${tag} ${state}: horizontal scroll by ${over}px`);
      };
      const board = page.locator('.rl-board--place');
      const count = async () =>
        page.$$eval('.rl-board--place .rl-chip:not(.rl-chip--ghost)', (els) =>
          els.reduce((n, e) => n + Number(e.getAttribute('data-count')), 0),
        );
      const cellBox = async (label) =>
        board.locator(`[data-pocket="${label}"] rect`).first().boundingBox();
      const tapAt = async (x, y) => page.mouse.click(x, y);
      const centreOf = async (label) => {
        const b = await cellBox(label);
        return [b.x + b.width / 2, b.y + b.height / 2];
      };

      // 1. The whole table is on screen with no scrolling: 0, 36, every outside box, the control.
      const fit = await page.evaluate(() => {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const bad = [];
        const sel = [
          '.rl-board--place [data-pocket="0"]',
          '.rl-board--place [data-pocket="36"]',
          '.rl-board--place [data-bet]',
          '.rl-mode',
          '.le-status',
        ];
        for (const q of sel)
          for (const el of document.querySelectorAll(q)) {
            const r = el.getBoundingClientRect();
            if (r.top < -0.5 || r.left < -0.5 || r.bottom > H + 0.5 || r.right > W + 0.5)
              bad.push(
                `${q} ${el.getAttribute('data-bet') ?? el.getAttribute('data-pocket') ?? ''} ${r.top.toFixed(0)}..${r.bottom.toFixed(0)} of ${H}`,
              );
          }
        const m = document.querySelector('.rl-mode').getBoundingClientRect();
        const st = document.querySelector('.le-status').getBoundingClientRect();
        const bb = document.querySelector('.rl-board--place').getBoundingClientRect();
        if (bb.bottom > st.top + 0.5)
          bad.push(`board bottom ${bb.bottom.toFixed(0)} under status ${st.top.toFixed(0)}`);
        return {
          bad,
          mode: [m.width, m.height],
          scroll: document.documentElement.scrollHeight - H,
        };
      });
      if (fit.bad.length) failures.push(`${tag}: off screen: ${fit.bad.slice(0, 4).join('; ')}`);
      if (fit.mode[0] < 44 || fit.mode[1] < 44) failures.push(`${tag}: mode control ${fit.mode}`);
      console.log(tag, 'page scroll beyond viewport:', fit.scroll);
      // The control sits in the dead corner: it must not overlap the 0 cell or the first row.
      const overlap = await page.evaluate(() => {
        const m = document.querySelector('.rl-mode').getBoundingClientRect();
        let hit = '';
        for (const el of document.querySelectorAll('.rl-board--place [data-pocket]')) {
          const r = el.querySelector('rect').getBoundingClientRect();
          if (
            m.left < r.right - 1 &&
            m.right > r.left + 1 &&
            m.top < r.bottom - 1 &&
            m.bottom > r.top + 1
          )
            hit += el.outerHTML.slice(0, 90) + ' ';
        }
        return hit;
      });
      const geom = await page.evaluate(() => {
        const b = document.querySelector('.rl-board--place').getBoundingClientRect();
        const m = document.querySelector('.rl-mode').getBoundingClientRect();
        const z = document
          .querySelector('.rl-board--place [data-pocket="0"] rect')
          .getBoundingClientRect();
        return {
          board: [b.width, b.height, b.top],
          mode: [m.top, m.bottom, m.left, m.right],
          zero: [z.top, z.bottom, z.left],
        };
      });
      console.log(tag, JSON.stringify(geom));
      if (overlap) failures.push(`${tag}: mode control overlaps ${overlap}`);
      await check('empty');

      // toBoard against getScreenCTM: the CSS box and the viewBox agree.
      const drift = await board.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const v = el.viewBox.baseVal;
        const pt = new DOMPoint(v.x + v.width / 2, v.y + v.height / 2).matrixTransform(
          el.getScreenCTM(),
        );
        return Math.hypot(pt.x - (r.left + r.width / 2), pt.y - (r.top + r.height / 2));
      });
      if (drift > 1)
        failures.push(`${tag}: toBoard drifts ${drift.toFixed(2)}px from getScreenCTM`);

      // 2. Tap a cell centre: a straight chip lands at the cell centre.
      const [cx, cy] = await centreOf('17');
      await tapAt(cx, cy);
      if ((await count()) !== 1) failures.push(`${tag}: centre tap did not add a chip`);
      const chip = await board
        .locator('.rl-chip[data-spot="straight:17"] circle')
        .first()
        .boundingBox();
      console.log(tag, 'chip', JSON.stringify(chip), cx, cy);
      if (!chip || Math.hypot(chip.x + chip.width / 2 - cx, chip.y + chip.height / 2 - cy) > 4)
        failures.push(`${tag}: straight chip is not at the cell centre`);
      await tapAt(cx, cy);
      if ((await count()) !== 2) failures.push(`${tag}: tap on a chip did not stack`);

      // 3. Edge tap between 17 and 20 is a split.
      const [dx, dy] = await centreOf('20');
      await tapAt((cx + dx) / 2, (cy + dy) / 2);
      if (!(await board.locator('.rl-chip[data-spot="split:17-20"]').count()))
        failures.push(`${tag}: edge tap did not place split:17-20`);

      // 4. Remove mode takes a chip off; back to Add.
      await page.click('[aria-label="Remove chips"]');
      await tapAt(cx, cy);
      if ((await count()) !== 2) failures.push(`${tag}: Remove did not remove (${await count()})`);
      await check('remove');
      await page.click('[aria-label="Add chips"]');

      // 5. The lock through the new control, arrows inside the sheet, persistence on the button.
      await page.click('.rl-mode');
      const dlg = page.getByRole('dialog', { name: 'Bet type' });
      await dlg.waitFor();
      const names = await dlg
        .getByRole('radio')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      if (
        names.join('|') !==
        'Auto|1, straight|2, split|3, street|4, corner (trio and basket nearest the zero)|6, six line'
      )
        failures.push(`${tag}: lock names ${names}`);
      if (!(await dlg.getByRole('radiogroup', { name: 'Bet type' }).count()))
        failures.push(`${tag}: radiogroup is not named "Bet type"`);
      await check('mode-sheet');
      await page.screenshot({ path: `${out}/${tag}-mode.png` });
      await dlg.getByRole('radio', { name: 'Auto' }).focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      if ((await dlg.locator('[aria-checked=true]').getAttribute('aria-label')) !== '2, split')
        failures.push(`${tag}: arrow keys did not select Split`);
      if (!(await page.getByRole('dialog', { name: 'Bet type' }).count()))
        failures.push(`${tag}: arrow key closed the sheet`);
      await dlg.getByRole('radio', { name: '2, split' }).click();
      await page.waitForSelector('[role=dialog]', { state: 'detached' });
      if ((await page.textContent('.rl-mode')) !== 'Split')
        failures.push(`${tag}: control does not show Split`);
      await tapAt(cx, cy);
      const splits = await board.locator('.rl-chip[data-spot^="split:"]').count();
      if (splits < 2) failures.push(`${tag}: split lock placed no split`);
      await page.click('.rl-mode');
      await page
        .getByRole('dialog', { name: 'Bet type' })
        .getByRole('radio', { name: 'Auto' })
        .click();

      // 6. Long-press (touch) or Enter (desktop) opens the bet sheet; the stepper adds.
      const before = await count();
      if (vp.mobile) {
        const cdp = await context.newCDPSession(page);
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
      await page.keyboard.press('Escape');
      await page.waitForSelector('.rl-sheet', { state: 'detached' });

      // 7. Call bets through the control.
      await page.click('.rl-mode');
      await page.getByRole('button', { name: 'Call bets…' }).click();
      const calls = page.getByRole('dialog', { name: 'Call bets' });
      await calls.waitFor();
      await calls.locator('[data-bet="voisins"] button[aria-label^="Add"]').click();
      await check('calls');
      await calls.getByRole('button', { name: 'Close' }).click();
      await page.waitForSelector('[role=dialog]', { state: 'detached' });
      if (!(await board.locator('.rl-chip--ghost').count()))
        failures.push(`${tag}: no ghost chips for voisins`);
      await check('voisins');
      await page.screenshot({ path: `${out}/${tag}-editor-voisins.png` });
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
console.log('editor shots clean');
