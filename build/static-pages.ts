// Static, JS-free pages for search engines and LLMs (docs/seo.md). The app uses hash routes, which
// crawlers ignore, so the build also writes real pages at /strategies/ and /strategies/<slug>/, one
// per gallery bundle, plus sitemap.xml, llms.txt and llms-full.txt. Every number on a page comes
// from the bundle itself through the same analysis (`runMetrics`, `survival`) and the same
// formatting helpers (`fmtMoney`, `fmtPct`) the Analyze screen uses; nothing is typed in by hand.
import type { Plugin } from 'vite';
// Relative imports: the config's own imports do not see Vite's alias (as in vite-plugin-gallery.ts).
import { runMetrics, survival } from '../src/core/analysis/index.ts';
import type { RunMetrics } from '../src/core/contracts/analysis.ts';
import type { RunData } from '../src/core/contracts/run.ts';
import { decodeRunBundle } from '../src/core/store/index.ts';
import { fmtInt, fmtMoney, fmtPct, fmtZ } from '../src/core/ui/results/format.ts';
import {
  TABLE_MAX,
  buildGallery,
  type GalleryEntry,
  type GalleryOptions,
} from './vite-plugin-gallery.ts';

export const ORIGIN = 'https://creynia.com';
export const APP = 'spinner';
export const APP_URL = `${ORIGIN}/${APP}/`;
export const THEME = '#0d3b2e';
const OG_IMAGE = `${ORIGIN}/assets/og/${APP}.jpg`;
const PERSON_ID = `${ORIGIN}/#creynia`;
const WEBSITE_ID = `${ORIGIN}/#website`;
const OTHER_APPS = [
  { id: 'crappy', game: 'Craps' },
  { id: 'baccaratton', game: 'Baccarat' },
  { id: 'holdumb', game: "Ultimate Texas Hold'em" },
];

/**
 * True for a dist file written by this module. The service worker must not precache these (they
 * are for crawlers, and a precached copy would go stale) nor answer their navigations with the
 * app shell.
 */
export function isStaticSiteFile(file: string): boolean {
  return (
    file.startsWith('strategies/') ||
    file === 'sitemap.xml' ||
    file === 'llms.txt' ||
    file === 'llms-full.txt'
  );
}

// ---------------------------------------------------------------- text helpers

const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Strips the tags of a small HTML fragment for llms-full.txt (the fragments here are simple). */
function toText(html: string): string {
  return html
    .replace(/<li>/g, '- ')
    .replace(/<h2>/g, '### ')
    .replace(/<\/(p|li|h2|h3|tr|ul|ol|table|dl|div)>/g, '\n')
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

const plural = (n: number, w: string): string => `${fmtInt(n)} ${w}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- the definition, in words

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

const WHEELS: Record<string, { name: string; detail: string }> = {
  european: { name: 'European', detail: 'single zero, 37 pockets' },
  american: { name: 'American', detail: 'double zero, 38 pockets' },
  'triple-zero': { name: 'Triple-zero', detail: '0, 00 and 000, 39 pockets' },
};

/** Payouts by bet family (the roulette plugin's table, src/game/roulette/bets.ts). */
const PAYS: Record<string, number> = {
  straight: 35,
  split: 17,
  street: 11,
  trio: 11,
  corner: 8,
  sixline: 5,
  dozen: 2,
  column: 2,
};
const EVEN_MONEY: Record<string, string> = {
  red: 'red',
  black: 'black',
  odd: 'odd',
  even: 'even',
  low: '1-18 (low)',
  high: '19-36 (high)',
};

export function betText(id: string): string {
  if (EVEN_MONEY[id]) return `${EVEN_MONEY[id]}, pays 1 to 1`;
  const [family = id, ...rest] = id.split(':');
  const pockets = rest.join(':').replaceAll('-', ', ');
  const pays = PAYS[family];
  const what =
    family === 'straight'
      ? `${pockets === '0' ? 'zero' : pockets} (straight up)`
      : family === 'sixline'
        ? `the six-line ${rest.join(':').split('-')[0]}-${rest.join(':').split('-').at(-1)}`
        : family === 'dozen' || family === 'column'
          ? `${family} ${pockets}`
          : pockets
            ? `${family} ${pockets}`
            : family;
  return pays ? `${what}, pays ${pays} to 1` : what;
}

const FIB = [1, 1];
for (let i = 2; i < 64; i++) FIB.push(FIB[i - 1]! + FIB[i - 2]!);

/** Base of a progression in units (`{ units: n }`, the default `{ units: 1 }`), or null if not units. */
function baseUnits(spec: Obj): number | null {
  const b = spec.base ?? { units: 1 };
  return isObj(b) && typeof b.units === 'number' ? b.units : null;
}

const ON_CAP: Record<string, string> = {
  reset: 'it goes back to the first stake',
  stay: 'it stays at the top stake',
  stop: 'the session stops',
};
/** Kind-specific `onCap` defaults (docs/design/strategy.md §7.4). */
const DEFAULT_ON_CAP: Record<string, string> = {
  martingale: 'reset',
  fibonacci: 'reset',
  dalembert: 'stay',
  labouchere: 'reset',
};

export interface StakePlan {
  /** Sentences in HTML (escaped). */
  paragraphs: string[];
  /** The stake ladder in units, when the progression has levels. */
  ladder?: number[];
}

function moneyUnits(units: number, unit: number): string {
  return fmtMoney(units * unit);
}

/**
 * How the stakes move, from the definition (strategy.md §7.4 is the source of every rule here).
 * Unknown kinds give no paragraphs; the page then relies on the definition's own notes.
 */
export function stakePlan(strategy: Obj): StakePlan {
  const unit = strategy.unit as number;
  const stages = (strategy.stages as Obj[] | undefined) ?? [];
  const layout = ((stages[0]?.layout as Obj[] | undefined) ?? []).filter((l) => isObj(l));
  const progs = (strategy.progressions as Record<string, Obj> | undefined) ?? {};
  const out: StakePlan = { paragraphs: [] };
  if (stages.length !== 1 || Object.keys(progs).length > 1) return out;

  const fixed = layout.every((l) => isObj(l.amount) && typeof l.amount.units === 'number');
  if (fixed) {
    const parts = layout.map((l) => {
      const u = (l.amount as Obj).units as number;
      return `${plural(u, 'unit')} (${moneyUnits(u, unit)}) on ${betText(l.bet as string)}`;
    });
    const total = layout.reduce((s, l) => s + ((l.amount as Obj).units as number), 0);
    out.paragraphs.push(
      `Every spin the same ${layout.length === 1 ? 'bet' : 'bets'}, whatever happened before: ${esc(parts.join('; '))}.` +
        (layout.length > 1
          ? ` That is ${plural(total, 'unit')} (${moneyUnits(total, unit)}) a spin.`
          : ''),
      layout.length === 1
        ? 'There is no progression: the stake never changes, so this is the baseline that every progression is measured against.'
        : 'There is no progression: the stakes never change, win or lose.',
    );
    return out;
  }

  const [name, spec] = Object.entries(progs)[0] ?? [];
  if (!name || !spec || layout.length !== 1) return out;
  const bet = layout[0]!.bet as string;
  const base = baseUnits(spec);
  if (base === null) return out;
  const kind = spec.kind as string;
  const onCap = (spec.onCap as string | undefined) ?? DEFAULT_ON_CAP[kind] ?? 'reset';
  const capText = ON_CAP[onCap] ?? onCap;
  const on = `One bet each spin, on ${esc(betText(bet))}.`;
  const u = (n: number) => `${plural(n, 'unit')} (${moneyUnits(n, unit)})`;

  if (kind === 'martingale') {
    const m = (spec.multiplier as number | undefined) ?? 2;
    const L = spec.maxSteps as number;
    out.ladder = Array.from({ length: L }, (_, k) => m ** k * base);
    out.paragraphs.push(
      `${on} It starts at ${u(base)}. After each loss the stake is ${m === 2 ? 'doubled' : `multiplied by ${m}`}, ${m === 2 ? 'so one win recovers every loss in the streak plus one starting stake; ' : ''}after a win it goes back to ${u(base)}.`,
      `There are ${L} levels, up to ${u(out.ladder.at(-1)!)}. A loss at the top level would need a bigger stake than the plan allows, so ${capText}, and the losses of that streak stay lost.`,
    );
  } else if (kind === 'fibonacci') {
    const L = (spec.maxSteps as number | undefined) ?? 20;
    const back = (spec.back as number | undefined) ?? 2;
    out.ladder = FIB.slice(0, L).map((f) => f * base);
    out.paragraphs.push(
      `${on} The stake follows the Fibonacci sequence (each number is the sum of the two before it), in units of ${moneyUnits(base, unit)}. After a loss it moves one place along the sequence; after a win it moves back ${plural(back, 'place')} (never before the first).`,
      `There are ${L} levels, up to ${u(out.ladder.at(-1)!)}. A loss at the top level ends the climb: ${capText}.`,
    );
  } else if (kind === 'dalembert') {
    const L = (spec.maxSteps as number | undefined) ?? 50;
    const step = isObj(spec.step) && typeof spec.step.units === 'number' ? spec.step.units : base;
    out.ladder = Array.from({ length: L }, (_, k) => base + k * step);
    out.paragraphs.push(
      `${on} It starts at ${u(base)}. After a loss the stake goes up by ${u(step)}; after a win it comes down by ${u(step)}, never below the start.`,
      `There are ${L} levels, up to ${u(out.ladder.at(-1)!)}; a loss at the top level means ${capText}.`,
    );
  } else if (kind === 'labouchere') {
    const line = spec.line as number[];
    const maxLength = (spec.maxLength as number | undefined) ?? 32;
    const onEmpty = (spec.onEmpty as string | undefined) ?? 'reset';
    out.paragraphs.push(
      `${on} Write down the line ${line.join('-')} (in units of ${moneyUnits(base, unit)}). Each spin, bet the first plus the last number of the line (or the only one left). A win crosses both numbers off; a loss adds the amount just lost to the end of the line.`,
      `When the line is empty, the cycle has won ${plural(
        line.reduce((s, x) => s + x, 0),
        'unit',
      )} (the sum of the starting line) and ${onEmpty === 'stop' ? 'the session stops' : 'a new line starts'}. If a loss would make the line longer than ${fmtInt(maxLength)} numbers, ${capText.replace('the first stake', 'a fresh line')}, and that cycle's losses stay lost.`,
    );
  }
  if (spec.maxAmount !== undefined)
    out.paragraphs.push('A stake above the progression’s maximum amount counts as the top.');
  return out;
}

// ---------------------------------------------------------------- one strategy's facts

export interface StrategyPage {
  slug: string;
  entry: GalleryEntry;
  data: RunData;
  metrics: RunMetrics;
  medianRounds: number | null;
  tableMax: number | undefined;
}

export async function loadStrategies(opts: GalleryOptions = {}): Promise<StrategyPage[]> {
  const g = await buildGallery(opts);
  const out: StrategyPage[] = [];
  for (const entry of g.index.entries) {
    const raw = g.files.get(entry.file)!;
    const res = await decodeRunBundle(new Uint8Array(raw), entry.game.id);
    if ('error' in res) throw new Error(`gallery/${entry.slug}: ${res.error}`);
    const data = res.data;
    // Analyze passes the even-money maximum of the resolved rules (tableMaxFor); every preset has
    // the same high-limit table (decisions #3), the value the gallery index uses. With rule
    // overrides the limits could differ, so the page then says "unknown" rather than guess.
    const rules = data.definition.game.rules as { overrides?: Obj };
    const tableMax =
      rules.overrides && Object.keys(rules.overrides).length > 0 ? undefined : TABLE_MAX;
    out.push({
      slug: entry.slug,
      entry,
      data,
      metrics: runMetrics(data, { tableMax }),
      medianRounds: survival(data).medianRounds,
      tableMax,
    });
  }
  return out;
}

/** The Analyze verdict in the per-session framing (AnalysisView's verdictLine). */
export function verdict(m: RunMetrics): string {
  const ci = m.net.mean.ci;
  const pm = ci ? ` ± ${fmtMoney((ci.hi - ci.lo) / 2)}` : '';
  return `mean ${fmtMoney(m.net.mean.value, { sign: true })}${pm} per session · P(ahead) ${fmtPct(m.probabilities.ahead.p)} · bust ${fmtPct(m.probabilities.bust.p)}`;
}

interface Row {
  label: string;
  value: string;
  ci?: string;
  note?: string;
}

const ciMoney = (ci?: { lo: number; hi: number }, sign = false): string | undefined =>
  ci ? `${fmtMoney(ci.lo, { sign })} to ${fmtMoney(ci.hi, { sign })}` : undefined;
const ciPct = (ci: { lo: number; hi: number }): string => `${fmtPct(ci.lo)} to ${fmtPct(ci.hi)}`;

function resultRows(p: StrategyPage): Row[] {
  const m = p.metrics;
  const rph = p.data.definition.session.roundsPerHour;
  const rows: Row[] = [
    {
      label: 'Mean net result per session',
      value: fmtMoney(m.net.mean.value, { sign: true }),
      ci: ciMoney(m.net.mean.ci, true),
    },
    {
      label: 'Median net result per session',
      value: fmtMoney(m.net.q.p50, { sign: true }),
      ci: ciMoney(m.net.medianCI, true),
    },
    {
      label: '10th / 90th percentile of the net result',
      value: `${fmtMoney(m.net.q.p10, { sign: true })} / ${fmtMoney(m.net.q.p90, { sign: true })}`,
    },
    {
      label: 'Best / worst session',
      value: `${fmtMoney(m.net.max, { sign: true })} / ${fmtMoney(m.net.min, { sign: true })}`,
    },
    { label: 'Spread (SD) per session', value: fmtMoney(m.volatility.sdSession) },
    {
      label: 'Chance of finishing ahead',
      value: fmtPct(m.probabilities.ahead.p),
      ci: ciPct(m.probabilities.ahead.ci),
    },
    {
      label: 'Chance of going bust (losing the whole bankroll)',
      value: fmtPct(m.probabilities.bust.p),
      ci: ciPct(m.probabilities.bust.ci),
    },
    {
      label: `Chance of playing all ${fmtInt(p.data.definition.session.maxRounds)} spins`,
      value: fmtPct(m.probabilities.cap.p),
      ci: ciPct(m.probabilities.cap.ci),
    },
    {
      label: 'Expected loss per session',
      value: fmtMoney(m.expected.meanExpectedLoss),
      note: 'exact, from the odds of every bet placed',
    },
    {
      label: 'Realized loss per session',
      value: fmtMoney(m.expected.meanRealizedLoss.value),
      ci: ciMoney(m.expected.meanRealizedLoss.ci),
    },
    {
      label: 'Expected loss per hour',
      value: fmtMoney(m.edge.costOfPlayPerHour),
      note: `at ${fmtInt(rph)} spins an hour`,
    },
  ];
  if (m.edge.realized && m.edge.analytic !== null)
    rows.push({
      label: 'House edge: realized vs exact',
      value: `${fmtPct(m.edge.realized.value)} vs ${fmtPct(m.edge.analytic)}`,
      ci: m.edge.realized.ci ? ciPct(m.edge.realized.ci) : undefined,
      note: 'loss as a share of everything wagered',
    });
  rows.push({
    label: 'Mean amount wagered per session',
    value: fmtMoney(meanWagered(p.data, m.n)),
  });
  rows.push({
    label: 'Run luck (z)',
    value: fmtZ(m.expected.luckZ),
    note: 'how far the whole run is from the odds; within ±2 is ordinary',
  });
  for (const [k, pr] of [
    ['stop-win', m.probabilities.stopWin],
    ['stop-loss', m.probabilities.stopLoss],
  ] as const)
    if (pr.k > 0) rows.push({ label: `Chance of a ${k}`, value: fmtPct(pr.p), ci: ciPct(pr.ci) });
  return rows;
}

function meanWagered(d: RunData, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += d.summary.wagered[i]!;
  return n ? s / n : 0;
}

function riskRows(p: StrategyPage): Row[] {
  const m = p.metrics;
  const B = p.data.definition.session.bankroll;
  const dd = m.drawdown;
  const ex = m.exposure;
  const rows: Row[] = [
    {
      label: 'Mean max drawdown (largest fall from a peak)',
      value: fmtMoney(dd.mean.value),
      ci: ciMoney(dd.mean.ci),
    },
    { label: 'Median max drawdown', value: fmtMoney(dd.q.p50), ci: ciMoney(dd.medianCI) },
    {
      label: '90th / 99th percentile drawdown',
      value: `${fmtMoney(dd.q.p90)} / ${fmtMoney(dd.q.p99)}`,
    },
    {
      label: `Chance of a drawdown of at least half the bankroll (${fmtMoney(B / 2)})`,
      value: fmtPct(dd.pHalfBankroll.p),
      ci: ciPct(dd.pHalfBankroll.ci),
    },
    {
      label: 'Mean largest amount on the table',
      value: fmtMoney(ex.mean.value),
      ci: ciMoney(ex.mean.ci),
    },
    { label: '99th percentile largest amount on the table', value: fmtMoney(ex.q.p99) },
    { label: 'Largest amount on the table in any session', value: fmtMoney(ex.max) },
  ];
  rows.push(
    ex.pAtTableMax
      ? {
          label: `Chance of reaching the table maximum (${fmtMoney(p.tableMax ?? 0)})`,
          value: fmtPct(ex.pAtTableMax.p),
          ci: ciPct(ex.pAtTableMax.ci),
        }
      : { label: 'Chance of reaching the table maximum', value: 'unknown' },
  );
  rows.push({
    label: 'Mean session length',
    value: `${fmtInt(m.length.mean.value)} spins`,
    note:
      p.medianRounds === null
        ? 'more than half of the sessions played every spin'
        : `half of the sessions had ended by spin ${fmtInt(p.medianRounds)}`,
  });
  return rows;
}

function table(caption: string, rows: Row[]): string {
  const body = rows
    .map(
      (r) =>
        `<tr><th scope="row">${esc(r.label)}${r.note ? `<span class="note">${esc(r.note)}</span>` : ''}</th><td>${esc(r.value)}${r.ci ? `<span class="ci-narrow">${esc(r.ci)}</span>` : ''}</td><td class="ci">${r.ci ? esc(r.ci) : ''}</td></tr>`,
    )
    .join('\n');
  return `<div class="scroll"><table class="keys">\n<caption>${esc(caption)}</caption>\n<thead><tr><th scope="col">Measure</th><th scope="col">Value</th><th scope="col" class="ci">95% interval</th></tr></thead>\n<tbody>\n${body}\n</tbody></table></div>`;
}

function setupRows(p: StrategyPage): Row[] {
  const d = p.data.definition;
  const rules = d.game.rules as { preset?: string };
  const wheel = WHEELS[rules.preset ?? ''];
  const rows: Row[] = [
    { label: 'Wheel', value: wheel ? `${wheel.name} (${wheel.detail})` : String(rules.preset) },
    { label: 'Bankroll per session', value: fmtMoney(d.session.bankroll) },
    { label: 'Unit (base bet)', value: fmtMoney(d.strategy.unit) },
    { label: 'Spins per session (at most)', value: fmtInt(d.session.maxRounds) },
    { label: 'Sessions simulated', value: fmtInt(p.metrics.n) },
    { label: 'Pace', value: `${fmtInt(d.session.roundsPerHour)} spins an hour` },
  ];
  if (d.session.stopWin) rows.push({ label: 'Stop-win', value: fmtMoney(d.session.stopWin) });
  if (d.session.stopLoss) rows.push({ label: 'Stop-loss', value: fmtMoney(d.session.stopLoss) });
  if (p.tableMax !== undefined)
    rows.push({ label: 'Table maximum (outside bets)', value: fmtMoney(p.tableMax) });
  rows.push({ label: 'Seed', value: String(d.run.seed) });
  return rows;
}

function setupList(p: StrategyPage): string {
  return `<dl class="facts">${setupRows(p)
    .map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`)
    .join('')}</dl>`;
}

/** One line of setup for summaries: "10,000 sessions of up to 500 spins, $5,000 bankroll, $25 unit, European wheel". */
function setupLine(p: StrategyPage): string {
  const d = p.data.definition;
  const wheel = WHEELS[(d.game.rules as { preset?: string }).preset ?? '']?.name ?? '';
  return `${fmtInt(p.metrics.n)} sessions of up to ${fmtInt(d.session.maxRounds)} spins, ${fmtMoney(d.session.bankroll)} bankroll, ${fmtMoney(d.strategy.unit)} unit, ${wheel} wheel`;
}

// ---------------------------------------------------------------- page shell

interface Crumb {
  name: string;
  url: string;
}

interface PageInput {
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

// ---------------------------------------------------------------- the pages

const STRATEGIES_PATH = `/${APP}/strategies/`;
const ROOT_CRUMBS: Crumb[] = [
  { name: 'Know the Odds', url: `${ORIGIN}/` },
  { name: 'spinner (Roulette)', url: APP_URL },
  { name: 'Strategies', url: ORIGIN + STRATEGIES_PATH },
];

/** The house-edge explanation shared by the index and every strategy page. */
function houseEdgeHtml(pages: StrategyPage[], self?: StrategyPage): string {
  // The exact edge of each run, as displayed; one sentence when they all show the same value.
  const edges = [
    ...new Set(
      pages.map((p) => p.metrics.edge.analytic).flatMap((e) => (e === null ? [] : [fmtPct(e)])),
    ),
  ];
  const wheels = [
    ...new Set(pages.map((p) => (p.data.definition.game.rules as { preset?: string }).preset)),
  ];
  const edgeText =
    edges.length === 1 && wheels.length === 1 && wheels[0] === 'european'
      ? ` On the European wheel used here every bet carries the same edge: ${edges[0]!} of each dollar wagered, in every run on this site, whatever the system.`
      : '';
  const own = self?.metrics.edge;
  const ownText =
    self && own?.realized && own.analytic !== null
      ? ` In this run an average session wagered ${fmtMoney(meanWagered(self.data, self.metrics.n))} in total, and the realized loss came to ${fmtPct(own.realized.value)} of everything wagered, against the exact ${fmtPct(own.analytic)}.`
      : '';
  return `<h2>Why no progression changes the house edge</h2>
<p>Every roulette bet pays a little less than its true odds, because of the zero.${edgeText} A betting system changes only <em>how much</em> you bet and <em>when</em>. Each spin is independent of the ones before it, so no sequence of stakes can change the edge: the expected loss is always the edge times the total amount wagered.${ownText}</p>
<p>What a system does change is the size of the bets, and with it the total wagered and the shape of the results. Raising the stake after a loss puts more money through the wheel, so the expected loss grows with it, and the risk piles up in the long losing streaks that the progression cannot afford. Compare the amount wagered, the bust rate and the drawdowns of each system in the table on the <a href="${ORIGIN}${STRATEGIES_PATH}">strategies page</a>.</p>`;
}

const REJECT_REASON: Record<string, string> = {
  unaffordable: 'not enough bankroll',
  'over-max': 'over the table limit',
  'table-max': 'over the table limit',
  'below-min': 'below the table minimum',
};

/** The Analyze warnings about bets the table or bankroll did not allow (AnalysisView). */
function tableNotesHtml(p: StrategyPage): string {
  const b = p.metrics.breakdown;
  const out: string[] = [];
  if (b.rejected.total > 0) {
    const parts = Object.entries(b.rejected.byReason)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${fmtInt(v)} ${REJECT_REASON[k] ?? k}`);
    out.push(
      `<p>${fmtInt(b.rejected.total)} bets were rejected (${esc(parts.join(', '))}) and not played, in ${fmtPct(b.rejected.sessionsWithRejections.p)} of sessions${parts.length === 1 && b.rejected.byReason.unaffordable ? ': the strategy asked for a stake the remaining bankroll could not cover' : ''}.</p>`,
    );
  }
  let adjusted = 0;
  for (let i = 0; i < p.metrics.n; i++) adjusted += p.data.summary.adjusted[i]!;
  if (adjusted > 0)
    out.push(
      `<p>${fmtInt(adjusted)} bets were adjusted to fit the table (clamped, reduced or rounded).</p>`,
    );
  return out.join('\n');
}

/** "Against flat betting on the same spins ..." for every run except the baseline itself. */
function baselineHtml(p: StrategyPage, all: StrategyPage[]): string {
  const b = all.find((x) => x.entry.tags.includes('baseline'));
  if (!b || b === p || b.data.definition.run.seed !== p.data.definition.run.seed) return '';
  const pm = p.metrics;
  const bm = b.metrics;
  return `<p>Against <a href="../${b.slug}/">${esc(b.entry.title)}</a>, run with the same seed and setup: mean result ${esc(fmtMoney(pm.net.mean.value, { sign: true }))} vs ${esc(fmtMoney(bm.net.mean.value, { sign: true }))} a session, finished ahead ${fmtPct(pm.probabilities.ahead.p)} vs ${fmtPct(bm.probabilities.ahead.p)}, went bust ${fmtPct(pm.probabilities.bust.p)} vs ${fmtPct(bm.probabilities.bust.p)}, and ${esc(fmtMoney(meanWagered(p.data, pm.n)))} vs ${esc(fmtMoney(meanWagered(b.data, bm.n)))} wagered in an average session.</p>`;
}

function ldStrategyArticle(p: StrategyPage, url: string, description: string): Obj {
  return {
    '@type': ['Article', 'LearningResource'],
    '@id': `${url}#article`,
    headline: p.entry.title,
    name: `${p.entry.title}: simulated roulette results`,
    description,
    url,
    inLanguage: 'en',
    educationalLevel: 'beginner',
    learningResourceType: 'simulation results',
    about: { '@type': 'Thing', name: 'Roulette betting systems' },
    author: { '@id': PERSON_ID },
    publisher: { '@id': PERSON_ID },
    isPartOf: { '@id': `${ORIGIN}${STRATEGIES_PATH}#collection` },
    image: OG_IMAGE,
    isAccessibleForFree: true,
  };
}

function wheelOn(p: StrategyPage): string {
  const w = WHEELS[(p.data.definition.game.rules as { preset?: string }).preset ?? ''];
  return w ? ` on a ${w.name} wheel` : '';
}

function strategyDescription(p: StrategyPage): string {
  const m = p.metrics;
  const d = p.data.definition;
  const long = `${p.entry.title}, simulated over ${fmtInt(m.n)} roulette sessions of ${fmtInt(d.session.maxRounds)} spins${wheelOn(p)}: mean result ${fmtMoney(m.net.mean.value, { sign: true })} a session, ${fmtPct(m.probabilities.ahead.p)} finish ahead, ${fmtPct(m.probabilities.bust.p)} go bust.`;
  if (long.length <= 160) return long;
  return `${p.entry.title}: ${fmtInt(m.n)} simulated roulette sessions. Mean ${fmtMoney(m.net.mean.value, { sign: true })} a session, ${fmtPct(m.probabilities.ahead.p)} ahead, ${fmtPct(m.probabilities.bust.p)} bust.`;
}

function strategyPage(p: StrategyPage, i: number, all: StrategyPage[]): PageOut {
  const path = `${STRATEGIES_PATH}${p.slug}/`;
  const url = ORIGIN + path;
  const d = p.data.definition;
  const plan = stakePlan(d.strategy as unknown as Obj);
  const description = strategyDescription(p);
  const ladder = plan.ladder
    ? `<p class="ladder">Stakes, level by level: ${plan.ladder.map((x) => fmtInt(x)).join(', ')} ${plan.ladder.length === 1 && plan.ladder[0] === 1 ? 'unit' : 'units'} (${fmtMoney(plan.ladder[0]! * d.strategy.unit)} to ${fmtMoney(plan.ladder.at(-1)! * d.strategy.unit)}).</p>`
    : '';
  const prev = all[i - 1];
  const next = all[i + 1];
  const tags = p.entry.tags.length
    ? ` <span class="note">Tags: ${esc(p.entry.tags.join(', '))}</span>`
    : '';
  const body = `<p class="lead">${esc(d.notes ?? '')}${tags}</p>
<p class="verdict">${esc(verdict(p.metrics))}</p>
<p>The numbers on this page come from a real run of ${esc(setupLine(p))}, saved in the spinner gallery. They are exactly what spinner’s Analyze screen shows for it, with 95% intervals.</p>
<p><a class="cta" href="../../#/gallery/${encodeURIComponent(p.slug)}">Open this run in spinner: charts and every session</a><a class="cta secondary" href="../../#/define">Test your own system</a></p>
<h2>How the stakes move</h2>
<p>${esc(d.strategy.notes ?? '')}</p>
${plan.paragraphs.map((x) => `<p>${x}</p>`).join('\n')}
${ladder}
<h2>The simulation</h2>
${setupList(p)}
<h2>Results</h2>
${table(`${p.entry.title}: results over ${fmtInt(p.metrics.n)} sessions`, resultRows(p))}
${tableNotesHtml(p)}
${baselineHtml(p, all)}
<h2>Risk: drawdowns and bet size</h2>
${table(`${p.entry.title}: drawdown, exposure and session length`, riskRows(p))}
${houseEdgeHtml(all, p)}
<p><a class="cta" href="../../#/gallery/${encodeURIComponent(p.slug)}">See the fan chart, survival curve and sessions in spinner</a></p>
<nav class="pager" aria-label="More strategies">${prev ? `<a href="../${prev.slug}/" rel="prev">← ${esc(prev.entry.title)}</a>` : '<span></span>'}<a href="../">All strategies</a>${next ? `<a href="../${next.slug}/" rel="next">${esc(next.entry.title)} →</a>` : '<span></span>'}</nav>`;
  const html = renderPage({
    path,
    title: `${p.entry.title}: Roulette Simulation Results | spinner`,
    description,
    h1: `${p.entry.title}: ${fmtInt(p.metrics.n)} simulated roulette sessions`,
    body,
    crumbs: [...ROOT_CRUMBS, { name: p.entry.title, url }],
    graph: [ldStrategyArticle(p, url, description)],
    up: '../../',
  });
  return {
    file: `strategies/${p.slug}/index.html`,
    path,
    html,
    title: p.entry.title,
    description,
    text: llmsText(p, plan, all),
  };
}

interface PageOut {
  file: string;
  path: string;
  html: string;
  title: string;
  description: string;
  text: string;
}

function compareTable(pages: StrategyPage[], link: (p: StrategyPage) => string): string {
  const rows = pages
    .map((p) => {
      const m = p.metrics;
      return `<tr><th scope="row"><a href="${link(p)}">${esc(p.entry.title)}</a></th><td>${esc(fmtMoney(m.net.mean.value, { sign: true }))}</td><td>${esc(fmtPct(m.probabilities.ahead.p))}</td><td>${esc(fmtPct(m.probabilities.bust.p))}</td><td>${esc(fmtMoney(m.drawdown.mean.value))}</td><td>${esc(fmtMoney(meanWagered(p.data, m.n)))}</td><td>${esc(fmtMoney(m.edge.costOfPlayPerHour))}</td></tr>`;
    })
    .join('\n');
  return `<div class="scroll"><table>
<caption>One saved run per system</caption>
<thead><tr><th scope="col">System</th><th scope="col">Mean net per session</th><th scope="col">Finished ahead</th><th scope="col">Went bust</th><th scope="col">Mean max drawdown</th><th scope="col">Mean wagered per session</th><th scope="col">Expected loss per hour</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>`;
}

function compareMarkdown(pages: StrategyPage[], url: string): string {
  const head =
    '| System | Mean net per session | Finished ahead | Went bust | Mean max drawdown | Mean wagered per session | Expected loss per hour |\n|---|---|---|---|---|---|---|';
  const rows = pages.map((p) => {
    const m = p.metrics;
    return `| [${p.entry.title}](${url}${p.slug}/) | ${fmtMoney(m.net.mean.value, { sign: true })} | ${fmtPct(m.probabilities.ahead.p)} | ${fmtPct(m.probabilities.bust.p)} | ${fmtMoney(m.drawdown.mean.value)} | ${fmtMoney(meanWagered(p.data, m.n))} | ${fmtMoney(m.edge.costOfPlayPerHour)} |`;
  });
  return [head, ...rows].join('\n');
}

/** "Flat on red, Martingale on red and James Bond" from the gallery titles. */
function listNames(pages: StrategyPage[]): string {
  const names = pages.map((p) => p.entry.title.replace(/ on red$/, ''));
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '');
}

function indexPage(pages: StrategyPage[]): PageOut {
  const path = STRATEGIES_PATH;
  const url = ORIGIN + path;
  const same = pages.every(
    (p) =>
      setupLine(p) === setupLine(pages[0]!) &&
      p.data.definition.run.seed === pages[0]!.data.definition.run.seed,
  );
  const n = pages.every((p) => p.metrics.n === pages[0]!.metrics.n)
    ? `${fmtInt(pages[0]!.metrics.n)} `
    : 'thousands of ';
  const description = `${listNames(pages)} roulette systems, each simulated over ${n}sessions: mean loss, bust risk, drawdowns.`;
  const cards = pages
    .map(
      (p) =>
        `<li><h3><a href="${p.slug}/">${esc(p.entry.title)}</a></h3><p>${esc(p.data.definition.strategy.notes ?? '')}</p><p class="note">${esc(verdict(p.metrics))}</p></li>`,
    )
    .join('\n');
  const body = `<p class="lead">Roulette betting systems promise to turn a house edge into a profit. spinner tests them the honest way: it plays each one for thousands of seeded sessions and counts what happens. Here are the saved runs from the spinner gallery, with the numbers the app computes from them.</p>
<p><a class="cta" href="../#/gallery">Open the gallery in spinner</a><a class="cta secondary" href="../#/define">Test your own system</a></p>
<h2>The systems side by side</h2>
${same && pages[0] ? `<p>Every run uses the same setup: ${esc(setupLine(pages[0]))}, and the same seed, so the systems face the same spins.</p>` : ''}
${compareTable(pages, (p) => `${p.slug}/`)}
<h2>Each system</h2>
<ul class="cards">
${cards}
</ul>
${houseEdgeHtml(pages)}
<h2>About these numbers</h2>
<p>Each figure is computed by spinner’s own analysis code from the saved run file, and is the same number its Analyze screen shows. Percentages carry 95% intervals on the individual pages. To run longer sessions, a different bankroll or your own rules, open spinner and build the experiment yourself; it runs in your browser, with play money, and nothing is uploaded.</p>`;
  const html = renderPage({
    path,
    title: 'Roulette Betting Systems Tested: Simulated Results | spinner',
    description,
    h1: 'Roulette betting systems, tested by simulation',
    body,
    crumbs: ROOT_CRUMBS,
    graph: [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#collection`,
        name: 'Roulette betting systems, tested by simulation',
        description,
        url,
        inLanguage: 'en',
        author: { '@id': PERSON_ID },
        isPartOf: { '@id': WEBSITE_ID },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: pages.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: p.entry.title,
            url: `${url}${p.slug}/`,
          })),
        },
      },
    ],
    up: '../',
  });
  const text = [
    `Roulette betting systems promise to turn a house edge into a profit. spinner tests them by simulation. Setup: ${pages[0] ? setupLine(pages[0]) : ''}.`,
    compareMarkdown(pages, url),
    toText(houseEdgeHtml(pages)),
  ].join('\n\n');
  return {
    file: 'strategies/index.html',
    path,
    html,
    title: 'Roulette betting systems, tested by simulation',
    description,
    text,
  };
}

function llmsText(p: StrategyPage, plan: StakePlan, all: StrategyPage[]): string {
  const d = p.data.definition;
  const rows = (rs: Row[]) =>
    rs
      .map(
        (r) =>
          `- ${r.label}: ${r.value}${r.ci ? ` (95% interval ${r.ci})` : ''}${r.note ? ` (${r.note})` : ''}`,
      )
      .join('\n');
  return [
    d.notes ?? '',
    `Verdict: ${verdict(p.metrics)}`,
    '### How the stakes move',
    [d.strategy.notes ?? '', ...plan.paragraphs.map(toText)].join('\n\n'),
    plan.ladder
      ? `Stakes by level (units of ${fmtMoney(d.strategy.unit)}): ${plan.ladder.join(', ')}`
      : '',
    '### The simulation',
    rows(setupRows(p)),
    '### Results',
    rows(resultRows(p)),
    toText(tableNotesHtml(p)),
    toText(baselineHtml(p, all)),
    '### Risk',
    rows(riskRows(p)),
    toText(houseEdgeHtml(all, p)),
    `Open in spinner: ${APP_URL}#/gallery/${p.slug}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ---------------------------------------------------------------- sitemap and llms files

const SPA_SUMMARY =
  'spinner is a free roulette strategy lab that runs in the browser: define a betting system (flat, Martingale, Fibonacci, d’Alembert, Labouchere, James Bond or your own rules), simulate it over thousands of seeded sessions, and see the real distribution of results: average loss, bust risk, drawdowns and how the stakes behaved. Play money only, nothing is uploaded. Part of Know the Odds by creynia.';

export function sitemapXml(paths: string[]): string {
  const urls = paths.map((p) => `  <url><loc>${ORIGIN}${p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function llmsTxt(index: PageOut, pages: PageOut[]): string {
  return `# spinner — Roulette (betting-system strategy lab)

> ${SPA_SUMMARY}

## App

- [spinner](${APP_URL}): the app itself (define a strategy, run it, analyze the results; works offline)
- [Gallery in the app](${APP_URL}#/gallery): saved runs that open read-only in the Analyze screen

## Strategies (simulated results)

- [${index.title}](${ORIGIN}${index.path}): ${index.description}
${pages.map((p) => `- [${p.title}](${ORIGIN}${p.path}): ${p.description}`).join('\n')}

## Know the Odds

- [Know the Odds](${ORIGIN}/): creynia's casino lab, the home of all four apps
${OTHER_APPS.map((a) => `- [${a.id}](${ORIGIN}/${a.id}/): ${a.game}`).join('\n')}

## Optional

- [Full text of every page](${APP_URL}llms-full.txt): the strategy pages as plain text
- [Source code](https://github.com/creynia/spinner): MIT licensed
`;
}

function llmsFull(index: PageOut, pages: PageOut[]): string {
  const part = (p: PageOut) => `## ${p.title}\n\nURL: ${ORIGIN}${p.path}\n\n${p.text}\n`;
  return `# spinner — Roulette (betting-system strategy lab)

> ${SPA_SUMMARY}

For education only, with play money only. The house always has an edge, and no betting system changes that. If gambling is hurting you or someone you know, call or text 1-800-GAMBLER (US), or contact your national problem-gambling helpline.

${[index, ...pages].map(part).join('\n')}`;
}

export interface StaticSite {
  /** dist-relative file name to contents. */
  files: Map<string, string>;
  /** Every URL path in the sitemap, starting with the SPA root. */
  paths: string[];
}

export async function buildStaticSite(opts: GalleryOptions = {}): Promise<StaticSite> {
  const strategies = await loadStrategies(opts);
  const files = new Map<string, string>();
  const paths = [`/${APP}/`];
  if (strategies.length > 0) {
    const index = indexPage(strategies);
    const pages = strategies.map((p, i) => strategyPage(p, i, strategies));
    for (const p of [index, ...pages]) {
      files.set(p.file, p.html);
      paths.push(p.path);
    }
    files.set('llms.txt', llmsTxt(index, pages));
    files.set('llms-full.txt', llmsFull(index, pages));
  }
  files.set('sitemap.xml', sitemapXml(paths));
  return { files, paths };
}

/** Emits the static site into the normal build (never the dev server). */
export function staticPagesPlugin(opts: GalleryOptions = {}): Plugin {
  let root = process.cwd();
  let site: StaticSite | undefined;
  return {
    name: 'spinner-static-pages',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      try {
        site = await buildStaticSite({ ...opts, dir: opts.dir ?? `${root}/gallery` });
      } catch (e) {
        this.error((e as Error).message);
      }
    },
    generateBundle() {
      if (!site) return;
      for (const [fileName, source] of site.files)
        this.emitFile({ type: 'asset', fileName, source });
    },
  };
}
