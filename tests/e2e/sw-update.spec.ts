// Service-worker update path (architecture.md §8.4): build A, serve it, load it, build B with a
// different SHA, swap what the server serves, and the update toast appears; Reload shows B's SHA in
// About. While a run is active the button says "Reload (run will resume)" and Run offers Resume.
// Both builds go to temp dirs (vite build --outDir) so the shared dist/ is untouched.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { expect, test, type Page } from './helpers';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const SHA_A = 'aaaaaaa';
const SHA_B = 'bbbbbbb';

function build(outDir: string, sha: string): void {
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    env: { ...process.env, GITHUB_SHA: sha },
    stdio: 'pipe',
  });
}

let tmp: string;
let dirA: string;
let dirB: string;
let root: string;
let server: Server;
let origin: string;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  tmp = mkdtempSync(join(tmpdir(), 'spinner-sw-'));
  dirA = join(tmp, 'a');
  dirB = join(tmp, 'b');
  build(dirA, SHA_A);
  build(dirB, SHA_B);
  server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (!path.startsWith('/spinner/')) {
      res.statusCode = 404;
      return void res.end();
    }
    let file = join(root, normalize(path.slice('/spinner/'.length)));
    if (!file.startsWith(root)) {
      res.statusCode = 403;
      return void res.end();
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.statusCode = 404;
      return void res.end();
    }
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'no-cache');
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://localhost:${(server.address() as AddressInfo).port}/spinner/`;
});
test.afterAll(async () => {
  await new Promise((r) => server?.close(r));
  rmSync(tmp, { recursive: true, force: true });
});
test.beforeEach(() => {
  root = dirA;
});

async function controlled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
    }
  });
}
const sha = async (page: Page) => {
  await page.goto(`${origin}?e2e#/settings`);
  return page.locator('#about dd').nth(1).textContent();
};

test('a new build shows the update toast, and Reload runs the new SHA', async ({ page, guard }) => {
  test.setTimeout(120_000);
  await page.goto(`${origin}?e2e#/settings`);
  await controlled(page);
  expect(await sha(page)).toBe(SHA_A);
  expect(await page.evaluate('window.__spinner.sha')).toBe(SHA_A);

  root = dirB;
  await page.getByRole('button', { name: 'Check for updates' }).click();
  const toast = page.locator('.pwa-toast');
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await expect(toast.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
  await guard.check('update toast');
  await toast.getByRole('button', { name: 'Reload', exact: true }).click();
  // controllerchange reloads the page onto the new worker and the new files.
  await expect(page.locator('.pwa-toast')).toHaveCount(0);
  await expect.poll(async () => sha(page), { timeout: 30_000 }).toBe(SHA_B);
  await guard.check('after update');
});

test('while a run is active the toast says the run will resume', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${origin}?e2e#/`);
  await controlled(page);
  await page.waitForFunction('window.__results !== undefined');
  const runId = await page.evaluate<string>(
    "window.__results.start({ sessions: 200000, maxRounds: 300, name: 'Long run' })",
  );
  await page.evaluate((id) => void (location.hash = `#/run/${id}`), runId);
  await expect(page.locator('[data-status=running]')).toBeVisible({ timeout: 30_000 });
  root = dirB;
  await page.evaluate(
    async () => void (await (await navigator.serviceWorker.getRegistration())!.update()),
  );
  const button = page.locator('.pwa-toast button');
  await expect(button).toHaveText('Reload (run will resume)', { timeout: 30_000 });
  await button.click();
  await expect(page.locator('[data-warning=interrupted]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  expect(await page.evaluate('window.__spinner.sha')).toBe(SHA_B);
});
