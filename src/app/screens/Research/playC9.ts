// Chapter 10, "Play c9 at the table": the c9 cash-out candidate written out level by level. Every
// amount is read from the candidate's strategy document in data.json (the same document Open in
// Define loads); the totals, the running loss, the net of a hit, where the loss limit trips and the
// cycle-model predictions are derived here, never typed by hand. Pure, so the static research
// pages (build/static-research.ts) print the same table.
import { candidate } from './data';
import { ladderFromStrategy, type SurvivorLadder } from './survivors';

/** The candidate this chapter plays, and its ledger rows (plan.md §9). */
export const C9_CANDIDATE = 'keeper-c9-streets-to12-cashout';
export const C9_ROW = 'e7-c9:e7-c9-W20-SLhalf';
/** Reporting seed, holdouts 1 and 2, seed 3. */
export const C9_SEED_ROWS: readonly string[] = [
  C9_ROW,
  'e7-c9-holdout:e7-c9-W20-SLhalf@1',
  'e7-c9-holdout:e7-c9-W20-SLhalf@2',
  'e7-c9-seed3:e7-c9-W20-SLhalf@3',
];
export const C9_AMERICAN_ROW = 'x1-c9-cashout-axes:x1-c9-am';
/** The reference ladders run on the default $25-minimum table (chapter 8). */
export const DEFAULT_TABLE_ROWS: readonly string[] = [
  'e6-widen-screen:a9-dozen-streets-default',
  'e6-stack-screen:b11-red-default-l7',
  'e6-hybrid-screen:c6-dozen-to-two-dozens-default',
];

/** Single-zero wheel: 37 pockets; a street covers 3 numbers and pays 11 to 1. */
const POCKETS = 37;
const STREET_PAYS = 11;

export interface PlayLevel {
  /** 0 = first bet of a run; one more for each miss in a row */
  level: number;
  /** the streets on the table, each as its three numbers */
  streets: number[][];
  /** cents on each street */
  perStreet: number;
  /** cents on the table this spin */
  onTable: number;
  /** cents lost since the last hit when this level is reached (D(k)) */
  carried: number;
  /** cents down since the last hit if this level misses too (D(k + 1)) */
  downIfMiss: number;
  /** cents up since the last hit if this level hits */
  hitNets: number;
  /** chance this spin hits (covered numbers / 37) */
  pHit: number;
  /** chance a run gets this far (every level before it missed) */
  pReach: number;
}

export interface PlayPlan {
  ladder: SurvivorLadder;
  levels: PlayLevel[];
  /** chip size, cents */
  chip: number;
  /** stop-win: leave when the session is up this much (cents) */
  target: number;
  /** stop-loss: leave when the session is down this much or more (cents, positive) */
  lossLimit: number;
  /** what the whole ladder costs if every level misses (cents) */
  capLoss: number;
  /** the miss after which the loss limit trips, from any point of a session */
  tripLevel: number;
  /** cents down when the limit trips: from a run started at +$0 and at the target less one chip */
  stopLoss: { most: number; least: number };
  /** the biggest single bet a session places (cents, per street, at tripLevel) */
  maxBet: number;
  /** the smallest net of a hit (cents) */
  minHit: number;
  /** chance a run misses every level up to tripLevel: the loss limit trips */
  qStop: number;
  /** average net of a run that ends in a hit (cents) */
  avgHit: number;
  /** hits needed to reach the target at avgHit each */
  runsNeeded: number;
  /** cycle model: (1 - qStop)^runsNeeded */
  pWinPredicted: number;
  /** average spins of a run (a hit, or the loss limit) */
  spinsPerRun: number;
  /** runsNeeded x spinsPerRun */
  spinsPredicted: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `net` threshold of the stage rule that ends the session with `stop` (cash-out, loss-limit). */
function stopAt(s: unknown, stop: string): number {
  const stages = isObj(s) && Array.isArray(s.stages) ? s.stages : [];
  for (const stage of stages) {
    const rules = isObj(stage) && Array.isArray(stage.rules) ? stage.rules : [];
    for (const r of rules) {
      if (!isObj(r) || !Array.isArray(r.then) || !isObj(r.when)) continue;
      if (!r.then.some((t) => isObj(t) && t.stop === stop)) continue;
      const cmp = r.when.cmp;
      if (Array.isArray(cmp) && cmp[0] === 'net' && typeof cmp[2] === 'number') return cmp[2];
    }
  }
  throw new Error(`playC9: no "${stop}" rule on net`);
}

/** Derives the level table and the session numbers from a strategy document of the c9 shape. */
export function playPlan(strategy: unknown): PlayPlan {
  const { amounts, bets } = ladderFromStrategy(strategy);
  const chip = isObj(strategy) && typeof strategy.unit === 'number' ? strategy.unit : 100;
  const target = stopAt(strategy, 'cash-out');
  const lossLimit = -stopAt(strategy, 'loss-limit');
  const ladder: SurvivorLadder = {
    id: 'c9',
    label: 'c9 with cash-out',
    rowId: C9_ROW,
    amounts,
    bets,
  };

  const levels: PlayLevel[] = [];
  let carried = 0;
  let pReach = 1;
  amounts.forEach((perStreet, level) => {
    const streets = bets.filter((b) => b.fromLevel <= level).map((b) => b.numbers);
    const onTable = perStreet * streets.length;
    const covered = streets.reduce((n, s) => n + s.length, 0);
    const pHit = covered / POCKETS;
    levels.push({
      level,
      streets,
      perStreet,
      onTable,
      carried,
      downIfMiss: carried + onTable,
      hitNets: (STREET_PAYS + 1) * perStreet - onTable - carried,
      pHit,
      pReach,
    });
    carried += onTable;
    pReach *= 1 - pHit;
  });

  // A run starts at a session net between 0 (every finished run nets a profit) and the target less
  // one chip (at the target the session is over). The limit trips on the first miss that leaves
  // even the best start at -lossLimit or below.
  const best = target - chip;
  const tripLevel = levels.findIndex((l) => best - l.downIfMiss <= -lossLimit);
  if (tripLevel < 0) throw new Error('playC9: the loss limit never trips');
  if (tripLevel > 0 && -levels[tripLevel - 1]!.downIfMiss <= -lossLimit)
    throw new Error('playC9: the loss limit can trip at more than one level');
  const played = levels.slice(0, tripLevel + 1);
  const trip = levels[tripLevel]!;
  const qStop = trip.pReach * (1 - trip.pHit);
  const avgHit = played.reduce((s, l) => s + l.pReach * l.pHit * l.hitNets, 0) / (1 - qStop);
  const runsNeeded = target / avgHit;
  const spinsPerRun = played.reduce((s, l) => s + l.pReach, 0);

  return {
    ladder,
    levels,
    chip,
    target,
    lossLimit,
    capLoss: carried,
    tripLevel,
    stopLoss: { most: trip.downIfMiss, least: trip.downIfMiss - best },
    maxBet: trip.perStreet,
    minHit: Math.min(...levels.map((l) => l.hitNets)),
    qStop,
    avgHit,
    runsNeeded,
    pWinPredicted: (1 - qStop) ** runsNeeded,
    spinsPerRun,
    spinsPredicted: runsNeeded * spinsPerRun,
  };
}

export const PLAY_C9: PlayPlan = playPlan(candidate(C9_CANDIDATE).strategy);

/** "1 (1-3)", "4 (1-12)": how many streets and the numbers they cover, when they run on. */
export function streetsLabel(l: PlayLevel): string {
  const nums = l.streets.flat();
  return `${l.streets.length} (${Math.min(...nums)}–${Math.max(...nums)})`;
}

/** Column heads of the level table (the chapter, the print card, the static page). */
export const LEVEL_HEAD = [
  'Level',
  'Streets',
  'Chips per street',
  'On the table',
  'Down if it misses',
  'A hit nets',
] as const;

/** The level table as text cells, formatted by the caller (signed and unsigned money). */
export function levelRows(
  plan: PlayPlan,
  fmt: { money: (c: number) => string; dollars: (c: number) => string },
): string[][] {
  return plan.levels.map((l) => [
    String(l.level),
    streetsLabel(l),
    String(l.perStreet / plan.chip),
    fmt.dollars(l.onTable),
    fmt.money(-l.downIfMiss),
    fmt.money(l.hitNets),
  ]);
}
