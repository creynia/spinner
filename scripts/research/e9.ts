// E9, slow-recovery ladders (docs/research/plan.md §7.18, briefs/E9.md): the ladder catalogue,
// the predictions from slowLadder.ts, and the spec files. Pure node, no aliases:
//   node scripts/research/e9.ts                 predictions as markdown (cycle chain + session DP)
//   node scripts/research/e9.ts --json <path>   the same predictions as JSON
//   node scripts/research/e9.ts --specs         write scripts/research/specs/x-e9-*.json
// Money is integer cents. European wheel, $5,000 bankroll, 500 spins, seed 20261031.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DOZEN,
  RED,
  cycleStats,
  dalembertStakes,
  fibonacciStakes,
  fit,
  geometricStakes,
  labouchereMc,
  noCapExact,
  predict,
  sessionDp,
  singleBet,
  type CycleStats,
  type LabouchereInput,
  type LevelLadder,
  type Prediction,
  type SessionResult,
} from './slowLadder.ts';

export const BANKROLL = 500_000;
export const SPINS = 500;
const SEED = 20261031;

type OnCap = 'reset' | 'stop';
type Json = unknown;

export interface E9Ladder {
  id: string;
  /** Spec file (without .json) the experiments go to. */
  spec: string;
  family: string;
  /** Base stake, cents. */
  unit: number;
  growth: string;
  back: string;
  /** Level ladder for the DPs; Labouchere carries `lab` instead. */
  lad?: LevelLadder;
  lab?: LabouchereInput;
  /** Smallest bet the table takes (reduced bets below it bust), cents. */
  tableMin: number;
  rules: Json;
  strategy: (onCap: OnCap) => Json;
  /** Which onCap variants run; the stop twin of a reset row gets the suffix `-stop`. */
  variants: OnCap[];
  session?: { stopWin?: number; stopLoss?: number };
  /** Recovers within the cycle (false: the `onWin: reset` controls with r < 2). */
  recovers: boolean;
}

const european = (outsideMin?: number, insideMinTotal?: number): Json =>
  outsideMin === undefined
    ? 'european'
    : {
        preset: 'european',
        overrides: {
          limits: {
            outside: { min: outsideMin },
            ...(insideMinTotal !== undefined ? { inside: { minTotal: insideMinTotal } } : {}),
          },
        },
      };

const doc = (
  id: string,
  name: string,
  unit: number,
  prog: Json,
  layout: Json,
  rules: Json[] = [],
) => ({
  schema: 1,
  id: id.toLowerCase(),
  name,
  game: 'roulette',
  unit,
  progressions: { q: prog },
  stages: [{ id: 'play', layout, rules }],
});

const onRed = [{ bet: 'red', amount: { prog: 'q' } }];
const onDozen = [{ bet: 'dozen:1', amount: { prog: 'q' } }];
const STREETS = ['street:1-2-3', 'street:4-5-6', 'street:7-8-9', 'street:10-11-12'];
const c9Layout = STREETS.map((bet, i) =>
  i === 0
    ? { bet, amount: { prog: 'q' } }
    : { bet, amount: { prog: 'q' }, when: { cmp: [{ progStep: 'q' }, '>=', i] } },
);
/** Extra steps back after a won round (sequence `onWin: 'back'` already steps one). */
const backRules = (back: number): Json[] =>
  back > 1
    ? [
        {
          when: { event: 'bet-won' },
          then: Array.from({ length: back - 1 }, () => ({ prog: 'q', do: 'back' })),
        },
      ]
    : [];

const usd = (c: number): string => `$${(c / 100).toLocaleString('en-US')}`;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** The c9 widening layout (one street, then up to four) at per-street amounts `a`. */
function c9Ladder(a: number[], back: number): LevelLadder {
  return {
    back,
    levels: a.map((x, k) => {
      const n = Math.min(k + 1, 4);
      return { stake: n * x, p: (3 * n) / 37, win: 12 * x - n * x };
    }),
  };
}
function fitC9(a: number[]): number[] {
  const out: number[] = [];
  let s = 0;
  for (let k = 0; k < a.length; k++) {
    const st = Math.min(k + 1, 4) * a[k]!;
    if (s + st > BANKROLL) break;
    out.push(a[k]!);
    s += st;
  }
  return out;
}

export const C9_AMOUNTS = [
  100, 200, 200, 300, 500, 700, 1100, 1600, 2400, 3600, 5400, 8100, 12200, 18300, 27400, 41100,
];
const DOZEN_G15_U5 = [
  500, 800, 1200, 1800, 2700, 4000, 6000, 9000, 13500, 20300, 30400, 45600, 68400, 102600, 153900,
];

function martingale(id: string, unit: number, L: number, variants: OnCap[]): E9Ladder {
  const st = geometricStakes(unit, 2, L);
  return {
    id,
    spec: 'x-e9-controls',
    family: 'one-win control',
    unit,
    growth: '×2',
    back: 'reset',
    lad: singleBet(st, Infinity),
    tableMin: unit,
    rules: european(unit === 2500 ? undefined : unit),
    strategy: (onCap) =>
      doc(
        id,
        `Martingale red ${usd(unit)} L${L}`,
        unit,
        {
          kind: 'martingale',
          track: 'red',
          maxSteps: L,
          onCap,
        },
        onRed,
      ),
    variants,
    recovers: true,
  };
}

function fibonacci(unit: number, back: number): E9Ladder {
  const st = fit(fibonacciStakes(unit, 40), BANKROLL);
  const id = `e9-fib-u${unit / 100}-b${back}`;
  return {
    id,
    spec: 'x-e9-fib',
    family: '(a) Fibonacci',
    unit,
    growth: 'Fib',
    back: String(back),
    lad: singleBet(st, back),
    tableMin: unit,
    rules: european(unit === 2500 ? undefined : unit),
    strategy: (onCap) =>
      doc(
        id,
        `Fibonacci red ${usd(unit)} back ${back}, ${st.length} levels`,
        unit,
        {
          kind: 'fibonacci',
          track: 'red',
          maxSteps: st.length,
          back,
          onCap,
        },
        onRed,
      ),
    variants: ['reset', 'stop'],
    recovers: true,
  };
}

function geometric(r: number, onWin: 'back' | 'reset'): E9Ladder {
  const st = fit(geometricStakes(500, r, 64), BANKROLL);
  const id = `e9-geo-r${r.toFixed(1).replace('.', '')}-${onWin}`;
  return {
    id,
    spec: onWin === 'back' ? 'x-e9-geo-back' : 'x-e9-geo-reset',
    family: onWin === 'back' ? '(b) geometric, back' : '(b) geometric, reset',
    unit: 500,
    growth: `×${r}`,
    back: onWin === 'back' ? '1' : 'reset',
    lad: singleBet(st, onWin === 'back' ? 1 : Infinity),
    tableMin: 500,
    rules: european(500),
    strategy: (onCap) =>
      doc(
        id,
        `Geometric ×${r} red $5, onWin ${onWin}, ${st.length} levels`,
        500,
        {
          kind: 'sequence',
          track: 'red',
          onWin,
          onLoss: 'advance',
          onCap,
          amounts: st,
        },
        onRed,
      ),
    variants: ['reset', 'stop'],
    recovers: onWin === 'back' || r >= 2,
  };
}

function dalembert(unit: number): E9Ladder {
  const st = fit(dalembertStakes(unit, unit, 1000), BANKROLL);
  const id = `e9-dal-u${unit / 100}`;
  return {
    id,
    spec: 'x-e9-dal-lab',
    family: "(c) d'Alembert",
    unit,
    growth: `+${usd(unit)}`,
    back: '1',
    lad: singleBet(st, 1),
    tableMin: unit,
    rules: european(unit === 2500 ? undefined : unit),
    strategy: (onCap) =>
      doc(
        id,
        `d'Alembert red ${usd(unit)} step ${usd(unit)}, ${st.length} levels`,
        unit,
        {
          kind: 'dalembert',
          track: 'red',
          maxSteps: st.length,
          step: { units: 1 },
          onCap,
        },
        onRed,
      ),
    variants: ['reset', 'stop'],
    recovers: true,
  };
}

function labouchere(line: number[], maxLength: number, maxAmount: number): E9Ladder {
  const id = `e9-lab-${line.join('')}`;
  return {
    id,
    spec: 'x-e9-dal-lab',
    family: '(c) Labouchere',
    unit: 500,
    growth: `line ${line.join(',')}`,
    back: '2 numbers',
    lab: { line, unit: 500, maxLength, maxAmount },
    tableMin: 500,
    rules: european(500),
    strategy: (onCap) =>
      doc(
        id,
        `Labouchere red $5 [${line.join(',')}], maxLength ${maxLength}, max ${usd(maxAmount)}`,
        500,
        {
          kind: 'labouchere',
          track: 'red',
          line,
          maxLength,
          maxAmount,
          onCap,
        },
        onRed,
      ),
    variants: ['reset', 'stop'],
    recovers: true,
  };
}

/** Geometric ladder on dozen 1 that steps `back` levels per win (sequence back + rule backs). */
function dozenSlow(r: number, back: number, note: string): E9Ladder {
  const st = fit(geometricStakes(500, r, 64), BANKROLL);
  const id = `e9-doz-r${String(r).replace('.', '')}-b${back}`;
  return {
    id,
    spec: 'x-e9-transplant',
    family: `(d) dozen, ${note}`,
    unit: 500,
    growth: `×${r}`,
    back: String(back),
    lad: singleBet(st, back, DOZEN, 2),
    tableMin: 500,
    rules: european(500),
    strategy: (onCap) =>
      doc(
        id,
        `Dozen 1 ×${r} $5, ${back} back per win, ${st.length} levels`,
        500,
        {
          kind: 'sequence',
          track: 'dozen:1',
          onWin: 'back',
          onLoss: 'advance',
          onCap,
          amounts: st,
        },
        onDozen,
        backRules(back),
      ),
    variants: ['stop', 'reset'],
    recovers: true,
  };
}

function c9Slow(r: number, back: number, note: string): E9Ladder {
  const a = fitC9(geometricStakes(100, r, 64));
  const id = `e9-c9-r${String(r).replace('.', '')}-b${back}`;
  return {
    id,
    spec: 'x-e9-transplant',
    family: `(d) c9 streets, ${note}`,
    unit: 100,
    growth: `×${r}`,
    back: String(back),
    lad: c9Ladder(a, back),
    tableMin: 100,
    rules: european(100, 100),
    strategy: (onCap) =>
      doc(
        id,
        `c9 streets to 12, ×${r} $1, ${back} back per win, ${a.length} levels`,
        100,
        { kind: 'sequence', track: 'round', onWin: 'back', onLoss: 'advance', onCap, amounts: a },
        c9Layout,
        backRules(back),
      ),
    variants: ['stop', 'reset'],
    recovers: true,
  };
}

const c9OneWin: E9Ladder = {
  id: 'e9-c9-onewin',
  spec: 'x-e9-transplant',
  family: '(d) c9 one-win control',
  unit: 100,
  growth: '×1.5',
  back: 'reset',
  lad: c9Ladder(C9_AMOUNTS, Infinity),
  tableMin: 100,
  rules: european(100, 100),
  strategy: (onCap) =>
    doc(
      'e9-c9-onewin',
      'c9 streets to 12, one-win (the §9 candidate)',
      100,
      {
        kind: 'sequence',
        track: 'round',
        onWin: 'reset',
        onLoss: 'advance',
        onCap,
        amounts: C9_AMOUNTS,
      },
      c9Layout,
    ),
  variants: ['stop'],
  recovers: true,
};

/**
 * Added after the main runs (plan §7.18 addendum, predicted before its own run): one-win dozen
 * ladders s(k+1) = ceil(1.5 s(k)) on the $1 chip at a $1 and $3 base, fitted to $5,000, to place
 * the one-win frontier at the P(win) of the best slow ladders.
 */
function dozenFrontier(u: number): E9Ladder {
  const a = [u];
  while (a.length < 40) a.push(Math.ceil((a[a.length - 1]! * 1.5) / 100) * 100);
  const st = fit(a, BANKROLL);
  const id = `e9-doz-onewin-u${u / 100}`;
  return {
    id,
    spec: 'x-e9-frontier',
    family: 'one-win frontier (dozen)',
    unit: u,
    growth: '×1.5',
    back: 'reset',
    lad: singleBet(st, Infinity, DOZEN, 2),
    tableMin: u,
    rules: european(u),
    strategy: (onCap) =>
      doc(
        id,
        `Dozen 1 ×1.5 ${usd(u)} one-win, ${st.length} levels`,
        u,
        {
          kind: 'sequence',
          track: 'dozen:1',
          onWin: 'reset',
          onLoss: 'advance',
          onCap,
          amounts: st,
        },
        onDozen,
      ),
    variants: ['stop'],
    recovers: true,
  };
}

const dozenOneWin: E9Ladder = {
  id: 'e9-doz-onewin-u5',
  spec: 'x-e9-transplant',
  family: '(d) dozen one-win control',
  unit: 500,
  growth: '×1.5',
  back: 'reset',
  lad: singleBet(DOZEN_G15_U5, Infinity, DOZEN, 2),
  tableMin: 500,
  rules: european(500),
  strategy: (onCap) =>
    doc(
      'e9-doz-onewin-u5',
      'Dozen 1 ×1.5 $5 one-win (E4 dozen-g-u5)',
      500,
      {
        kind: 'sequence',
        track: 'dozen:1',
        onWin: 'reset',
        onLoss: 'advance',
        onCap,
        amounts: DOZEN_G15_U5,
      },
      onDozen,
    ),
  variants: ['stop'],
  recovers: true,
};

/** The cash-out family (e) on the best slow ladder, Fibonacci $5 back 2 (chosen by prediction). */
function cashout(id: string, stopWin: number, stopLoss?: number): E9Ladder {
  const base = fibonacci(500, 2);
  return {
    ...base,
    id,
    spec: 'x-e9-cashout',
    family: '(e) cash-out on fib-u5-b2',
    strategy: (onCap) => ({ ...(base.strategy(onCap) as object), id: id.toLowerCase() }),
    variants: ['stop'],
    session: { stopWin, ...(stopLoss !== undefined ? { stopLoss } : {}) },
  };
}
const FIB5_HALF = sum(fit(fibonacciStakes(500, 40), BANKROLL)) / 2;

const c9Cashout: E9Ladder = {
  ...c9OneWin,
  id: 'e9-c9-cashout-ctrl',
  spec: 'x-e9-cashout',
  family: '(e) c9 cash-out control',
  strategy: (onCap) => ({ ...(c9OneWin.strategy(onCap) as object), id: 'e9-c9-cashout-ctrl' }),
  session: { stopWin: 28000, stopLoss: 245950 },
};

const flatRed: E9Ladder = {
  id: 'e9-flat-red',
  spec: 'x-e9-controls',
  family: 'control',
  unit: 2500,
  growth: 'flat',
  back: '—',
  lad: { levels: [{ stake: 2500, p: RED, win: 2500 }], back: Infinity },
  tableMin: 2500,
  rules: 'european',
  strategy: () => 'preset:flat-red',
  variants: ['reset'],
  recovers: false,
};

const fibPreset: E9Ladder = {
  id: 'e9-fib-preset',
  spec: 'x-e9-controls',
  family: 'control (preset)',
  unit: 2500,
  growth: 'Fib',
  back: '2',
  lad: singleBet(fibonacciStakes(2500, 12), 2),
  tableMin: 2500,
  rules: 'european',
  strategy: (onCap) =>
    doc(
      'e9-fib-preset',
      'Fibonacci red $25 back 2, 12 levels (preset; bankroll binds at level 10)',
      2500,
      {
        kind: 'fibonacci',
        track: 'red',
        maxSteps: 12,
        back: 2,
        onCap,
      },
      onRed,
    ),
  variants: ['reset', 'stop'],
  recovers: true,
};

export const LADDERS: E9Ladder[] = [
  flatRed,
  martingale('e9-mart-u25-L8', 2500, 8, ['reset', 'stop']),
  martingale('e9-mart-u5-L10', 500, 10, ['reset', 'stop']),
  fibPreset,
  martingale('e9-mart-u1-L12', 100, 12, ['stop']),
  martingale('e9-mart-u2-L11', 200, 11, ['stop']),
  martingale('e9-mart-u4-L10', 400, 10, ['stop']),
  martingale('e9-mart-u9-L9', 900, 9, ['stop']),
  ...[500, 2500].flatMap((u) => [1, 2, 3].map((b) => fibonacci(u, b))),
  ...[1.2, 1.4, 1.6, 1.8, 2.0].map((r) => geometric(r, 'back')),
  ...[1.2, 1.4, 1.6, 1.8, 2.0].map((r) => geometric(r, 'reset')),
  dalembert(500),
  dalembert(2500),
  labouchere([1], 16, 100_000),
  labouchere([1, 2, 3], 16, 100_000),
  dozenSlow(1.36, 4, 'Fib-b2 analogue (2r⁴ = r³+r²+r+1)'),
  dozenSlow(1.36, 5, 'Fib-b3 analogue (one step more)'),
  c9Slow(1.36, 4, 'Fib-b2 analogue'),
  c9Slow(1.36, 5, 'Fib-b3 analogue'),
  dozenOneWin,
  c9OneWin,
  dozenFrontier(100),
  dozenFrontier(300),
  cashout('e9-fib5b2-W10', 5000),
  cashout('e9-fib5b2-W20', 10000),
  cashout('e9-fib5b2-W10-SLhalf', 5000, FIB5_HALF),
  cashout('e9-fib5b2-W20-SLhalf', 10000, FIB5_HALF),
  cashout('e9-fib5b2-W280-SLhalf', 28000, FIB5_HALF),
  c9Cashout,
];

/** Ids that rerun on holdout seeds 1 and 2 (`specs/x-e9-holdout.json`). */
export const HOLDOUT = [
  'e9-fib-u5-b2-stop',
  'e9-fib-u5-b2',
  'e9-fib-u5-b3-stop',
  'e9-fib-u25-b3-stop',
  'e9-doz-r136-b4',
  'e9-c9-r136-b4',
  'e9-mart-u5-L10-stop',
  // added after the first holdout batch: the stop twins of the transplants and the one-win
  // frontier points, whose ids carry no `-stop` suffix (they only run with onCap stop)
  'e9-doz-r136-b4-stop',
  'e9-c9-r136-b4-stop',
  'e9-mart-u2-L11',
  'e9-mart-u4-L10',
  'e9-fib5b2-W20-SLhalf',
  'e9-fib5b2-W280-SLhalf',
  'e9-doz-onewin-u1',
  'e9-doz-onewin-u3',
];

export interface E9Row {
  id: string;
  spec: string;
  family: string;
  onCap: OnCap;
  unit: number;
  growth: string;
  back: string;
  levels: number | null;
  ladderTotal: number | null;
  cycle: CycleStats;
  pred: Prediction;
  /** Exact P(no cap seen) from a fresh ladder, and the first spin it is below 1/2 (-1: never). */
  exact: { pNoCap: number; crossing: number } | null;
  session: Omit<SessionResult, 'path'> | null;
  recovers: boolean;
}

export function experiments(): {
  ladder: E9Ladder;
  id: string;
  onCap: OnCap;
}[] {
  return LADDERS.flatMap((l) =>
    l.variants.map((onCap) => ({
      ladder: l,
      onCap,
      id: onCap === 'stop' && l.variants.includes('reset') ? `${l.id}-stop` : l.id,
    })),
  );
}

export function predictAll(): E9Row[] {
  const cache = new Map<string, { cycle: CycleStats; exact: E9Row['exact'] }>();
  return experiments().map(({ ladder: l, id, onCap }) => {
    let base = cache.get(l.id);
    if (!base) {
      const cycle = l.lad
        ? cycleStats(l.lad)
        : labouchereMc({ ...l.lab!, bankroll: BANKROLL }, 1_000_000);
      base = { cycle, exact: l.lad ? noCapExact(l.lad, SPINS) : null };
      cache.set(l.id, base);
    }
    const session = l.lad
      ? sessionDp(l.lad, {
          bankroll: BANKROLL,
          spins: SPINS,
          onCap,
          tableMin: l.tableMin,
          ...l.session,
        })
      : null;
    const sessionOut = session ? (({ path: _p, ...rest }) => rest)(session) : null;
    return {
      id,
      spec: l.spec,
      family: l.family,
      onCap,
      unit: l.unit,
      growth: l.growth,
      back: l.back,
      levels: l.lad ? l.lad.levels.length : null,
      ladderTotal: l.lad ? sum(l.lad.levels.map((x) => x.stake)) : null,
      cycle: base.cycle,
      pred: predict(base.cycle, SPINS),
      exact: base.exact,
      session: sessionOut,
      recovers: l.recovers,
    };
  });
}

export function specFiles(): Record<string, Json> {
  const out: Record<string, { defaults: Json; experiments: Json[] }> = {};
  const defaults = {
    rules: 'european',
    session: { bankroll: BANKROLL, maxRounds: SPINS },
    run: { sessions: 10000, seed: SEED },
  };
  const holdout: Json[] = [];
  for (const { ladder: l, id, onCap } of experiments()) {
    const e = {
      id,
      rules: l.rules,
      ...(l.session ? { session: l.session } : {}),
      strategy: l.strategy(onCap),
    };
    (out[l.spec] ??= { defaults, experiments: [] }).experiments.push(e);
    if (HOLDOUT.includes(id)) holdout.push(e);
  }
  out['x-e9-holdout'] = { defaults, experiments: holdout };
  return out;
}

const pct = (p: number): string => `${(100 * p).toFixed(1)}`;
const d0 = (c: number | null): string =>
  c === null ? '—' : `${c < 0 ? '−' : ''}$${Math.round(Math.abs(c) / 100).toLocaleString('en-US')}`;

export function markdown(rows: E9Row[]): string {
  const head =
    '| id | onCap | L | ladder | q | E[T] | τ̄ | cap loss | B | x | k | λ | e^(−λ) | exact | n½ | crossing | median cf | DP median | DP P(win) | DP mean | DP CVaR 5 % | DP cap | DP bust | DP ahead until |\n' +
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
  const lines = rows.map((r) => {
    const c = r.cycle;
    const p = r.pred;
    const ok = r.recovers && c.tau > 0;
    const s = r.session;
    return [
      r.id,
      r.onCap,
      r.levels ?? '—',
      r.ladderTotal === null ? '—' : d0(r.ladderTotal),
      c.q.toFixed(5),
      c.ET.toFixed(2),
      `$${(c.tau / 100).toFixed(2)}`,
      d0(c.capLoss),
      ok ? p.B.toFixed(0) : '—',
      ok ? p.x.toFixed(3) : '—',
      ok ? p.k.toFixed(2) : '—',
      p.lambda.toFixed(3),
      p.pNoCap.toFixed(3),
      r.exact ? r.exact.pNoCap.toFixed(3) : '—',
      p.nHalf > 1e5 ? '> 10⁵' : p.nHalf.toFixed(0),
      r.exact ? (r.exact.crossing < 0 ? '> 500' : String(r.exact.crossing)) : '—',
      ok && p.median !== null ? d0(p.median) : 'neg',
      s ? d0(s.median) : '—',
      s ? pct(s.pWin) : '—',
      s ? d0(s.mean) : '—',
      s ? d0(s.cvar5) : '—',
      s ? pct(s.pCap) : '—',
      s ? pct(s.pBust) : '—',
      s ? (s.medianAheadUntil ?? '—') : '—',
    ].join(' | ');
  });
  return [head, ...lines.map((l) => `| ${l} |`)].join('\n');
}

export function main(argv: string[]): void {
  const here = dirname(fileURLToPath(import.meta.url));
  if (argv[0] === '--specs') {
    for (const [name, spec] of Object.entries(specFiles())) {
      const path = join(here, 'specs', `${name}.json`);
      writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
      console.log(`wrote ${path}`);
    }
    return;
  }
  const rows = predictAll();
  if (argv[0] === '--json') {
    writeFileSync(argv[1] ?? 'e9-predictions.json', `${JSON.stringify(rows, null, 1)}\n`);
    return;
  }
  console.log(markdown(rows));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
