// The static crawler pages (build/static-pages.ts, docs/seo.md): one page per gallery bundle, every
// page well formed, the sitemap equal to the pages, and the numbers identical to what the Analyze
// screen shows. Source checks build the site in memory; the dist checks skip until `npm run build`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeFramer } from '@core/ui/results/format';
import { verdictLine } from '@core/ui/results/AnalysisView';

// build/ belongs to the node tsconfig project, which this (app-project) test cannot reference, so
// the module is loaded by a computed path (as gallery.test.ts does) and typed by the shapes used.
interface Metrics {
  n: number;
  length: { mean: { value: number } };
}
interface Page {
  slug: string;
  metrics: Metrics;
  data: { definition: { session: { roundsPerHour: number } } };
}
const modPath = '../../build/static-pages.ts';
const mod = (await import(/* @vite-ignore */ modPath)) as {
  buildStaticSite: (o?: {
    dir?: string;
  }) => Promise<{ files: Map<string, string>; paths: string[] }>;
  loadStrategies: (o?: { dir?: string }) => Promise<Page[]>;
  isStaticSiteFile: (f: string) => boolean;
  stakePlan: (s: Record<string, unknown>) => { paragraphs: string[]; ladder?: number[] };
  ORIGIN: string;
};

const root = new URL('../../', import.meta.url);
const galleryDir = new URL('gallery/', root).pathname;
const slugs = (
  JSON.parse(readFileSync(new URL('gallery/order.json', root), 'utf8')) as string[]
).map((f) => f.replace(/\.spinner\.json(\.gz)?$/, ''));

const site = await mod.buildStaticSite({ dir: galleryDir });
const strategies = await mod.loadStrategies({ dir: galleryDir });
const htmlPages = [...site.files].filter(([f]) => f.endsWith('.html'));

const one = (html: string, re: RegExp): string[] => [...html.matchAll(re)].map((m) => m[1]!);

describe('static strategy pages', () => {
  it('has the index and one page per gallery bundle, in gallery order', () => {
    expect(htmlPages.map(([f]) => f)).toEqual([
      'strategies/index.html',
      ...slugs.map((s) => `strategies/${s}/index.html`),
    ]);
  });

  it.each(htmlPages)('%s has one h1, a title, a description and a canonical', (file, html) => {
    const path = `/spinner/${file.replace(/index\.html$/, '')}`;
    expect(one(html, /<h1>([\s\S]*?)<\/h1>/g)).toHaveLength(1);
    const titles = one(html, /<title>([^<]+)<\/title>/g);
    expect(titles).toHaveLength(1);
    expect(titles[0]!.length).toBeLessThanOrEqual(62);
    const desc = one(html, /<meta name="description" content="([^"]+)">/g);
    expect(desc).toHaveLength(1);
    expect(desc[0]!.length).toBeGreaterThanOrEqual(120);
    expect(desc[0]!.length).toBeLessThanOrEqual(160);
    expect(one(html, /<link rel="canonical" href="([^"]+)">/g)).toEqual([
      `https://creynia.com${path}`,
    ]);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('og:image" content="https://creynia.com/assets/og/spinner.jpg"');
    expect(html).toContain('1-800-GAMBLER');
    // JSON-LD parses and carries the breadcrumb and the shared person id.
    const ld = JSON.parse(
      one(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)[0]!,
    ) as {
      '@graph': { '@type': string | string[] }[];
    };
    expect(ld['@graph'].some((n) => n['@type'] === 'BreadcrumbList')).toBe(true);
    expect(JSON.stringify(ld)).toContain('https://creynia.com/#creynia');
    // No script runs on these pages, and no link leaves for the old host.
    expect(
      html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ''),
    ).not.toMatch(/<script/);
    expect(html).not.toContain('github.io');
  });

  it.each(strategies.map((s) => [s.slug, s] as const))(
    '%s shows the Analyze verdict and links into the gallery entry',
    (slug, s) => {
      const html = site.files.get(`strategies/${slug}/index.html`)!;
      const fr = makeFramer(
        'session',
        s.metrics.length.mean.value,
        s.data.definition.session.roundsPerHour,
      );
      // verdictLine is the Analyze screen's own verdict (per session framing, the default).
      const v = verdictLine(s.metrics as never, fr);
      expect(html).toContain(`<p class="verdict">${v}</p>`);
      expect(html).toContain(`href="../../#/gallery/${slug}"`);
    },
  );

  it('explains the stake ladder from the definition (strategy.md §7.4)', () => {
    const mart = mod.stakePlan({
      unit: 2500,
      stages: [{ id: 'p', layout: [{ bet: 'red', amount: { prog: 'm' } }] }],
      progressions: { m: { kind: 'martingale', maxSteps: 8, onCap: 'reset', track: 'red' } },
    });
    expect(mart.ladder).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
    const fib = mod.stakePlan({
      unit: 2500,
      stages: [{ id: 'p', layout: [{ bet: 'red', amount: { prog: 'f' } }] }],
      progressions: { f: { kind: 'fibonacci', maxSteps: 12, track: 'red' } },
    });
    expect(fib.ladder).toEqual([1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]);
    const dal = mod.stakePlan({
      unit: 2500,
      stages: [{ id: 'p', layout: [{ bet: 'red', amount: { prog: 'd' } }] }],
      progressions: { d: { kind: 'dalembert', maxSteps: 20, track: 'red' } },
    });
    expect(dal.ladder?.at(-1)).toBe(20);
    expect(dal.paragraphs.join(' ')).toContain('stays at the top stake');
  });
});

describe('sitemap and llms files', () => {
  const sitemap = site.files.get('sitemap.xml')!;
  const locs = one(sitemap, /<loc>([^<]+)<\/loc>/g);

  it('lists the app root and exactly the emitted pages, absolute with a trailing slash', () => {
    const pages = htmlPages.map(
      ([f]) => `https://creynia.com/spinner/${f.replace(/index\.html$/, '')}`,
    );
    expect(locs).toEqual(['https://creynia.com/spinner/', ...pages]);
    expect(site.paths.map((p) => mod.ORIGIN + p)).toEqual(locs);
    expect(sitemap).not.toContain('<lastmod>');
  });

  it('llms.txt follows llmstxt.org and links every page', () => {
    const llms = site.files.get('llms.txt')!;
    expect(llms.split('\n')[0]).toBe('# spinner — Roulette (betting-system strategy lab)');
    expect(llms).toMatch(/\n> \S/);
    for (const loc of locs) expect(llms).toContain(`](${loc})`);
  });

  it('llms-full.txt carries the text of every strategy page', () => {
    const full = site.files.get('llms-full.txt')!;
    for (const s of strategies) expect(full).toContain(`/strategies/${s.slug}/`);
    expect(full).toContain('1-800-GAMBLER');
  });

  it('marks every emitted file as static (excluded from the service worker precache)', () => {
    for (const f of site.files.keys()) expect(mod.isStaticSiteFile(f)).toBe(true);
    for (const f of ['index.html', 'gallery/index.json', 'assets/x.js', 'manifest.webmanifest'])
      expect(mod.isStaticSiteFile(f)).toBe(false);
  });
});

const hasDist = existsSync(new URL('dist/strategies/index.html', root));
describe.skipIf(!hasDist)('dist static site', () => {
  it('holds exactly the files the module builds', () => {
    const walk = (d: URL): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(new URL(`${e.name}/`, d)).map((f) => `${e.name}/${f}`) : [e.name],
      );
    const built = [
      ...walk(new URL('dist/strategies/', root)).map((f) => `strategies/${f}`),
      ...['sitemap.xml', 'llms.txt', 'llms-full.txt'].filter((f) =>
        existsSync(new URL(`dist/${f}`, root)),
      ),
    ].sort();
    expect(built).toEqual([...site.files.keys()].sort());
    for (const f of built)
      expect(readFileSync(new URL(`dist/${f}`, root), 'utf8')).toBe(site.files.get(f));
  });
  it('the app shell has the canonical, JSON-LD and a noscript link to the strategies', () => {
    const html = readFileSync(new URL('dist/index.html', root), 'utf8');
    expect(html).toContain('<link rel="canonical" href="https://creynia.com/spinner/"');
    expect(html).toContain('"@type": "WebApplication"');
    expect(html).toMatch(/<noscript>[\s\S]*href="\.\/strategies\/"[\s\S]*<\/noscript>/);
  });
});
