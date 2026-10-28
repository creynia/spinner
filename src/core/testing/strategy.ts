/**
 * A minimal strategy driver for core tests (architecture.md §12.2: "use a minimal test strategy
 * driver in testing/ so you are not blocked"). It interprets a small subset of the real
 * `StrategyDefinition` schema so the same definitions keep working when `core/strategy` lands:
 *
 *   - stages with `layout` entries (`bet`, `amount`, optional `when`) and ordered `rules`;
 *   - amounts/expressions: numbers, session fact names (`net`, `round`, `roundsInStage`, `equity`,
 *     `bankroll`, `peak`, `drawdown`, `wagered`, `lastNet`), `{ units }`, `{ var }`, `{ prog }`,
 *     `{ add | times | max | min | sub }`;
 *   - conditions: `always`, `all`, `any`, `not`, `cmp`, `fact` (through the plugin's `compileFact`);
 *   - effects: `goto`, `stop`, `set`, `inc`, `skipRound`, `{ prog, do: 'reset' }`;
 *   - progressions `flat` and `martingale` (`maxSteps`, `onCap: 'reset' | 'stay'`) tracking a bet id.
 *
 * It is NOT the reference for the strategy semantics (that is `core/strategy`); `extends`, `once`,
 * `cooldown`, history conditions, `press` and the other progression kinds are not supported.
 */
import type { Layout, RoundOutcome } from '../contracts/game';
import type {
  CompileContext,
  Condition,
  Effect,
  Expr,
  Observation,
  StepOutput,
  StrategyDefinition,
  StrategyMemory,
  StrategyRuntime,
  TraceSink,
} from '../contracts/strategy';
import type { TraceWindow } from '../contracts/strategy-trace';

interface ProgState {
  step: number;
}
interface Mem {
  __brand: 'StrategyMemory';
  stage: number;
  roundsInStage: number;
  vars: Record<string, number>;
  prog: Record<string, ProgState>;
}

type NumFn = (m: Mem, o: Observation) => number | null;
type BoolFn = (m: Mem, o: Observation) => boolean;
type EffectFn = (m: Mem, o: Observation, ctl: Ctl) => void;
interface Ctl {
  goto: number | null;
  stop: string | null;
  skip: boolean;
}
interface CompiledRule {
  id: string;
  when: BoolFn;
  then: EffectFn[];
}
interface CompiledStage {
  id: string;
  layout: { bet: string; amount: NumFn; when: BoolFn }[];
  rules: CompiledRule[];
}

const SESSION_FACTS = new Set([
  'net',
  'round',
  'roundsInStage',
  'equity',
  'bankroll',
  'peak',
  'drawdown',
  'wagered',
  'lastNet',
]);

export function compileTestStrategy(def: StrategyDefinition, ctx: CompileContext): StrategyRuntime {
  const stageIds = def.stages.map((s) => s.id);
  const stageIndex = new Map(stageIds.map((id, i) => [id, i]));
  const progNames = Object.keys(def.progressions ?? {}).sort();
  const reasons = new Set<string>();

  const sessionFact = (name: string): NumFn => {
    switch (name) {
      case 'net':
        return (_m, o) => o.session.net;
      case 'round':
        return (_m, o) => o.window;
      case 'roundsInStage':
        return (m) => m.roundsInStage;
      case 'equity':
        return (_m, o) => o.session.equity;
      case 'bankroll':
        return (_m, o) => o.session.bankroll;
      case 'peak':
        return (_m, o) => o.session.peak;
      case 'drawdown':
        return (_m, o) => o.session.drawdown;
      case 'wagered':
        return (_m, o) => o.session.wagered;
      default:
        return (_m, o) => o.session.lastNet;
    }
  };

  const progAmount = (name: string): NumFn => {
    const spec = def.progressions?.[name];
    if (!spec) throw new Error(`unknown progression ${name}`);
    return (m) => {
      const step = m.prog[name]!.step;
      return spec.kind === 'martingale' ? def.unit * 2 ** step : def.unit;
    };
  };

  const expr = (e: Expr): NumFn => {
    if (typeof e === 'number') return () => e;
    if (typeof e === 'string') {
      if (!SESSION_FACT_NAMES_OK(e)) throw new Error(`unsupported fact ${e}`);
      return sessionFact(e);
    }
    if ('units' in e) {
      const n = e.units;
      return () => n * def.unit;
    }
    if ('var' in e) {
      const v = e.var;
      return (m) => m.vars[v] ?? null;
    }
    if ('prog' in e) return progAmount(e.prog);
    const bin = (items: Expr[], f: (a: number, b: number) => number): NumFn => {
      const fns = items.map(expr);
      return (m, o) => {
        let acc: number | null = null;
        for (const fn of fns) {
          const v = fn(m, o);
          if (v === null) return null;
          acc = acc === null ? v : f(acc, v);
        }
        return acc;
      };
    };
    if ('add' in e) return bin(e.add, (a, b) => a + b);
    if ('times' in e) return bin(e.times, (a, b) => a * b);
    if ('max' in e) return bin(e.max, Math.max);
    if ('min' in e) return bin(e.min, Math.min);
    if ('sub' in e) return bin(e.sub, (a, b) => a - b);
    throw new Error(`unsupported expression ${JSON.stringify(e)}`);
  };

  const cond = (c: Condition): BoolFn => {
    if ('always' in c) return () => true;
    if ('all' in c) {
      const fns = c.all.map(cond);
      return (m, o) => fns.every((f) => f(m, o));
    }
    if ('any' in c) {
      const fns = c.any.map(cond);
      return (m, o) => fns.some((f) => f(m, o));
    }
    if ('not' in c) {
      const f = cond(c.not);
      return (m, o) => !f(m, o);
    }
    if ('cmp' in c) {
      const [l, op, r] = c.cmp;
      const lf = expr(l);
      const rf = expr(r);
      return (m, o) => {
        const a = lf(m, o);
        const b = rf(m, o);
        if (a === null || b === null) return false;
        switch (op) {
          case '<':
            return a < b;
          case '<=':
            return a <= b;
          case '==':
            return a === b;
          case '!=':
            return a !== b;
          case '>=':
            return a >= b;
          default:
            return a > b;
        }
      };
    }
    if ('fact' in c) {
      const [ref, op, value] = c.fact;
      const acc = ctx.compileFact(ref, ctx.rules);
      return (_m, o) => {
        const v = acc(o.state, o.last);
        if (v === null) return false;
        if (op === 'in') return (value as unknown[]).includes(v);
        if (op === 'notIn') return !(value as unknown[]).includes(v);
        const w = value as number | string | boolean;
        switch (op) {
          case '<':
            return v < w;
          case '<=':
            return v <= w;
          case '==':
            return v === w;
          case '!=':
            return v !== w;
          case '>=':
            return v >= w;
          default:
            return v > w;
        }
      };
    }
    throw new Error(`unsupported condition ${JSON.stringify(c)}`);
  };

  const effect = (e: Effect): EffectFn => {
    if ('goto' in e) {
      const to = stageIndex.get(e.goto);
      if (to === undefined) throw new Error(`unknown stage ${e.goto}`);
      return (_m, _o, ctl) => {
        ctl.goto = to;
      };
    }
    if ('stop' in e) {
      reasons.add(e.stop);
      const r = e.stop;
      return (_m, _o, ctl) => {
        ctl.stop = r;
      };
    }
    if ('set' in e) {
      const f = expr(e.to);
      const name = e.set;
      return (m, o) => {
        m.vars[name] = f(m, o) ?? 0;
      };
    }
    if ('inc' in e) {
      const f = expr(e.by ?? 1);
      const name = e.inc;
      return (m, o) => {
        m.vars[name] = (m.vars[name] ?? 0) + (f(m, o) ?? 0);
      };
    }
    if ('skipRound' in e) {
      return (_m, _o, ctl) => {
        ctl.skip = true;
      };
    }
    if ('prog' in e && e.do === 'reset') {
      const name = e.prog;
      return (m) => {
        m.prog[name]!.step = 0;
      };
    }
    throw new Error(`unsupported effect ${JSON.stringify(e)}`);
  };

  const stages: CompiledStage[] = def.stages.map((s) => ({
    id: s.id,
    layout: (s.layout ?? []).map((l) => ({
      bet: ctx.parseBet(l.bet) ?? l.bet,
      amount:
        typeof l.amount === 'object' && 'keepOr' in l.amount
          ? expr(l.amount.keepOr)
          : expr(l.amount as Expr),
      when: l.when ? cond(l.when) : () => true,
    })),
    rules: (s.rules ?? [])
      .filter((r) => r.enabled !== false)
      .map((r, i) => ({
        id: r.id ?? `${s.id}#${i}`,
        when: cond(r.when),
        then: r.then.map(effect),
      })),
  }));

  const feed = (m: Mem, last: RoundOutcome | null): void => {
    if (!last) return;
    for (const name of progNames) {
      const spec = def.progressions![name]!;
      const track = typeof spec.track === 'string' ? spec.track : null;
      if (!track) continue;
      const r = last.resolutions.find((x) => x.bet === track);
      if (!r) continue;
      const st = m.prog[name]!;
      if (spec.kind === 'martingale') {
        if (r.profit > 0) st.step = 0;
        else if (r.profit < 0) {
          if (st.step + 1 >= spec.maxSteps) st.step = spec.onCap === 'stay' ? st.step : 0;
          else st.step++;
        }
      }
    }
  };

  const freshMem = (): Mem => ({
    __brand: 'StrategyMemory',
    stage: 0,
    roundsInStage: 0,
    vars: {},
    prog: Object.fromEntries(progNames.map((n) => [n, { step: 0 }])),
  });

  const ctl: Ctl = { goto: null, stop: null, skip: false };
  const reasonList = [...reasons].sort();

  const runtime: StrategyRuntime = {
    def,
    stageIds,
    stopReasons: reasonList,
    createMemory: () => freshMem() as StrategyMemory,
    reset(memory) {
      const m = memory as unknown as Mem;
      m.stage = 0;
      m.roundsInStage = 0;
      m.vars = { ...(def.vars ?? {}) };
      for (const n of progNames) m.prog[n]!.step = 0;
    },
    step(memory, obs, out: StepOutput, trace?: TraceSink) {
      const m = memory as unknown as Mem;
      if (obs.window > 0) {
        m.roundsInStage++;
        feed(m, obs.last);
      }
      ctl.goto = null;
      ctl.stop = null;
      ctl.skip = false;
      const startStage = m.stage;
      const fired: string[] = [];
      for (const rule of stages[m.stage]!.rules) {
        if (!rule.when(m, obs)) continue;
        fired.push(rule.id);
        for (const fx of rule.then) fx(m, obs, ctl);
        if (ctl.goto !== null) {
          m.stage = ctl.goto;
          m.roundsInStage = 0;
          break;
        }
        if (ctl.stop !== null) break;
      }
      out.stage = m.stage;
      out.stop = ctl.stop;
      out.error = null;
      out.acts = [];
      const desired: { bet: string; amount: number }[] = [];
      if (ctl.stop === null && !ctl.skip) {
        for (const l of stages[m.stage]!.layout) {
          if (!l.when(m, obs)) continue;
          const a = l.amount(m, obs);
          if (a === null || !(a > 0)) continue;
          desired.push({ bet: l.bet, amount: Math.floor(a) });
        }
      }
      (out as { desired: Layout }).desired = desired;
      if (trace) {
        const rec: TraceWindow = {
          w: obs.window,
          stage: stageIds[startStage]!,
          obs: {},
          prog: {},
          fired,
          effects: [],
          desired: desired.map((d) => ({ ...d, source: 'layout' as const })),
          equity: obs.session.equity,
        };
        if (m.stage !== startStage) rec.stageAfter = stageIds[m.stage]!;
        if (ctl.stop !== null) rec.stop = ctl.stop;
        if (ctl.skip) rec.skip = true;
        trace.window(rec);
      }
    },
  };
  return runtime;
}

function SESSION_FACT_NAMES_OK(name: string): boolean {
  return SESSION_FACTS.has(name);
}
