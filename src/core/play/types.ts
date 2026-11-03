/**
 * Play mode: one hand-played session at a real table with a bankroll (the "practice table" of the
 * sibling apps). Game-agnostic: the game arrives as a `GamePlugin` through `PlayEnv`. The session
 * is a plain JSON value (persisted by the app); every operation is a pure function that returns a
 * new session or a refusal, so the UI can keep it in state, undo it and save it as-is.
 */
import type { BetId, Cents, GamePlugin, Rng, RoundOutcome } from '../contracts/game';

/** One bet on the felt in play mode: the whole stake on that bet id. */
export interface PlayBet {
  bet: BetId;
  amount: Cents;
}

/** How spins are drawn. */
export type PlayRngSpec =
  /** crypto.getRandomValues for every draw, unbiased by rejection (the default). */
  | { kind: 'crypto' }
  /** xoshiro128** from a uint32 seed: the session can be replayed exactly. */
  | { kind: 'seeded'; seed: number };

/** One resolved spin, as kept in the session log. */
export interface SpinRecord {
  /** 1-based spin number in this session. */
  n: number;
  /** What was staked this spin (placement order). */
  bets: PlayBet[];
  wagered: Cents;
  /** Net cash effect of the spin (equity change). */
  net: Cents;
  /** Equity (cash + carried stakes such as imprisoned bets) after the spin. */
  equity: Cents;
  /** Expected loss of the bets staked, in (fractional) cents, from the plugin's ev. */
  expectedLoss: number;
  /** Plugin summary of the outcome (roulette: pocket, label, color, ...). */
  summary: RoundOutcome['summary'];
  resolutions: RoundOutcome['resolutions'];
  events: { type: string; bet?: BetId }[];
  /** ISO time. */
  at: string;
}

/** Running totals over every spin of the session (not just the kept log). */
export interface PlayStats {
  spins: number;
  /** Spins that had at least one new stake. */
  betSpins: number;
  wagered: Cents;
  net: Cents;
  /** Sum of expected losses (cents, fractional). */
  expectedLoss: number;
  /** Sum of per-spin variances (cents²), for the luck z-score. */
  variance: number;
  /** Spins with net > 0 / < 0 / = 0 among bet spins. */
  wins: number;
  losses: number;
  pushes: number;
  biggestWin: Cents;
  biggestLoss: Cents;
  /** Highest and lowest level seen (start included); level = start bankroll + session net, so top-ups don't count. */
  peak: Cents;
  trough: Cents;
  /** Largest peak-to-trough drop of the level. */
  maxDrawdown: Cents;
  /** Positive: current run of winning bet spins; negative: of losing ones. */
  streak: number;
  longestWinStreak: number;
  longestLossStreak: number;
}

export interface PlaySession {
  v: 1;
  /** Random id. */
  id: string;
  /** Plugin id. */
  game: string;
  /** Rules preset id the table was opened with. */
  variant: string;
  rng: PlayRngSpec;
  /** Starting bankroll plus every top-up. */
  bankIn: Cents;
  startBankroll: Cents;
  /** Cash in hand: excludes the bets being placed and stakes carried by the engine. */
  bankroll: Cents;
  /** Bets being placed for the next spin (not yet deducted from `bankroll`). */
  bets: PlayBet[];
  /** The bets of the last spin that had any (what Rebet places). */
  lastBets: PlayBet[];
  /** Previous `bets` arrays, newest last, at most PLAY_UNDO_LIMIT. */
  undo: PlayBet[][];
  /** Most recent spins, oldest first, at most PLAY_LOG_LIMIT. */
  log: SpinRecord[];
  /** Level (start bankroll + session net) after every spin, index 0 = start; at most PLAY_CURVE_LIMIT points, thinned. */
  curve: Cents[];
  stats: PlayStats;
  /** Stakes the engine carries between spins (roulette: imprisoned bets); equity = bankroll + carried. */
  carried: Cents;
  /** `plugin.serialize(state)` between spins (carried bets, spin history). */
  engine: unknown;
  /** Seeded mode: the xoshiro128** state words after the last draw. */
  rngState?: number[];
  startedAt: string;
  updatedAt: string;
  /** Set when the player ended the session. */
  endedAt?: string;
}

export const PLAY_UNDO_LIMIT = 200;
export const PLAY_LOG_LIMIT = 500;
export const PLAY_CURVE_LIMIT = 2000;

/** Why an operation was refused; `message` is plain English for a toast or live region. */
export interface PlayRefusal {
  ok: false;
  code:
    | 'unaffordable'
    | 'over-max'
    | 'below-min'
    | 'no-bets'
    | 'nothing-to-rebet'
    | 'nothing-to-undo'
    | 'not-placeable'
    | 'table'
    | 'ended'
    | 'bad-amount';
  message: string;
  /** The bet concerned, when one is. */
  bet?: BetId;
}
export type PlayResult = { ok: true; session: PlaySession } | PlayRefusal;
export type SpinResult = { ok: true; session: PlaySession; spin: SpinRecord } | PlayRefusal;

/** The game the session is played with. */
export interface PlayEnv<S = unknown, R = unknown> {
  plugin: GamePlugin<S, unknown, R, unknown>;
  rules: R;
  /**
   * Rebuild the engine state from `session.engine` with `rng` as its random source (roulette:
   * `{ ...plugin.deserialize(x), rng }`). Absent: `plugin.deserialize` then `state.rng = rng`.
   */
  restore?(snapshot: unknown, rng: Rng): S;
  /** Clock for timestamps (tests). Default: `new Date().toISOString()`. */
  now?(): string;
}

/** Per-spot problem found by `checkBets` before a spin. */
export interface BetProblem {
  bet: BetId;
  code: string;
  message: string;
}
