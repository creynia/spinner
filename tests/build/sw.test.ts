// Source checks always run; the built-output checks skip until `npm run build` has produced dist/.
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
