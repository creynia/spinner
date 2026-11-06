// Play-mode session operations (types.ts): pure functions from a session to a new session or a
// refusal. Bets are kept as whole stakes per bet id and are only handed to the engine at spin
// time, through the plugin's own reconcile/apply, so the table enforces exactly the rules a
// simulation would. Nothing here knows which game is played.
import type { BetId, Cents, Json, LayoutEntry, Rng } from '../contracts/game';
import type { LayoutSpot } from '../contracts/layout';
import { formatMoney } from '../money';
import { rngFor, seededState } from './rng';
import {
  PLAY_CURVE_LIMIT,
  PLAY_LOG_LIMIT,
  PLAY_UNDO_LIMIT,
  type BetProblem,
  type PlayBet,
  type PlayEnv,
  type PlayRefusal,
  type PlayResult,
  type PlayRngSpec,
  type PlaySession,
  type PlayStats,
  type SpinRecord,
  type SpinResult,
} from './types';

const nowOf = (env: Pick<PlayEnv, 'now'>): string =>
  env.now ? env.now() : new Date().toISOString();

const refuse = (code: PlayRefusal['code'], message: string, bet?: BetId): PlayRefusal =>
  bet === undefined ? { ok: false, code, message } : { ok: false, code, message, bet };

const okS = (session: PlaySession): PlayResult => ({ ok: true, session });

/** Sum of the stakes. */
export function betsTotal(bets: readonly PlayBet[]): Cents {
  let t = 0;
  for (const b of bets) t += b.amount;
  return t;
}

/** Cash plus stakes the engine carries (not the bets being placed, which are still cash). */
export function equityOf(s: PlaySession): Cents {
  return s.bankroll + s.carried;
}

function emptyStats(start: Cents): PlayStats {
  return {
    spins: 0,
    betSpins: 0,
    wagered: 0,
    net: 0,
    expectedLoss: 0,
    variance: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    biggestWin: 0,
    biggestLoss: 0,
    peak: start,
    trough: start,
    maxDrawdown: 0,
    streak: 0,
    longestWinStreak: 0,
    longestLossStreak: 0,
    lossRun: { amount: 0, spins: 0 },
    lastWinCost: null,
  };
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?(): string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function restoreState<S>(env: PlayEnv<S>, snapshot: unknown, rng: Rng): S {
  if (env.restore) return env.restore(snapshot, rng);
  const st = env.plugin.deserialize(snapshot) as S & { rng?: Rng };
  st.rng = rng;
  return st;
}

/** A new session at a fresh table. */
export function createSession<S, R>(
  env: PlayEnv<S, R>,
  opts: {
    variant: string;
    bankroll: Cents;
    rng?: PlayRngSpec;
    id?: string;
    rulesOverrides?: Record<string, Json>;
  },
): PlaySession {
  if (!Number.isSafeInteger(opts.bankroll) || opts.bankroll <= 0)
    throw new RangeError(`play: bankroll must be positive cents: ${opts.bankroll}`);
  const spec = opts.rng ?? { kind: 'crypto' as const };
  const rng = rngFor(spec);
  const state = env.plugin.createState({ rules: env.rules, rng, bankroll: opts.bankroll });
  const at = nowOf(env);
  const s: PlaySession = {
    v: 1,
    id: opts.id ?? randomId(),
    game: env.plugin.id,
    variant: opts.variant,
    ...(opts.rulesOverrides && Object.keys(opts.rulesOverrides).length
      ? { rulesOverrides: structuredClone(opts.rulesOverrides) }
      : {}),
    rng: spec,
    bankIn: opts.bankroll,
    startBankroll: opts.bankroll,
    bankroll: opts.bankroll,
    bets: [],
    lastBets: [],
    undo: [],
    log: [],
    curve: [opts.bankroll],
    stats: emptyStats(opts.bankroll),
    carried: 0,
    engine: env.plugin.serialize(state),
    startedAt: at,
    updatedAt: at,
  };
  if (spec.kind === 'seeded') s.rngState = seededState(spec.seed);
  return s;
}

const cloneBets = (bets: readonly PlayBet[]): PlayBet[] => bets.map((b) => ({ ...b }));

function sameBets(a: readonly PlayBet[], b: readonly PlayBet[]): boolean {
  return (
    a.length === b.length && a.every((x, i) => x.bet === b[i]!.bet && x.amount === b[i]!.amount)
  );
}

/** Validate a whole bet list against the bankroll and per-bet maxima, then commit it as one undo step. */
function commitBets<S, R>(env: PlayEnv<S, R>, s: PlaySession, next: PlayBet[]): PlayResult {
  if (s.endedAt) return refuse('ended', 'This session has ended');
  for (const b of next) {
    if (!Number.isSafeInteger(b.amount) || b.amount <= 0)
      return refuse('bad-amount', `Invalid amount on ${b.bet}`, b.bet);
    const lim = env.plugin.limits(b.bet, env.rules);
    if (lim === null) {
      if (env.plugin.bets.parse(b.bet) === null)
        return refuse('not-placeable', `${b.bet} is not a bet at this table`, b.bet);
    } else if (b.amount > lim.max) {
      return refuse('over-max', `Table maximum on this bet is ${formatMoney(lim.max)}`, b.bet);
    }
  }
  const total = betsTotal(next);
  if (total > s.bankroll)
    return refuse(
      'unaffordable',
      `Not enough bankroll: ${formatMoney(total)} needed, ${formatMoney(s.bankroll)} available`,
    );
  if (sameBets(next, s.bets)) return okS(s);
  const undo = [...s.undo, cloneBets(s.bets)];
  if (undo.length > PLAY_UNDO_LIMIT) undo.splice(0, undo.length - PLAY_UNDO_LIMIT);
  return okS({ ...s, bets: next, undo, updatedAt: nowOf(env) });
}

/** Canonical id, or the input when the plugin cannot parse it (commitBets then refuses it). */
const canon = (env: PlayEnv, bet: BetId): BetId => env.plugin.bets.parse(bet) ?? bet;

/** Add `amount` to `bet` (merged with what is already there). Below-minimum stakes are allowed until the spin. */
export function placeBet<S, R>(
  env: PlayEnv<S, R>,
  s: PlaySession,
  bet: BetId,
  amount: Cents,
): PlayResult {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    return refuse('bad-amount', 'Choose a chip first', bet);
  const id = canon(env, bet);
  const next = cloneBets(s.bets);
  const had = next.find((b) => b.bet === id);
  if (had) had.amount += amount;
  else next.push({ bet: id, amount });
  return commitBets(env, s, next);
}

/** Take `amount` off `bet` (all of it when omitted or larger than the stake). */
export function removeBet<S, R>(
  env: PlayEnv<S, R>,
  s: PlaySession,
  bet: BetId,
  amount?: Cents,
): PlayResult {
  const id = canon(env, bet);
  const i = s.bets.findIndex((b) => b.bet === id);
  if (i < 0) return refuse('no-bets', 'No chips on that bet', id);
  const next = cloneBets(s.bets);
  const left = amount === undefined ? 0 : next[i]!.amount - amount;
  if (left <= 0) next.splice(i, 1);
  else next[i]!.amount = left;
  return commitBets(env, s, next);
}

/** Replace every bet being placed. */
export function setBets<S, R>(
  env: PlayEnv<S, R>,
  s: PlaySession,
  bets: readonly PlayBet[],
): PlayResult {
  const merged: PlayBet[] = [];
  for (const b of bets) {
    const id = canon(env, b.bet);
    const had = merged.find((m) => m.bet === id);
    if (had) had.amount += b.amount;
    else merged.push({ bet: id, amount: b.amount });
  }
  return commitBets(env, s, merged);
}

/** Put a chip layout on the table at `chipValue` per chip, added to or replacing the current bets. */
export function placeSpots<S, R>(
  env: PlayEnv<S, R>,
  s: PlaySession,
  spots: readonly LayoutSpot[],
  chipValue: Cents,
  mode: 'add' | 'replace' = 'add',
): PlayResult {
  if (!Number.isSafeInteger(chipValue) || chipValue <= 0)
    return refuse('bad-amount', 'Choose a chip value');
  const add = spots.map((sp) => ({ bet: sp.bet, amount: sp.chips * chipValue }));
  return setBets(env, s, mode === 'add' ? [...s.bets, ...add] : add);
}

export function undoBets(s: PlaySession): PlayResult {
  if (s.endedAt) return refuse('ended', 'This session has ended');
  if (s.undo.length === 0) return refuse('nothing-to-undo', 'Nothing to undo');
  const undo = s.undo.slice(0, -1);
  return okS({
    ...s,
    bets: cloneBets(s.undo[s.undo.length - 1]!),
    undo,
    updatedAt: new Date().toISOString(),
  });
}

export function clearBets(s: PlaySession): PlayResult {
  if (s.endedAt) return refuse('ended', 'This session has ended');
  if (s.bets.length === 0) return refuse('no-bets', 'No bets to clear');
  const undo = [...s.undo, cloneBets(s.bets)].slice(-PLAY_UNDO_LIMIT);
  return okS({ ...s, bets: [], undo, updatedAt: new Date().toISOString() });
}

/** Bets := the last spin's bets. */
export function rebet<S, R>(env: PlayEnv<S, R>, s: PlaySession): PlayResult {
  if (s.lastBets.length === 0) return refuse('nothing-to-rebet', 'No previous bets to repeat');
  return commitBets(env, s, cloneBets(s.lastBets));
}

/** Doubles every bet being placed; with none, places the last spin's bets doubled. */
export function doubleBets<S, R>(env: PlayEnv<S, R>, s: PlaySession): PlayResult {
  const base = s.bets.length ? s.bets : s.lastBets;
  if (base.length === 0) return refuse('nothing-to-rebet', 'No bets to double');
  return commitBets(
    env,
    s,
    base.map((b) => ({ bet: b.bet, amount: b.amount * 2 })),
  );
}

/**
 * One more chip of `chip` on every bet being placed (with none, on the last spin's bets): `step`
 * gives a bet's pieces (a call bet takes one chip per piece). One undo step.
 */
export function addChipEach<S, R>(
  env: PlayEnv<S, R>,
  s: PlaySession,
  chip: Cents,
  step: (bet: BetId) => number = () => 1,
): PlayResult {
  if (!Number.isSafeInteger(chip) || chip <= 0) return refuse('bad-amount', 'Choose a chip first');
  const base = s.bets.length ? s.bets : s.lastBets;
  if (base.length === 0) return refuse('no-bets', 'No bets to add to');
  return commitBets(
    env,
    s,
    base.map((b) => ({ bet: b.bet, amount: b.amount + chip * Math.max(1, step(b.bet)) })),
  );
}

/** Replace the rules overrides (e.g. new table limits); the host re-resolves its env's rules. */
export function setRulesOverrides(s: PlaySession, overrides: Record<string, Json>): PlaySession {
  const next: PlaySession = { ...s, updatedAt: new Date().toISOString() };
  if (Object.keys(overrides).length) next.rulesOverrides = structuredClone(overrides);
  else delete next.rulesOverrides;
  return next;
}

/** Add cash to the bankroll (a rebuy). */
export function topUp(s: PlaySession, amount: Cents): PlaySession {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new RangeError('play: top-up must be positive cents');
  return {
    ...s,
    bankroll: s.bankroll + amount,
    bankIn: s.bankIn + amount,
    updatedAt: new Date().toISOString(),
  };
}

export function endSession(s: PlaySession): PlaySession {
  const at = new Date().toISOString();
  return { ...s, endedAt: at, updatedAt: at };
}

/** Result minus expectation, and how many standard deviations that is (null before any variance). */
export function luckOf(stats: PlayStats): { luck: number; z: number | null } {
  const luck = stats.net + stats.expectedLoss;
  return { luck, z: stats.variance > 0 ? luck / Math.sqrt(stats.variance) : null };
}

const describeCode = (code: string, bet: BetId, env: PlayEnv): string => {
  const lim = env.plugin.limits(bet, env.rules);
  switch (code) {
    case 'below-min':
      return lim ? `Below the table minimum of ${formatMoney(lim.min)}` : 'Below the table minimum';
    case 'over-max':
    case 'clamped':
      return lim ? `Over the table maximum of ${formatMoney(lim.max)}` : 'Over the table maximum';
    case 'unaffordable':
    case 'reduced':
      return 'Not enough bankroll';
    case 'inside-min-total':
      return 'Inside bets are below the table minimum total';
    case 'table-max':
      return 'Over the table maximum per spin';
    case 'rounded':
    case 'invalid-amount':
    case 'bad-amount':
      return 'Not a whole number of chips for this bet';
    case 'not-on-wheel':
      return 'Not on this wheel';
    default:
      return code.replace(/-/g, ' ');
  }
};

interface Staged<S> {
  state: S;
  problems: BetProblem[];
}

/** Hands the bets to a restored engine through reconcile/apply/confirm; problems mean "do not spin". */
function stage<S, R>(env: PlayEnv<S, R>, s: PlaySession, rng: Rng): Staged<S> {
  const plugin = env.plugin;
  const state = restoreState(env, s.engine, rng);
  const problems: BetProblem[] = [];
  if (s.bets.length === 0) return { state, problems };
  const desired: LayoutEntry[] = s.bets.map((b) => ({ bet: b.bet, amount: b.amount }));
  const rec = plugin.reconcile(state, desired);
  for (const r of rec.rejected)
    problems.push({
      bet: r.entry.bet,
      code: r.reason,
      message: describeCode(r.reason, r.entry.bet, env),
    });
  for (const a of rec.adjusted)
    if (a.to !== a.entry.amount)
      problems.push({
        bet: a.entry.bet,
        code: a.reason,
        message: describeCode(a.reason, a.entry.bet, env),
      });
  for (const d of rec.deferred)
    problems.push({
      bet: d.entry.bet,
      code: d.reason,
      message: describeCode(d.reason, d.entry.bet, env),
    });
  if (problems.length) return { state, problems };
  let st = state;
  for (const action of rec.actions) {
    const r = plugin.apply(st, action);
    if (!r.ok) {
      const bet = (action as { bet?: BetId }).bet ?? '';
      problems.push({ bet, code: r.code, message: describeCode(r.code, bet, env) });
      return { state: st, problems };
    }
    st = r.state;
  }
  const c = plugin.apply(st, { type: 'confirm' });
  if (!c.ok) {
    problems.push({ bet: '', code: c.code, message: describeCode(c.code, '', env) });
    return { state: st, problems };
  }
  return { state: c.state, problems };
}

/** What would stop the bets being placed from going down as they are (empty: ready to spin). */
export function checkBets<S, R>(env: PlayEnv<S, R>, s: PlaySession): BetProblem[] {
  if (s.bets.length === 0) return [];
  // A throwaway source: staging draws nothing.
  const dummy: Rng = {
    next: () => 0,
    below: () => 0,
    float53: () => 0,
    snapshot: () => [0, 0, 0, 0],
  };
  return stage(env, s, dummy).problems;
}

function pushCurve(curve: readonly Cents[], v: Cents): Cents[] {
  const next = [...curve, v];
  if (next.length <= PLAY_CURVE_LIMIT) return next;
  // Thin: keep the start, then every other point, so long sessions keep their shape.
  const thin = [next[0]!];
  for (let i = 1; i < next.length - 1; i += 2) thin.push(next[i]!);
  thin.push(next[next.length - 1]!);
  return thin;
}

/** Spin the wheel with the bets being placed (none is allowed: a spin to watch). */
export function spin<S, R>(env: PlayEnv<S, R>, s: PlaySession): SpinResult {
  if (s.endedAt) return refuse('ended', 'This session has ended');
  const plugin = env.plugin;
  const rng = rngFor(s.rng, s.rngState);
  const staged = stage(env, s, rng);
  if (staged.problems.length) {
    const p = staged.problems[0]!;
    return refuse('table', p.message, p.bet || undefined);
  }
  const view = plugin.visible(staged.state);
  const expectedLoss = s.bets.length ? plugin.ev.expectedLossPerRound(view) : 0;
  const variance = s.bets.length ? plugin.ev.variancePerRound(view) : 0;
  const { state, outcome } = plugin.playRound(staged.state);
  const equity = plugin.equity(state);
  const cash = (state as { bankroll?: number }).bankroll;
  const bankroll = typeof cash === 'number' ? cash : equity;
  const at = nowOf(env);
  const n = s.stats.spins + 1;
  const record: SpinRecord = {
    n,
    bets: cloneBets(s.bets),
    wagered: outcome.wagered,
    net: outcome.net,
    equity,
    expectedLoss,
    summary: { ...outcome.summary },
    resolutions: outcome.resolutions.map((r) => ({ ...r })),
    events: outcome.events.map((e) =>
      e.bet === undefined ? { type: e.type } : { type: e.type, bet: e.bet },
    ),
    at,
  };
  const st = { ...s.stats };
  const run = s.stats.lossRun ?? { amount: 0, spins: 0 };
  st.lossRun = run;
  st.lastWinCost = s.stats.lastWinCost ?? null;
  st.spins = n;
  st.wagered += outcome.wagered;
  st.net += outcome.net;
  st.expectedLoss += expectedLoss;
  st.variance += variance;
  // A spin counts toward win/loss when anything was at stake (new bets or carried ones).
  if (s.bets.length || outcome.resolutions.length) {
    st.betSpins += 1;
    if (outcome.net > 0) {
      st.wins += 1;
      if (run.spins > 0) {
        // What the win cost: the losing run it ended plus the stake on the winning spin itself.
        const cost = { amount: run.amount + outcome.wagered, spins: run.spins + 1 };
        record.cost = cost;
        st.lastWinCost = { ...cost, win: outcome.net };
      }
      st.lossRun = { amount: 0, spins: 0 };
      st.streak = st.streak > 0 ? st.streak + 1 : 1;
      st.longestWinStreak = Math.max(st.longestWinStreak, st.streak);
    } else if (outcome.net < 0) {
      st.losses += 1;
      st.lossRun = { amount: run.amount - outcome.net, spins: run.spins + 1 };
      st.streak = st.streak < 0 ? st.streak - 1 : -1;
      st.longestLossStreak = Math.max(st.longestLossStreak, -st.streak);
    } else st.pushes += 1;
    st.biggestWin = Math.max(st.biggestWin, outcome.net);
    st.biggestLoss = Math.min(st.biggestLoss, outcome.net);
  }
  // Measured net of top-ups (start + session result), so a rebuy is not a "win".
  const level = equity - (s.bankIn - s.startBankroll);
  st.peak = Math.max(st.peak, level);
  st.trough = Math.min(st.trough, level);
  st.maxDrawdown = Math.max(st.maxDrawdown, st.peak - level);
  const log = [...s.log, record];
  if (log.length > PLAY_LOG_LIMIT) log.splice(0, log.length - PLAY_LOG_LIMIT);
  const next: PlaySession = {
    ...s,
    bankroll,
    carried: equity - bankroll,
    bets: [],
    lastBets: s.bets.length ? cloneBets(s.bets) : s.lastBets,
    undo: [],
    log,
    curve: pushCurve(s.curve, level),
    stats: st,
    engine: plugin.serialize(state),
    updatedAt: at,
  };
  if (s.rng.kind === 'seeded') next.rngState = [...rng.snapshot()];
  else delete next.rngState;
  return { ok: true, session: next, spin: record };
}

/**
 * A bet list as a chip layout: the largest chip value that divides every stake (in whole `step`
 * multiples, e.g. a call bet's pieces), so the layout redraws the same bets at that value.
 */
export function spotsFromBets(
  bets: readonly PlayBet[],
  step: (bet: BetId) => number = () => 1,
): { spots: LayoutSpot[]; chipValue: Cents } {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let g = 0;
  for (const b of bets) g = gcd(g, Math.round(b.amount / Math.max(1, step(b.bet))));
  if (g <= 0) return { spots: [], chipValue: 0 };
  return {
    spots: bets.map((b) => ({ bet: b.bet, chips: Math.round(b.amount / g) })),
    chipValue: g,
  };
}
