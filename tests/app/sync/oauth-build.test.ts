// The OAuth return page is a second Vite HTML entry (sync.md §5.4, §13 WP-S3): it must get the CSP
// meta from the build plugin and carry no inline script. The source checks always run; the built
// checks run once `npm run build` has produced dist/.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs from the repo root; import.meta.url is not a file URL in the dom environment.
const root = process.cwd();
const at = (p: string): string => join(root, p);
const pluginPath = at('build/vite-plugin-csp.ts');
const { CSP, cspPlugin } = (await import(/* @vite-ignore */ pluginPath)) as {
  CSP: string;
  cspPlugin: () => {
    configResolved(c: { command: string }): void;
    transformIndexHtml: { handler(html: string): string };
  };
};
const source = readFileSync(at('oauth-return.html'), 'utf8');
const metaRe = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?>/;
const inlineScripts = (html: string) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].filter(
    (m) => m[1]!.trim() !== '',
  );

describe('oauth-return.html source', () => {
  it('is a build entry in vite.config.ts and loads only its own module', () => {
    const cfg = readFileSync(at('vite.config.ts'), 'utf8');
    expect(cfg).toContain('./oauth-return.html');
    expect(cfg).toContain('rollupOptions');
    expect(source).toContain('src="/src/oauth/return.ts"');
    expect(inlineScripts(source)).toEqual([]);
    expect(source).not.toMatch(/\son[a-z]+=/i); // no inline handlers (the CSP would block them)
  });

  it('gets the CSP meta from the build plugin: right after charset, before anything else, not in dev', () => {
    const plugin = cspPlugin();
    plugin.configResolved({ command: 'build' });
    const out = plugin.transformIndexHtml.handler(source);
    const meta = metaRe.exec(out);
    expect(meta?.[1]?.replaceAll('&#39;', "'")).toBe(CSP);
    expect(out.indexOf('charset')).toBeLessThan(512);
    expect(out.indexOf(meta![0])).toBeGreaterThan(out.indexOf('charset'));
    expect(out.slice(0, out.indexOf(meta![0]))).not.toMatch(/<script|<link|<style/);
    expect(inlineScripts(out)).toEqual([]);
    const dev = cspPlugin();
    dev.configResolved({ command: 'serve' });
    expect(dev.transformIndexHtml.handler(source)).toBe(source);
  });

  it('the policy allows the Google hosts and nothing inline', () => {
    expect(CSP).toContain("script-src 'self' https://accounts.google.com/gsi/client");
    expect(CSP).toContain('connect-src');
    expect(CSP).toContain('https://www.googleapis.com');
    expect(CSP).toContain('https://oauth2.googleapis.com');
  });
});

describe.skipIf(!existsSync(at('dist/oauth-return.html')))('built dist/oauth-return.html', () => {
  const html = existsSync(at('dist/oauth-return.html'))
    ? readFileSync(at('dist/oauth-return.html'), 'utf8')
    : '';
  it('has the meta CSP and no inline script', () => {
    expect(metaRe.exec(html)?.[1]?.replaceAll('&#39;', "'")).toBe(CSP);
    expect(inlineScripts(html)).toEqual([]);
  });
  it('loads a bundled module and does not pull in the app', () => {
    const src = /<script type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
    expect(src).toMatch(/assets\/.+\.js$/);
    const js = readFileSync(at(`dist/${src!.replace(/^\.\//, '').replace(/^\//, '')}`), 'utf8');
    expect(js.length).toBeLessThan(20_000); // the redirect page, not the app
    expect(js).toContain('spinner:sync:token');
  });
  it('is precached by the service worker like the rest of dist', () => {
    const sw = readFileSync(at('dist/sw.js'), 'utf8');
    expect(sw).toContain('./oauth-return.html');
  });
});
