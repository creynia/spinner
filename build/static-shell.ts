// Shared shell of the static crawler pages (docs/seo.md): constants, escaping, the page template
// with head tags, JSON-LD breadcrumb, header and footer, the "Related" block and the sitemap.
// Used by static-pages.ts (strategies) and static-research.ts (research and sources).
export const ORIGIN = 'https://creynia.com';
export const APP = 'spinner';
export const APP_URL = `${ORIGIN}/${APP}/`;
export const THEME = '#0d3b2e';
export const OG_IMAGE = `${ORIGIN}/assets/og/${APP}.jpg`;
export const PERSON_ID = `${ORIGIN}/#creynia`;
export const WEBSITE_ID = `${ORIGIN}/#website`;
export const OTHER_APPS = [
  { id: 'crappy', game: 'Craps' },
  { id: 'baccaratton', game: 'Baccarat' },
  { id: 'holdumb', game: "Ultimate Texas Hold'em" },
];

export type Obj = Record<string, unknown>;

// ---------------------------------------------------------------- text helpers

export const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Strips the tags of a small HTML fragment for llms-full.txt (the fragments here are simple). */
export function toText(html: string): string {
  return html
    .replace(/<li>/g, '- ')
    .replace(/<h2[^>]*>/g, '### ')
    .replace(/<h3[^>]*>/g, '#### ')
    .replace(/<\/(p|li|h2|h3|tr|ul|ol|table|dl|div|pre|caption)>/g, '\n')
    .replace(/<(td|th|dd)[^>]*>/g, ' | ')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------- page shell

export interface Crumb {
  name: string;
  url: string;
}

export interface PageInput {
  path: string; // '/spinner/strategies/x/' relative to the origin
  title: string;
  description: string;
  h1: string;
  body: string;
  crumbs: Crumb[];
  graph: Obj[];
  /** Relative prefix from this page to the app root ('../' or '../../'). */
  up: string;
}

const STYLE = `
:root{color-scheme:dark;--felt:${THEME};--bg:#082419;--ink:#eef3ee;--muted:#a9c2b4;--gold:#e0bb4a;--line:#2c5a49;--card:#0f4434}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--gold)}
header,nav.crumbs,main,footer{max-width:72ch;margin:0 auto;padding-left:16px;padding-right:16px}
header{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline;justify-content:space-between;padding-top:16px;padding-bottom:12px;border-bottom:1px solid var(--line);max-width:none;background:var(--felt)}
header .brand{color:var(--muted);text-decoration:none;font-size:.9rem}
header .app{color:var(--ink);font-weight:700;text-decoration:none;font-size:1.1rem}
nav.crumbs{font-size:.85rem;color:var(--muted);padding-top:12px}
nav.crumbs ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px}
nav.crumbs li+li::before{content:"›";margin-right:4px;color:var(--muted)}
h1{font-size:1.75rem;line-height:1.25;margin:.6em 0 .3em}
h2{font-size:1.3rem;margin:1.6em 0 .4em}
h3{font-size:1.05rem;margin:1.2em 0 .3em}
.lead{color:var(--muted);font-size:1.05rem}
.verdict{font-weight:600;background:var(--card);border-left:4px solid var(--gold);padding:10px 14px;border-radius:6px}
.cta{display:inline-block;background:var(--gold);color:#1b1503;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:8px;margin:8px 8px 8px 0}
.cta.secondary{background:transparent;color:var(--gold);border:2px solid var(--gold)}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:.95rem}
caption{text-align:left;color:var(--muted);font-size:.85rem;padding-bottom:4px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
td{white-space:nowrap;font-variant-numeric:tabular-nums}
thead th{color:var(--muted);font-weight:600;font-size:.85rem}
.note{display:block;color:var(--muted);font-weight:400;font-size:.82rem}
dl.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:4px 16px;margin:8px 0}
dl.facts div{border-bottom:1px solid var(--line);padding:4px 0}
dt{color:var(--muted);font-size:.85rem}dd{margin:0;font-weight:600}
.ladder{font-variant-numeric:tabular-nums}
ul.cards{list-style:none;padding:0;display:grid;gap:12px}
ul.cards li{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
ul.cards h3{margin:0 0 4px}
ul.cards .eyebrow{margin:0;color:var(--muted);font-size:.8rem}
ul.takeaways{background:var(--card);border-left:4px solid var(--gold);border-radius:6px;padding:10px 14px 10px 32px}
pre.formulas{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 12px;overflow-x:auto;font-size:.88rem;line-height:1.5;white-space:pre}
nav.related{margin:24px 0 0;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:8px}
nav.related h2{margin:0 0 6px;font-size:1.05rem}
nav.related ul{margin:0;padding-left:20px}
nav.related li{margin:4px 0}
nav.related .note{display:inline;margin-left:4px}
ul.sources{padding-left:20px}
ul.sources li{margin:8px 0}
.pager{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin:24px 0;padding-top:12px;border-top:1px solid var(--line)}
footer{color:var(--muted);font-size:.85rem;line-height:1.6;padding-top:24px;padding-bottom:32px;border-top:1px solid var(--line);margin-top:32px}
footer strong{color:var(--ink)}
.ci-narrow{display:none}
@media (max-width:640px){table.keys .ci{display:none}table.keys .ci-narrow{display:block;color:var(--muted);font-weight:400;font-size:.8rem;white-space:normal}table.keys th[scope=row]{width:58%}}
@media (max-width:420px){body{font-size:16px}h1{font-size:1.45rem}th,td{padding:6px 4px}}
`
  .trim()
  .replace(/\n/g, '');

const CSP_STATIC =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'";

function breadcrumbLd(crumbs: Crumb[], id: string): Obj {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${id}#breadcrumb`,
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

function footer(): string {
  const others = OTHER_APPS.map(
    (a) => `<a href="${ORIGIN}/${a.id}/">${esc(a.game)} (${a.id})</a>`,
  ).join(' · ');
  return `<footer>
<p><strong>For education only, with play money only.</strong> The house always has an edge, and no betting system changes that. These apps show how big the edge is, not how to beat it.</p>
<p>If gambling is hurting you or someone you know, call or text <strong>1-800-GAMBLER</strong> (US), or contact your national problem-gambling helpline.</p>
<p>More from Know the Odds: ${others} · <a href="${ORIGIN}/">creynia.com</a></p>
</footer>`;
}

export function renderPage(p: PageInput): string {
  const url = ORIGIN + p.path;
  const graph = [...p.graph, breadcrumbLd(p.crumbs, url)];
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll(
    '<',
    '\\u003c',
  );
  const crumbs = p.crumbs
    .map((c, i) =>
      i === p.crumbs.length - 1
        ? `<li aria-current="page">${esc(c.name)}</li>`
        : `<li><a href="${c.url}">${esc(c.name)}</a></li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP_STATIC}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="${THEME}">
<link rel="icon" type="image/svg+xml" href="${p.up}icon.svg">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Know the Odds">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<script type="application/ld+json">${ld}</script>
<style>${STYLE}</style>
</head>
<body>
<header><a class="brand" href="${ORIGIN}/">Know the Odds</a><a class="app" href="${p.up}">spinner · Roulette strategy lab</a></header>
<nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs}</ol></nav>
<main>
<h1>${esc(p.h1)}</h1>
${p.body}
</main>
${footer()}
</body>
</html>
`;
}

export interface PageOut {
  file: string;
  path: string;
  html: string;
  title: string;
  description: string;
  text: string;
}

export interface RelatedLink {
  href: string;
  title: string;
  /** One short line after the link (plain text). */
  note?: string;
}

/**
 * The "Related" block at the bottom of a static page: 3 to 5 links to closely related pages,
 * deduplicated by href and in the order given (callers pick them from the data).
 */
export function relatedHtml(links: RelatedLink[]): string {
  const seen = new Set<string>();
  const unique = links.filter((l) => !seen.has(l.href) && seen.add(l.href)).slice(0, 5);
  if (unique.length === 0) return '';
  const items = unique
    .map(
      (l) =>
        `<li><a href="${l.href}">${esc(l.title)}</a>${l.note ? `<span class="note">${esc(l.note)}</span>` : ''}</li>`,
    )
    .join('');
  return `<nav class="related" aria-labelledby="related-h"><h2 id="related-h">Related</h2><ul>${items}</ul></nav>`;
}

export function sitemapXml(paths: string[]): string {
  const urls = paths.map((p) => `  <url><loc>${ORIGIN}${p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
