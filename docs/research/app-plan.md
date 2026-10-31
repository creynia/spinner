# Research section in the app: plan

Owner: creynia. Orchestrator: this document's author. Branch: `claude/roulette-strategy-variance-utbjcd`.
Inputs: `docs/research/plan.md` (findings §7, open questions §8, candidates §9), `docs/research/briefs/*.md`,
`docs/research/results/*.json`, `scripts/research/candidates/*.json`. Repository rules: `CONTRIBUTING.md`,
`docs/design/decisions.md` (wins), `docs/design/architecture.md` §6 (screens), §7 (charts).

## 1. What is being built

A **Research** entry under the **More** tab (`#/research`) that tells the story of the loop's findings to a
lay reader, with real charts from the simulation results, and a collapsible "The math" block in every
chapter for readers who want the derivation. The framing is practical: how to use what was learned to shift
the *median* session outcome positive, starting from even-money bets and moving toward layouts that are
more fun to play (towers of chips, shapes on the board, favourite numbers), while being plain that the
*mean* never turns positive and that the median is bought with the tail.

Three things make it more than a static page:

- **Charts from data**, not pictures: the equity-path quantiles and the headline numbers of the ledger rows
  are shipped as a small JSON and drawn with the app's own SVG charts (`src/core/ui/charts`).
- **Try it:** every candidate strategy has an "Open in Define" button that builds a share link
  (`encodeShareLink`) carrying the strategy, the $1-minimum table override, the $5,000 bankroll, 500 spins
  and the stops, so the owner's caveat "the strategy file cannot carry table limits" disappears.
- **Build your own ladder:** a small calculator (the pure maths of `scripts/research/ladder.ts`, moved into
  the app) where the reader picks coverage, base stake, bankroll and a cash-out target and sees levels,
  the cap chance, the horizon and the predicted P(win) and median.

## 2. Reader and tone

A roulette player who is curious, not a statistician. Every chapter leads with one sentence a player can
act on, then a chart, then two or three takeaways. Words to avoid in the lead text: variance, quantile,
skew, CVaR, expectation. Words to use: average (for mean), typical session (for median), worst 5 % of
sessions (for CVaR 5 %), chance of ending ahead (P(win)), bankroll, table minimum, cash-out. Each chapter's
"The math" block may use the real terms and the formulas. Never promise an edge: the sentence "every
dollar you bet costs 2.7 cents on average, no matter how you bet it" appears in chapter 1 and in the closing
chapter. Money is formatted with the app's `formatMoney`; percentages to one decimal.

## 3. Chapters (fixed; content and design agents work from this list)

Each chapter has: `id`, title, lead (one sentence), body (≤ 120 words), one chart, takeaways (≤ 3 bullets),
math block (≤ 200 words plus formulas), and the data keys it needs (section 5). Numbers in text must come
from `docs/research/results/*.json` or `plan.md` §7 tables and be re-checked by the content agent.

| # | id | title (working) | what it shows | chart | data (results file: ids) |
| --- | --- | --- | --- | --- | --- |
| 0 | `start` | Start here | Three cards: the edge never changes; you can change the shape; a cash-out locks the typical session. Flat red vs c9 cash-out: typical session, chance of ending ahead, average, worst 5 %. | stat tiles | observations: flat-red; e7-c9: e7-c9-W20-SLhalf |
| 1 | `edge` | Every dollar costs the same | $25 on red, on red + a dozen, on 25 numbers: same average loss (−$338), different spread (SD $557 / $490 / $375). | three overlaid histograms of final net, or a dot-and-range strip | e1-spread: e1-red, e1-red12-dozen3-13, e1-straights25 |
| 2 | `martingale` | Why doubling feels like it works | Median path of flat, Martingale and Fibonacci on red: the median rises, then collapses at spin 290 (Martingale). Cycles and the cap. | line band: p50 with p10–p90 band, three series | observations: flat-red, martingale-red, fibonacci-red |
| 3 | `levels` | Levels, not luck | Horizon vs levels (5..10): each level roughly doubles how long the typical session stays ahead; 10 levels at a $5 base keeps +$1,185 at spin 500. Same 8 levels with a $10,000 bankroll: same horizon. | bars or dots: ahead-until vs L, with the n½ prediction line | e3a-levels: L5..L10; observations: martingale-red-br10k |
| 4 | `placement` | Beyond red: grow at the right rate | Doubling on a dozen dies at spin ~70; ×1.5 restores 160; g = 36/(36 − c) table for dozen, two dozens, six-line, corner, 25 and 35 numbers; the $5-base dozen at +$1,611. | grouped bars: horizon with the right factor vs doubling, per placement | e4-*: `-g-stop` twins and `-x2` controls; e4-dozen: dozen-g-u5 |
| 5 | `curve` | One curve rules them all | Never-capped share vs x = p·S/B for 53 ladders sits under e^(−x); layout is not a lever beyond bankroll-in-profits; widening raises k. | scatter + curve | briefs/E5.md table (extracted to data by the content agent: id, family, x, never-capped, k) |
| 6 | `shapes` | Towers, shapes and favourite numbers | The three survivors as board pictures per level (widen a1, stack b3, hybrid c9) and their paths; 4-seed table: typical, chance ahead, average, worst 5 %, bust. | small board glyphs (SVG) + line band of p50 for the three | e6-full: a1, b3, c9 (seed 20261031), e8-seed3 |
| 7 | `cashout` | Cash out: the stop that moves the typical session | c9 with targets W5..W100: chance of ending ahead falls as the target rises; the typical session equals the target; the stop-loss halves the worst 5 %. Martingale's 8th bet gets cut by the bankroll; the 7-loss trailing stop. | line: P(win) vs target, with the e^(−qW) prediction; secondary: worst 5 % | e7-c9: W5..W100, W20-SLhalf; e7-mart; e7b-mart-L7stop |
| 8 | `limits` | What breaks it | American wheel (a1 flips), 1,000 spins (every median negative), $25 table minimums (all survivors need $1), bankroll above the ladder changes nothing. Honesty: the average is negative on every row. | table + two small bars | e8-american, e8-length, e8-partage, e8-br10k |
| 9 | `try` | Try it | Candidates with Open in Define; the ladder calculator; how to read the Analyze screen afterwards; the risk notice. | calculator UI | candidates/*.json; plan §9 |

Section order on the page is 0..9. Desktop shows a sticky chapter list on the left; phone shows a chapter
chip row under the h1 and in-page anchors. Deep links `#/research?chapter=<id>` scroll to a chapter.

## 4. Architecture

- Route `/research` (`src/app/routes.tsx`; one new line), screen `src/app/screens/Research/index.tsx`,
  styles `research.css`, content `content.ts` (prose and takeaways, typed), data `data.json` (generated)
  and `data.ts` (typed loader and series helpers), `ladderMath.ts` (moved from `scripts/research/ladder.ts`;
  the script then imports it from `@app/screens/Research/ladderMath`), `LadderCalculator.tsx`,
  `Board.tsx` (board glyph for a layout at a level), `TryIt.tsx` (share-link buttons).
- More screen: add `{ path: '/research', label: 'Research', hint: 'What progressions can and cannot do' }`
  at the top of `LINKS`. Nav: add `/research` to the More item's `also`.
- Charts: `LineBand`, `Bars`, `Histogram`/`OverlayHistogram`, `ChartFrame`/`ChartSvg`/`Legend`/`DataTable`
  from `@core/ui/charts`; a scatter is new and small (chapter 5) and lives in the screen, drawn with
  `ChartSvg`. Every chart has a `DataTable` fallback for screen readers, as the existing charts do.
- Collapsible math: a native `<details class="math">` with `<summary>The math</summary>`, styled in
  `research.css`; formulas as plain text with `<sub>`/`<sup>`; no external script or font (CSP).
- Data budget: `data.json` ≤ 150 KB; paths downsampled to ≤ 60 points per series. It is a static import,
  bundled and precached by the service worker like any module.
- Tests: unit tests for `data.ts` (shape, budget), `ladderMath.ts` (pinned values from `ladder.test.ts`),
  `content.ts` (every chapter has every field, no banned words in leads), the share-link builder (round
  trip through `decodeShareLink`); e2e: `tests/e2e/shell.spec.ts` gains `#/research` in its route loop
  (one h1, no overflow, axe clean, tap targets) and a research spec checks chapter anchors, a details
  toggle, the calculator and that Open in Define lands on `#/define?d=` with the notice "Loaded from a link".

## 5. `data.json` schema (owned by the data agent; consumed by everyone)

```ts
interface ResearchData {
  generatedFrom: string[];                 // result files used
  rows: Record<string, RowStats>;          // key: "<file>:<id>"
  paths: Record<string, PathSeries>;       // same keys, only for rows a chart draws
  curve: CurvePoint[];                     // chapter 5
  candidates: Candidate[];                 // chapter 9
}
interface RowStats {
  file: string; id: string; sessions: number; bankroll: number; maxRounds: number;
  mean: number; meanCI: [number, number]; median: number; medianCI: [number, number];
  sd: number; p10: number; p90: number; cvar5: number; pWin: number; pBust: number;
  capRate: number;                          // endedBy strategy:cap-* / N
  wagerMean: number; edgeRealized: number; roundsMean: number;
  medianAheadUntil: number | null; medianPeak: { round: number; net: number };
}
interface PathSeries { rounds: number[]; p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[]; mean: number[]; ahead: number[] }
interface CurvePoint { id: string; family: string; x: number; neverCapped: number; k: number }
interface Candidate { id: string; file: string; name: string; strategy: unknown; rules: unknown; session: unknown; rows: string[] }
```

Row keys the chapters need are listed in section 3; the data agent includes every id from those files
plus the three candidates' rows on all four seeds.

## 6. Work packages, agents and waves

Shared-file ownership: `plan.md`, `ledger.md`, `HANDOFF.md`, `app-plan.md`, `routes.tsx`, `Nav.tsx`,
`More/index.tsx` are the orchestrator's; a WP that must touch one says so and touches only its line.
Every agent works in its own worktree, pulls the branch first, commits only its own files, runs
`npm run lint && npm run typecheck && npm run format:check` plus its own tests before pushing, rebases on
push conflicts, and never opens a pull request. Commit prefixes: `feat(research-ui):`, `test:`, `docs:`.

**Wave A (parallel, start now)**

| WP | model | produces | notes |
| --- | --- | --- | --- |
| C1 content | Opus | `docs/research/report.md` (owner-facing report, chapters 0–9, every number re-checked against results) and `src/app/screens/Research/content.ts` (the same prose as typed data: `CHAPTERS: Chapter[]` with id, title, lead, body, takeaways, math, dataKeys) | Lay tone per §2; math blocks carry the formulas; the report is also the file a human reads |
| D1 design | Opus | `docs/design/research.md`: IA, layout at 360/768/1280, chart spec per chapter (type, series, axes, legend, colours from tokens), board glyph spec, calculator UI, Try-it flow, accessibility, test plan, exact file list and props for wave-B implementers | Reads architecture.md §6–7, layouts.md, the existing Analyze and Gallery screens |
| T1 data | Sonnet | `scripts/research/app-data.ts` + `npm run research:app-data`, `src/app/screens/Research/data.json`, `data.ts`, unit test | Schema §5; budget 150 KB; curve points from `briefs/E5.md` table |
| T2 tooling | Sonnet | runner: `capRate` in reports; aggregator: E4 unit fix (`meta.tau` or documented B convention); `ladderMath.ts` moved into the app with the script importing it, tests moved/kept green | Closes two §8 items |
| X1 experiments | Sonnet | c9 cash-out on the American wheel and at 250 / 1,000 spins; a1 with a 7-of-8 trailing stop (`amounts` cut by one level, `onCap: stop`, W20); predictions written first; specs, reports, ledger rows, plan §7.16 | The only wave-A agent that edits `plan.md`/`ledger.md` |
| I1 scaffold | Sonnet | route, More link, Nav `also`, `Research/index.tsx` shell with chapter navigation and anchors, `research.css` incl. `details.math`, placeholder chapters rendered from `content.ts` stub, `shell.spec.ts` route loop entry | Implements the skeleton decisions in §3–4 so D1 need not re-decide them |

**Wave B (after C1, D1, T1 land)**

| WP | model | produces |
| --- | --- | --- |
| I2 chapters 0–3 | Sonnet | stat tiles, histogram strip, line bands, levels chart |
| I3 chapters 4–6 | Sonnet | placement bars, curve scatter, board glyphs + survivor paths |
| I4 chapters 7–9 | Sonnet | cash-out chart, limits table, Try-it buttons (share link), calculator |
| R1 review | Sonnet | code review of wave B against `docs/design/research.md`; findings fixed by the authors |
| Q1 e2e + screenshots | Sonnet | `tests/e2e/research.spec.ts`, four viewports, light/dark screenshots into `docs/screenshots/` |

**Wave C**: orchestrator review of the screen and the report against the results; README line; final
`npm run check`, build, push.

## 7. Acceptance

- `#/research` renders all ten chapters on phone and desktop, one h1, axe clean, dark mode correct.
- Every number on the page is traceable to a `rows[...]` entry in `data.json` or to `content.ts`, and
  every `content.ts` number was re-checked against `docs/research/results/*.json` by C1.
- "Open in Define" for each candidate produces a draft whose run reproduces the ledger row's median on
  seed 20261031 (the Define screen's seed field set from the link).
- The calculator reproduces `ladder.test.ts` pins and the chapter-3 and chapter-4 horizons.
- `npm run check` and `npm run build` pass; `data.json` ≤ 150 KB.
