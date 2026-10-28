/* global document */
// Screenshots + axe + overflow check of the harness page (run through the resource baton):
//   res browser game-ui -- env PORT=5209 node src/game/roulette/ui/harness/shots.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import preact from '@preact/preset-vite';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const out =
  process.argv[2] ??
  '/tmp/claude-0/-home-user-spinner/828ad1c6-cbad-5e73-b247-9a1c047fbf35/scratchpad/shots/game-ui';
const port = Number(process.env.PORT ?? 5209);
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
  for (const wheel of ['european', 'american', 'triple-zero']) {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        // The full matrix of screenshots is for the european wheel; the others get one pass each.
        const shoot = wheel === 'european' || (vp.name === '390' && theme === 'light');
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
          `http://127.0.0.1:${port}/src/game/roulette/ui/harness/index.html?theme=${theme}&wheel=${wheel}`,
        );
        await page.waitForSelector('.rl-board');
        const tag = `${wheel}-${vp.name}-${theme}`;
        const check = async (state) => {
          const axe = await new AxeBuilder({ page }).analyze();
          for (const v of axe.violations)
            failures.push(`${tag} ${state}: axe ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`);
          const over = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          if (over > 0) failures.push(`${tag} ${state}: horizontal scroll by ${over}px`);
        };
        await check('closed');
        if (shoot) await page.screenshot({ path: `${out}/${tag}-table.png`, fullPage: true });

        // Tap sizes of the interactive regions (only enforced where the spec requires it).
        const sizes = await page.evaluate(() =>
          [...document.querySelectorAll('.rl-picker [role=button]')].map((e) => {
            const r = e.getBoundingClientRect();
            return Math.min(r.width, r.height);
          }),
        );
        const min = Math.min(...sizes);
        console.log(`${tag}: smallest picker region ${min.toFixed(1)} px`);
        if (vp.mobile && vp.width >= 390 && min < 44)
          failures.push(`${tag}: picker region ${min.toFixed(1)} px < 44`);

        // Keyboard path: Tab must reach a number cell, Enter opens the sheet, Escape closes it and
        // gives focus back (real Chromium: SVG attributes are case-sensitive).
        {
          let reached = false;
          for (let i = 0; i < 150 && !reached; i++) {
            await page.keyboard.press('Tab');
            reached = await page.evaluate(
              () =>
                document.activeElement?.closest('.rl-picker [data-pocket]') !== null &&
                document.activeElement?.hasAttribute('data-pocket') === true,
            );
          }
          if (!reached) failures.push(`${tag}: Tab never reaches a [data-pocket] cell`);
          else {
            const pocket = await page.evaluate(() =>
              document.activeElement.getAttribute('data-pocket'),
            );
            await page.keyboard.press('Enter');
            if (!(await page.$('.rl-sheet'))) failures.push(`${tag}: Enter did not open the sheet`);
            await page.waitForFunction(() => document.activeElement?.closest('.rl-sheet'));
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => !document.querySelector('.rl-sheet'));
            await page.waitForTimeout(50);
            const back = await page.evaluate(() =>
              document.activeElement?.getAttribute('data-pocket'),
            );
            if (back !== pocket) failures.push(`${tag}: focus not restored (${back} vs ${pocket})`);
            await page.keyboard.press('Space');
            if (!(await page.$('.rl-sheet'))) failures.push(`${tag}: Space did not open the sheet`);
            await page.waitForFunction(() => document.activeElement?.closest('.rl-sheet'));
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => !document.querySelector('.rl-sheet'));
          }
          await page.focus('.rl-picker [role=tab][aria-selected=true]');
          await page.keyboard.press('ArrowRight');
          const sel = await page.evaluate(() => document.activeElement?.textContent);
          if (sel !== 'Call bets' && wheel === 'european')
            failures.push(`${tag}: ArrowRight tab -> ${sel}`);
          await page.keyboard.press('Home');
        }

        await page.click('.rl-picker [data-pocket="17"]');
        await page.waitForSelector('.rl-sheet');
        const rowMin = await page.evaluate(() =>
          Math.min(
            ...[...document.querySelectorAll('.rl-row')].map(
              (e) => e.getBoundingClientRect().height,
            ),
          ),
        );
        if (rowMin < 48) failures.push(`${tag}: sheet row ${rowMin}px < 48`);
        await check('sheet');
        if (shoot) await page.screenshot({ path: `${out}/${tag}-sheet.png` });
        await page.click('.rl-sheet [data-bet-row="split:17-20"]');
        const picked = await page.textContent('#picked');
        if (picked !== 'split:17-20') failures.push(`${tag}: picked ${picked}`);
        if (shoot) await page.screenshot({ path: `${out}/${tag}-picked.png`, fullPage: true });

        if (wheel === 'european' && theme === 'light') {
          await page.click('[role=tab]:nth-child(2)');
          await check('calls');
          if (vp.name === '390')
            await page.screenshot({ path: `${out}/${tag}-calls.png`, fullPage: true });
          await page.click('[role=tab]:nth-child(3)');
          await page.fill('input', '17-20');
          await check('type');
        }
        if (errors.length) failures.push(`${tag}: console errors ${errors.join(' | ')}`);
        await context.close();
      }
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
console.log('all shots clean');
