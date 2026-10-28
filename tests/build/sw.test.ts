// Source checks always run; the built-output checks skip until `npm run build` has produced dist/.
import { runInNewContext } from 'node:vm';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const src = readFileSync(new URL('src/pwa/sw.ts', root), 'utf8');
const hasDist = existsSync(new URL('dist/sw.js', root));

describe('sw.ts source', () => {
  it('re-fetches precached files past the HTTP cache', () => {
    expect(src).toContain("cache: 'reload'");
  });
  it('only skips waiting on request (no automatic skipWaiting)', () => {
    const calls = src.match(/sw\.skipWaiting\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(src.indexOf('sw.skipWaiting()')).toBeGreaterThan(src.indexOf('SKIP_WAITING'));
  });
  it('matches cached responses despite Vary (cors-mode module requests)', () => {
    expect(src).toContain('ignoreVary: true');
  });
  it('keeps gallery bundles in their own cache that outlives app versions', () => {
    expect(src).toContain("'spinner-gallery'");
    expect(src).toContain('k !== GALLERY_CACHE');
  });
});

describe('gallery fetch handling (sw.ts run against fakes)', () => {
  type Handler = (e: unknown) => void;
  async function load() {
    const ts = (await import('typescript')).default;
    const js = ts
      .transpileModule(src, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      })
      .outputText.replace(/__PRECACHE__/g, '[]')
      .replace(/__VERSION__/g, '"t"');
    const handlers: Record<string, Handler> = {};
    const stored: string[] = [];
    let putFails = false;
    const fakeCaches = {
      open: () =>
        Promise.resolve({
          put: (r: Request) =>
            putFails ? Promise.reject(new Error('quota')) : (stored.push(r.url), Promise.resolve()),
          match: () => Promise.resolve(undefined),
          keys: () => Promise.resolve([]),
        }),
      keys: () => Promise.resolve([]),
    };
    let status = 200;
    const fakeSelf = {
      location: new URL('http://x/spinner/sw.js'),
      addEventListener: (t: string, h: Handler) => (handlers[t] = h),
    };
    runInNewContext(js.replace(/^"use strict";/, ''), {
      self: fakeSelf,
      caches: fakeCaches,
      fetch: () => Promise.resolve(new Response('b', { status })),
      Request,
      URL,
    });
    return {
      stored,
      setStatus: (n: number) => (status = n),
      failPut: () => (putFails = true),
      async fetch(url: string) {
        let p: Promise<Response> | undefined;
        const waits: Promise<unknown>[] = [];
        handlers.fetch!({
          request: new Request(url),
          respondWith: (r: Promise<Response>) => (p = r),
          waitUntil: (w: Promise<unknown>) => waits.push(w),
        });
        const res = p ? await p : undefined;
        await Promise.all(waits);
        return res;
      },
    };
  }
  it('stores a 200 bundle, skips a 206, and survives a failing put', async () => {
    const sw = await load();
    const res = await sw.fetch('http://x/spinner/gallery/a-1.spinner.json');
    expect(res?.status).toBe(200);
    expect(sw.stored).toHaveLength(1);
    sw.setStatus(206);
    await sw.fetch('http://x/spinner/gallery/b-2.spinner.json');
    expect(sw.stored).toHaveLength(1);
    sw.setStatus(200);
    sw.failPut();
    expect((await sw.fetch('http://x/spinner/gallery/c-3.spinner.json'))?.status).toBe(200);
  });
  it('treats gallery/index.json?x as the index, not a bundle', async () => {
    const sw = await load();
    await sw.fetch('http://x/spinner/gallery/index.json?x=1');
    expect(sw.stored).toEqual([]);
  });
});

describe.skipIf(!hasDist)('dist/sw.js', () => {
  const sw = hasDist ? readFileSync(new URL('dist/sw.js', root), 'utf8') : '';
  const precache = hasDist
    ? (JSON.parse(/\[\s*"\.\/"[\s\S]*?\]/.exec(sw)?.[0] ?? '[]') as string[])
    : [];

  it('has both build-time constants substituted', () => {
    expect(sw).not.toContain('__PRECACHE__');
    expect(sw).not.toContain('__VERSION__');
    expect(sw).toMatch(/spinner-/);
    expect(sw).toContain('SKIP_WAITING');
  });
  it('precaches the shell, manifest, icons, worker chunk and gallery index', () => {
    expect(precache).toContain('./');
    expect(precache).toContain('./index.html');
    expect(precache).toContain('./manifest.webmanifest');
    expect(precache).toContain('./icons/icon-192.png');
    expect(precache).toContain('./icons/icon-512.png');
    expect(precache).toContain('./gallery/index.json');
    expect(precache.some((p) => /^\.\/assets\/sim\.worker-.*\.js$/.test(p))).toBe(true);
  });
  it('does not precache gallery bundles, source maps or itself', () => {
    expect(
      precache.filter((p) => p.startsWith('./gallery/') && p !== './gallery/index.json'),
    ).toEqual([]);
    expect(precache.some((p) => p.endsWith('.map') || p === './sw.js')).toBe(false);
  });
  it('lists every built file except those exclusions', () => {
    const walk = (d: URL): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(new URL(`${e.name}/`, d)).map((f) => `${e.name}/${f}`) : [e.name],
      );
    const built = walk(new URL('dist/', root))
      .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
      .filter((f) => !f.startsWith('gallery/') || f === 'gallery/index.json');
    expect(precache.filter((p) => p !== './').sort()).toEqual(built.map((f) => `./${f}`).sort());
  });
  it('index.html links the manifest and apple-touch-icon', () => {
    const html = readFileSync(new URL('dist/index.html', root), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('apple-touch-icon');
  });
});
