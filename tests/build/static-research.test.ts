// The static Research and Sources pages (build/static-research.ts, docs/seo.md): one page per
// chapter with the chapter's own text, tables whose numbers are the app's data and maths, a CTA into
// the app's chapter route, a Related block on every static page, and the exact house-edge table
// pinned to the roulette engine.
import { describe, expect, it } from 'vitest';
import { betEdge } from '@game/roulette/ev';
import { resolveRules } from '@game/roulette/rules';
import { parseHash } from '@app/router';
import { PRESET_SOURCES, SOURCE_GROUPS } from '@app/sources';
import { CHAPTERS } from '@app/screens/Research/content';
import { data, row } from '@app/screens/Research/data';
import { money, pct1, spins } from '@app/screens/Research/kit';
import { PLACEMENTS } from '@app/screens/Research/ChPlacement';
import { predictedHalfLife as appHalfLife } from '@app/screens/Research/ChLevels';
import { CASHOUT_ROWS, COLUMNS, STRATEGIES } from '@app/screens/Research/ChLimits';
import { CANDIDATE_ORDER as APP_CANDIDATE_ORDER } from '@app/screens/Research/TryIt';
import { CURVE_GROUPS } from '@app/screens/Research/ChCurve';
import { curveGroup } from '@app/screens/Research/Scatter';

// build/ is outside the app tsconfig project: load by a computed path, typed by the shapes used.
interface Table {
  caption: string;
  head: string[];
  rows: string[][];
}
interface EdgeBet {
  label: string;
  id: Record<string, string>;
}
type Wheel = 'european' | 'american' | 'triple-zero';
const researchPath = '../../build/static-research.ts';
const pagesPath = '../../build/static-pages.ts';
const research = (await import(/* @vite-ignore */ researchPath)) as {
  chapterTables: (id: string) => Table[];
  EDGE_BETS: EdgeBet[];
  exactEdge: (b: EdgeBet, w: Wheel) => { num: number; den: number };
  LA_PARTAGE_EDGE: { num: number; den: number };
  money: (c: number) => string;
  pct1: (x: number) => string;
  spins: (n: number) => string;
  PLACEMENTS: unknown;
  LEVELS: readonly number[];
  predictedHalfLife: (r: unknown, L: number) => number;
  LIMIT_STRATEGIES: { id: string; label: string }[];
  LIMIT_COLUMNS: { label: string; key: (s: string) => string }[];
  LIMIT_CASHOUT_ROWS: [string, string][];
  CANDIDATE_ORDER: string[];
  curveGroupLabel: (family: string) => string;
};
const pages = (await import(/* @vite-ignore */ pagesPath)) as {
  buildStaticSite: (o?: { dir?: string }) => Promise<{ files: Map<string, string> }>;
};

const root = new URL('../../', import.meta.url);
const site = await pages.buildStaticSite({ dir: new URL('gallery/', root).pathname });
const page = (f: string): string => {
  const html = site.files.get(f);
  if (!html) throw new Error(`no page ${f}`);
  return html;
};
const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const htmlFiles = [...site.files.keys()].filter((f) => f.endsWith('.html'));

describe('research chapter pages', () => {
  it.each(CHAPTERS.map((c, i) => [c.id, c, i] as const))(
    '%s renders the chapter text and links into the app chapter',
    (id, c) => {
      const html = page(`research/${id}/index.html`);
      for (const t of [c.lead, ...c.body, ...c.takeaways, ...c.math.text, ...c.math.formulas])
        expect(html).toContain(esc(t));
      // The CTA is the route the app's chapter links use (#/research?chapter=<id>).
      expect(html).toContain(`href="../../#/research?chapter=${id}"`);
      const parsed = parseHash(`#/research?chapter=${id}`);
      expect(parsed.path).toBe('/research');
      expect(parsed.query.get('chapter')).toBe(id);
      // Charts become real tables, never image-only results.
      expect(html).not.toMatch(/<img|<svg|<canvas/);
      expect(html.match(/<table>/g)?.length ?? 0).toBeGreaterThan(0);
      expect(html).toMatch(/<caption>[^<]+<\/caption>/);
      expect(html).toContain('<th scope="col">');
      expect(html).toContain('<th scope="row">');
    },
  );

  it('every table cell on the chapter pages is in the page, escaped', () => {
    for (const c of CHAPTERS) {
      const html = page(`research/${c.id}/index.html`);
      for (const t of research.chapterTables(c.id))
        for (const r of t.rows) for (const cell of r) expect(html).toContain(esc(cell));
    }
  });

  it('formats numbers like the Research screen (kit.tsx)', () => {
    for (const v of [-321044, 28600, 0, -46, 99, 123456789])
      expect(research.money(v)).toBe(money(v));
    for (const v of [0.9028, 0, 1, 0.0005]) expect(research.pct1(v)).toBe(pct1(v));
    for (const v of [290, 1117, 0]) expect(research.spins(v)).toBe(spins(v));
  });

  it('mirrors the row lists of the chapter charts', () => {
    expect(research.PLACEMENTS).toEqual(PLACEMENTS);
    expect(research.LIMIT_STRATEGIES.map((s) => [s.id, s.label])).toEqual(
      STRATEGIES.map((s) => [s.id, s.label]),
    );
    expect(research.LIMIT_COLUMNS.map((c) => [c.label, c.key('x')])).toEqual(
      COLUMNS.map((c) => [c.label, c.key('x')]),
    );
    expect(research.LIMIT_CASHOUT_ROWS).toEqual(CASHOUT_ROWS);
    expect(research.CANDIDATE_ORDER).toEqual(APP_CANDIDATE_ORDER);
    for (const p of data.curve)
      expect(research.curveGroupLabel(p.family)).toBe(
        CURVE_GROUPS.find((g) => g.id === curveGroup(p.family))!.label,
      );
    for (const L of research.LEVELS) {
      const r = row(`e3a-levels:e3a-L${L}`);
      expect(research.predictedHalfLife(r, L)).toBe(appHalfLife(r, L));
    }
  });

  it('pins the headline numbers to data.json', () => {
    const mart = row('observations:martingale-red');
    const m = page('research/martingale/index.html');
    expect(m).toContain(`stayed ahead until spin ${spins(mart.medianAheadUntil!)}`);
    expect(m).toContain(`the average result was ${money(mart.mean)}`);
    expect(m).toContain(`${pct1(mart.pBust)} of sessions had gone broke`);
    const cash = row('e7-c9:e7-c9-W20-SLhalf');
    const start = page('research/start/index.html');
    for (const v of [money(cash.median), pct1(cash.pWin), money(cash.mean), money(cash.cvar5)])
      expect(start).toContain(`<td>${esc(v)}</td>`);
    const index = page('research/index.html');
    expect(index).toContain(`${money(cash.median)} here, ending ahead ${pct1(cash.pWin)}`);
    expect(index).toContain(`Every one of the ${spins(Object.keys(data.rows).length)} simulated`);
    expect(Object.values(data.rows).every((r) => r.mean < 0)).toBe(true);
    const levels = page('research/levels/index.html');
    expect(levels).toContain(
      `<td>${spins(Math.round(appHalfLife(row('e3a-levels:e3a-L8'), 8)))}</td>`,
    );
    expect(levels).toContain(`spin ${spins(row('e3a-levels:e3a-L8').medianAheadUntil!)}`);
  });

  it('lists every chapter on the research index, with its lead', () => {
    const index = page('research/index.html');
    for (const c of CHAPTERS) {
      expect(index).toContain(`<a href="${c.id}/">${esc(c.title)}</a>`);
      expect(index).toContain(esc(c.lead));
    }
    expect(index).toContain('href="../#/research"');
  });
});

describe('roulette house edge (exact)', () => {
  it.each(['european', 'american', 'triple-zero'] as const)(
    'the %s column equals the engine edge of every bet',
    (wheel) => {
      const rules = resolveRules(wheel);
      for (const b of research.EDGE_BETS) {
        const e = betEdge(b.id[wheel]!, rules);
        expect(e, `${b.label} on ${wheel}`).not.toBeNull();
        const want = -Number(e!.edge.num) / Number(e!.edge.den);
        const got = research.exactEdge(b, wheel);
        expect(got.num / got.den).toBeCloseTo(want, 12);
      }
    },
  );

  it('la partage halves the even-money edge, as the engine says', () => {
    const e = betEdge('red', { ...resolveRules('european'), laPartage: true })!;
    expect(research.LA_PARTAGE_EDGE.num / research.LA_PARTAGE_EDGE.den).toBeCloseTo(
      -Number(e.edge.num) / Number(e.edge.den),
      12,
    );
  });

  it('answers "European vs American" in the first paragraph of the edge chapter', () => {
    const html = page('research/edge/index.html');
    const first = /<h1>[^<]*<\/h1>\s*<p class="verdict">([^<]+)<\/p>/.exec(html)?.[1] ?? '';
    expect(first).toMatch(/^The house edge in roulette is 2\.70% .* 5\.26% /);
    expect(first).toContain(money(row('e8-american:e8-am-flat-red').mean));
  });
});

describe('sources page', () => {
  const html = page('sources/index.html');
  it('lists every source with an anchor, its note and its link', () => {
    for (const g of SOURCE_GROUPS) {
      expect(html).toContain(`<h2>${esc(g.group)}</h2>`);
      for (const i of g.items) {
        expect(html).toContain(`<li id="${i.id}">`);
        expect(html).toContain(esc(i.note));
        if (i.url) expect(html).toContain(`href="${esc(i.url)}"`);
      }
    }
    expect(html).toContain('href="../#/sources"');
  });
  it('strategy pages link to their preset source by anchor', () => {
    for (const [slug, id] of Object.entries(PRESET_SOURCES)) {
      const f = `strategies/${slug}/index.html`;
      if (site.files.has(f))
        expect(page(f)).toContain(`href="https://creynia.com/spinner/sources/#${id}"`);
    }
  });
});

describe('every static page', () => {
  /** dist file for a link, or null when the link leaves the static site. */
  const target = (href: string, from: string): string | null => {
    const base = `https://creynia.com/spinner/${from.replace(/index\.html$/, '')}`;
    const u = new URL(href, base);
    if (u.origin !== 'https://creynia.com' || !u.pathname.startsWith('/spinner/')) return null;
    if (u.hash.startsWith('#/')) return null; // a route into the app
    const rel = u.pathname.slice('/spinner/'.length);
    return rel === '' ? 'index.html' : rel.endsWith('/') ? `${rel}index.html` : rel;
  };

  it.each(htmlFiles)('%s has a Related block of 3-5 links that all resolve', (f) => {
    const html = page(f);
    const block = /<nav class="related"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
    expect(block).toBeDefined();
    const links = [...block!.matchAll(/<a href="([^"]+)">/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(links.length).toBeLessThanOrEqual(5);
    expect(new Set(links).size).toBe(links.length);
    for (const l of links) {
      const t = target(l, f);
      expect(t, l).not.toBeNull();
      expect(site.files.has(t!.split('#')[0]!), l).toBe(true);
    }
  });

  it.each(htmlFiles)('%s links only to pages that exist', (f) => {
    for (const [, href] of page(f).matchAll(/href="([^"]+)"/g)) {
      const t = target(href!, f);
      if (t === null || t === 'index.html' || t === 'icon.svg') continue;
      expect(site.files.has(t), `${f} -> ${href}`).toBe(true);
    }
  });

  it.each([...site.files.keys()])('%s has no raw template or markdown syntax', (f) => {
    const text = page(f)
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
      .replaceAll('xoshiro128**', 'xoshiro128'); // the generator's real name
    for (const bad of ['${', 'undefined', 'NaN', '[object', '**', '`', 'Infinity'])
      expect(text, bad).not.toContain(bad);
  });
});
