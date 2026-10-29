import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

export { expect };
export type { Page };

export interface Guard {
  /** Assert no horizontal overflow and no console errors so far, labelled with the state name. */
  check(state: string): Promise<void>;
}

interface GuardFixtures {
  guard: Guard;
  /** Console or page errors matching any of these patterns are ignored (document each one where used). */
  guardIgnore: RegExp[];
}

/**
 * Every test that imports `test` from here gets a guard: console and page errors are recorded from
 * the start of the test, and any that remain unignored at the end of the test fail it. Call
 * `guard.check(state)` at each state to also assert no horizontal overflow there.
 */
export const test = base.extend<GuardFixtures>({
  guardIgnore: [[], { option: true }],
  guard: [
    async ({ page, guardIgnore }, use) => {
      const errors: string[] = [];
      // The production build carries a CSP meta tag (sync.md §5.5): any violation fails the test.
      // A listener in the page logs it as a console error before anything else runs.
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          console.error(
            `CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`,
          );
        });
      });
      const unignored = () => errors.filter((e) => !guardIgnore.some((re) => re.test(e)));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      await use({
        async check(state: string) {
          const [scroll, client] = await page.evaluate<[number, number]>(
            '[document.documentElement.scrollWidth, document.documentElement.clientWidth]',
          );
          expect(
            scroll,
            `${state}: horizontal overflow (scrollWidth ${scroll} > clientWidth ${client})`,
          ).toBeLessThanOrEqual(client);
          expect(unignored(), `${state}: console errors`).toEqual([]);
        },
      });
      expect(unignored(), 'console errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});

/** Fails on any serious or critical axe violation on the current page, labelled with the state. */
export async function expectAxeClean(page: Page, state: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(bad, `${state}: axe violations`).toEqual([]);
}

/** Resolves 'pong' when a real module worker answers `ping` (needs the `?e2e` hook, see ROUTES). */
export async function pingWorker(page: Page): Promise<string> {
  return page.evaluate<string>('window.__spinner.ping()');
}

/**
 * One screen check: no element wider than the viewport outside a component-level scroller, no
 * console errors so far, no serious axe violations. Shared by the flow specs.
 */
export async function screenCheck(page: Page, guard: Guard, label: string): Promise<void> {
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')]
      .filter((el) => {
        if (el.getBoundingClientRect().right <= w + 1) return false;
        for (let p: Element | null = el.parentElement; p; p = p.parentElement) {
          if (/auto|scroll|hidden/.test(getComputedStyle(p).overflowX)) return false;
          if (p.classList.contains('visually-hidden')) return false;
        }
        return true;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName}.${String(el.getAttribute('class'))}`);
  });
  expect(wide, `${label}: elements wider than the viewport`).toEqual([]);
  await guard.check(label);
  await expectAxeClean(page, label);
}
