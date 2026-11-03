// Shared helpers for the Play-on-phones suites (docs/testing/play-mobile.md).
import { expect, type Page } from '@playwright/test';

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

/** Portrait target devices from the plan (CSS px). */
export const VIEWPORTS: Viewport[] = [
  { name: 'phone-360', width: 360, height: 780 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'pixel-pro', width: 412, height: 915 },
  { name: 'pixel-pro-chrome', width: 412, height: 780 },
  { name: 'phone-short', width: 412, height: 700 },
];

/** The landscape target from the plan. */
export const LANDSCAPE: Viewport = { name: 'landscape', width: 844, height: 390 };

export const SESSION_KEY = 'spinner:play:session';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Opens #/play with clean storage. `session` (a JSON string or object) is written to
 * `spinner:play:session` before the app boots. Waits for the board and the action bar.
 */
export async function gotoPlay(page: Page, opts: { session?: unknown } = {}): Promise<void> {
  const seed = opts.session === undefined ? null : JSON.stringify(opts.session);
  await page.goto('./');
  await page.evaluate(
    ([key, value]) => {
      localStorage.clear();
      sessionStorage.clear();
      if (value) localStorage.setItem(key!, value);
    },
    [SESSION_KEY, seed],
  );
  await page.goto('./#/play');
  await page.reload();
  await page.locator('.play-board .rl-chipboard').waitFor();
  await page.locator('.play-bar').waitFor();
  await page.evaluate('window.scrollTo(0, 0)');
}

/** Bounding box (viewport coordinates) of the first element matching `selector`; null if absent. */
export async function rectOf(page: Page, selector: string): Promise<Rect | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
    };
  }, selector);
}

/** Rect of `selector`, failing the test when the element is missing. */
export async function mustRect(page: Page, selector: string): Promise<Rect> {
  const r = await rectOf(page, selector);
  expect(r, `${selector} should exist`).not.toBeNull();
  return r!;
}

/** True when the two rects share more than `tol` px in both axes. */
export function overlaps(a: Rect, b: Rect, tol = 1): boolean {
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > tol &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tol
  );
}

/** True when the rect lies fully inside a viewport of the given size (1px tolerance). */
export function insideViewport(r: Rect, vw: number, vh: number, tol = 1): boolean {
  return r.left >= -tol && r.top >= -tol && r.right <= vw + tol && r.bottom <= vh + tol;
}

export function fmt(r: Rect): string {
  return `[x ${r.left.toFixed(0)}-${r.right.toFixed(0)}, y ${r.top.toFixed(0)}-${r.bottom.toFixed(0)}]`;
}

/** Asserts the document is not wider than the viewport. */
export async function noHorizontalOverflow(page: Page, label: string): Promise<void> {
  const [scroll, client] = await page.evaluate<[number, number]>(
    '[document.documentElement.scrollWidth, document.documentElement.clientWidth]',
  );
  expect(
    scroll,
    `${label}: horizontal overflow (scrollWidth ${scroll} > ${client})`,
  ).toBeLessThanOrEqual(client);
}
