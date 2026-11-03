// S4: a 1,000-spin session with extreme numbers still fits a phone (docs/testing/play-mobile.md).
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type * as CorePlay from '@core/play';
import type { PlayEnv, PlayResult, PlaySession } from '@core/play';
import {
  VIEWPORTS,
  fmt,
  gotoPlay,
  insideViewport,
  mustRect,
  noHorizontalOverflow,
  overlaps,
  type Rect,
  type Viewport,
} from './helpers';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPINS = 1000;
/** $9,999,999 of cash, and a net of -$123,456 after the 1,000 spins. */
const BANKROLL: number = 999_999_900;
const NET: number = -12_345_600;
const HISTORY_KEY = 'spinner:play:history';

type CoreApi = Pick<typeof CorePlay, 'createSession' | 'placeBet' | 'spin'>;

interface Built {
  session: Record<string, unknown>;
  history: Record<string, unknown>[];
}

/**
 * Plays 1,000 spins with the real core and a seeded RNG (loaded through Vite's SSR loader, so the
 * TypeScript sources and path aliases are used as they are), then stretches the numbers.
 */
async function buildSession(): Promise<Built> {
  const { createServer } = await import('vite');
  const { aliases } = await import('../../../build/aliases');
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: aliases },
  });
  try {
    const core = (await server.ssrLoadModule('/src/core/play/index.ts')) as CoreApi;
    const envMod = (await server.ssrLoadModule('/src/app/screens/Play/env.ts')) as {
      rouletteEnv(v: string): PlayEnv;
    };
    const variant = 'european';
    const env = envMod.rouletteEnv(variant);
    const ok = (r: PlayResult): PlaySession => {
      if (!r.ok) throw new Error(r.message);
      return r.session;
    };
    let s = core.createSession(env, {
      variant,
      bankroll: BANKROLL,
      rng: { kind: 'seeded', seed: 20260101 },
      id: 'long-session-1000',
    });
    for (let i = 0; i < SPINS; i++) {
      s = ok(core.placeBet(env, s, `straight:${i % 37}`, 5_000));
      s = ok(core.placeBet(env, s, i % 2 ? 'red' : 'black', 100_000));
      const r = core.spin(env, s);
      if (!r.ok) throw new Error(r.message);
      s = r.session;
    }
    s = ok(core.placeBet(env, s, 'straight:17', 5_000));
    // Stretch to the extremes: $9,999,999 of cash, a net of -$123,456, a huge wagered total.
    s = {
      ...s,
      bankroll: BANKROLL,
      carried: 0,
      bankIn: BANKROLL - NET,
      stats: { ...s.stats, net: NET, wagered: 99_999_999_999, biggestWin: 35_000_000 },
    };
    const history = Array.from({ length: 20 }, (_, i) => ({
      id: `h${i}`,
      variant,
      seed: 4_000_000_000 + i,
      startedAt: '2026-01-01T10:00:00.000Z',
      endedAt: '2026-01-01T12:00:00.000Z',
      spins: 1_000_000 + i,
      bankIn: BANKROLL,
      final: BANKROLL + NET,
      net: NET - i,
      wagered: 99_999_999_999,
      expectedLoss: 12345.6,
    }));
    return { session: s as unknown as Record<string, unknown>, history };
  } finally {
    await server.close();
  }
}

let built: Built;
test.beforeAll(async () => {
  built = await buildSession();
});

async function open(page: Page, vp: Viewport): Promise<void> {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await gotoPlay(page, { session: built.session });
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k!, v!),
    [HISTORY_KEY, JSON.stringify(built.history)],
  );
  await page.reload();
  await page.locator('.play-board .rl-chipboard').waitFor();
  await page.evaluate('window.scrollTo(0, 0)');
}

/** Selectors of elements that may never be wider than the viewport. */
async function tooWide(page: Page, root: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const w = document.documentElement.clientWidth;
    const base = document.querySelector(sel);
    if (!base) return [`${sel} is missing`];
    const out: string[] = [];
    for (const el of [base, ...base.querySelectorAll('*')]) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // Content of a component-level scroller (the recent strip) may extend past the edge.
      let scrolled = false;
      for (let p = el.parentElement; p && base.contains(p); p = p.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(p).overflowX)) scrolled = true;
      }
      if (scrolled) continue;
      if (r.left < -1 || r.right > w + 1) {
        out.push(
          `${el.tagName}.${String(el.getAttribute('class'))} x ${r.left}-${r.right} (vw ${w})`,
        );
      }
    }
    return out.slice(0, 5);
  }, root);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} 1,000 spins`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'phone', 'portrait phone sizes loop inside');
      await open(page, vp);
    });

    test('the session loaded with extreme numbers', async ({ page }) => {
      const head = await page.locator('.play-head').innerText();
      expect(head).toContain('1,000');
      expect(head).toMatch(/9,999,9\d\d/);
      expect(head).toContain('123,456');
    });

    test('header, session strip and result strip stay inside the viewport width', async ({
      page,
    }) => {
      for (const sel of ['.play-top', '.play-head', '.play-result']) {
        expect(await tooWide(page, sel), sel).toEqual([]);
      }
      await noHorizontalOverflow(page, `${vp.name} closed stats`);
    });

    test('the recent-numbers strip is capped and does not wrap past one row', async ({ page }) => {
      const items = await page.locator('.play-recent > *').count();
      expect(items).toBeLessThanOrEqual(20);
      const strip = await mustRect(page, '.play-recent');
      const result = await mustRect(page, '.play-result');
      expect(strip.height, 'recent strip height').toBeLessThan(result.height + 60);
      expect(result.height, 'result line height').toBeLessThan(vp.height / 4);
    });

    test('opened stats panel and its last-spins log stay inside the viewport width', async ({
      page,
    }) => {
      const toggle = page.locator('.play-stats-toggle');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true')
        await toggle.evaluate((el) => (el as HTMLElement).click());
      await expect(page.locator('#play-stats-body')).toBeVisible();
      expect(await tooWide(page, '.play-side'), 'stats panel').toEqual([]);
      expect(await tooWide(page, '.play-log'), 'log table').toEqual([]);
      await noHorizontalOverflow(page, `${vp.name} open stats`);
    });

    test('the log is capped and the page height stays bounded', async ({ page }) => {
      const toggle = page.locator('.play-stats-toggle');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true')
        await toggle.evaluate((el) => (el as HTMLElement).click());
      const rows = await page.locator('.play-log tbody tr').count();
      expect(rows, 'last-spins rows').toBeLessThanOrEqual(50);
      const height = await page.evaluate<number>('document.documentElement.scrollHeight');
      expect(height, 'page height with stats open').toBeLessThanOrEqual(vp.height + 4500);
    });

    test('with stats closed the page is as tall as the same session with a short log', async ({
      page,
    }) => {
      const toggle = page.locator('.play-stats-toggle');
      if ((await toggle.getAttribute('aria-expanded')) === 'true') {
        await toggle.evaluate((el) => (el as HTMLElement).click());
      }
      const long = await page.evaluate<number>('document.documentElement.scrollHeight');
      const log = built.session['log'] as unknown[];
      const curve = built.session['curve'] as unknown[];
      await gotoPlay(page, {
        session: { ...built.session, log: log.slice(-20), curve: curve.slice(-20) },
      });
      const short = await page.evaluate<number>('document.documentElement.scrollHeight');
      expect(long, 'page height must not grow with the session length').toBeLessThanOrEqual(
        short + 2,
      );
    });

    test('past-sessions history list fits the viewport width and scrolls inside the sheet', async ({
      page,
    }) => {
      await page.getByRole('button', { name: 'More play actions' }).click();
      await page
        .getByRole('button', { name: /Session: top up/ })
        .evaluate((el) => (el as HTMLElement).click());
      const dialog = page.getByRole('dialog', { name: /session/i });
      await expect(dialog).toBeVisible();
      await expect(page.locator('.play-history-row').first()).toBeVisible();
      expect(await tooWide(page, '.sheet'), 'sheet').toEqual([]);
      const sheet = await mustRect(page, '.sheet');
      expect(sheet.bottom, 'sheet bottom').toBeLessThanOrEqual(vp.height + 1);
      expect(sheet.top, 'sheet top').toBeGreaterThanOrEqual(-1);
      await noHorizontalOverflow(page, `${vp.name} session sheet`);
    });

    test('S1 still holds: every part inside the viewport, nothing overlapping', async ({
      page,
    }) => {
      const parts: Array<[string, string]> = [
        ['session strip', '.play-head'],
        ['result line', '.play-result'],
        ['board', '.play-board .rl-chipboard'],
        ['chip rack', '.chip-rack'],
        ['action bar', '.play-bar'],
      ];
      expect(await page.evaluate('window.scrollY')).toBe(0);
      const rects: Array<[string, Rect]> = [];
      for (const [name, sel] of parts) rects.push([name, await mustRect(page, sel)]);
      const bad: string[] = [];
      for (const [name, r] of rects) {
        if (!insideViewport(r, vp.width, vp.height)) {
          bad.push(`${name} ${fmt(r)} outside ${vp.width}x${vp.height}`);
        }
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const [an, ar] = rects[i]!;
          const [bn, br] = rects[j]!;
          if (overlaps(ar, br)) bad.push(`${an} ${fmt(ar)} overlaps ${bn} ${fmt(br)}`);
        }
      }
      expect(bad, 'fit problems').toEqual([]);
    });
  });
}
