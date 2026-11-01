// Static, JS-free pages for the Research and Sources screens (docs/seo.md): /research/, one page per
// chapter at /research/<chapter id>/, and /sources/. The prose is the chapter text of
// src/app/screens/Research/content.ts, verbatim. Every number in a table comes from data.json
// through the app's own loader (`row`, `path`) and its own maths (`ladder`, SURVIVORS), formatted
// like the Research screen (kit.tsx `money`, `pct1`, `spins`); the house-edge table is the exact
// edge of each bet from its payout and pocket count, which tests pin to the engine's `betEdge`.
// Nothing here is a hand-typed statistic: the chapter charts become the tables of values they plot.
import { formatMoney } from '../src/core/money/cents.ts';
import { CHAPTERS, type Chapter } from '../src/app/screens/Research/content.ts';
import { data, path, row } from '../src/app/screens/Research/data.ts';
import type { RowStats } from '../src/app/screens/Research/dataTypes.ts';
import { ladder } from '../src/app/screens/Research/ladderMath.ts';
import { SURVIVORS, capLoss } from '../src/app/screens/Research/survivors.ts';
import { SOURCE_GROUPS } from '../src/app/sources.ts';
import {
  APP,
  APP_URL,
  OG_IMAGE,
  ORIGIN,
  PERSON_ID,
  WEBSITE_ID,
  esc,
  relatedHtml,
  renderPage,
  type Crumb,
  type Obj,
  type PageOut,
  type RelatedLink,
} from './static-shell.ts';

// ---------------------------------------------------------------- formatting (as kit.tsx)

/** Net amounts: "+$286", "-$46.25" (kit.tsx `money`). */
export const money = (cents: number): string => formatMoney(cents, { sign: true });
/** Unsigned amounts: "$5,000". */
const dollars = (cents: number): string => formatMoney(cents);
/** "90.3%" (kit.tsx `pct1`). */
export const pct1 = (x: number): string => `${(x * 100).toFixed(1)}%`;
/** "1,117" (kit.tsx `spins`). */
export const spins = (n: number): string => n.toLocaleString('en-US');
const pct2 = (x: number): string => `${(x * 100).toFixed(2)}%`;

// ---------------------------------------------------------------- tables (HTML and Markdown)

export interface Table {
  caption: string;
  head: string[];
  /** Each row: the first cell is the row header. Plain text (escaped here). */
  rows: string[][];
}

function tableHtml(t: Table): string {
  const head = t.head.map((h) => `<th scope="col">${esc(h)}</th>`).join('');
  const body = t.rows
    .map(
      ([first = '', ...rest]) =>
        `<tr><th scope="row">${esc(first)}</th>${rest.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`,
    )
    .join('\n');
  return `<div class="scroll"><table>\n<caption>${esc(t.caption)}</caption>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody></table></div>`;
}

function tableMd(t: Table): string {
  const cell = (s: string) => s.replaceAll('|', '\\|');
  return [
    `Table: ${t.caption}`,
    '',
    `| ${t.head.map(cell).join(' | ')} |`,
    `|${t.head.map(() => '---').join('|')}|`,
    ...t.rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

/** "4 seeds: -$3,214 to -$3,209" style range over several rows. */
function seedRange(rows: RowStats[], pick: (r: RowStats) => number, fmt: (v: number) => string) {
  const v = rows.map(pick);
  return `${fmt(pick(rows[0]!))} (${rows.length} seeds: ${fmt(Math.min(...v))} to ${fmt(Math.max(...v))})`;
}

const setupOf = (r: RowStats): string =>
  `${spins(r.sessions)} sessions, ${dollars(r.bankroll)} bankroll, up to ${spins(r.maxRounds)} spins`;

// ---------------------------------------------------------------- house edge (exact)

type Wheel = 'european' | 'american' | 'triple-zero';
export const WHEEL_POCKETS: Record<Wheel, number> = {
  european: 37,
  american: 38,
  'triple-zero': 39,
};

export interface EdgeBet {
  label: string;
  /** Canonical bet id per wheel (for the engine check in tests). */
  id: Record<Wheel, string>;
  covered: Record<Wheel, number>;
  /** "X to 1" (src/game/roulette/bets.ts `payout`). */
  pays: Record<Wheel, number>;
}

const same = <T>(v: T): Record<Wheel, T> => ({ european: v, american: v, 'triple-zero': v });

/** One row per bet family: the numbers covered and the payout set the exact edge. */
export const EDGE_BETS: readonly EdgeBet[] = [
  { label: 'Straight up (one number)', id: same('straight:17'), covered: same(1), pays: same(35) },
  { label: 'Split (two numbers)', id: same('split:17-20'), covered: same(2), pays: same(17) },
  {
    label: 'Street (three numbers)',
    id: same('street:16-17-18'),
    covered: same(3),
    pays: same(11),
  },
  {
    label: 'Corner (four numbers)',
    id: same('corner:17-18-20-21'),
    covered: same(4),
    pays: same(8),
  },
  {
    label: 'Six-line (six numbers)',
    id: same('sixline:13-14-15-16-17-18'),
    covered: same(6),
    pays: same(5),
  },
  { label: 'Dozen or column (12 numbers)', id: same('dozen:2'), covered: same(12), pays: same(2) },
  {
    label: 'Red/black, odd/even, 1-18/19-36',
    id: same('red'),
    covered: same(18),
    pays: same(1),
  },
  {
    label: 'Basket: first four / top line with the zeros',
    id: same('basket'),
    covered: { european: 4, american: 5, 'triple-zero': 6 },
    pays: { european: 8, american: 6, 'triple-zero': 5 },
  },
];

/** Exact house edge of a bet as a fraction of the stake: 1 - (pays + 1) x covered / pockets. */
export function exactEdge(b: EdgeBet, w: Wheel): { num: number; den: number } {
  const n = WHEEL_POCKETS[w];
  return { num: n - (b.pays[w] + 1) * b.covered[w], den: n };
}
const edgePct = (e: { num: number; den: number }): string => pct2(e.num / e.den);

function edgeTable(): Table {
  return {
    caption: 'Exact house edge of each roulette bet, by wheel (share of every dollar staked)',
    head: ['Bet', 'Pays', 'European (single zero)', 'American (double zero)', 'Triple zero'],
    rows: EDGE_BETS.map((b) => [
      b.label,
      b.pays.european === b.pays.american && b.pays.american === b.pays['triple-zero']
        ? `${b.pays.european} to 1`
        : `${b.pays.european} / ${b.pays.american} / ${b.pays['triple-zero']} to 1`,
      edgePct(exactEdge(b, 'european')),
      edgePct(exactEdge(b, 'american')),
      edgePct(exactEdge(b, 'triple-zero')),
    ]),
  };
}

/** The even-money edge with la partage: half the stake comes back on a zero, so 1/74. */
export const LA_PARTAGE_EDGE = { num: 1, den: 2 * WHEEL_POCKETS.european };

/** The measured cost of the wheel, flat $25 on red: the same spins on both wheels. */
const FLAT_EU = 'e6-full:flat-red@20261031';
const FLAT_AM = 'e8-american:e8-am-flat-red';

function wheelSimTable(): Table {
  const eu = row(FLAT_EU);
  const am = row(FLAT_AM);
  const col = (r: RowStats) => [
    money(r.mean),
    money(r.median),
    pct1(r.pWin),
    pct2(-r.edgeRealized),
    dollars(r.wagerMean),
  ];
  return {
    caption: `Flat $25 on red, simulated on both wheels (${setupOf(eu)})`,
    head: [
      'Wheel',
      'Average result',
      'Typical session',
      'Chance of ending ahead',
      'Realized edge',
      'Wagered per session',
    ],
    rows: [
      ['European (single zero)', ...col(eu)],
      ['American (double zero)', ...col(am)],
    ],
  };
}

function edgeAnswer(): string {
  const red = EDGE_BETS.find((b) => b.id.european === 'red')!;
  const basket = EDGE_BETS.find((b) => b.id.european === 'basket')!;
  const eu = row(FLAT_EU);
  const am = row(FLAT_AM);
  return `The house edge in roulette is ${edgePct(exactEdge(red, 'european'))} on every bet of a European single-zero wheel and ${edgePct(exactEdge(red, 'american'))} on an American double-zero wheel, except the American five-number top line, which costs ${edgePct(exactEdge(basket, 'american'))}. With la partage (French rules) the even-money bets cost ${edgePct(LA_PARTAGE_EDGE)}. In money: $25 a spin on red for ${spins(eu.maxRounds)} spins averaged ${money(eu.mean)} on the European wheel and ${money(am.mean)} on the American one in ${spins(eu.sessions)} simulated sessions. No way of spreading or sizing the bets changes the edge.`;
}

// ---------------------------------------------------------------- chapter tables (the charts as data)

/** Chapter 0: flat red beside the c9 cash-out (ChStart). */
function startTables(): Table[] {
  const flat = row('observations:flat-red');
  const cash = row('e7-c9:e7-c9-W20-SLhalf');
  const line = (label: string, f: (r: RowStats) => string) => [label, f(flat), f(cash)];
  return [
    {
      caption: `Flat $25 on red against streets with a cash-out (${setupOf(flat)})`,
      head: ['Measure', 'Flat $25 on red', 'Streets with a cash-out'],
      rows: [
        line('Typical session', (r) => money(r.median)),
        line('Chance of ending ahead', (r) => pct1(r.pWin)),
        line('Average', (r) => money(r.mean)),
        line('Worst 5 % of sessions', (r) => money(r.cvar5)),
        line('Ended broke', (r) => pct1(r.pBust)),
        line('Wagered per session', (r) => dollars(r.wagerMean)),
      ],
    },
  ];
}

/** Chapter 1: the three spreads (ChEdge). */
export const EDGE_SPREADS = [
  { label: 'Red', key: 'e1-spread:e1-red' },
  { label: 'Red + a dozen', key: 'e1-spread:e1-red12-dozen3-13' },
  { label: '25 numbers', key: 'e1-spread:e1-straights25' },
] as const;

function edgeTables(): Table[] {
  const first = row(EDGE_SPREADS[0].key);
  return [
    {
      caption: `Result after ${spins(first.maxRounds)} spins at $25 a spin, by spread (${setupOf(first)})`,
      head: [
        'Bet',
        'Average',
        'Typical',
        '10th pct',
        '90th pct',
        'SD',
        'Worst 5 %',
        'Ending ahead',
      ],
      rows: EDGE_SPREADS.map(({ label, key }) => {
        const r = row(key);
        return [
          label,
          money(r.mean),
          money(r.median),
          money(r.p10),
          money(r.p90),
          dollars(r.sd),
          money(r.cvar5),
          pct1(r.pWin),
        ];
      }),
    },
  ];
}

/** Chapter 2: the typical-session paths of ChMartingale, and the three rows. */
const MART_LINES = [
  { label: 'Flat $25 on red', key: 'observations:flat-red' },
  { label: 'Martingale', key: 'observations:martingale-red' },
  { label: 'Fibonacci', key: 'observations:fibonacci-red' },
] as const;

const aheadUntil = (r: RowStats): string =>
  r.medianAheadUntil === null
    ? 'never ahead'
    : r.medianAheadUntil >= r.maxRounds
      ? `still ahead at spin ${spins(r.maxRounds)}`
      : `spin ${spins(r.medianAheadUntil)}`;

function martingaleTables(): Table[] {
  const [flat, mart, fib] = MART_LINES.map((l) => path(l.key));
  const r0 = row(MART_LINES[0].key);
  return [
    {
      caption: `Martingale, Fibonacci and flat betting on red (${setupOf(r0)})`,
      head: [
        'Strategy',
        'Typical session ahead until',
        'Typical session peak',
        'Typical at the end',
        'Average',
        'Ended broke',
        'Wagered per session',
      ],
      rows: MART_LINES.map(({ label, key }) => {
        const r = row(key);
        return [
          label,
          aheadUntil(r),
          `${money(r.medianPeak.net)} at spin ${spins(r.medianPeak.round)}`,
          money(r.median),
          money(r.mean),
          pct1(r.pBust),
          dollars(r.wagerMean),
        ];
      }),
    },
    {
      caption: 'Typical session by spin, on red (the chart in the app)',
      head: [
        'Spin',
        'Flat typical',
        'Martingale typical',
        'Martingale 10th pct',
        'Martingale 90th pct',
        'Fibonacci typical',
      ],
      rows: flat!.rounds.map((rd, i) => [
        `spin ${spins(rd)}`,
        money(flat!.p50[i]!),
        money(mart!.p50[i]!),
        money(mart!.p10[i]!),
        money(mart!.p90[i]!),
        money(fib!.p50[i]!),
      ]),
    },
  ];
}

/** Chapter 3 (ChLevels): the prediction n½ from `ladder()` with the experiment's own stake. */
export const LEVELS = [5, 6, 7, 8, 9, 10] as const;
export function predictedHalfLife(r: RowStats, L: number): number {
  const base = r.bankroll / (2 ** L - 1);
  return ladder({ c: 18, g: 2, base, unit: base, betMax: r.bankroll, maxLevels: L }).nHalf;
}

function levelsTables(): Table[] {
  const rows = LEVELS.map((L) => ({ L, r: row(`e3a-levels:e3a-L${L}`) }));
  const bank = [
    ['Martingale on red, $25 base, $5,000', 'observations:martingale-red'],
    ['Martingale on red, $25 base, $10,000', 'observations:martingale-red-br10k'],
    ['Martingale on red, $5 base, 10 levels, $5,000', 'observations:martingale-red-unit5-L10'],
  ] as const;
  return [
    {
      caption: `How long the typical session stays ahead, by levels in a doubling ladder on red (bankroll of exactly one ladder, ${spins(rows[0]!.r.sessions)} sessions of up to ${spins(rows[0]!.r.maxRounds)} spins)`,
      head: [
        'Levels',
        'Predicted half-life (spins)',
        'Typical session ahead until',
        'Typical at the end',
        'Average',
        'Worst 5 %',
      ],
      rows: rows.map(({ L, r }) => [
        String(L),
        spins(Math.round(predictedHalfLife(r, L))),
        aheadUntil(r),
        money(r.median),
        money(r.mean),
        money(r.cvar5),
      ]),
    },
    {
      caption: 'Same ladder, more money, or more levels',
      head: [
        'Setup',
        'Typical session ahead until',
        'Typical at the end',
        'Average',
        'Worst 5 %',
        'Ended broke',
      ],
      rows: bank.map(([label, key]) => {
        const r = row(key);
        // The labels name the setup; check them against the row so a data change cannot drift.
        if (!label.includes(dollars(r.bankroll))) throw new Error(`research: ${key} bankroll`);
        return [
          label,
          aheadUntil(r),
          money(r.median),
          money(r.mean),
          money(r.cvar5),
          pct1(r.pBust),
        ];
      }),
    },
  ];
}

/** Chapter 4 (ChPlacement.PLACEMENTS). */
const standard = (p: string, label: string) => ({
  id: p,
  label,
  right: `e4-${p}:e4-${p}-g-stop`,
  doubling: `e4-${p}:e4-${p}-x2`,
});
export const PLACEMENTS = [
  standard('dozen', 'Dozen'),
  {
    id: 'dozen-u5',
    label: 'Dozen, $5 base',
    right: 'e4-dozen:e4-dozen-g-u5-stop',
    doubling: 'e4-dozen:e4-dozen-x2-u5',
  },
  standard('two-dozens', 'Two dozens'),
  standard('sixline', 'Six-line'),
  standard('corner', 'Corner'),
  standard('straights25', '25 numbers'),
  standard('straights35', '35 numbers'),
];

const aheadShort = (v: number | null): string =>
  v === null ? 'never' : v >= 500 ? '500+' : spins(v);

function placementTables(): Table[] {
  return [
    {
      caption: 'Spins the typical session stays ahead, by placement (the chart in the app)',
      head: [
        'Placement',
        'Growth factor',
        'Right factor (spins ahead)',
        'Doubling (spins ahead)',
        'Predicted n½ (spins)',
        'Average, right factor',
      ],
      rows: PLACEMENTS.map((p) => {
        const right = row(p.right);
        const dbl = row(p.doubling);
        const m = right.meta;
        const n = m && m.q! > 0 && m.p! > 0 ? Math.LN2 / (m.q! * m.p!) : null;
        return [
          p.label,
          m?.g === undefined ? '-' : `×${Number(m.g.toFixed(2))}`,
          aheadShort(right.medianAheadUntil),
          aheadShort(dbl.medianAheadUntil),
          n === null || !Number.isFinite(n) ? '-' : spins(Math.round(n)),
          money(right.mean),
        ];
      }),
    },
  ];
}

/** Chapter 5 (ChCurve): every ladder of data.curve, with Scatter.curveGroup's groups. */
export function curveGroupLabel(family: string): string {
  if (family.startsWith('E3')) return 'Martingale on red';
  if (family.startsWith('E4'))
    return /^E4 (dozen|two-dozens)\b/.test(family) ? 'Outside bets' : 'Inside bets';
  return 'Shapes (widen, stack, mix)';
}

function curveTables(): Table[] {
  return [
    {
      caption: `Share of sessions that never lost the ladder, for all ${data.curve.length} ladders (x = session length ÷ ladder cost)`,
      head: ['Ladder', 'Group', 'x', 'Never capped', 'e^(−x)', 'k'],
      rows: data.curve.map((c) => [
        c.id,
        curveGroupLabel(c.family),
        c.x.toFixed(2),
        pct1(c.neverCapped),
        pct1(Math.exp(-c.x)),
        c.k.toFixed(2),
      ]),
    },
  ];
}

/** Chapter 6 (ChShapes): the three survivors on four seeds. */
const SEED_KEYS = (rowId: string): string[] => [
  `e6-full:${rowId}@20261031`,
  `e6-full:${rowId}@1`,
  `e6-full:${rowId}@2`,
  `e8-seed3:${rowId}@3`,
];

function shapesTables(): Table[] {
  const main = SURVIVORS.map((s) => ({ s, stats: SEED_KEYS(s.rowId).map(row) }));
  return [
    {
      caption: `The three ladders on four seeds: value on seed 20261031, then the lowest to highest (${setupOf(main[0]!.stats[0]!)})`,
      head: [
        'Ladder',
        'Typical session',
        'Chance of ending ahead',
        'Average',
        'Worst 5 % of sessions',
        'Lost the ladder',
      ],
      rows: main.map(({ s, stats }) => [
        s.label,
        seedRange(stats, (r) => r.median, money),
        seedRange(stats, (r) => r.pWin, pct1),
        seedRange(stats, (r) => r.mean, money),
        seedRange(stats, (r) => r.cvar5, money),
        seedRange(stats, (r) => r.capRate, pct1),
      ]),
    },
    {
      caption: 'What each ladder puts on the table',
      head: ['Ladder', 'Levels', 'First stake per bet', 'Top stake per bet', 'Whole ladder costs'],
      rows: SURVIVORS.map((s) => [
        s.label,
        String(s.amounts.length),
        dollars(s.amounts[0]!),
        dollars(s.amounts.at(-1)!),
        dollars(capLoss(s)),
      ]),
    },
  ];
}

/** Chapter 7 (ChCashout). */
const TARGETS = [5, 10, 20, 50, 100] as const;
const C9 = (id: string): string => `e7-c9:e7-c9-${id}`;

function cashoutTables(): Table[] {
  const q = row(C9('W20')).meta?.q;
  return [
    {
      caption: 'c9: chance of ending ahead by cash-out target (cycle wins)',
      head: ['Target', 'Measured', 'Predicted (1 − q)^W', 'Typical session', 'Average'],
      rows: TARGETS.map((w) => {
        const r = row(C9(`W${w}`));
        return [
          `${w} wins`,
          pct1(r.pWin),
          typeof q === 'number' ? pct1((1 - q) ** w) : '-',
          money(r.median),
          money(r.mean),
        ];
      }),
    },
    {
      caption: 'Worst 5 % of sessions with and without the stops',
      head: ['Version', 'Chance of ending ahead', 'Worst 5 % of sessions', 'Average'],
      rows: (
        [
          ['c9, no cash-out', C9('nostop')],
          ['c9, cash out at 20 wins', C9('W20')],
          ['c9, 20 wins + stop-loss', C9('W20-SLhalf')],
          ['Martingale, 8 levels, cash out at 20 wins', 'e7-mart:e7m-stop-W20'],
          ['Martingale, 7 levels + stop', 'e7b-mart-L7stop:e7b-L7stop-W20'],
        ] as const
      ).map(([label, key]) => {
        const r = row(key);
        return [label, pct1(r.pWin), money(r.cvar5), money(r.mean)];
      }),
    },
  ];
}

/** Chapter 8 (ChLimits.STRATEGIES, COLUMNS, CASHOUT_ROWS). */
export const LIMIT_STRATEGIES = [
  { id: 'flat-red', label: 'Flat $25 on red' },
  { id: 'b3-two-streets-l29', label: 'b3: two streets, stacked' },
  { id: 'c9-streets-to12-stack', label: 'c9: streets to 12, stacked' },
  { id: 'a1-streets-w27', label: 'a1: streets, widening' },
] as const;
export const LIMIT_COLUMNS: readonly { label: string; key: (s: string) => string }[] = [
  { label: 'European, 500 spins', key: (s) => `e6-full:${s}@20261031` },
  { label: 'American wheel', key: (s) => `e8-american:e8-am-${s}` },
  { label: '250 spins', key: (s) => `e8-length:e8-S250-${s}` },
  { label: '1,000 spins', key: (s) => `e8-length:e8-S1000-${s}` },
  { label: '$10,000 bankroll', key: (s) => `e8-br10k:e8-br10k-${s}` },
];
export const LIMIT_CASHOUT_ROWS: readonly [string, string][] = [
  ['c9 + cash-out, European, 500 spins', 'e7-c9:e7-c9-W20-SLhalf'],
  ['c9 + cash-out, American wheel', 'x1-c9-cashout-axes:x1-c9-am'],
  ['c9 + cash-out, 250 spins', 'x1-c9-cashout-axes:x1-c9-S250'],
  ['c9 + cash-out, 1,000 spins', 'x1-c9-cashout-axes:x1-c9-S1000'],
  ['c9 + cash-out, American wheel, 1,000 spins', 'x1-c9-cashout-axes:x1-c9-am-S1000'],
  ['a1 + $226 cash-out, full ladder', 'x1-a1-trailing:x1-a1-W20-ctrl'],
  ['a1 without its last level + $226 cash-out', 'x1-a1-trailing:x1-a1-L8-W20'],
  ['a1 without its last level, no cash-out', 'x1-a1-trailing:x1-a1-L8-nostop'],
];

function limitsTables(): Table[] {
  return [
    {
      caption: 'Typical session / average, by strategy under each change',
      head: ['Strategy', ...LIMIT_COLUMNS.map((c) => c.label)],
      rows: LIMIT_STRATEGIES.map((s) => [
        s.label,
        ...LIMIT_COLUMNS.map((c) => {
          const r = row(c.key(s.id));
          return `${money(r.median)} / ${money(r.mean)}`;
        }),
      ]),
    },
    {
      caption: 'Cash-out versions of c9 and a1 under each change',
      head: ['Strategy', 'Typical session', 'Chance of ending ahead', 'Average', 'Worst 5 %'],
      rows: LIMIT_CASHOUT_ROWS.map(([label, key]) => {
        const r = row(key);
        return [label, money(r.median), pct1(r.pWin), money(r.mean), money(r.cvar5)];
      }),
    },
  ];
}

/** Chapter 9 (TryIt.CANDIDATE_ORDER): the candidates and their rows on four seeds. */
export const CANDIDATE_ORDER = [
  'keeper-c9-streets-to12-cashout',
  'keeper-c9-streets-to12-stack',
  'keeper-b3-two-streets-l29',
];

function tryTables(): Table[] {
  const cands = [...data.candidates].sort(
    (a, b) => CANDIDATE_ORDER.indexOf(a.id) - CANDIDATE_ORDER.indexOf(b.id),
  );
  return [
    {
      caption: 'The three candidates: first seed, then the lowest to highest of four seeds',
      head: ['Candidate', 'Typical session', 'Ends ahead', 'Average', 'Worst 5 %'],
      rows: cands.map((c) => {
        const stats = c.rows.map(row);
        return [
          c.name,
          seedRange(stats, (r) => r.median, money),
          seedRange(stats, (r) => r.pWin, pct1),
          seedRange(stats, (r) => r.mean, money),
          seedRange(stats, (r) => r.cvar5, money),
        ];
      }),
    },
  ];
}

const CHAPTER_TABLES: Record<string, () => Table[]> = {
  start: startTables,
  edge: edgeTables,
  martingale: martingaleTables,
  levels: levelsTables,
  placement: placementTables,
  curve: curveTables,
  shapes: shapesTables,
  cashout: cashoutTables,
  limits: limitsTables,
  try: tryTables,
};

/** Every table a chapter page shows (tests read these). */
export function chapterTables(id: string): Table[] {
  const f = CHAPTER_TABLES[id];
  if (!f) throw new Error(`research: no tables for chapter "${id}"`);
  return id === 'edge' ? [...f(), edgeTable(), wheelSimTable()] : f();
}

// ---------------------------------------------------------------- search-facing titles

interface ChapterSeo {
  /** <title> without the " | spinner" suffix. */
  title: string;
  h1: string;
  /** Used when the chapter lead is not 120-160 characters. */
  description?: () => string;
  /** A first paragraph that answers the query, built from the data. */
  answer?: () => string;
}

const CHAPTER_SEO: Record<string, ChapterSeo> = {
  start: {
    title: 'Roulette Strategy Research: Start Here',
    h1: 'Roulette strategy research: start here',
  },
  edge: {
    title: 'Roulette House Edge: European vs American',
    h1: 'Roulette house edge, European vs American: every dollar costs the same',
    description: () => {
      const red = EDGE_BETS.find((b) => b.id.european === 'red')!;
      return `Roulette house edge: ${edgePct(exactEdge(red, 'european'))} on every European bet, ${edgePct(exactEdge(red, 'american'))} on American. Spreading chips changes the swings, never the cost. Exact table and simulations.`;
    },
    answer: edgeAnswer,
  },
  martingale: {
    title: 'Does the Martingale Work in Roulette?',
    h1: 'Does the Martingale work in roulette? Why doubling feels like it works',
    description: () =>
      'Does the Martingale work in roulette? Doubling keeps the typical session ahead for a few hundred spins, then one losing streak empties the ladder. Simulated.',
    answer: () => {
      const r = row('observations:martingale-red');
      return `No: doubling after each loss does not beat the house edge, it only delays the loss. In ${spins(r.sessions)} simulated sessions of Martingale on red from ${dollars(r.bankroll)}, the typical session stayed ahead until spin ${spins(r.medianAheadUntil ?? 0)} and then fell; after ${spins(r.maxRounds)} spins the average result was ${money(r.mean)}, the typical session ${money(r.median)}, and ${pct1(r.pBust)} of sessions had gone broke.`;
    },
  },
  levels: {
    title: 'Martingale Levels vs Bankroll: Levels, Not Luck',
    h1: 'Martingale levels vs bankroll: levels, not luck',
  },
  placement: {
    title: 'Martingale on Dozens: Grow at the Right Rate',
    h1: 'Beyond red: grow at the right rate (Martingale on dozens and inside bets)',
    description: () =>
      'Off even money, doubling is the wrong raise for a roulette progression: multiply by 36 ÷ (36 − numbers covered) instead. Dozens, six-lines, corners, simulated.',
  },
  curve: {
    title: 'One Curve Rules Them All: Ladder Survival',
    h1: 'One curve rules them all: how long a roulette ladder survives',
  },
  shapes: {
    title: 'Roulette Towers, Shapes and Favourite Numbers',
    h1: 'Towers, shapes and favourite numbers',
    description: () =>
      'Stacking chips on a few streets, widening across the board, or both: three roulette ladders that passed every test, with their typical and worst sessions.',
  },
  cashout: {
    title: 'Roulette Win Goal and Stop-Loss: When to Cash Out',
    h1: 'Cash out: the stop that moves the typical session',
    description: () =>
      'A roulette win goal (cash-out) makes the typical session equal the target; a stop-loss at half the ladder caps the damage. How often each target is reached.',
  },
  limits: {
    title: 'What Breaks a Roulette Ladder: Wheel, Length, Limits',
    h1: 'What breaks it: American wheel, long sessions and table minimums',
    description: () =>
      'Other seeds, a bigger bankroll and la partage change little; long sessions, $25 table minimums and the double-zero wheel break roulette ladders. Simulated.',
  },
  try: {
    title: 'Try a Roulette Ladder: Candidates and Calculator',
    h1: 'Try it: three candidate ladders and a calculator',
    description: () =>
      'Pick one of three tested roulette ladders, play it with play money from $5,000 for 500 spins, and judge it by the typical session, average and worst 5 %.',
  },
};

// ---------------------------------------------------------------- related links (from the data)

export interface StrategyRef {
  slug: string;
  title: string;
}

/** Gallery strategies a chapter draws, read from its dataKeys ("<file>:<row id>[@seed]"). */
function strategiesInChapter(c: Chapter, strategies: StrategyRef[]): StrategyRef[] {
  const ids = c.dataKeys.map((k) => (k.split(':')[1] ?? '').split('@')[0]!);
  return strategies.filter((s) =>
    ids.some((id) => id === s.slug || id.startsWith(`${s.slug}-`) || id.endsWith(`-${s.slug}`)),
  );
}

/**
 * Research chapters for a strategy page: the chapters whose data draws that gallery run, in
 * chapter order (at most three); a system no chapter draws gets the edge chapter, which applies
 * to every system.
 */
export function chaptersForStrategy(slug: string, strategies: StrategyRef[]): Chapter[] {
  const found = CHAPTERS.filter((c) =>
    strategiesInChapter(c, strategies).some((s) => s.slug === slug),
  ).slice(0, 3);
  return found.length > 0 ? found : CHAPTERS.filter((c) => c.id === 'edge');
}

// ---------------------------------------------------------------- pages

export const RESEARCH_PATH = `/${APP}/research/`;
export const SOURCES_PATH = `/${APP}/sources/`;
const STRATEGIES_PATH = `/${APP}/strategies/`;
const BASE_CRUMBS: Crumb[] = [
  { name: 'Know the Odds', url: `${ORIGIN}/` },
  { name: 'spinner (Roulette)', url: APP_URL },
];
const RESEARCH_CRUMBS: Crumb[] = [
  ...BASE_CRUMBS,
  { name: 'Research', url: ORIGIN + RESEARCH_PATH },
];

export const chapterUrl = (id: string): string => `${ORIGIN}${RESEARCH_PATH}${id}/`;
const chapterTitle = (c: Chapter): string => CHAPTER_SEO[c.id]?.title ?? c.title;

function chapterDescription(c: Chapter): string {
  const seo = CHAPTER_SEO[c.id];
  if (c.lead.length >= 120 && c.lead.length <= 160 && !seo?.description) return c.lead;
  if (seo?.description) return seo.description();
  throw new Error(`research: chapter "${c.id}" needs a description`);
}

/** "U+2212 minus" and friends render fine; the formulas keep their own characters. */
function mathHtml(c: Chapter): string {
  return `${c.math.text.map((t) => `<p>${esc(t)}</p>`).join('\n')}
<pre class="formulas"><code>${c.math.formulas.map(esc).join('\n')}</code></pre>`;
}

function chapterPage(c: Chapter, i: number, strategies: StrategyRef[]): PageOut {
  const path = `${RESEARCH_PATH}${c.id}/`;
  const url = ORIGIN + path;
  const seo = CHAPTER_SEO[c.id];
  const description = chapterDescription(c);
  const h1 = seo?.h1 ?? c.title;
  const tables = chapterTables(c.id);
  const prev = CHAPTERS[i - 1];
  const next = CHAPTERS[i + 1];
  const answer = seo?.answer?.();
  const cta = `<a class="cta" href="../../#/research?chapter=${encodeURIComponent(c.id)}">Open this chapter in spinner, with the interactive charts</a>`;
  const extraCta =
    c.id === 'try'
      ? '<a class="cta secondary" href="../../#/define">Open Define</a>'
      : '<a class="cta secondary" href="../../#/define">Test your own system</a>';
  const drawn = strategiesInChapter(c, strategies);
  const related: RelatedLink[] = [
    ...drawn.slice(0, 2).map((s) => ({
      href: `${ORIGIN}${STRATEGIES_PATH}${s.slug}/`,
      title: `${s.title}: simulated results`,
    })),
    ...(next ? [{ href: chapterUrl(next.id), title: next.title, note: `Chapter ${i + 1}` }] : []),
    ...(prev ? [{ href: chapterUrl(prev.id), title: prev.title, note: `Chapter ${i - 1}` }] : []),
    ...(drawn.length === 0
      ? [{ href: ORIGIN + STRATEGIES_PATH, title: 'Roulette betting systems, tested' }]
      : []),
    { href: ORIGIN + SOURCES_PATH, title: 'Sources and references' },
  ];
  const edgeSection =
    c.id === 'edge'
      ? `<h2>European vs American roulette: the house edge of every bet</h2>
<p>Each bet pays a little less than its true odds because of the zero pockets. The edge is one minus the payout times the chance of winning: on a single-zero wheel every bet works out to the same share; the extra zero of the American wheel raises it, and the five-number top line is worse still.</p>
${tableHtml(tables.at(-2)!)}
<p>La partage (French rules, single zero only): when the ball lands on zero, even-money bets lose only half, so their edge falls to ${edgePct(LA_PARTAGE_EDGE)}. All other bets keep the full edge.</p>
<h2>What the extra zero costs in a session</h2>
${tableHtml(tables.at(-1)!)}`
      : '';
  const chapterTablesHtml = (c.id === 'edge' ? tables.slice(0, -2) : tables)
    .map(tableHtml)
    .join('\n');
  const body = `${answer ? `<p class="verdict">${esc(answer)}</p>\n` : ''}<p class="lead">${esc(c.lead)}</p>
<p class="note">Chapter ${i} of the spinner roulette research (chapters 0 to ${CHAPTERS.length - 1}): ${esc(c.title)}.</p>
${c.body.map((p) => `<p>${esc(p)}</p>`).join('\n')}
<p>${cta}${extraCta}</p>
<h2>The numbers</h2>
${chapterTablesHtml}
<h2>Takeaways</h2>
<ul class="takeaways">${c.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
${edgeSection}
<h2>The math</h2>
${mathHtml(c)}
<p>${cta}</p>
<nav class="pager" aria-label="Chapters">${prev ? `<a href="../${prev.id}/" rel="prev">← ${esc(prev.title)}</a>` : '<span></span>'}<a href="../">All chapters</a>${next ? `<a href="../${next.id}/" rel="next">${esc(next.title)} →</a>` : '<span></span>'}</nav>
${relatedHtml(related)}`;
  const html = renderPage({
    path,
    title: `${chapterTitle(c)} | spinner`,
    description,
    h1,
    body,
    crumbs: [...RESEARCH_CRUMBS, { name: c.title, url }],
    graph: [
      {
        '@type': ['Article', 'LearningResource'],
        '@id': `${url}#article`,
        headline: h1,
        name: c.title,
        description,
        url,
        inLanguage: 'en',
        educationalLevel: 'intermediate',
        learningResourceType: 'research chapter',
        position: i,
        about: { '@type': 'Thing', name: 'Roulette betting progressions' },
        author: { '@id': PERSON_ID },
        publisher: { '@id': PERSON_ID },
        isPartOf: { '@id': `${ORIGIN}${RESEARCH_PATH}#collection` },
        image: OG_IMAGE,
        isAccessibleForFree: true,
      } satisfies Obj,
    ],
    up: '../../',
  });
  const text = [
    answer ?? '',
    c.lead,
    ...c.body,
    '### The numbers',
    ...(c.id === 'edge' ? tables.slice(0, -2) : tables).map(tableMd),
    '### Takeaways',
    c.takeaways.map((t) => `- ${t}`).join('\n'),
    ...(c.id === 'edge'
      ? [
          '### European vs American roulette: the house edge of every bet',
          tableMd(tables.at(-2)!),
          `La partage (single zero only): even-money bets lose half on a zero, so their edge is ${edgePct(LA_PARTAGE_EDGE)}.`,
          tableMd(tables.at(-1)!),
        ]
      : []),
    '### The math',
    ...c.math.text,
    c.math.formulas.map((f) => `    ${f}`).join('\n'),
    `Open in spinner: ${APP_URL}#/research?chapter=${c.id}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    file: `research/${c.id}/index.html`,
    path,
    html,
    title: chapterTitle(c),
    description,
    text,
  };
}

/** Headline rows of the research index: the baseline, two classic systems and the survivors. */
function headlineTable(): Table {
  const items: [string, string][] = [
    ['Flat $25 on red', 'observations:flat-red'],
    ['Martingale on red', 'observations:martingale-red'],
    ['Fibonacci on red', 'observations:fibonacci-red'],
    ...SURVIVORS.map((s) => [s.label, `e6-full:${s.rowId}@20261031`] as [string, string]),
    ['c9 with a cash-out and stop-loss', 'e7-c9:e7-c9-W20-SLhalf'],
  ];
  const r0 = row(items[0]![1]);
  return {
    caption: `Headline results (${setupOf(r0)}, European wheel)`,
    head: [
      'Strategy',
      'Typical session',
      'Chance of ending ahead',
      'Average',
      'Worst 5 % of sessions',
      'Ended broke',
    ],
    rows: items.map(([label, key]) => {
      const r = row(key);
      return [label, money(r.median), pct1(r.pWin), money(r.mean), money(r.cvar5), pct1(r.pBust)];
    }),
  };
}

function researchIndex(chapters: PageOut[]): PageOut {
  const path = RESEARCH_PATH;
  const url = ORIGIN + path;
  const head = headlineTable();
  const means = head.rows.map((r) => r[3]!);
  const allNegative = Object.values(data.rows).every((r) => r.mean < 0);
  const n = Object.keys(data.rows).length;
  const description =
    'Roulette strategy research: what betting progressions can do for the typical session, what they cannot do for the average, simulated in ten chapters.';
  const answer = `Can a roulette betting system beat the house? No. ${allNegative ? `Every one of the ${spins(n)} simulated setups in this research has a negative average result: the` : 'The'} edge is a fixed cost on every dollar wagered, and no progression changes it. What a progression can change is the shape of the results: a ladder with a cash-out can make the typical session a small win (${head.rows.at(-1)![1]} here, ending ahead ${head.rows.at(-1)![2]} of the time) while the average stays negative (${means.at(-1)}) and the worst sessions get worse.`;
  const cards = CHAPTERS.map(
    (c, i) =>
      `<li><p class="eyebrow">Chapter ${i}</p><h3><a href="${c.id}/">${esc(c.title)}</a></h3><p>${esc(c.lead)}</p></li>`,
  ).join('\n');
  const body = `<p class="verdict">${esc(answer)}</p>
<p class="lead">What the simulations found about betting progressions: what they can do for a typical session, what they cannot do for the average, and how to try the ideas yourself.</p>
<p>The research is a set of seeded Monte Carlo experiments run with spinner’s own engine: ${esc(setupOf(row('observations:flat-red')))} on a European wheel unless a chapter says otherwise, each finding checked against a closed-form prediction. In the app every chapter has an interactive chart; here each chart is a table of the values it plots.</p>
<p><a class="cta" href="../#/research">Read the research in spinner</a><a class="cta secondary" href="../#/define">Test your own system</a></p>
<h2>Headline findings</h2>
${tableHtml(head)}
<p>“Typical session” is the median net result, “average” the mean, and “worst 5 %” the mean of the worst 5 % of sessions.</p>
<h2>The chapters</h2>
<ul class="cards">
${cards}
</ul>
${relatedHtml([
  { href: ORIGIN + STRATEGIES_PATH, title: 'Roulette betting systems, tested by simulation' },
  { href: chapterUrl('martingale'), title: 'Does the Martingale work in roulette?' },
  { href: chapterUrl('edge'), title: 'Roulette house edge, European vs American' },
  { href: ORIGIN + SOURCES_PATH, title: 'Sources and references' },
])}`;
  const html = renderPage({
    path,
    title: 'Roulette Strategy Research: What Progressions Do | spinner',
    description,
    h1: 'Roulette strategy research: what betting progressions can and cannot do',
    body,
    crumbs: RESEARCH_CRUMBS,
    graph: [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#collection`,
        name: 'Roulette strategy research',
        description,
        url,
        inLanguage: 'en',
        author: { '@id': PERSON_ID },
        isPartOf: { '@id': WEBSITE_ID },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: chapters.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: CHAPTERS[i]!.title,
            url: ORIGIN + p.path,
          })),
        },
      },
    ],
    up: '../',
  });
  const text = [
    answer,
    'What the simulations found about betting progressions: what they can do for a typical session, what they cannot do for the average, and how to try the ideas yourself.',
    tableMd(head),
    CHAPTERS.map((c, i) => `- Chapter ${i}, [${c.title}](${chapterUrl(c.id)}): ${c.lead}`).join(
      '\n',
    ),
  ].join('\n\n');
  return {
    file: 'research/index.html',
    path,
    html,
    title: 'Roulette strategy research',
    description,
    text,
  };
}

function sourcesPage(): PageOut {
  const path = SOURCES_PATH;
  const url = ORIGIN + path;
  const count = SOURCE_GROUPS.reduce((s, g) => s + g.items.length, 0);
  const description = `Where spinner’s roulette rules, betting systems, statistics and random number generator come from: ${count} references, each with what the app used it for.`;
  const intro =
    'Every figure in this app is computed by the app itself, in exact arithmetic or by exhaustive enumeration or simulation, and cross-checked against the published references below. The rules and strategies are the standard ones; these are the places they are documented.';
  const groups = SOURCE_GROUPS.map(
    (g) =>
      `<h2>${esc(g.group)}</h2>\n<ul class="sources">${g.items
        .map(
          (i) =>
            `<li id="${esc(i.id)}"><strong>${i.url ? `<a href="${esc(i.url)}" rel="noopener">${esc(i.title)}</a>` : esc(i.title)}</strong>${i.author ? `, ${esc(i.author)}` : ''}<br>${esc(i.note)}</li>`,
        )
        .join('')}</ul>`,
  ).join('\n');
  const body = `<p class="lead">${esc(intro)}</p>
<p>The research chapters (<a href="../research/">roulette strategy research</a>) and the <a href="../strategies/">strategy results</a> are produced the same way: seeded simulations of spinner’s own engine, with the analysis code the app ships.</p>
<p><a class="cta" href="../#/sources">Open Sources in spinner</a></p>
${groups}
<p>Source code: <a href="https://github.com/creynia/spinner" rel="noopener">github.com/creynia/spinner</a> (MIT license).</p>
${relatedHtml([
  { href: ORIGIN + RESEARCH_PATH, title: 'Roulette strategy research' },
  { href: ORIGIN + STRATEGIES_PATH, title: 'Roulette betting systems, tested by simulation' },
  { href: chapterUrl('edge'), title: 'Roulette house edge, European vs American' },
])}`;
  const html = renderPage({
    path,
    title: 'Sources: Roulette Rules, Systems and Statistics | spinner',
    description,
    h1: 'Sources: where the rules, figures and strategies come from',
    body,
    crumbs: [...BASE_CRUMBS, { name: 'Sources', url }],
    graph: [
      {
        '@type': 'WebPage',
        '@id': `${url}#page`,
        name: 'Sources',
        description,
        url,
        inLanguage: 'en',
        author: { '@id': PERSON_ID },
        isPartOf: { '@id': WEBSITE_ID },
        citation: SOURCE_GROUPS.flatMap((g) =>
          g.items.map((i) => ({
            '@type': 'CreativeWork',
            name: i.title,
            ...(i.author ? { author: i.author } : {}),
            ...(i.url ? { url: i.url } : {}),
          })),
        ),
      },
    ],
    up: '../',
  });
  const text = [
    intro,
    ...SOURCE_GROUPS.map(
      (g) =>
        `### ${g.group}\n\n${g.items
          .map(
            (i) =>
              `- ${i.url ? `[${i.title}](${i.url})` : i.title}${i.author ? `, ${i.author}` : ''}: ${i.note}`,
          )
          .join('\n')}`,
    ),
  ].join('\n\n');
  return { file: 'sources/index.html', path, html, title: 'Sources', description, text };
}

export interface ResearchSite {
  index: PageOut;
  chapters: PageOut[];
  sources: PageOut;
}

export function buildResearchSite(strategies: StrategyRef[]): ResearchSite {
  const chapters = CHAPTERS.map((c, i) => chapterPage(c, i, strategies));
  return { index: researchIndex(chapters), chapters, sources: sourcesPage() };
}
