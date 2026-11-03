// Play mode persistence and small pure helpers: the session in localStorage, the list of finished
// sessions, board <-> bets conversion. Every storage access is in try/catch (private mode, quota).
import type { BetId, Cents } from '@core/contracts/game';
import type { LayoutSpot } from '@core/contracts/layout';
import {
  betsTotal,
  equityOf,
  placeBet,
  removeBet,
  type PlayResult,
  type PlaySession,
} from '@core/play';
import { isVariant, type RouletteEnv } from './env';

export const SESSION_KEY = 'spinner:play:session';
export const HISTORY_KEY = 'spinner:play:history';
export const HISTORY_LIMIT = 20;
/** The bankroll a first visit starts with ($1,000). */
export const DEFAULT_BANKROLL: Cents = 100_000;

/** One finished session in the history list. */
export interface SessionSummary {
  id: string;
  variant: string;
  seed?: number;
  startedAt: string;
  endedAt: string;
  spins: number;
  bankIn: Cents;
  final: Cents;
  net: Cents;
  wagered: Cents;
  expectedLoss: number;
}

function isSession(x: unknown): x is PlaySession {
  if (!x || typeof x !== 'object') return false;
  const s = x as Partial<PlaySession>;
  return (
    s.v === 1 &&
    s.game === 'roulette' &&
    isVariant(s.variant) &&
    typeof s.id === 'string' &&
    typeof s.bankroll === 'number' &&
    Array.isArray(s.bets) &&
    Array.isArray(s.log) &&
    Array.isArray(s.curve) &&
    typeof s.stats === 'object' &&
    s.stats !== null
  );
}

export function loadSession(): PlaySession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const x: unknown = JSON.parse(raw);
    return isSession(x) ? x : null;
  } catch {
    return null;
  }
}

export function saveSession(s: PlaySession | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* blocked or full storage: the session just lives in memory */
  }
}

export function loadHistory(): SessionSummary[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const x: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(x)
      ? x.filter(
          (h): h is SessionSummary =>
            !!h && typeof h === 'object' && typeof (h as SessionSummary).id === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

export function saveHistory(list: readonly SessionSummary[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT)));
  } catch {
    /* not remembered */
  }
}

export function summarize(s: PlaySession): SessionSummary {
  const final = equityOf(s);
  return {
    id: s.id,
    variant: s.variant,
    ...(s.rng.kind === 'seeded' ? { seed: s.rng.seed } : {}),
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? s.updatedAt,
    spins: s.stats.spins,
    bankIn: s.bankIn,
    final,
    net: final - s.bankIn,
    wagered: s.stats.wagered,
    expectedLoss: s.stats.expectedLoss,
  };
}

/** Newest first, one entry per session id, at most HISTORY_LIMIT. */
export function withSummary(list: readonly SessionSummary[], s: SessionSummary): SessionSummary[] {
  return [s, ...list.filter((h) => h.id !== s.id)].slice(0, HISTORY_LIMIT);
}

/** The bets on the felt as board spots in table chip units (so money labels are exact). */
export function spotsOfBets(
  bets: readonly { bet: BetId; amount: Cents }[],
  chipUnit: Cents,
): LayoutSpot[] {
  return bets.map((b) => ({ bet: b.bet, chips: Math.round(b.amount / chipUnit) }));
}

/** Cash in hand after the bets being placed. */
export const cashOf = (s: PlaySession): Cents => s.bankroll - betsTotal(s.bets);
/** Bets being placed plus stakes the engine carries (imprisoned bets). */
export const onTableOf = (s: PlaySession): Cents => betsTotal(s.bets) + s.carried;
/** Session result so far: equity minus everything bought in. */
export const netOf = (s: PlaySession): Cents => equityOf(s) - s.bankIn;

/**
 * The board's tap: `delta` steps of the selected chip (call bets: their pieces). Adds with
 * `placeBet`; removes with `removeBet` (all of it when the chip is larger).
 */
export function adjustBet(
  env: RouletteEnv,
  s: PlaySession,
  bet: BetId,
  delta: number,
  denom: Cents,
): PlayResult {
  if (delta > 0) return placeBet(env, s, bet, delta * denom);
  return removeBet(env, s, bet, -delta * denom);
}

/** Imprisoned bets the engine carries (`prison:<bet>`), read from the roulette snapshot. */
export function carriedBets(s: PlaySession): { bet: BetId; amount: Cents }[] {
  const prison = (s.engine as { prison?: unknown } | null | undefined)?.prison;
  if (!Array.isArray(prison)) return [];
  return (prison as unknown[])
    .filter((b): b is { bet: string; amount: number } => {
      const x = b as { bet?: unknown; amount?: unknown } | null;
      return !!x && typeof x.bet === 'string' && typeof x.amount === 'number';
    })
    .map((b) => ({ bet: b.bet.replace(/^prison:/, ''), amount: b.amount }));
}
