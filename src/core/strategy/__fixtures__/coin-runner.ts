// Runs a strategy through the fake `coin` plugin: a miniature harness loop for golden traces.
import type { Cents, RoundOutcome } from '../../contracts/game';
import type {
  CompileContext,
  Observation,
  StepOutput,
  StrategyDefinition,
} from '../../contracts/strategy';
import type { SessionTrace, TraceWindow } from '../../contracts/strategy-trace';
import { sessionRng } from '../../rng';
import { coin } from '../../testing';
import { compileStrategy } from '../compile';

export const GOLDEN_SEED = 20261028;

export function coinCtx(): CompileContext {
  const rules = coin.rules.resolve('standard');
  return {
    catalog: coin.bets.catalog(rules),
    parseBet: (id) => coin.bets.parse(id),
    facts: coin.facts,
    rules,
    limits: (b, r) => coin.limits(b, r as typeof rules),
    compileFact: (ref) => coin.compileFact(ref, rules),
  };
}

export interface CoinRun {
  trace: SessionTrace;
  rejected: number;
  endedBy: string;
}

export function runCoin(
  def: unknown,
  opts: { seed?: number; index?: number; bankroll?: Cents; rounds?: number } = {},
): CoinRun {
  const rules = coin.rules.resolve('standard');
  const start = opts.bankroll ?? 500_000;
  const rt = compileStrategy(def as StrategyDefinition, coinCtx());
  const mem = rt.createMemory();
  rt.reset(mem);
  const state = coin.createState({
    rules,
    rng: sessionRng(opts.seed ?? GOLDEN_SEED, opts.index ?? 0, 'engine'),
    bankroll: start,
  });
  const trace: TraceWindow[] = [];
  let last: RoundOutcome | null = null;
  let net = 0;
  let peak = start;
  let wagered = 0;
  let rejected = 0;
  let endedBy = 'rounds';
  const rounds = opts.rounds ?? 200;
  for (let w = 0; w < rounds; w++) {
    const equity = coin.equity(state);
    const obs: Observation = {
      window: w,
      session: {
        start,
        bankroll: state.bankroll,
        equity,
        net,
        peak,
        drawdown: peak - equity,
        wagered,
        roundsWagered: 0,
        lastNet: last?.net ?? 0,
        exposure: state.stake,
      },
      table: coin.layoutOf(state),
      last,
      state: coin.visible(state),
    };
    const out: StepOutput = { stage: 0, desired: [], acts: [], stop: null, error: null };
    let rec!: TraceWindow;
    rt.step(mem, obs, out, { window: (r) => (rec = r) });
    trace.push(rec);
    if (out.stop || out.error) {
      endedBy = out.stop ? `strategy:${out.stop}` : 'error';
      break;
    }
    const r = coin.reconcile(state, out.desired);
    for (const a of r.actions) coin.apply(state, a);
    rejected += r.rejected.length;
    rec.reconcile = {
      actions: r.actions.length,
      deferred: r.deferred.map((x) => ({ bet: x.entry.bet, reason: x.reason })),
      rejected: r.rejected.map((x) => ({ bet: x.entry.bet, reason: x.reason })),
      adjusted: r.adjusted.map((x) => ({ bet: x.entry.bet, to: x.to, reason: x.reason })),
    };
    last = coin.playRound(state).outcome;
    rec.outcome = {
      summary: last.summary,
      net: last.net,
      resolutions: last.resolutions.map((x) => ({
        bet: x.bet,
        result: x.result,
        profit: x.profit,
      })),
    };
    net += last.net;
    wagered += last.wagered;
    peak = Math.max(peak, coin.equity(state));
    rec.equity = coin.equity(state);
    if (state.bankroll < rules.min && state.stake === 0 && out.desired.length > 0) {
      endedBy = 'bust';
      break;
    }
  }
  return { trace, rejected, endedBy };
}

/** Canonical JSON (keys sorted), one record per line. */
export function jsonl(trace: SessionTrace): string {
  const canon = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(canon)
      : x && typeof x === 'object'
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, canon((x as Record<string, unknown>)[k])]),
          )
        : x;
  return trace.map((r) => JSON.stringify(canon(r))).join('\n') + '\n';
}
