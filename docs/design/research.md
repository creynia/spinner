# Research screen: design (WP D1)

Status: design for wave B of `docs/research/app-plan.md` §6. Inputs: app-plan §1–§7, `docs/design/decisions.md`
(wins over everything here), `architecture.md` §6–§7, the code cited in each section, and what wave A
landed by commit 64bdd81: I1's scaffold (`index.tsx`, `chapters.tsx`, `research.css`, stub `content.ts`),
T1's `data.json`/`data.ts`, T2's `ladderMath.ts`. Rows marked **I1b** are changes to the landed scaffold
that must be made before wave B (§11 Q1). Where this file and
app-plan.md disagree, this file is the later decision, except where `decisions.md` says otherwise. The
conflicts it resolves are listed in §11.

## 1. Purpose and reader

The Research screen (`#/research`) tells the story of the research loop in ten short chapters: the house
edge never changes, a progression only changes the *shape* of the results, and a ladder sized to the
bankroll plus a cash-out can make the typical session end ahead while the average stays negative. Every
chart is drawn from `data.json` with the app's own SVG charts, every chapter ends with a collapsed "The
math" block, and the last chapter lets the reader open a candidate strategy in Define or size a ladder of
their own.

The reader is a curious roulette player, not a statistician (app-plan §2). They read on a phone first, in
short sittings, and jump between chapters. The page must therefore work as a linear read and as a set of
deep-linkable chapters, show one chart at a time on a phone, keep the lay words (typical session, average,
worst 5 % of sessions, chance of ending ahead) in everything outside the math blocks, and never imply an
edge.

## 2. Information architecture

| Item | Decision | Reuses |
| --- | --- | --- |
| Route | `{ pattern: '/research', screen: Research }` in `src/app/routes.tsx` | route table pattern |
| Deep link | `#/research?chapter=<id>`; ids `start edge martingale levels placement curve shapes cashout limits try` (app-plan §3). Unknown id: ignored, page opens at the top | `Settings?section=about` (`Settings/index.tsx:87`) |
| More | first entry of `LINKS`: `{ path: '/research', label: 'Research', hint: 'What progressions can and cannot do' }` | `More/index.tsx` |
| Nav | `'/research'` added to the More item's `also` | `Nav.tsx` |
| Back / title | `parentOf('/research')` returns `'/more'` (`router.ts`, new `case 'research'`); TopBar `TITLES.research = 'Research'` | `router.ts`, `TopBar.tsx` |
| Phone nav (< 768 px) | landed: `<nav class="research-nav research-nav-chips" aria-label="Chapters">`, an `ol` of `a.chip` with the full chapter titles, one row scrolling sideways in its own container (architecture §6.1 allows component scrollers). Not sticky | `.chip` (`kit.css`) |
| Desktop nav (≥ 768 px) | landed: `<nav class="research-nav research-nav-column" aria-label="Chapter list">`, sticky `ol` of `a.research-nav-link` | Nav.tsx: both navs render, CSS shows one |
| Anchors | landed: section ids `chapter-<id>`, heading ids `chapter-<id>-h`. **No `href="#research-…"` links**: the hash router would read them as a route (`router.ts` `parseHash`) and `RouteBoundary key={hash}` would remount the screen. Every chapter link is `<a href="#/research?chapter=<id>">` (landed) whose click handler (**I1b**: the landed links have none, so each tap remounts the screen and resets the calculator) (no modifier keys) calls `preventDefault`, `history.replaceState(null, '', '#/research?chapter=<id>')` in try/catch, `scrollIntoView({ block: 'start', behavior })` and `h2.focus({ preventScroll: true })` | replaceState without remount: `Analyze/index.tsx:33-40` |
| Initial deep link | on mount, a valid `query.get('chapter')` scrolls its section into view after one `requestAnimationFrame`, `behavior: 'auto'`, without moving focus | `Settings/index.tsx:86-88` |
| Current chapter (**I1b**) | an `IntersectionObserver` (`rootMargin: '0px 0px -60% 0px'`) sets `aria-current="location"` on the link of the topmost visible chapter, in both navs. Skipped when `IntersectionObserver` is undefined (happy-dom). Scrolling never rewrites the URL | |
| Next link (**I1b**) | each chapter ends with `<a class="link-tap research-next">Next: <title></a>` (same handler); chapter 9 ends with "Back to the top" (scrolls to the h1) | `a.link-tap` (`Settings/index.tsx:231`) |
| Motion | `behavior: 'smooth'` unless `matchMedia('(prefers-reduced-motion: reduce)')` matches, then `'auto'` | architecture §6.1 |

**Headings.** One `h1` ("Research") per screen (architecture §6.1). Each chapter title is an `h2`
(`tabIndex={-1}` so it can take focus). Inside a chapter only `h3` is used: the two column heads of chapter 0, "Try a candidate" / "Build your own ladder" / "After you run it" in chapter 9.
Chart titles are `figcaption`s (ChartFrame), not headings. The math `summary` is not a heading. Under the
h1 sits the landed `p.lead.research-intro` (no number in it, so nothing to trace).

## 3. Page layout

Widths below are the CSS box widths the charts measure (`useElementWidth` / `useWidth`). Card padding is
`var(--gutter)` (16 px) plus a 1 px border (`app.css .card`), so card inner = card width − 34.

| Viewport | Shell (`app.css`) | Research grid | Card inner width | Chart width |
| --- | --- | --- | --- | --- |
| 360 × 780 | TopBar + TabBar, content 328 | one column; chip row (44 px tall + 8 px gap) under the lead | 294 | 294 (height 220) |
| 390 × 844 | same | same | 324 | 324 (220) |
| 768 – 1199 (incl. 844 × 390) | NavRail 96 px, content padding 16 | `grid-template-columns: 184px minmax(0, 1fr)`, gap 16; toc sticky `top: 16px`, `max-height: calc(100dvh - 84px)`, `overflow-y: auto` | 406 at 768, 482 at 844 | same (220–250) |
| ≥ 1200 (1280 × 800) | NavRail, `max-width: 1280px` | `grid-template-columns: 220px minmax(0, 880px)`, gap 24, `justify-content: start` | 846 at 1280 | 846 (380) |

Prose (`.research-lead`, body `p`, takeaways, math) is capped at `max-width: 68ch`; charts, tables and the
calculator use the full card width. Chapters are spaced 16 px (the card's `margin-bottom: 12px` plus 4).
`scroll-margin-top: 8px` on each section (the TopBar is not sticky).

```
360 px                         768 px                                1280 px
┌──────────────────────────┐   ┌────┬──────────────────────────────┐ ┌────┬──────────────────────────────────────────┐
│ ‹ Research        (top)  │   │    │ Research (top bar)           │ │    │ Research (top bar)                       │
├──────────────────────────┤   │rail├────────┬─────────────────────┤ │rail├──────────┬───────────────────────────────┤
│ h1 Research              │   │    │ h1 Research (spans both)     │ │    │ h1 Research                              │
│ lead                     │   │    │ lead                         │ │    │ lead                                     │
│ [Start][Edge][Doubling]→ │   │    ├────────┬─────────────────────┤ │    ├──────────┬───────────────────────────────┤
│┌────────────────────────┐│   │    │0 Start │┌───────────────────┐│ │    │0 Start   │┌─────────────────────────────┐│
││Chapter 1               ││   │    │1 Edge ◂││ h2 + lead + body  ││ │    │1 Edge   ◂││ h2, lead, body (68ch)       ││
││h2 Every dollar costs…  ││   │    │2 Doubl.││ ┌───────────────┐ ││ │    │2 Doubling││ ┌─────────────────────────┐ ││
││lead (muted)            ││   │    │3 Levels││ │ chart 406 px  │ ││ │    │3 Levels  ││ │ chart 846 × 380         │ ││
││body                    ││   │    │4 …     ││ └───────────────┘ ││ │    │4 …       ││ └─────────────────────────┘ ││
││┌──────────────────────┐││   │    │ sticky ││ takeaways         ││ │    │ sticky   ││ takeaways                   ││
│││ chart 294 × 220      │││   │    │        ││ ▸ The math        ││ │    │          ││ ▸ The math                  ││
││└──────────────────────┘││   │    │        ││ Next: Doubling    ││ │    │          ││ Next: Why doubling…         ││
││legend · summary        ││   │    │        │└───────────────────┘│ │    │          │└─────────────────────────────┘│
││▸ Data table            ││   │    │        │┌─ chapter 2 ──────┐│ │    │          │┌─ chapter 2 ─────────────────┐│
││What to take away • • • ││   │    │        │                     │ │    │          │                               │
││▸ The math              ││   └────┴────────┴─────────────────────┘ └────┴──────────┴───────────────────────────────┘
││Next: Why doubling…     ││
│└────────────────────────┘│   At 768–1199 the h1 and lead span both columns (grid-column: 1 / -1); the toc and
├──────────────────────────┤   the chapters start on the next grid row. Same at ≥ 1200.
│ Home Define Library More │
└──────────────────────────┘
```

Chapter-internal two-column layouts switch at `@media (min-width: 1200px)` (only then is the card ≥ 720 px):
chapter 0 stats, chapter 6 glyph row, chapter 9 calculator (inputs | outputs). Below 1200 they stack.

## 4. The chapter component

`ChapterCard` (landed in `index.tsx`) renders one chapter. It follows the hand-rolled card of Settings
About (`Settings/index.tsx:237`: `<section class="card" id aria-labelledby>`), because `Card` has no `id`
prop. Target markup, with the **I1b** additions marked `+`:

```
<section class="card research-chapter" id="chapter-<id>" aria-labelledby="chapter-<id>-h">
+ <p class="research-eyebrow">Chapter <n></p>            0.8rem, var(--muted), uppercase, letter-spacing .04em
  <h2 id="chapter-<id>-h" tabIndex={-1}>title</h2>      + tabIndex; .card h2 (1.1rem), 1.25rem from 768 px
  <p class="lead">lead</p>                               landed; + .research-chapter .lead { color: var(--text); font-weight: 600 }
  <p>body[0]</p> <p>body[1]</p> …                        1rem, line-height 1.5
  <Chart chapter={chapter} />                            the chart(s) of §5, from CHAPTER_CHARTS
  <ul class="takeaways">…</ul>                           landed, ≤ 3 items
  <details class="math"><summary>The math</summary>
    <div class="math-body"><MathText … /></div></details>  + MathText for text[] and formulas[]
+ <a class="link-tap research-next" href="#/research?chapter=<next>">Next: <next title></a>
</section>
```

| Part | Spec |
| --- | --- |
| `details.math` | Native `<details>`; summary text exactly **"The math"**. Closed on every mount; the open state is never stored (no localStorage, no URL). Styled in the landed `research.css` (`details.math`, accent left border, `::before` marker ▸/▾, `::-webkit-details-marker` hidden). Required, check against the landed CSS: `summary` `min-height: 44px` (tap target), focus ring = the global `:focus-visible` (3 px `var(--focus)`, offset 2, `app.css`) or the landed `summary:focus-visible` rule if it is at least as visible, both themes. Keyboard: Enter and Space toggle natively; nothing custom. Pattern: `.sp-chart__table > summary` in `charts.css` |
| `.math-body` | landed: `chapter.math.text` as `p`, `chapter.math.formulas` as `code.formula`. **I1b**: `code.formula` is `display: block`, `font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` (system fonts only), `white-space: pre-wrap`, `overflow-wrap: anywhere`, `padding: 6px 8px`, `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: 6px`, `margin: 6px 0` |
| `MathText` (**I1b**, `kit.tsx`) | `MathText({ text: string })`: no `innerHTML`; `^x` / `^(…)` become `<sup>`, `_x` / `_(…)` become `<sub>`, every other character stays text. Used for each `math.text` entry and each formula. Unit-tested |
| Next link | `display: inline-flex; min-height: 44px; margin-top: 8px; font-weight: 600` |

Chapter text (title, lead, body, takeaways, math) comes only from `content.ts` (C1; the landed stub has
the final `Chapter` type: `math: { text: string[]; formulas: string[] }`). Numbers drawn in charts, stats
and tables come only from `data.json` through `row(key)` / `path(key)` / `data` from `./data` (T1, landed),
which throw `research data: no row "<key>"`, so a missing key fails a unit test and never renders `NaN`.

Formats (all in `kit.tsx`, **I1b**): money `formatMoney(c, { sign: true })` from `@core` for net amounts ("+$286",
"-$46"); bankroll-like amounts without sign; `pct1(x)` = `${(x * 100).toFixed(1)}%` (Gallery's `pct`,
`Gallery/index.tsx:56`); spins `n.toLocaleString('en-US')`; compact axis money `axisMoney(c)`: `$0`,
`$500`, `$1.5k`, `-$5k`.

## 5. Charts per chapter

Rules for every chart on the screen:

- Import charts and kit only from `@core/ui` (the lint rule rejects `@core/ui/charts`, eslint.config.js
  `isPublicEntry`). `useElementWidth`, scales and `seriesColor` are not exported, so in-screen charts use
  `useWidth`, `scaleLinear`, `niceTicks` from `kit.tsx` (copies of `charts/hooks.ts` and `geom/scale.ts`
  behaviour) and colours by CSS variable name.
- Every chart sits in `ChartFrame` (title, summary, `DataTable`) or is an existing core chart that does.
  The summary is one computed sentence; the table carries every plotted value. In-screen charts have no
  cursor or tooltip (the table is the accessible path), so their `ChartSvg` gets no `svgProps` and is not
  focusable.
- Height: `clamp(220, 0.52 × width, 380)` px (`Axes.tsx chartHeight`) unless the row table below says
  otherwise. Text ≥ 12 px (`.sp-axis-text`). Colours only via `--chart-1…6`, `--band-inner`, `--zero`,
  `--chart-grid`, `--chart-text`, `--line-expected`, or app tokens; the chart tokens exist only inside
  `.sp-chart` (`charts.css`), so in-screen SVG that uses them must be inside a `ChartFrame`.
- Must not: load fonts, scripts, images or data from anywhere (CSP `default-src 'self'`,
  `build/vite-plugin-csp.ts`); use `innerHTML`, `foreignObject` or `<style>` elements; animate (or only
  under `prefers-reduced-motion: no-preference`); fetch (`data.json` is a static import); carry meaning by
  colour alone (shape or dash pattern too); overflow the page at 360 px.
- `LineBand` colours series by index (`seriesColor(i)`, dash `dashFor(i)`): the series order below is the
  colour assignment: 1st blue `--chart-1` solid, 2nd orange `--chart-2` dashed, 3rd green `--chart-3`
  dotted, 4th purple `--chart-4` dash-dot. `Bars` colours by sign (positive `--chart-1`, negative
  `--chart-2`).

Keys are `"<results file without .json>:<row id>"`, e.g. `e7-c9:e7-c9-W20-SLhalf` (app-plan §5); every key
below exists in the landed `data.json`, and every `path(...)` key is among its `paths`. `medianAheadUntil`:
last checkpoint with a positive typical session, `null` = never ahead, 500 = still ahead at the end.

| Ch | Component (owner) | Data keys | Series / marks, in colour order | Axes, formats | Legend, table, notes |
| --- | --- | --- | --- | --- | --- |
| 0 `start` | `Stat` ×8 in `.research-versus` (no chart) | `observations:flat-red`, `e7-c9:e7-c9-W20-SLhalf` | two columns, h3 "Flat $25 on red" / "Streets with a cash-out"; per column: Typical session (`median`, interval `medianCI`), Chance of ending ahead (`pWin`), Average (`mean`, interval `meanCI`), Worst 5 % of sessions (`cvar5`) | money signed, pct1; `tone="neutral"` always | grid 2 columns at every width (each ≥ 140 px at 360), gap 12; ≥ 1200 a column is a 2 × 2 grid. Takeaways stay the normal list |
| 1 `edge` | `DotRows` (§5.1) | `e1-spread:e1-red`, `e1-spread:e1-red12-dozen3-13`, `e1-spread:e1-straights25` | rows "Red", "Red + a dozen", "25 numbers"; range bar `p10`–`p90` (`--band-inner` fill, `--chart-1` stroke); marks: Typical session `median` circle `--chart-1`; Average `mean` diamond `--chart-2` | x money (`axisMoney`), label "Result after 500 spins"; zero line `--zero` labelled "Break-even" | legend: range "Middle 80 % of sessions", circle, diamond. Table columns: Bet, Average, Typical, 10th pct, 90th pct, SD (`sd`) |
| 2 `martingale` | `LineBand` (core) | paths `observations:flat-red`, `observations:martingale-red`, `observations:fibonacci-red` | 1 Flat (`p50`); 2 Martingale (`p50`, band `p10`/`p90`, `bandLabel` "Martingale, middle 80 %"); 3 Fibonacci (`p50`) | `xKind 'linear'`, x = `rounds`, `xAxisLabel` "Spin", `xFmt` `spin n`; `yFmt` money signed, `yAxisFmt` `axisMoney`; `refs: [{ y: 0, label: 'Break-even' }]` | built-in legend and table. Summary names Martingale's `medianPeak` and `medianAheadUntil` |
| 3 `levels` | `LineBand` (core) + 2 `Stat` | `e3a-levels:e3a-L5` … `e3a-L10`; `observations:martingale-red`, `observations:martingale-red-br10k` | x categorical `L5…L10` labels "5" … "10"; 1 Measured: typical session ahead until (`medianAheadUntil`, `null` → 0, 500 = still ahead); 2 Predicted n½ (`ladder({ c: 18, g: 2, base: 500, unit: 500, betMax: 500000, maxLevels: L }).nHalf`, `ladderMath.ts`) | `xAxisLabel` "Levels in the ladder"; `yFmt` `spin n`; `yDomain [0, 1200]`; `refs: [{ y: 500, label: 'Session ends (500 spins)', dash: '4 4' }]` | table shows "500+" for still-ahead rows. Stats under the chart: "Ahead until, $5,000 bankroll" / "… $10,000 bankroll" (`medianAheadUntil` of the two observations rows) |
| 4 `placement` | `DotRows` | per placement `p` in `dozen, two-dozens, sixline, corner, straights25, straights35`: `e4-<p>:e4-<p>-g-stop`, `e4-<p>:e4-<p>-x2`; plus `e4-dozen:e4-dozen-g-u5-stop`, `e4-dozen:e4-dozen-x2-u5` | rows "Dozen", "Dozen, $5 base", "Two dozens", "Six-line", "Corner", "25 numbers", "35 numbers"; marks: Right growth factor (`-g-stop` `medianAheadUntil`) circle `--chart-1`; Doubling (`-x2` `medianAheadUntil`) square `--chart-2`; Predicted n½ (`ln 2 / (q·p)` from the `-g-stop` row's `meta`, §11 Q2) tick `--chart-text` | x "Spins the typical session stays ahead", domain [0, 500], `clampAt 500` | `null` (never ahead) draws no mark, table says "never". Table adds growth factor `meta.g` as "×1.5". If `meta` is absent the n½ series is omitted |
| 5 `curve` | `Scatter` (new, §5.2) | `data.curve` | points `x` vs `neverCapped`, grouped (below); curve `e^(−x)` | x "Session length ÷ ladder cost (x)", domain [0, 2.5], ticks 0, 0.5 … 2.5, fmt `toFixed(2)`; y "Share never capped", [0, 1], pct axis `0%…100%` | legend with shape swatches; points with `x > 2.5` (all near 0) are not drawn and the summary says how many; table: Ladder, Group, x, Never capped, e^(−x), k |
| 6 `shapes` | `ShapesExplorer` (Board ×3 + range input) + `LineBand` + table | `e6-full:<id>@20261031`, `@1`, `@2`, `e8-seed3:<id>@3` for `c9-streets-to12-stack`, `b3-two-streets-l29`, `a1-streets-w27`; paths `e6-full:<id>@20261031` | LineBand: 1 c9, 2 b3, 3 a1 (`p50` only) | as chapter 2 | 4-seed table (§5.3); boards (§5.4) |
| 7 `cashout` | `LineBand` + `Bars` + 2 `Stat` pairs | `e7-c9:e7-c9-W5`, `-W10`, `-W20`, `-W50`, `-W100`, `-W20-SLhalf`, `-nostop`; `e7-mart:e7m-stop-W20`; `e7b-mart-L7stop:e7b-L7stop-W20` | LineBand x categorical "5" "10" "20" "50" "100": 1 Measured (`pWin`); 2 Predicted `(1 − q)^W` with `q = meta.q` (omitted without `meta`). Bars "Worst 5 % of sessions": "No cash-out" (`-nostop`), "Cash out at 20 wins" (`-W20`), "20 wins + stop-loss" (`-W20-SLhalf`), value `cvar5` | LineBand `xAxisLabel` "Cash-out target (cycle wins)", `yFmt` pct1, `yDomain [0, 1]`, `refs: [{ y: 0.5, label: 'Half of sessions' }]`; Bars `valueLabel` "Worst 5 %", `signed` | Stat pairs: "Martingale, 8 levels" vs "7 levels + stop": Chance ahead, Worst 5 %. Bars orientation `auto` |
| 8 `limits` | visible table + 2 `Bars` | for `flat-red`, `b3-two-streets-l29`, `c9-streets-to12-stack`, `a1-streets-w27` (`<sid>`): `e6-full:<sid>@20261031`, `e8-american:e8-am-<sid>`, `e8-length:e8-S250-<sid>`, `e8-length:e8-S1000-<sid>`, `e8-br10k:e8-br10k-<sid>` | table rows = 4 strategies, columns "European, 500 spins", "American wheel", "250 spins", "1,000 spins", "$10,000 bankroll"; each cell "typical / average" (`median` / `mean`, both signed). Bars 1 "Typical session, American wheel" (`e8-am-*` `median`); Bars 2 "Typical session at 1,000 spins" (`e8-S1000-*` `median`) | money signed | table in `div.research-tablewrap` (`overflow-x: auto`, `tabIndex 0`, `role="region"`, `aria-label`), like `DataTable`'s `.sp-chart__tablewrap`; `th scope`; average cells muted. The $25-minimum point is prose only (no row) |
| 9 `try` | `TryIt` + `LadderCalculator` | `data.candidates`, each `candidate.rows[0]` | §6, §7 | | |

### 5.1 `DotRows` (new, `DotRows.tsx`, owner I1b)

Horizontal rows like `Bars` horizontal (`Bars.tsx`): label column `min(40 % of width, maxChars × 7 + 12)`
px, row pitch 36 px, x axis 30 px at the bottom, `svgH = 8 + rows × 36 + 34`. Range bar: 6 px tall, centred
on the row. Marks 10 px: circle r 5, square 9 × 9, diamond (square rotated 45°), tick (2 × 16 px line).
A value above `clampAt` is drawn as a right-pointing triangle at the axis end with the text `500+`. Vertical
grid at the ticks (`.sp-grid`), optional zero line `--zero` 1.5 px with a halo label. Own legend inside
the plot `div` (`ul.sp-chart__legend` with 28 × 12 SVG swatches drawing the actual shape), because
`Legend` has no shape swatches.

### 5.2 `Scatter` (new, `Scatter.tsx`, owner I3)

Drawn with `ChartFrame` + `ChartSvg`, `plotBox`-style margins (left 44, right 12, top 14, bottom 44).
Groups (from `CurvePoint.family`, mapped by `curveGroup()`; unknown families fall into the last group):

| Group | Families (prefix) | Shape | Colour |
| --- | --- | --- | --- |
| `e3` "Martingale on red" | `E3` | circle r 4 | `--chart-2` |
| `e4-out` "Outside bets" | `E4` dozen, two-dozens | square 7 | `--chart-3` |
| `e4-in` "Inside bets" | `E4` sixline, corner, straights | triangle 8 | `--chart-4` |
| `e6` "Shapes (widen, stack, mix)" | `E6` | diamond 8 | `--chart-5` |

Marks have `stroke: var(--surface)` 1 px so overlaps read. The curve `y = e^(−x)` is a 100-sample
polyline, `--chart-1`, 2.5 px, solid, labelled directly at x = 1.2 with a halo text "e^(−x): the ceiling".
Points are drawn after the curve. y axis ticks 0, 25, 50, 75, 100 %.

### 5.3 Chapter 6 seed table

Visible table, rows c9 / b3 / a1, columns Typical session, Chance of ending ahead, Average, Worst 5 %,
Ended broke (`pBust`). Each cell: the seed-20261031 value, then `<span class="muted research-range">` "4
seeds: <min> to <max>". Same wrapper as chapter 8.

### 5.4 Board glyph (`Board.tsx`, owner I3)

A tiny SVG of the horizontal layout: the 0 cell on the left spanning three rows, then 12 columns × 3 rows
(column `k` holds `3k−2` bottom, `3k−1` middle, `3k` top), and a **tower lane** above the board where each
bet's chips are stacked.

```ts
export interface BoardBet { numbers: number[]; amount: number } // amount in cents, per bet
export interface BoardGlyphProps {
  bets: BoardBet[];
  /** accessible name, e.g. "c9 after 5 losses: 4 streets, $7 each, $28 on the table" */
  label: string;
  /** px; default 260. Cell = width / 13. */
  width?: number;
  /** cents per first chip; each extra chip doubles the stake. Default 100. */
  chipUnit?: number;
  /** draws the board at 40 % opacity with the text "Ladder ran out" over it */
  capped?: boolean;
}
export function BoardGlyph(props: BoardGlyphProps): JSX.Element;
export function chipCount(amount: number, chipUnit?: number): number; // clamp(1 + round(log2(amount / chipUnit)), 1, 11)
```

| Size | Width | Cell | Board height | Tower lane | Total height |
| --- | --- | --- | --- | --- | --- |
| phone, 1 per row | 260 | 20 × 14 | 42 | 66 (11 discs × 6) | 112 |
| ≥ 1200, 3 in a row | 260 | same | same | same | same |

Cells: `fill: none; stroke: var(--border)`; covered numbers `fill: var(--accent)` (the zero cell too when
covered). Discs: `rect` width 0.8 × cell, height 5, step 6, `fill: var(--amber)`, `stroke: var(--surface)`,
centred over the covered columns (midpoint of the bet's first and last column), stacked up from the lane's
bottom. No number text (too small); the caption under the glyph carries the words. `role="img"`,
`aria-label={label}`, `<title>` omitted (the label is enough). App tokens only, so it works outside
`.sp-chart` and in both themes.

`ShapesExplorer` (in `ChShapes.tsx`): a native `<input type="range" id="shapes-losses">` labelled "Losses in
a row: N" (0 … 28, step 1, `min-height: 44px`, full width), above three figures (c9, b3, a1), each a
`BoardGlyph` + caption `p` ("4 streets, $7 each · $28 on the table" or, past the survivor's last level,
"Ladder ran out after L losses: −$X lost"). The survivors come from `SURVIVORS` in `survivors.ts`:

```ts
export interface SurvivorLadder {
  id: 'c9' | 'b3' | 'a1'; label: string; rowId: string; // e.g. 'c9-streets-to12-stack'
  amounts: number[];                                      // cents per bet per level
  bets: { numbers: number[]; fromLevel: number }[];       // when progStep >= fromLevel
}
export const SURVIVORS: readonly SurvivorLadder[];
export function betsAtLevel(l: SurvivorLadder, level: number): BoardBet[] | 'capped';
export function capLoss(l: SurvivorLadder): number;       // Σ_levels amounts[k] × active bets at k
export function ladderFromStrategy(s: unknown): Pick<SurvivorLadder, 'amounts' | 'bets'>;
```

`SURVIVORS` is written by hand (a1 is not a candidate, so its strategy is not in `data.json`), with a unit
test that `ladderFromStrategy` on the three strategies in `scripts/research/specs/e6-full.json` gives the
same `amounts` and `bets`.

## 6. Try it (chapter 9, `TryIt.tsx` + `share.ts`, owner I4)

One block per `data.candidates` entry, in plan §9 order by id: `keeper-c9-streets-to12-cashout`, `keeper-c9-streets-to12-stack`, `keeper-b3-two-streets-l29`, each a
`div.research-candidate` (border `var(--border)`, radius 10, padding 12): `h3`-less bold name, one line
"Typical session +$286 · ends ahead 90.3% · average −$46 · worst 5 % −$3,210" from `rows[c.rows[0]]`, and
the button.

| Step | Spec |
| --- | --- |
| Build | `candidateDefinition(c)` returns `{ schema: 1, name: c.name, game: { id: 'roulette', rules: TRY_RULES }, strategy: c.strategy, session: { bankroll: 500000, maxRounds: 500 }, run: { sessions: 10000, seed: 20261031 } }` with `TRY_RULES = { preset: 'european', overrides: { limits: { outside: { min: 100 }, inside: { minTotal: 100 } } } }`. The stops of the cash-out candidate are strategy rules, so they travel with `strategy` |
| Normalize | `normalizeDefinition(def, { plugin: game.plugin, resolveStrategyRef: () => undefined })` (`Run/e2eHook.ts:37`, `Define/doc.ts:243`). `!ok`: the button is replaced by `p.error` "This candidate does not load: <first error message>." (a unit test keeps all three ok) |
| Encode | `encodeShareLink(normalized)` from `@core` |
| Navigate | `{ hash }` → `go(hash)` with `go` defaulting to `navigate` (deps pattern: `GalleryDeps.go`, `Gallery/index.tsx`) |
| Too long | `{ tooLong }`: the block shows "This definition is too long for a link: export the definition file." (`SHARE_FALLBACK_NOTICE`, as Define does at `Define/index.tsx:320`) and a secondary button "Download definition file" that saves `exportDefinitionFile(normalized)` as `<candidate id>.definition.json` (the private `download()` pattern of `Settings/index.tsx:65`) |
| Button | `Button variant="primary"`, text "Open in Define", `aria-label="Open in Define: <name>"` (the visible text must be a prefix of the accessible name, axe `label-content-name-mismatch`); while encoding: disabled, text "Opening…" |
| Copy under the buttons | "Opens an unsaved draft in Define with the $1-minimum table, a $5,000 bankroll, 500 spins, 10,000 sessions and seed 20261031. Press Run; on Analyze → Overview the typical session should match the number above, because the seed is the same." (numbers here are constants of `share.ts`, not results) |
| Define shows | the notice "Loaded from a link. This is an unsaved draft." (`Define/index.tsx:479`), the strategy, Game & rules with the overrides, Session $5,000 / 500 spins, Run 10,000 sessions / seed 20261031 |
| Risk notice | no disclaimer text on this screen (decisions #11); the last line of chapter 9 is a `link-tap` "Read the risk notice" to `#/settings?section=about` (§11 Q3) |

```ts
export const TRY_RULES: RulesRef;
export function candidateDefinition(c: Candidate): ExperimentDefinition;
export type CandidateLink =
  | { kind: 'link'; hash: string }
  | { kind: 'file'; chars: number; file: string; filename: string }
  | { kind: 'error'; message: string };
export async function candidateLink(c: Candidate): Promise<CandidateLink>;
export interface TryItProps { candidates: Candidate[]; rows: Record<string, RowStats>; go?: (hash: string) => void }
export function TryIt(props: TryItProps): JSX.Element;
```

## 7. The ladder calculator (`LadderCalculator.tsx` + `calculator.ts`, owner I4)

Pure maths: `ladder()` from `ladderMath.ts` (moved by T2 from `scripts/research/ladder.ts`, unchanged)
plus `cashOut()` in `calculator.ts`. European wheel only (p = c/37); the copy says so.

**Inputs** (top to bottom; Field + label + hint; `Field` and `MoneyInput` from `@core/ui`; integer fields
are a local `IntField` copied from Define's private `NumInput`, `Define/index.tsx:364`):

| Field (id) | Control | Default | Valid | Error text |
| --- | --- | --- | --- | --- |
| Numbers covered (`calc-c`) | IntField | 18 | integer 1–35 | "Pick 1 to 35 numbers." |
| First bet (`calc-base`) | MoneyInput | $25 | ≥ $0.01, ≤ bet max | "The first bet must fit under the bet maximum." |
| Chip size (`calc-unit`) | MoneyInput | $1 | ≥ $0.01 | MoneyInput's own |
| Bet maximum (`calc-max`) | MoneyInput | $5,000 | ≥ first bet | as first bet |
| Bankroll (`calc-bankroll`) | MoneyInput | $5,000 | ≥ first bet | "The bankroll must cover the first bet." |
| Spins (`calc-spins`) | IntField | 500 | 1–100,000 | "Spins: 1 to 100,000." |
| Cash out after (`calc-w`) | IntField, hint "cycle wins; 0 = no cash-out; = $X" | 0 | integer 0–1,000 | "0 to 1,000 cycle wins." |

Hints: coverage "Chance per spin: 48.6%. Each loss raises the bet ×2.00, enough to win back every loss
plus one first-bet profit." (`g = 36/(36 − c)`, two decimals). Above the fields, three `Chip` buttons fill
the inputs: "Red, doubling from $25" (18, $25, $25, $5,000, $5,000), "Red, doubling from $5" (18, $5,
$5, $5,000, $5,115) and "Dozen, ×1.5 from $25" (12, $25, $1, $5,000, $5,000), all 500 spins, W 0.

Examples in the table use the preset "Red, doubling from $5".

**Outputs** (recomputed on every valid change; the previous result stays while a field is invalid, greyed
with `aria-disabled`; `Stat` tiles in a 2-column grid at every width):

| Output | Formula (ladder.ts / plan.md §2) | Shown as |
| --- | --- | --- |
| Levels that fit | `L`: amounts `ceil(g^k·base/unit)·unit` while `a ≤ betMax` and `Σa ≤ bankroll` | "10", hint "$5, $10, $20 … $2,560" (first 3, last) |
| Chance a cycle runs out | `q = (1 − p)^L`, `p = c/37` | "0.13% (1 in 784)" |
| Typical session stays ahead until | `n½ = ln 2 / (q·p)` | "about spin 1,117", or "past spin S" hint "beyond this session" |
| Chance of no run-out in S spins | `P(no cap) = e^(−q·p·S)` | pct1 |
| Chance of ending ahead | with W > 0: `e^(−q·min(W, p·S))` (plan §2 `(1 − q)^W`, capped at the cycles a session plays); W = 0: same as above | pct1 |
| Typical session (predicted) | `profit × min(W or ∞, p·S)` when the chance above > ½, `profit = levelNet[0] = base·(36 − c)/c`; else "below break-even" | money signed |
| Loss when the ladder runs out | `totalStake = Σ amounts` | money, negative |
| Average | `−1/37` of every dollar bet, always | "−2.7 cents per dollar bet" |
| Deficit warning | `firstDeficitLevel !== null` | `p.error` "Level N does not win back the losses before it: raise the growth or the chip size." |
| Nothing fits | `L === 0` | `p.error` "The first bet does not fit: raise the bankroll or the bet maximum." |

```ts
export interface CalcInput { c: number; base: number; unit: number; betMax: number; bankroll: number; spins: number; w: number }
export interface CalcResult { ladder: LadderResult; pWin: number; typical: number | 'negative'; capLoss: number }
export function calculate(i: CalcInput): CalcResult;                 // calculator.ts, pure
export function cashOut(r: LadderResult, w: number, spins: number): { pWin: number; typical: number | 'negative' };
export const CALC_DEFAULTS: CalcInput;
export const CALC_PRESETS: readonly { id: string; label: string; input: CalcInput }[];
export function LadderCalculator(props: { initial?: CalcInput }): JSX.Element;
```

Layout: below 1200 px, presets, inputs (a 2-column grid of fields from 390 px, `.define-pair`-like, one
column at 360), outputs. From 1200 px, inputs left and outputs right (`grid-template-columns: 1fr 1fr`,
gap 24). One `p.muted` under the outputs: "Predictions from the cycle model of chapters 3 and 5, not a
simulation. Simulated typical sessions run up to 15% lower. To check a ladder, build it in Define and run
it." A visually hidden `aria-live="polite"` sentence ("10 levels; typical session ahead until about spin
1,117; chance of ending ahead 73.3%") updates 600 ms after the last change; the tiles themselves are not live.

## 8. Accessibility and dark mode checklist

- [ ] One `h1`; chapter titles `h2`; only `h3` inside chapters (§2).
- [ ] Both navs are `<nav aria-label="Chapters">`; the hidden one is `display: none`; links have the
      chapter title as name (chips: short label plus `aria-label` "Chapter 7: Cash out…").
- [ ] Every interactive element ≥ 44 px tall, including chips, the toc links, `summary`, range input,
      next links and any link in prose (`a.link-tap`; the shell spec measures every `a`).
- [ ] Chapter links move focus to the chapter `h2`; deep links on load do not move focus.
- [ ] Every chart: `ChartFrame` figure with a computed summary and a `DataTable`; SVG `role="img"` named by
      title + summary; colour never alone (shapes in DotRows/Scatter, dashes in LineBand, sign labels in
      Bars, filled vs outlined cells in the board).
- [ ] Visible tables: `caption` or `aria-label` on the scroll region, `th scope="col"`/`"row"`.
- [ ] Form fields have labels; errors use `Field`'s `role="alert"` and `aria-invalid`.
- [ ] `details.math` keyboard-operable natively; global focus ring visible on `summary` in both themes.
- [ ] Reduced motion: no smooth scrolling, no animation.
- [ ] Dark mode: no literal colours in `research.css` or any chapter CSS/SVG; app tokens (`--surface`,
      `--bg`, `--text`, `--muted`, `--border`, `--accent`, `--amber`, `--focus`, `--danger`) and chart tokens
      only; checked with `data-theme="dark"` and OS dark. axe clean in both.
- [ ] No horizontal page scroll at 360 px; wide tables and the chip row scroll in their own containers.

## 9. Files and ownership

All under `src/app/screens/Research/` unless a path is given. A wave-B implementer edits **only** files in
its row. I1b creates every chapter file as a placeholder and points `chapters.tsx` at them, so
`chapters.tsx` and `index.tsx` are never edited in wave B (three agents editing adjacent lines of one map
would conflict on rebase).

| File | Owner | Exports (props/types) |
| --- | --- | --- |
| `routes.tsx`, `router.ts` (`parentOf`), `More/index.tsx`, `Nav.tsx` `also`, `shell.spec.ts` route loop | I1, landed | — |
| `components/TopBar.tsx` | **I1b**: `TITLES.research = 'Research'` (missing; the TopBar now says "spinner") | — |
| `index.tsx` | I1 landed; **I1b** adds the §2 jump handler, IntersectionObserver, next links, eyebrow, `tabIndex={-1}`, `MathText` | `Research(props: ScreenProps)` |
| `chapters.tsx` | I1 landed; **I1b** replaces `Placeholder` by imports of the ten `Ch*.tsx` | `CHAPTER_CHARTS: Record<string, ChapterChart>`; `type ChapterChart = ComponentType<{ chapter: Chapter }>` (landed; chapter files read numbers by importing `row`, `path`, `data` from `./data`) |
| `kit.tsx` | **I1b** | `MathText(props: { text: string })`; `jumpTo(id: string, opts: { focus: boolean }): void`; `useWidth(): { ref: Ref<HTMLDivElement>; width: number }`; `scaleLinear(d0, d1, r0, r1): (v: number) => number`; `niceTicks(lo, hi, n): number[]`; `pct1(x)`; `money(c)` (signed `formatMoney`); `axisMoney(c)`; `spins(n)` |
| `DotRows.tsx` | **I1b** | `DotRows(props: DotRowsProps)`; `DotSeries { id; label; shape: 'circle' \| 'square' \| 'diamond' \| 'tick'; color: 1–6 }`; `DotRow { id; label; range?: [number, number]; values: Record<string, number \| null> }`; `DotRowsProps { title; summary; series; rows; domain?: [number, number]; clampAt?: number; zeroLine?: string; fmt(v): string; axisFmt(v): string; axisLabel: string; table: TableSpec; rangeLabel?: string }` |
| `research.css` | I1 landed; **I1b** adds eyebrow, next link, `code.formula`, `.research-tablewrap`, `.research-table`, `.research-versus`, `.research-candidate`, §3 grid widths (check against the landed values) | — |
| `ChStart.tsx`, `ChEdge.tsx`, `ChMartingale.tsx`, `ChLevels.tsx` (+ optional `chapters-0-3.css`) | I1b placeholder → **I2** | each `ChXxx(props: { chapter: Chapter }): JSX.Element` |
| `ChPlacement.tsx`, `ChCurve.tsx`, `ChShapes.tsx`, `Scatter.tsx`, `Board.tsx`, `survivors.ts` (+ optional `chapters-4-6.css`) | I1b placeholder for `Ch*` → **I3** | `Ch*` as above; `Scatter(props: ScatterProps)` with `ScatterProps { title; summary; points: { id; x; y; group }[]; groups: { id; label; shape: 'circle' \| 'square' \| 'triangle' \| 'diamond'; color: 1–6 }[]; xDomain; yDomain; curve?: { label; f(x): number; labelAt: number }; xLabel; yLabel; xFmt; yFmt; table: TableSpec }`; `curveGroup(family: string): string`; Board and survivors per §5.4 |
| `ChCashout.tsx`, `ChLimits.tsx`, `ChTry.tsx`, `TryIt.tsx`, `share.ts`, `LadderCalculator.tsx`, `calculator.ts` (+ optional `chapters-7-9.css`) | I1b placeholder for `Ch*` → **I4** | per §6, §7 |
| `content.ts` | C1 (stub landed by I1 with the final type) | `Chapter { id; title; lead; body: string[]; takeaways: string[]; math: { text: string[]; formulas: string[] }; dataKeys: string[] }`, `CHAPTERS: Chapter[]` |
| `data.json`, `data.ts`, `dataTypes.ts` | T1, landed | `data`, `row`, `path`, `candidate`, `rowsOf`; types of app-plan §5 |
| `ladderMath.ts` | T2, landed | `ladder`, `LadderInput`, `LadderResult` |
| `tests/e2e/research.spec.ts` | Q1 | — |

**Chapter 10 `play-c9` (added after wave B).** "Play c9 at the table", the c9 cash-out candidate as a
step-by-step how-to, placed after `try` (the chapter list, the chips, the next links and the static
pages all follow `CHAPTERS`). New files: `playC9.ts` (pure: the level table, the loss limit's trip
level and the cycle-model numbers, derived from the candidate document in `data.json`; also read by
`build/static-research.ts`, so it is in `tsconfig.node.json`), `playC9.test.ts`, `ChPlayC9.tsx`
(checklist, rules, `BoardGlyph` at levels 0–3 and 14, the 16-row level table in `TableWrap`, `Stat`
tiles from `e7-c9:e7-c9-W20-SLhalf`, `TryIt` for the one candidate, and a pocket card whose "Print this
card" button calls `window.print()`), `ChPlayC9.test.tsx` and `chapters-10.css` (the `@media print`
rules apply only while `printCard()` has put `research-print-card` on `<html>`; in print the card
uses the light scheme's `Canvas`/`CanvasText`, no literal colours). Edited: `content.ts`,
`chapters.tsx`, `content.test.ts`, `research.test.tsx`, `tests/e2e/research.spec.ts`,
`build/static-research.ts` (chapter tables and title), `tsconfig.node.json`.

Placeholders: each `ChXxx.tsx` from I1b returns the landed placeholder markup
(`<div class="chart-slot" aria-hidden="true">`) and has the final export name and signature. Optional CSS
files are imported by the owner's `Ch*.tsx` files.

## 10. Test plan

Unit tests (Vitest; `src/app/**` runs in happy-dom; `@testing-library/preact` as `Library/library.test.tsx`):

| Test file | Owner | Asserts |
| --- | --- | --- |
| `kit.test.tsx` | I1b | `MathText`: `^`/`_` to sup/sub, no HTML injection (`<b>` stays text); `pct1(0.9031)` = "90.3%"; `axisMoney` values; `niceTicks` |
| `research.test.tsx` (landed) | I1, extended by I1b | landed: ten chapters in order, one h1, sections with details, both navs, `?chapter=` scroll, unknown id. I1b adds: clicking a chip calls `history.replaceState` with `#/research?chapter=<id>` and focuses the h2 (`tabIndex -1`); summary text "The math"; next links |
| `DotRows.test.tsx` | I1b | marks per row and series; `null` draws nothing; clamp triangle above `clampAt`; table rows = data rows |
| `chapters-0-3.test.tsx` | I2 | each chapter renders with the real `data.json` (every key exists), the right number of series/marks and a non-empty summary; ch 3 predictions equal `ladder()` for L5–L10 (L10 within 3 of 1,117) |
| `chapters-4-6.test.tsx`, `survivors.test.ts`, `board.test.tsx` | I3 | real-data render; `curveGroup` on every `data.curve` family; scatter hides x > 2.5 and counts them in the summary; `ladderFromStrategy` matches `SURVIVORS` for the three e6-full strategies; `betsAtLevel` (c9 level 0 → 1 street, level 3 → 4, level 16 → 'capped'); `chipCount(100)` 1, `(41100)` 10; board draws 37 cells, covered cells filled |
| `share.test.ts` | I4 | for each candidate: `normalizeDefinition` ok; `encodeShareLink` gives `#/define?d=…&h=…`; `decodeShareLink` round trip equals the normalized definition (rules override, bankroll 500000, maxRounds 500, seed 20261031, sessions 10000, strategy unchanged); `tooLong` path with a stubbed encoder gives `kind: 'file'` |
| `calculator.test.ts` | I4 | the four `ladder.test.ts` pins through `calculate`; presets: red $5 → L 10, n½ within 3 of 1,117; dozen ×1.5 $25 → L 11, n½ within 3 of 159 (ch 4); c9-like q 0.00356: `cashOut` W20 ≈ 0.931, W100 ≈ 0.70 (plan §7.11) |
| `calculator-ui.test.tsx`, `tryit.test.tsx` | I4 | invalid coverage shows the error and keeps the last result; a preset fills every field; `TryIt` button calls `go` with a `#/define?d=` hash; error and file states render |

E2E `tests/e2e/research.spec.ts` (Q1; `test`, `expectAxeClean`, `screenCheck` from `helpers.ts`; projects
phone-360, phone 390 × 844, phone-landscape 844 × 390, desktop 1280 × 800; `page.goto('./?e2e#/research')`):

| Case | All four viewports unless noted |
| --- | --- |
| Structure | one h1; 10 `section.research-chapter`, each with an h2 and a `details.math` whose summary reads "The math"; `screenCheck` (no element wider than the viewport outside scrollers, no console or CSP errors, axe clean) |
| Tap targets | the shell spec's ≥ 43.5 px loop, plus `summary` and `input[type=range]` |
| Nav visibility | < 768: chip nav visible, toc hidden; ≥ 768 (landscape, desktop): toc visible and sticky (its top stays put after scrolling 2,000 px), chips hidden |
| Jump | click chapter 7 in the visible nav: URL ends `#/research?chapter=cashout`, the h2 "Cash out…" is focused and in the viewport; set calculator coverage to 12 first and check it is still 12 afterwards (no remount) |
| Deep link | `#/research?chapter=curve`: the curve section's top is within 0–120 px of the viewport top; `?chapter=nope` opens at the top without errors |
| Math | summary `aria-expanded`/`open` false → click → true; Enter on the focused summary closes it; reload → closed |
| Calculator | preset "Red, doubling from $5" → "10" levels and "1,117"; coverage 40 → error text, results greyed |
| Try it | button named `/^Open in Define: Keeper c9/` → URL matches `/#\/define\?d=/`, text "Loaded from a link. This is an unsaved draft.", seed field 20261031, spins 500 (phone-360 and desktop only) |
| Dark | `localStorage['spinner:theme'] = 'dark'` before load: axe clean, screenshots `research-<project>-dark.png` (with `SHOTS_DIR`, as `shell.spec.ts`) |

`shell.spec.ts` already has `#/research` in its route loop (I1, landed).

## 11. Open questions for the orchestrator

1. **I1b before wave B.** I1 landed (0444b3d) before this design and without `kit.tsx`, `DotRows.tsx`,
   the ten placeholder `Ch*.tsx`, the jump handler (each chip tap now remounts the screen through
   `RouteBoundary key={hash}`) and the TopBar title. Proposal: one Sonnet "I1b" makes the §9 **I1b** rows
   before I2/I3/I4 start (about an hour).
2. **`RowStats.meta`.** Chapters 4 and 7 draw predictions from the spec meta (`c, p, q, B, g, L, base`),
   which T1's `data.json` lacks (app-plan §5 has no such field). Proposal: T1 adds
   `meta: Record<string, number> | null` copied from each spec row; until then those prediction series
   are omitted (the charts are designed to work without them).
3. **Risk notice vs decisions #11.** app-plan §3 puts "the risk notice" in chapter 9; decisions #11 keeps
   the disclaimer on Settings/About only. This design links to `#/settings?section=about` and shows no
   disclaimer text. Confirm, or record an exception in decisions.md.

Settled while writing (no longer open): the `content.ts` shape is the landed stub's
(`math: { text, formulas }`); `medianAheadUntil` is the last checkpoint round with `p50 > 0` and `null`
when the typical session is never ahead (`scripts/research/run.ts:245-269`), so 500 means "still ahead at
the end"; candidates come in file order (b3, c9 cash-out, c9) and `TryIt` sorts them as plan §9 does
(c9 cash-out, c9, b3) by id.

Conflicts with app-plan.md found in the code, resolved above: chapter 1's "overlaid histograms" (no
histogram data in §5, so `DotRows`); chapter 4's "grouped bars" (`Bars` has no groups, so `DotRows`);
"in-page anchors" (hash router; replaceState links instead); imports from `@core/ui/charts` (lint allows
only `@core/ui`; `useElementWidth`/scales are not exported); `Card` has no `id` (section.card as Settings
About); `router.ts` `parentOf` and `TopBar` titles also need a line each; a1's board needs its strategy,
which is not in `data.json` (hand-written `SURVIVORS` with a spec cross-check).
