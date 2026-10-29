// The built HTML entries carry the production CSP as a meta tag (sync.md §5.5). Source checks
// always run; the built-output checks skip until `npm run build` has produced dist/.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// build/ belongs to the node tsconfig project, which this (app-project) test cannot reference, so
// the plugin is loaded by a computed path (as gallery.test.ts does).
const modPath = '../../build/vite-plugin-csp.ts';
const { CSP } = (await import(/* @vite-ignore */ modPath)) as { CSP: string };

const root = new URL('../../', import.meta.url);
const hasDist = existsSync(new URL('dist/index.html', root));

describe('CSP policy text', () => {
  const directives = Object.fromEntries(
    CSP.split('; ').map((d) => [d.split(' ')[0]!, d.split(' ').slice(1)]),
  );
  it('allows scripts only from self and Google Identity Services, never inline or eval', () => {
    expect(directives['script-src']).toEqual(["'self'", 'https://accounts.google.com/gsi/client']);
    expect(CSP).not.toContain("'unsafe-eval'");
    expect(directives['script-src']).not.toContain("'unsafe-inline'");
  });
  it('limits connections to Drive and the OAuth endpoints', () => {
    expect(directives['connect-src']).toEqual([
      "'self'",
      'https://www.googleapis.com',
      'https://accounts.google.com/gsi/',
      'https://oauth2.googleapis.com',
    ]);
  });
  it('locks everything else down', () => {
    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(directives['base-uri']).toEqual(["'self'"]);
    expect(directives['form-action']).toEqual(["'self'"]);
    expect(directives['worker-src']).toEqual(["'self'"]);
    expect(directives['frame-src']).toEqual(['https://accounts.google.com/gsi/']);
    expect(CSP).not.toContain('frame-ancestors'); // cannot be set in a meta tag
  });
});

describe.skipIf(!hasDist)('dist HTML entries', () => {
  const pages = hasDist
    ? readdirSync(new URL('dist/', root)).filter((f) => f.endsWith('.html'))
    : [];
  it('has at least index.html', () => {
    expect(pages).toContain('index.html');
  });
  it.each(pages)('%s has the meta CSP first in <head> and no inline script', (page) => {
    const html = readFileSync(new URL(`dist/${page}`, root), 'utf8');
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?>/.exec(html);
    expect(meta?.[1]?.replaceAll('&#39;', "'")).toBe(CSP);
    // the charset declaration must stay inside the first 1024 bytes
    expect(html.indexOf('charset')).toBeLessThan(1024);
    const before = html.slice(0, html.indexOf(meta![0]));
    expect(before).not.toMatch(/<script|<link|<style/);
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].filter(
      (m) => m[1]!.trim() !== '',
    );
    expect(inline).toEqual([]);
  });
});
