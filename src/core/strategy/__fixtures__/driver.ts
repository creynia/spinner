// A scripted driver for semantics tests: builds observations by hand and records traces.
import type { GameEvent, Layout, RoundOutcome } from '../../contracts/game';
import type {
  CompileContext,
  Observation,
  StepOutput,
  StrategyDefinition,
  StrategyMemory,
  StrategyRuntime,
} from '../../contracts/strategy';
import type { TraceWindow } from '../../contracts/strategy-trace';
import { compileStrategy } from '../compile';
import { makeCtx, stubView, type StubView } from './stub-ctx';

/** `res`: [bet, amount, profit]. Result by profit sign; net = sum of profits. */
export function outcome(
  res: [string, number, number][],
  events: GameEvent[] = [],
  stays: string[] = [],
): RoundOutcome {
  return {
    net: res.reduce((a, r) => a + r[2], 0),
    wagered: res.reduce((a, r) => a + r[1], 0),
    resolutions: [
      ...res.map(([bet, amount, profit]): RoundOutcome['resolutions'][number] => ({
        bet,
        amount,
        profit,
        result: profit > 0 ? 'win' : profit < 0 ? 'lose' : 'push',
      })),
      ...stays.map((bet) => ({ bet, amount: 0, profit: 0, result: 'stays' as const })),
    ],
    events,
    summary: {},
  };
}

export interface StepResult {
  out: StepOutput;
  trace: TraceWindow;
  /** desired as plain [bet, amount] pairs. */
  want: [string, number][];
}

export class Driver {
  readonly rt: StrategyRuntime;
  readonly mem: StrategyMemory;
  w = 0;
  net = 0;
  wagered = 0;
  traces: TraceWindow[] = [];
  view: StubView = stubView();

  constructor(
    def: unknown,
    ctx: CompileContext = makeCtx({ limits: () => ({ min: 1, max: 1e12 }) }),
    private readonly start = 500_000,
  ) {
    this.rt = compileStrategy(def as StrategyDefinition, ctx);
    this.mem = this.rt.createMemory();
    this.rt.reset(this.mem);
  }

  step(
    last: RoundOutcome | null = null,
    over: { table?: Layout; view?: Partial<StubView> } = {},
  ): StepResult {
    if (last) {
      this.net += last.net;
      this.wagered += last.wagered;
    }
    const equity = this.start + this.net;
    const obs: Observation = {
      window: this.w++,
      session: {
        start: this.start,
        bankroll: equity,
        equity,
        net: this.net,
        peak: Math.max(this.start, equity),
        drawdown: Math.max(0, this.start - equity),
        wagered: this.wagered,
        roundsWagered: 0,
        lastNet: last?.net ?? 0,
        exposure: 0,
      },
      table: over.table ?? [],
      last,
      state: { ...this.view, ...over.view },
    };
    const out: StepOutput = { stage: 0, desired: [], acts: [], stop: null, error: null };
    let trace!: TraceWindow;
    this.rt.step(this.mem, obs, out, {
      window: (r) => {
        trace = r;
        this.traces.push(r);
      },
    });
    return { out, trace, want: out.desired.map((e) => [e.bet, e.amount]) };
  }
}
