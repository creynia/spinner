// compileStrategy + the interpreter (strategy.md §3, §10, §11). Compile once per worker; `step`
// mutates preallocated memory only (the trace path, off for bulk sessions, may allocate).
import type { FactValue } from '../contracts/facts';
import type { LayoutEntry } from '../contracts/game';
import type {
  CompileContext,
  Condition,
  Effect,
  Expr,
  HistoryPredicate,
  Observation,
  ProgressionSpec,
  Rule,
  StepOutput,
  StrategyDefinition,
  StrategyMemory,
  StrategyRuntime,
  TraceSink,
} from '../contracts/strategy';
import type { TraceWindow } from '../contracts/strategy-trace';
import { normalizeStrategy } from './normalize';
import { isFactError, resolveFact } from './facts';
import { DEFAULT_ON_CAP, validateStrategy } from './validate';
import {
  F_ARMED,
  F_BASE,
  F_CAPS,
  F_EVCAP,
  F_EVDONE,
  F_FED,
  F_MAX,
  F_STEP,
  FLAG_CAP,
  FLAG_DONE,
  FLAG_STOP_CAP,
  FLAG_STOP_DONE,
  LINE_REGION,
  STRIDE,
  advance,
  amountOf,
  back,
  feed,
  isInitial,
  isLevelKind,
  resetState,
  stepOf,
  traceState,
  type OnCap,
  type ProgParams,
  type SeqStep,
} from './progression';
import { StrategyCompileError } from './errors';

type Fn = () => number;
type CFn = () => boolean;
type Obj = Record<string, unknown>;

const MAX_EFFECTS = 16;
const FED_NAMES = ['none', 'win', 'loss', 'push', 'unarmed'] as const;

// ------------------------------------------------------------------ memory

interface Shape {
  stages: number;
  vars: number;
  progs: number;
  rules: number;
  trackers: number;
  ring: number;
  events: number;
  lines: number;
}

/** All mutable state of one session. Opaque outside this module. */
export class Mem {
  readonly __brand = 'StrategyMemory' as const;
  stage = 0;
  roundsInStage = 0;
  serial = 1;
  winStreak = 0;
  lossStreak = 0;
  lastResult = 0; // 0 none, 1 win, 2 loss, 3 push
  observed = 0;
  anomalies = 0;
  readonly stageEntries: Int32Array;
  readonly vars: Float64Array;
  readonly prog: Float64Array;
  readonly lines: Float64Array;
  readonly onceAt: Int32Array;
  readonly nextEligible: Int32Array;
  readonly hStreak: Int32Array;
  readonly hSince: Int32Array;
  readonly ring: Uint8Array;
  readonly ringHead: Int32Array;
  readonly ringCount: Int32Array;
  readonly hits: Uint8Array;

  constructor(readonly shape: Shape) {
    this.stageEntries = new Int32Array(shape.stages);
    this.vars = new Float64Array(shape.vars);
    this.prog = new Float64Array(shape.progs * STRIDE);
    this.lines = new Float64Array(shape.lines * LINE_REGION);
    this.onceAt = new Int32Array(shape.rules);
    this.nextEligible = new Int32Array(shape.rules);
    this.hStreak = new Int32Array(shape.trackers);
    this.hSince = new Int32Array(shape.trackers);
    this.ring = new Uint8Array(shape.ring);
    this.ringHead = new Int32Array(shape.trackers);
    this.ringCount = new Int32Array(shape.trackers);
    this.hits = new Uint8Array(shape.events);
  }

  clone(): Mem {
    const m = new Mem(this.shape);
    m.stage = this.stage;
    m.roundsInStage = this.roundsInStage;
    m.serial = this.serial;
    m.winStreak = this.winStreak;
    m.lossStreak = this.lossStreak;
    m.lastResult = this.lastResult;
    m.observed = this.observed;
    m.anomalies = this.anomalies;
    m.stageEntries.set(this.stageEntries);
    m.vars.set(this.vars);
    m.prog.set(this.prog);
    m.lines.set(this.lines);
    m.onceAt.set(this.onceAt);
    m.nextEligible.set(this.nextEligible);
    m.hStreak.set(this.hStreak);
    m.hSince.set(this.hSince);
    m.ring.set(this.ring);
    m.ringHead.set(this.ringHead);
    m.ringCount.set(this.ringCount);
    m.hits.set(this.hits);
    return m;
  }
}

/** Number of times the strategy asked for something meaningless this session (null amounts, bases). */
export function strategyAnomalies(mem: StrategyMemory): number {
  return (mem as Mem).anomalies;
}

// ------------------------------------------------------------------ compiled structures

const enum OpCode {
  Bet,
  Remove,
  Clear,
  Press,
  Set,
  Inc,
  Goto,
  Prog,
  Stop,
  Skip,
  Act,
}
const enum ProgDo {
  Win = 1,
  Loss = 2,
  Push = 3,
  Reset = 4,
  Advance = 5,
  Back = 6,
}

class Op {
  code: OpCode = OpCode.Skip;
  bet = '';
  amount: Fn | null = null;
  by: Fn | null = null;
  cap: Fn | null = null;
  parent: string | undefined = undefined;
  working: 'auto' | 'on' | 'off' | undefined = undefined;
  slot = 0; // var slot, stage index or progression index
  flag = false; // goto: reenter
  progDo: ProgDo = ProgDo.Win;
  text = ''; // stop reason, act name
  args: Record<string, string | number> | undefined = undefined;
}

interface LayoutRec {
  bet: string;
  amount: Fn;
  keepOr: boolean;
  when: CFn | null;
  parent: string | undefined;
  working: 'auto' | 'on' | 'off' | undefined;
}

interface RuleRec {
  id: string;
  when: CFn;
  ops: Op[];
  once: 0 | 1 | 2;
  cooldown: number;
}

interface StageRec {
  id: string;
  onEnter: Op[];
  onExit: Op[];
  rules: Int32Array;
  layout: LayoutRec[];
}

interface ProgRec {
  name: string;
  params: ProgParams;
  /** 0 manual, 1 round, 2 bets */
  trackKind: 0 | 1 | 2;
  bets: string[];
  always: boolean;
  base: Fn;
  step: Fn | null;
  max: Fn | null;
}

interface EvSlot {
  name: string;
  bet: string | null;
  prog: string | null;
  args: [string, string | number][] | null;
}

interface Tracker {
  held: CFn;
  n: number;
  ringOff: number;
}

// patch kinds
const P_BET = 0;
const P_REMOVE = 1;
const P_CLEAR = 2;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

function hash8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ compile

export function compileStrategy(def: StrategyDefinition, ctx: CompileContext): StrategyRuntime {
  const diags = validateStrategy(def, ctx);
  const errors = diags.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new StrategyCompileError(errors);
  return new Compiler(normalizeStrategy(def), ctx).build();
}

interface Env {
  mem: Mem;
  obs: Observation;
  mask: number;
}

class Compiler {
  readonly E: Env = { mem: null as unknown as Mem, obs: null as unknown as Observation, mask: 0 };
  private readonly unit: number;
  private readonly stageIds: string[];
  private readonly varNames: string[];
  private readonly progNames: string[];
  private readonly varSlot = new Map<string, number>();
  private readonly progIdx = new Map<string, number>();
  private readonly stageIdx = new Map<string, number>();
  private readonly factCache = new Map<string, () => FactValue | null>();
  private readonly traceFacts: { key: string; read: () => FactValue | null }[] = [];
  private readonly evSlots: EvSlot[] = [];
  private readonly evKeys = new Map<string, number>();
  private readonly trackers: Tracker[] = [];
  private readonly trackerKeys = new Map<string, number>();
  private readonly trackerInfo: string[] = [];
  private ringTotal = 0;
  private readonly stopSet = new Set<string>();
  private readonly contract = new Set<string>();
  private readonly progs: ProgRec[] = [];
  private stages: StageRec[] = [];
  private rules: RuleRec[] = [];
  private lineProgs = 0;
  private readonly histTrace: { key: string; read: Fn }[] = [];
  private readonly varTrace = new Set<string>();

  constructor(
    private readonly def: StrategyDefinition,
    private readonly ctx: CompileContext,
  ) {
    this.unit = def.unit;
    this.stageIds = def.stages.map((s) => s.id);
    this.stageIds.forEach((id, i) => this.stageIdx.set(id, i));
    this.varNames = Object.keys(def.vars ?? {}).sort();
    this.varNames.forEach((v, i) => this.varSlot.set(v, i));
    this.progNames = Object.keys(def.progressions ?? {}).sort();
    this.progNames.forEach((p, i) => this.progIdx.set(p, i));
    for (const e of ctx.catalog) if (e.contract) this.contract.add(e.id);
  }

  private bet(id: string): string {
    return this.ctx.parseBet(id) ?? id;
  }

  // ---------------------------------------------------------------- facts

  private session(name: string): () => FactValue | null {
    const E = this.E;
    const ids = this.stageIds;
    const RESULT = ['none', 'win', 'loss', 'push'];
    switch (name) {
      case 'round':
        return () => E.obs.window;
      case 'roundsInStage':
        return () => E.mem.roundsInStage;
      case 'lastResult':
        return () => RESULT[E.mem.lastResult] as string;
      case 'winStreak':
        return () => E.mem.winStreak;
      case 'lossStreak':
        return () => E.mem.lossStreak;
      case 'stage':
        return () => ids[E.mem.stage] as string;
      default:
        return () => (E.obs.session as unknown as Record<string, number>)[name] as number;
    }
  }

  private fact(ref: string): { key: string; read: () => FactValue | null } {
    const r = resolveFact(ref, this.ctx, this.stageIds);
    if (isFactError(r)) throw new Error(`unreachable: ${r.detail}`);
    const cached = this.factCache.get(r.canonical);
    if (cached) return { key: r.canonical, read: cached };
    const E = this.E;
    let read: () => FactValue | null;
    if (r.session) read = this.session(r.name);
    else {
      const acc = this.ctx.compileFact(r.canonical, this.ctx.rules);
      read =
        r.scope === 'round'
          ? () => (E.obs.last === null ? null : acc(E.obs.state, E.obs.last))
          : () => acc(E.obs.state, E.obs.last);
    }
    this.factCache.set(r.canonical, read);
    this.traceFacts.push({ key: r.canonical, read });
    return { key: r.canonical, read };
  }

  private factNum(ref: string): Fn {
    const { read } = this.fact(ref);
    return () => {
      const v = read();
      return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN;
    };
  }

  // ---------------------------------------------------------------- events and history

  private evSlot(
    name: string,
    bet: string | null,
    prog: string | null,
    args: Obj | undefined,
  ): number {
    const a = args
      ? Object.keys(args)
          .sort()
          .map((k) => [k, args[k]] as [string, string | number])
      : null;
    const key = JSON.stringify([name, bet, prog, a]);
    const found = this.evKeys.get(key);
    if (found !== undefined) return found;
    const i = this.evSlots.length;
    this.evSlots.push({ name, bet, prog, args: a });
    this.evKeys.set(key, i);
    return i;
  }

  private evFromCond(c: { event: string; bet?: string; prog?: string; args?: Obj }): number {
    return this.evSlot(
      c.event,
      c.bet === undefined ? null : this.bet(c.bet),
      c.prog ?? null,
      c.args,
    );
  }

  private predHeld(h: HistoryPredicate): CFn {
    const E = this.E;
    if ('event' in h) {
      const s = this.evFromCond(h);
      return () => E.mem.hits[s] === 1;
    }
    const { read } = this.fact(h.fact);
    const eq: FactValue[] = Array.isArray(h.equals) ? h.equals : [h.equals];
    return () => {
      const v = read();
      if (v === null) return false;
      for (let i = 0; i < eq.length; i++) if (eq[i] === v) return true;
      return false;
    };
  }

  private tracker(h: HistoryPredicate, n: number): number {
    const key = JSON.stringify([h, n]);
    const found = this.trackerKeys.get(key);
    if (found !== undefined) return found;
    const t = this.trackers.length;
    this.trackers.push({ held: this.predHeld(h), n, ringOff: this.ringTotal });
    this.ringTotal += n;
    this.trackerKeys.set(key, t);
    this.trackerInfo.push(hash8(key));
    return t;
  }

  // ---------------------------------------------------------------- expressions

  private histRead(
    kind: 'streakLen' | 'countInLast' | 'roundsSince',
    h: HistoryPredicate,
    n: number,
  ): Fn {
    const E = this.E;
    const t = this.tracker(h, kind === 'countInLast' ? n : 0);
    const label = `${kind}(${this.trackerInfo[t]})`;
    const read: Fn =
      kind === 'streakLen'
        ? () => E.mem.hStreak[t] as number
        : kind === 'roundsSince'
          ? () => E.mem.hSince[t] as number
          : () => E.mem.ringCount[t] as number;
    this.histTrace.push({ key: label, read });
    return read;
  }

  private expr(e: Expr): Fn {
    const E = this.E;
    if (typeof e === 'number') return () => e;
    if (typeof e === 'string') return this.factNum(e);
    const o = e as Obj;
    if ('units' in o) {
      const v = (o.units as number) * this.unit;
      return () => v;
    }
    if ('fact' in o) return this.factNum(o.fact as string);
    if ('var' in o) {
      const s = this.varSlot.get(o.var as string) as number;
      this.varTrace.add(o.var as string);
      return () => E.mem.vars[s] as number;
    }
    if ('prog' in o) {
      const i = this.progIdx.get(o.prog as string) as number;
      const bit = 1 << i;
      return () => {
        E.mask |= bit;
        return this.progAmount(i);
      };
    }
    if ('progStep' in o) {
      const i = this.progIdx.get(o.progStep as string) as number;
      return () => stepOf(this.progs[i]!.params, E.mem.prog, i * STRIDE, E.mem.lines);
    }
    if ('progCaps' in o) {
      const i = this.progIdx.get(o.progCaps as string) as number;
      return () => E.mem.prog[i * STRIDE + F_CAPS] as number;
    }
    if ('stageEntries' in o) {
      const i = this.stageIdx.get(o.stageEntries as string) as number;
      return () => E.mem.stageEntries[i] as number;
    }
    if ('amountOn' in o) {
      const b = this.bet(o.amountOn as string);
      return () => this.amountOn(b);
    }
    if ('lastAmount' in o || 'lastProfit' in o) {
      const profit = 'lastProfit' in o;
      const b = this.bet((profit ? o.lastProfit : o.lastAmount) as string);
      return () => {
        const last = E.obs.last;
        if (last === null) return NaN;
        const rs = last.resolutions;
        for (let i = 0; i < rs.length; i++) {
          const r = rs[i]!;
          if (r.bet === b) return profit ? r.profit : r.amount;
        }
        return 0;
      };
    }
    if ('pctOfBankroll' in o) {
      const p = o.pctOfBankroll as number;
      return () => (E.obs.session.bankroll * p) / 100;
    }
    if ('tableMin' in o || 'tableMax' in o) {
      const isMin = 'tableMin' in o;
      const x = (isMin ? o.tableMin : o.tableMax) as string;
      const id = this.ctx.parseBet(x) ?? x;
      return () => {
        const l = this.ctx.limits(id, this.ctx.rules, E.obs.state);
        return l === null ? NaN : isMin ? l.min : l.max;
      };
    }
    if ('streakLen' in o) return this.histRead('streakLen', o.streakLen as HistoryPredicate, 0);
    if ('roundsSince' in o)
      return this.histRead('roundsSince', o.roundsSince as HistoryPredicate, 0);
    if ('countInLast' in o) {
      const h = o.countInLast as HistoryPredicate & { n: number };
      return this.histRead('countInLast', h, h.n);
    }
    if ('add' in o || 'times' in o || 'max' in o || 'min' in o) {
      const op = (['add', 'times', 'max', 'min'] as const).find((k) => k in o) as
        'add' | 'times' | 'max' | 'min';
      const fs = (o[op] as Expr[]).map((x) => this.expr(x));
      const n = fs.length;
      if (n === 2) {
        const a = fs[0]!;
        const b = fs[1]!;
        switch (op) {
          case 'add':
            return () => a() + b();
          case 'times':
            return () => a() * b();
          case 'max':
            return () => Math.max(a(), b());
          default:
            return () => Math.min(a(), b());
        }
      }
      return () => {
        let acc = fs[0]!();
        for (let i = 1; i < n; i++) {
          const v = fs[i]!();
          acc =
            op === 'add'
              ? acc + v
              : op === 'times'
                ? acc * v
                : op === 'max'
                  ? Math.max(acc, v)
                  : Math.min(acc, v);
        }
        return acc;
      };
    }
    if ('sub' in o) {
      const [a, b] = (o.sub as Expr[]).map((x) => this.expr(x)) as [Fn, Fn];
      return () => a() - b();
    }
    if ('div' in o) {
      const [a, b] = (o.div as Expr[]).map((x) => this.expr(x)) as [Fn, Fn];
      return () => {
        const x = a();
        const y = b();
        return y === 0 ? NaN : x / y;
      };
    }
    if ('floorTo' in o) {
      const [a, b] = (o.floorTo as Expr[]).map((x) => this.expr(x)) as [Fn, Fn];
      return () => {
        const x = a();
        const m = b();
        return m > 0 ? Math.floor(x / m) * m : NaN;
      };
    }
    if ('abs' in o) {
      const a = this.expr(o.abs as Expr);
      return () => Math.abs(a());
    }
    if ('if' in o) {
      const t = o.if as [Condition, Expr, Expr];
      const c = this.cond(t[0]);
      const a = this.expr(t[1]);
      const b = this.expr(t[2]);
      return () => (c() ? a() : b());
    }
    throw new Error('unreachable expression');
  }

  private amountOn(b: string): number {
    const t = this.E.obs.table;
    for (let i = 0; i < t.length; i++) if (t[i]!.bet === b) return t[i]!.amount;
    return 0;
  }

  private progAmount(i: number): number {
    return amountOf(this.progs[i]!.params, this.E.mem.prog, i * STRIDE, this.E.mem.lines);
  }

  // ---------------------------------------------------------------- conditions

  private cond(c: Condition): CFn {
    const E = this.E;
    const o = c as Obj;
    if ('always' in o) return () => true;
    if ('all' in o) {
      const fs = (o.all as Condition[]).map((x) => this.cond(x));
      return () => {
        for (let i = 0; i < fs.length; i++) if (!fs[i]!()) return false;
        return true;
      };
    }
    if ('any' in o) {
      const fs = (o.any as Condition[]).map((x) => this.cond(x));
      return () => {
        for (let i = 0; i < fs.length; i++) if (fs[i]!()) return true;
        return false;
      };
    }
    if ('not' in o) {
      const f = this.cond(o.not as Condition);
      return () => !f();
    }
    if ('cmp' in o) {
      const [ea, op, eb] = o.cmp as [Expr, string, Expr];
      const a = this.expr(ea);
      const b = this.expr(eb);
      switch (op) {
        case '<':
          return () => a() < b();
        case '<=':
          return () => a() <= b();
        case '==':
          return () => a() === b();
        case '!=':
          return () => {
            const x = a();
            const y = b();
            return x === x && y === y && x !== y; // null (NaN) is false for every operator
          };
        case '>=':
          return () => a() >= b();
        default:
          return () => a() > b();
      }
    }
    if ('fact' in o) {
      const [ref, op, value] = o.fact as [string, string, FactValue | FactValue[]];
      const { read } = this.fact(ref);
      const list = Array.isArray(value) ? value : [value];
      const has = (v: FactValue): boolean => {
        for (let i = 0; i < list.length; i++) if (list[i] === v) return true;
        return false;
      };
      switch (op) {
        case '==':
          return () => {
            const v = read();
            return v !== null && v === value;
          };
        case '!=':
          return () => {
            const v = read();
            return v !== null && v !== value;
          };
        case 'in':
          return () => {
            const v = read();
            return v !== null && has(v);
          };
        case 'notIn':
          return () => {
            const v = read();
            return v !== null && !has(v);
          };
        default: {
          const t = value as number;
          const cmp = (x: number): boolean =>
            op === '<' ? x < t : op === '<=' ? x <= t : op === '>=' ? x >= t : x > t;
          return () => {
            const v = read();
            return typeof v === 'number' && cmp(v);
          };
        }
      }
    }
    if ('event' in o) {
      const s = this.evFromCond(o as { event: string });
      return () => E.mem.hits[s] === 1;
    }
    if ('onTable' in o) {
      const b = this.bet(o.onTable as string);
      return () => this.amountOn(b) > 0;
    }
    if ('streak' in o) {
      const h = o.streak as HistoryPredicate & { atLeast: number };
      const t = this.tracker(h, 0);
      const n = h.atLeast;
      return () => (E.mem.hStreak[t] as number) >= n;
    }
    if ('countInLast' in o) {
      const h = o.countInLast as HistoryPredicate & {
        n: number;
        atLeast?: number;
        atMost?: number;
        partial?: boolean;
      };
      const t = this.tracker(h, h.n);
      const { n, atLeast, atMost } = h;
      const partial = h.partial === true;
      return () => {
        if (!partial && E.mem.observed < n) return false;
        const v = E.mem.ringCount[t] as number;
        return (atLeast === undefined || v >= atLeast) && (atMost === undefined || v <= atMost);
      };
    }
    if ('since' in o) {
      const h = o.since as HistoryPredicate & { atLeast?: number; atMost?: number };
      const t = this.tracker(h, 0);
      const { atLeast, atMost } = h;
      return () => {
        const v = E.mem.hSince[t] as number;
        return (atLeast === undefined || v >= atLeast) && (atMost === undefined || v <= atMost);
      };
    }
    if ('everyN' in o) {
      const n = o.everyN as number;
      const offset = (o.offset as number | undefined) ?? 0;
      const ofStage = o.of === 'stage';
      return () => {
        const x = ofStage ? E.mem.roundsInStage : E.obs.window;
        return x >= offset && (x - offset) % n === 0;
      };
    }
    return () => false; // 'chance' is rejected by the validator
  }

  // ---------------------------------------------------------------- effects

  private ops(list: Effect[] | undefined): Op[] {
    return (list ?? []).map((e) => this.op(e));
  }

  private op(e: Effect): Op {
    const o = e as Obj;
    const op = new Op();
    if ('bet' in o) {
      op.code = OpCode.Bet;
      op.bet = this.bet(o.bet as string);
      op.amount = this.expr(o.amount as Expr);
      op.parent = o.parent === undefined ? undefined : this.bet(o.parent as string);
      op.working = o.working as Op['working'];
    } else if ('remove' in o) {
      op.code = OpCode.Remove;
      op.bet = this.bet(o.remove as string);
    } else if ('clear' in o) op.code = OpCode.Clear;
    else if ('press' in o) {
      op.code = OpCode.Press;
      op.bet = this.bet(o.press as string);
      op.by = this.expr(o.by as Expr);
      op.cap = o.cap === undefined ? null : this.expr(o.cap as Expr);
    } else if ('set' in o) {
      op.code = OpCode.Set;
      op.slot = this.varSlot.get(o.set as string) as number;
      op.text = o.set as string;
      op.amount = this.expr(o.to as Expr);
    } else if ('inc' in o) {
      op.code = OpCode.Inc;
      op.slot = this.varSlot.get(o.inc as string) as number;
      op.text = o.inc as string;
      op.amount = o.by === undefined ? () => 1 : this.expr(o.by as Expr);
    } else if ('goto' in o) {
      op.code = OpCode.Goto;
      op.slot = this.stageIdx.get(o.goto as string) as number;
      op.flag = o.reenter === true;
    } else if ('prog' in o) {
      op.code = OpCode.Prog;
      op.slot = this.progIdx.get(o.prog as string) as number;
      op.text = o.prog as string;
      op.progDo = { win: 1, loss: 2, push: 3, reset: 4, advance: 5, back: 6 }[
        o.do as string
      ] as ProgDo;
    } else if ('stop' in o) {
      op.code = OpCode.Stop;
      op.text = o.stop as string;
      this.stopSet.add(o.stop as string);
    } else if ('skipRound' in o) op.code = OpCode.Skip;
    else {
      op.code = OpCode.Act;
      op.text = o.act as string;
      op.args = o.args as Op['args'];
    }
    return op;
  }

  private layoutRec(
    l: NonNullable<StrategyDefinition['stages'][number]['layout']>[number],
  ): LayoutRec {
    const a = l.amount as Obj | number | string;
    const keepOr = isObj(a) && 'keepOr' in a;
    return {
      bet: this.bet(l.bet),
      amount: this.expr((keepOr ? a.keepOr : a) as Expr),
      keepOr,
      when: l.when === undefined ? null : this.cond(l.when),
      parent: l.parent === undefined ? undefined : this.bet(l.parent),
      working: l.working,
    };
  }

  // ---------------------------------------------------------------- progressions

  private progParams(name: string, spec: ProgressionSpec): ProgParams {
    const s = spec as unknown as Obj;
    const kind = spec.kind;
    let limit = 0;
    let mult = 2;
    let back = 2;
    switch (kind) {
      case 'martingale':
      case 'grand-martingale':
        limit = s.maxSteps as number;
        mult = (s.multiplier as number | undefined) ?? 2;
        break;
      case 'fibonacci':
        limit = (s.maxSteps as number | undefined) ?? 20;
        back = (s.back as number | undefined) ?? 2;
        break;
      case 'dalembert':
        limit = (s.maxSteps as number | undefined) ?? 50;
        break;
      case 'paroli':
        limit = (s.maxSteps as number | undefined) ?? 3;
        mult = (s.multiplier as number | undefined) ?? 2;
        break;
      case 'oscars-grind':
        limit = (s.maxSteps as number | undefined) ?? 20;
        break;
      case 'labouchere':
        limit = (s.maxLength as number | undefined) ?? 32;
        break;
      default:
        break;
    }
    const line0 = kind === 'labouchere' ? (s.line as number[]) : [];
    let lineOff = 0;
    if (kind === 'labouchere') {
      lineOff = this.lineProgs * LINE_REGION;
      this.lineProgs++;
    }
    const seq = kind === 'sequence' ? (s.amounts as Expr[]).map((x) => this.expr(x)) : [];
    const onCap = ((s.onCap as string | undefined) ?? DEFAULT_ON_CAP[kind]) as OnCap;
    if (onCap === 'stop') this.stopSet.add(`cap-${name}`);
    const onEmpty = ((s.onEmpty as string | undefined) ?? 'reset') as 'reset' | 'stop';
    if (kind === 'labouchere' && onEmpty === 'stop') this.stopSet.add(`done-${name}`);
    return {
      kind,
      limit,
      mult,
      back,
      onCap,
      onEmpty,
      line0,
      lineOff,
      seq,
      onWin: ((s.onWin as string | undefined) ?? 'stay') as SeqStep,
      onLoss: ((s.onLoss as string | undefined) ?? 'stay') as SeqStep,
      onPush: ((s.onPush as string | undefined) ?? 'stay') as SeqStep,
    };
  }

  // ---------------------------------------------------------------- build

  build(): StrategyRuntime {
    const def = this.def;
    // progressions (sorted name order)
    for (const name of this.progNames) {
      const spec = (def.progressions as Record<string, ProgressionSpec>)[name]!;
      const s = spec as unknown as Obj;
      const params = this.progParams(name, spec);
      const track = s.track as string | { bets: string[] } | undefined;
      const trackKind: 0 | 1 | 2 =
        track === 'manual' || track === undefined ? 0 : track === 'round' ? 1 : 2;
      const bets =
        trackKind === 2
          ? typeof track === 'string'
            ? [this.bet(track)]
            : (track as { bets: string[] }).bets.map((b) => this.bet(b))
          : [];
      const unit = this.unit;
      this.progs.push({
        name,
        params,
        trackKind,
        bets,
        always: s.feed === 'always',
        base:
          s.base === undefined || spec.kind === 'sequence' ? () => unit : this.expr(s.base as Expr),
        step: s.step === undefined ? null : this.expr(s.step as Expr),
        max: s.maxAmount === undefined ? null : this.expr(s.maxAmount as Expr),
      });
    }
    // stages and rules
    const declared: { stage: number; rules: RuleRec[] }[] = [];
    const allRules: RuleRec[] = [];
    const firstRule: number[] = [];
    def.stages.forEach((st, si) => {
      firstRule.push(allRules.length);
      const recs: RuleRec[] = [];
      (st.rules ?? []).forEach((r: Rule, j) => {
        const rec: RuleRec = {
          id: r.id ?? `${st.id}#${j}`,
          when: this.cond(r.when),
          ops: this.ops(r.then),
          once: r.once === true ? 1 : r.once === 'stage' ? 2 : 0,
          cooldown: r.cooldown ?? 0,
        };
        recs.push(rec);
        allRules.push(rec);
      });
      declared.push({ stage: si, rules: recs });
    });
    this.rules = allRules;
    const layouts = def.stages.map((st) => (st.layout ?? []).map((l) => this.layoutRec(l)));
    const hooks = def.stages.map((st) => ({
      enter: this.ops(st.onEnter),
      exit: this.ops(st.onExit),
    }));
    this.stages = def.stages.map((st, si) => {
      const chain: number[] = [];
      let cur: number | undefined = si;
      while (cur !== undefined) {
        chain.push(cur);
        const ext: string | undefined = def.stages[cur]!.extends;
        cur = ext === undefined ? undefined : this.stageIdx.get(ext);
      }
      const ruleIdx: number[] = [];
      const layout: LayoutRec[] = [];
      for (const c of chain) {
        const stDef = def.stages[c]!;
        (stDef.rules ?? []).forEach((r, j) => {
          if (r.enabled !== false) ruleIdx.push((firstRule[c] as number) + j);
        });
        layout.push(...(layouts[c] as LayoutRec[]));
      }
      return {
        id: st.id,
        onEnter: hooks[si]!.enter,
        onExit: hooks[si]!.exit,
        rules: Int32Array.from(ruleIdx),
        layout,
      };
    });
    return new Interp(this).runtime();
  }

  // exposed to Interp
  get data() {
    return {
      def: this.def,
      ctx: this.ctx,
      E: this.E,
      unit: this.unit,
      stageIds: this.stageIds,
      varNames: this.varNames,
      progs: this.progs,
      stages: this.stages,
      rules: this.rules,
      evSlots: this.evSlots,
      trackers: this.trackers,
      ringTotal: this.ringTotal,
      lineProgs: this.lineProgs,
      contract: this.contract,
      stopReasons: [...this.stopSet].sort(),
      traceFacts: this.traceFacts,
      histTrace: this.histTrace,
      varTrace: this.varTrace,
      progNames: this.progNames,
    };
  }
}

// ------------------------------------------------------------------ interpreter

const D_CAP = 64 + 16 + 64; // layout entries + patches + implicit keeps

class Interp {
  private readonly d: Compiler['data'];
  private readonly E: Env;
  private readonly unit: number;
  private readonly progs: ProgRec[];
  private readonly stages: StageRec[];
  private readonly rules: RuleRec[];
  private readonly shape: Shape;

  // per-window scratch
  private effects = 0;
  private skip = false;
  private stopReason: string | null = null;
  private error: { code: string; message: string; path?: string } | null = null;
  private acts: { act: string; args?: Record<string, string | number> }[] = [];
  private gotoStage = -1;
  private removed: string[] = [];
  private tracing = false;
  private tFired: string[] = [];
  private tEffects: TraceWindow['effects'] = [];
  // patches
  private pType = new Int8Array(MAX_EFFECTS);
  private pBet: string[] = new Array<string>(MAX_EFFECTS).fill('');
  private pAmt = new Float64Array(MAX_EFFECTS);
  private pMask = new Int32Array(MAX_EFFECTS);
  private pParent: (string | undefined)[] = new Array<string | undefined>(MAX_EFFECTS);
  private pWorking: (LayoutEntry['working'] | undefined)[] = new Array<
    LayoutEntry['working'] | undefined
  >(MAX_EFFECTS);
  private nPatch = 0;
  // desired buffer
  private dBet: string[] = new Array<string>(D_CAP).fill('');
  private dAmt = new Float64Array(D_CAP);
  private dMask = new Int32Array(D_CAP);
  private dSrc = new Int8Array(D_CAP);
  private dParent: (string | undefined)[] = new Array<string | undefined>(D_CAP);
  private dWorking: (LayoutEntry['working'] | undefined)[] = new Array<
    LayoutEntry['working'] | undefined
  >(D_CAP);
  private dN = 0;
  private dropped: { bet: string; reason: 'null' | 'zero' | 'negative' }[] = [];
  private readonly pool: LayoutEntry[] = [];
  private readonly view: LayoutEntry[] = [];

  constructor(c: Compiler) {
    this.d = c.data;
    this.E = this.d.E;
    this.unit = this.d.unit;
    this.progs = this.d.progs;
    this.stages = this.d.stages;
    this.rules = this.d.rules;
    for (let i = 0; i < D_CAP; i++) this.pool.push({ bet: '', amount: 0 });
    this.shape = {
      stages: this.stages.length,
      vars: this.d.varNames.length,
      progs: this.progs.length,
      rules: this.rules.length,
      trackers: this.d.trackers.length,
      ring: Math.max(1, this.d.ringTotal),
      events: Math.max(1, this.d.evSlots.length),
      lines: this.d.lineProgs,
    };
  }

  runtime(): StrategyRuntime & { stepInternal: Interp['step'] } {
    return {
      def: this.d.def,
      stageIds: this.d.stageIds,
      stopReasons: this.d.stopReasons,
      createMemory: () => new Mem(this.shape),
      reset: (m) => this.reset(m as unknown as Mem),
      step: (m, obs, out, trace) => this.step(m as unknown as Mem, obs, out, trace),
      stepInternal: (m, obs, out, trace) => this.step(m, obs, out, trace),
    };
  }

  // ---------------------------------------------------------------- reset

  private reset(m: Mem): void {
    m.stage = 0;
    m.roundsInStage = 0;
    m.serial = 1;
    m.winStreak = 0;
    m.lossStreak = 0;
    m.lastResult = 0;
    m.observed = 0;
    m.anomalies = 0;
    m.stageEntries.fill(0);
    m.stageEntries[0] = 1;
    m.onceAt.fill(0);
    m.nextEligible.fill(0);
    m.hStreak.fill(0);
    m.hSince.fill(0);
    m.ring.fill(0);
    m.ringHead.fill(0);
    m.ringCount.fill(0);
    m.hits.fill(0);
    const vars = this.d.def.vars ?? {};
    this.d.varNames.forEach((n, i) => (m.vars[i] = vars[n] as number));
    for (let i = 0; i < this.progs.length; i++) {
      const o = i * STRIDE;
      const f = m.prog;
      f.fill(0, o, o + STRIDE);
      f[o + F_BASE] = this.unit;
      f[o + F_STEP] = this.unit;
      f[o + F_MAX] = Infinity;
      resetState(this.progs[i]!.params, f, o, m.lines);
    }
  }

  // ---------------------------------------------------------------- latching

  private latch(i: number, silent: boolean): void {
    const m = this.E.mem;
    const p = this.progs[i]!;
    const f = m.prog;
    const o = i * STRIDE;
    const b = Math.floor(p.base());
    if (b > 0 && Number.isFinite(b)) f[o + F_BASE] = b;
    else if (!silent) m.anomalies++;
    if (p.step) {
      const s = Math.floor(p.step());
      if (s > 0 && Number.isFinite(s)) f[o + F_STEP] = s;
      else if (!silent) m.anomalies++;
    } else f[o + F_STEP] = f[o + F_BASE] as number;
    if (p.max) {
      const x = Math.floor(p.max());
      f[o + F_MAX] = x > 0 && Number.isFinite(x) ? x : Infinity;
    }
  }

  private relatch(silent: boolean): void {
    const m = this.E.mem;
    for (let i = 0; i < this.progs.length; i++)
      if (isInitial(this.progs[i]!.params, m.prog, i * STRIDE)) this.latch(i, silent);
  }

  // ---------------------------------------------------------------- events

  private raise(name: 'prog-cap' | 'prog-done', progName: string): void {
    const slots = this.d.evSlots;
    const hits = this.E.mem.hits;
    for (let s = 0; s < slots.length; s++) {
      const e = slots[s]!;
      if (e.name === name && (e.prog === null || e.prog === progName)) hits[s] = 1;
    }
  }

  /** Applies feed flags: events, counters. Returns true when the window must stop. */
  private flags(i: number, flags: number): boolean {
    if (flags === 0) return false;
    const f = this.E.mem.prog;
    const o = i * STRIDE;
    const name = this.progs[i]!.name;
    if (flags & FLAG_CAP) {
      f[o + F_EVCAP] = 1;
      this.raise('prog-cap', name);
    }
    if (flags & FLAG_DONE) {
      f[o + F_EVDONE] = 1;
      this.raise('prog-done', name);
    }
    if (flags & FLAG_STOP_CAP) {
      this.stopReason = `cap-${name}`;
      return true;
    }
    if (flags & FLAG_STOP_DONE) {
      this.stopReason = `done-${name}`;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- step

  private step(m: Mem, obs: Observation, out: StepOutput, sink?: TraceSink): void {
    const E = this.E;
    E.mem = m;
    E.obs = obs;
    const w = obs.window;
    this.effects = 0;
    this.skip = false;
    this.stopReason = null;
    this.error = null;
    this.acts.length = 0;
    this.gotoStage = -1;
    this.removed.length = 0;
    this.nPatch = 0;
    this.dN = 0;
    this.dropped.length = 0;
    this.tracing = sink !== undefined;
    let tFed: Record<string, string> | null = null;
    if (this.tracing) {
      this.tFired = [];
      this.tEffects = [];
      tFed = {};
    }
    const startStage = m.stage;
    const anomalies0 = m.anomalies;
    let ended = false;

    m.hits.fill(0);
    for (let i = 0; i < this.progs.length; i++) {
      m.prog[i * STRIDE + F_EVCAP] = 0;
      m.prog[i * STRIDE + F_EVDONE] = 0;
      m.prog[i * STRIDE + F_FED] = 0;
    }

    if (w === 0) {
      this.relatch(true);
      const st = this.stages[m.stage]!;
      if (st.onEnter.length > 0) {
        if (this.tracing) this.tFired.push(`@enter:${st.id}`);
        ended = this.run(st.onEnter, `@enter:${st.id}`) !== 0;
      }
    } else if (obs.last !== null) this.observe(m, obs);

    if (!ended && w > 0) ended = this.feedAll(m, obs, tFed);
    if (!ended) this.relatch(false);

    let traceObs: Record<string, number | string | boolean | null> | undefined;
    if (!ended) {
      if (this.tracing) traceObs = this.traceObs();
      ended = this.rulesPhase(m, w);
    }

    const stopped = this.stopReason !== null || this.error !== null;
    this.view.length = 0;
    if (!stopped) {
      this.layoutPhase(m, obs);
      if (this.error === null) {
        for (let i = 0; i < this.dN; i++) {
          const e = this.pool[i]!;
          e.bet = this.dBet[i]!;
          e.amount = this.dAmt[i]!;
          e.parent = this.dParent[i];
          e.working = this.dWorking[i];
          this.view.push(e);
        }
        this.arm(m, obs);
      }
    }
    if (this.error !== null || this.stopReason !== null) this.view.length = 0;
    void ended;

    out.stage = m.stage;
    out.desired = this.view;
    out.acts = this.error === null && this.stopReason === null ? this.acts : EMPTY_ACTS;
    out.stop = this.stopReason;
    out.error = this.error;
    out.anomalies = m.anomalies - anomalies0;

    if (sink) sink.window(this.buildTrace(m, obs, startStage, traceObs ?? {}, tFed ?? {}));
  }

  // ---------------------------------------------------------------- phase 1

  private observe(m: Mem, obs: Observation): void {
    const last = obs.last!;
    // events: plugin events, then core events derived from resolutions
    const slots = this.d.evSlots;
    const hits = m.hits;
    const events = last.events;
    for (let s = 0; s < slots.length; s++) {
      const e = slots[s]!;
      if (e.name === 'prog-cap' || e.name === 'prog-done') continue;
      if (e.name === 'bet-won' || e.name === 'bet-lost' || e.name === 'bet-push') {
        const rs = last.resolutions;
        for (let i = 0; i < rs.length; i++) {
          const r = rs[i]!;
          if (r.result === 'stays') continue;
          const name = r.profit > 0 ? 'bet-won' : r.profit < 0 ? 'bet-lost' : 'bet-push';
          if (name === e.name && (e.bet === null || e.bet === r.bet)) hits[s] = 1;
        }
        continue;
      }
      for (let i = 0; i < events.length; i++) {
        const ev = events[i]! as unknown as Record<string, unknown>;
        if (ev.type !== e.name) continue;
        if (e.bet !== null && ev.bet !== e.bet) continue;
        if (e.args !== null) {
          let ok = true;
          for (let a = 0; a < e.args.length; a++) {
            const kv = e.args[a]!;
            if (ev[kv[0]] !== kv[1]) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
        }
        hits[s] = 1;
        break;
      }
    }
    // history trackers
    const ts = this.d.trackers;
    for (let t = 0; t < ts.length; t++) {
      const tr = ts[t]!;
      const held = tr.held();
      m.hStreak[t] = held ? (m.hStreak[t] as number) + 1 : 0;
      m.hSince[t] = held ? 0 : (m.hSince[t] as number) + 1;
      if (tr.n > 0) {
        const head = m.ringHead[t] as number;
        const at = tr.ringOff + head;
        if (m.observed >= tr.n)
          m.ringCount[t] = (m.ringCount[t] as number) - (m.ring[at] as number);
        m.ring[at] = held ? 1 : 0;
        if (held) m.ringCount[t] = (m.ringCount[t] as number) + 1;
        m.ringHead[t] = head + 1 === tr.n ? 0 : head + 1;
      }
    }
    m.observed += 1;
    // session-derived facts
    let anyResolved = false;
    for (let i = 0; i < last.resolutions.length; i++)
      if (last.resolutions[i]!.result !== 'stays') anyResolved = true;
    if (last.net > 0) {
      m.lastResult = 1;
      m.winStreak += 1;
      m.lossStreak = 0;
    } else if (last.net < 0) {
      m.lastResult = 2;
      m.lossStreak += 1;
      m.winStreak = 0;
    } else m.lastResult = anyResolved ? 3 : 0;
    m.roundsInStage += 1;
  }

  // ---------------------------------------------------------------- phase 2

  private feedAll(m: Mem, obs: Observation, tFed: Record<string, string> | null): boolean {
    const last = obs.last;
    if (last === null) return false;
    const f = m.prog;
    for (let i = 0; i < this.progs.length; i++) {
      const p = this.progs[i]!;
      if (p.trackKind === 0) continue;
      const o = i * STRIDE;
      const armed = f[o + F_ARMED] as number;
      let profit = 0;
      let stake = 0;
      let considered = 0;
      let unarmed = false;
      let resolvedBits = 0;
      const rs = last.resolutions;
      if (p.trackKind === 2) {
        for (let r = 0; r < rs.length; r++) {
          const res = rs[r]!;
          if (res.result === 'stays') continue;
          const idx = p.bets.indexOf(res.bet);
          if (idx < 0) continue;
          resolvedBits |= 1 << idx;
          if (p.always || (armed & (1 << idx)) !== 0) {
            profit += res.profit;
            stake += res.amount;
            considered++;
          } else unarmed = true;
        }
        f[o + F_ARMED] = armed & ~resolvedBits;
      } else {
        let any = false;
        for (let r = 0; r < rs.length; r++) {
          if (rs[r]!.result === 'stays') continue;
          any = true;
          stake += rs[r]!.amount;
        }
        if (any) {
          if (p.always || (armed & 1) !== 0) {
            profit = last.net;
            considered = 1;
          } else unarmed = true;
          f[o + F_ARMED] = 0;
        }
      }
      let code = 0;
      if (considered > 0) code = profit > 0 ? 1 : profit < 0 ? 2 : 3;
      else if (unarmed) code = 4;
      f[o + F_FED] = code;
      if (code >= 1 && code <= 3) {
        const flags = feed(p.params, f, o, m.lines, code, profit, stake);
        if (this.flags(i, flags)) {
          if (tFed) tFed[p.name] = FED_NAMES[code] as string;
          return true;
        }
      }
      if (tFed) tFed[p.name] = FED_NAMES[code] as string;
    }
    return false;
  }

  // ---------------------------------------------------------------- phase 3

  private rulesPhase(m: Mem, w: number): boolean {
    const st = this.stages[m.stage]!;
    const idx = st.rules;
    for (let k = 0; k < idx.length; k++) {
      const ri = idx[k]!;
      const r = this.rules[ri]!;
      if (r.once === 1 && m.onceAt[ri] !== 0) continue;
      if (r.once === 2 && m.onceAt[ri] === m.serial) continue;
      if (w < (m.nextEligible[ri] as number)) continue;
      if (!r.when()) continue;
      if (r.once !== 0) m.onceAt[ri] = r.once === 2 ? m.serial : 1;
      if (r.cooldown > 0) m.nextEligible[ri] = w + r.cooldown + 1;
      if (this.tracing) this.tFired.push(r.id);
      if (this.run(r.ops, r.id) !== 0) return true;
    }
    return false;
  }

  /** Runs an effect list. Returns 0 to continue, 1 after a stage change, 2 on stop/error. */
  private run(ops: Op[], ruleId: string): number {
    for (let i = 0; i < ops.length; i++) {
      if (this.effects >= MAX_EFFECTS) {
        this.error = {
          code: 'E_RT_EFFECT_CAP',
          message: `more than ${MAX_EFFECTS} effects in one window`,
        };
        return 2;
      }
      this.effects++;
      const s = this.exec(ops[i]!, ruleId);
      if (s !== 0) return s;
    }
    return 0;
  }

  private note(
    rule: string,
    op: string,
    detail: Record<string, number | string>,
    note?: TraceWindow['effects'][number]['note'],
  ): void {
    if (!this.tracing) return;
    const rec: TraceWindow['effects'][number] = { rule, op, detail };
    if (note) rec.note = note;
    this.tEffects.push(rec);
  }

  private patch(
    type: number,
    bet: string,
    amt: number,
    mask: number,
    parent: string | undefined,
    working: LayoutEntry['working'] | undefined,
  ): void {
    const n = this.nPatch++;
    this.pType[n] = type;
    this.pBet[n] = bet;
    this.pAmt[n] = amt;
    this.pMask[n] = mask;
    this.pParent[n] = parent;
    this.pWorking[n] = working;
  }

  private nonFinite(): number {
    this.error = { code: 'E_RT_NONFINITE', message: 'an expression overflowed to infinity' };
    return 2;
  }

  private exec(op: Op, rule: string): number {
    const E = this.E;
    const m = E.mem;
    const ign = this.skip ? 'ignored-skip' : undefined;
    switch (op.code) {
      case OpCode.Bet: {
        E.mask = 0;
        const a = (op.amount as Fn)();
        if (a === Infinity || a === -Infinity) return this.nonFinite();
        this.patch(P_BET, op.bet, a, E.mask, op.parent, op.working);
        this.note(rule, 'bet', { bet: op.bet, amount: Number.isNaN(a) ? 'null' : a }, ign);
        return 0;
      }
      case OpCode.Remove:
        this.removed.push(op.bet);
        this.patch(P_REMOVE, op.bet, 0, 0, undefined, undefined);
        this.note(rule, 'remove', { bet: op.bet }, ign);
        return 0;
      case OpCode.Clear:
        this.patch(P_CLEAR, '', 0, 0, undefined, undefined);
        this.note(rule, 'clear', {}, ign);
        return 0;
      case OpCode.Press: {
        const on = this.amountOn(op.bet);
        if (!(on > 0)) {
          this.note(rule, 'press', { bet: op.bet }, 'not-on-table');
          return 0;
        }
        E.mask = 0;
        const by = (op.by as Fn)();
        let v = on + by;
        if (op.cap) {
          const c = op.cap();
          if (c === c) v = Math.min(v, c);
        }
        if (v === Infinity || v === -Infinity) return this.nonFinite();
        if (v !== v) {
          this.note(rule, 'press', { bet: op.bet }, 'null-skipped');
          return 0;
        }
        this.patch(P_BET, op.bet, v, E.mask, undefined, undefined);
        this.note(rule, 'press', { bet: op.bet, amount: v }, ign);
        return 0;
      }
      case OpCode.Set:
      case OpCode.Inc: {
        const cur = m.vars[op.slot] as number;
        const v = (op.amount as Fn)();
        const next = op.code === OpCode.Set ? v : cur + v;
        if (next === Infinity || next === -Infinity) return this.nonFinite();
        if (next !== next) {
          m.anomalies++;
          this.note(
            rule,
            op.code === OpCode.Set ? 'set' : 'inc',
            { var: op.text, from: cur },
            'null-skipped',
          );
          return 0;
        }
        m.vars[op.slot] = next;
        this.note(rule, op.code === OpCode.Set ? 'set' : 'inc', {
          var: op.text,
          from: cur,
          to: next,
        });
        return 0;
      }
      case OpCode.Goto:
        return this.doGoto(op, rule);
      case OpCode.Prog:
        return this.doProg(op, rule);
      case OpCode.Stop:
        this.stopReason = op.text;
        this.note(rule, 'stop', { reason: op.text });
        return 2;
      case OpCode.Skip:
        this.skip = true;
        this.note(rule, 'skipRound', {});
        return 0;
      default: {
        const a: { act: string; args?: Record<string, string | number> } = { act: op.text };
        if (op.args) a.args = op.args;
        this.acts.push(a);
        this.note(rule, 'act', { act: op.text }, ign);
        return 0;
      }
    }
  }

  private doGoto(op: Op, rule: string): number {
    const m = this.E.mem;
    const target = op.slot;
    const tid = this.stages[target]!.id;
    if (target === m.stage && !op.flag) {
      this.note(rule, 'goto', { stage: tid }, 'no-op');
      return 0;
    }
    this.note(rule, 'goto', { stage: tid });
    const from = this.stages[m.stage]!;
    if (from.onExit.length > 0) {
      if (this.tracing) this.tFired.push(`@exit:${from.id}`);
      const s = this.run(from.onExit, `@exit:${from.id}`);
      if (s !== 0) return s;
    }
    this.gotoStage = target;
    m.stage = target;
    m.roundsInStage = 0;
    m.stageEntries[target] = (m.stageEntries[target] as number) + 1;
    m.serial += 1;
    const to = this.stages[target]!;
    if (to.onEnter.length > 0) {
      if (this.tracing) this.tFired.push(`@enter:${to.id}`);
      const s = this.run(to.onEnter, `@enter:${to.id}`);
      if (s !== 0) return s;
    }
    return 1;
  }

  private doProg(op: Op, rule: string): number {
    const m = this.E.mem;
    const i = op.slot;
    const p = this.progs[i]!;
    const f = m.prog;
    const o = i * STRIDE;
    this.note(rule, 'prog', {
      prog: op.text,
      do: ['', 'win', 'loss', 'push', 'reset', 'advance', 'back'][op.progDo] as string,
    });
    switch (op.progDo) {
      case ProgDo.Reset:
        resetState(p.params, f, o, m.lines);
        f[o + F_CAPS] = f[o + F_CAPS] as number;
        this.latch(i, false);
        return 0;
      case ProgDo.Advance:
        if (isLevelKind(p.params.kind))
          return this.flags(i, advance(p.params, f, o, m.lines)) ? 2 : 0;
        return 0;
      case ProgDo.Back:
        if (isLevelKind(p.params.kind)) back(f, o);
        return 0;
      default: {
        const amt = amountOf(p.params, f, o, m.lines);
        const a = Number.isFinite(amt) ? amt : 0;
        const flags = feed(p.params, f, o, m.lines, op.progDo, a, a);
        return this.flags(i, flags) ? 2 : 0;
      }
    }
  }

  // ---------------------------------------------------------------- phase 4

  private find(bet: string): number {
    for (let i = 0; i < this.dN; i++) if (this.dBet[i] === bet) return i;
    return -1;
  }

  private layoutPhase(m: Mem, obs: Observation): void {
    const E = this.E;
    const table = obs.table;
    this.dropped.length = 0;
    if (this.skip) {
      for (let i = 0; i < table.length && this.dN < D_CAP; i++)
        this.add(table[i]!.bet, table[i]!.amount, 0, 2, table[i]!.parent, table[i]!.working);
      return;
    }
    const lay = this.stages[m.stage]!.layout;
    for (let i = 0; i < lay.length; i++) {
      const l = lay[i]!;
      if (this.find(l.bet) >= 0) continue;
      if (l.when !== null && !l.when()) continue;
      E.mask = 0;
      let a: number;
      let mask: number;
      if (l.keepOr) {
        const on = this.amountOn(l.bet);
        if (on > 0) {
          a = on;
          mask = -1;
        } else {
          a = l.amount();
          mask = E.mask;
        }
      } else {
        a = l.amount();
        mask = E.mask;
      }
      this.add(l.bet, a, mask, 0, l.parent, l.working);
    }
    for (let k = 0; k < this.nPatch; k++) {
      const type = this.pType[k];
      if (type === P_CLEAR) this.dN = 0;
      else if (type === P_REMOVE) {
        const j = this.find(this.pBet[k]!);
        if (j >= 0) this.removeAt(j);
      } else {
        const j = this.find(this.pBet[k]!);
        if (j >= 0) {
          this.dAmt[j] = this.pAmt[k]!;
          this.dMask[j] = this.pMask[k]!;
          this.dSrc[j] = 1;
          if (this.pParent[k] !== undefined) this.dParent[j] = this.pParent[k];
          if (this.pWorking[k] !== undefined) this.dWorking[j] = this.pWorking[k];
        } else
          this.add(
            this.pBet[k]!,
            this.pAmt[k]!,
            this.pMask[k]!,
            1,
            this.pParent[k],
            this.pWorking[k],
          );
      }
    }
    for (let i = 0; i < table.length; i++) {
      const t = table[i]!;
      if (!this.d.contract.has(t.bet)) continue;
      if (this.find(t.bet) >= 0 || this.removed.includes(t.bet)) continue;
      this.add(t.bet, t.amount, 0, 2, t.parent, t.working);
    }
    // amount boundary
    let n = 0;
    for (let i = 0; i < this.dN; i++) {
      const a = this.dAmt[i]!;
      if (a === Infinity || a === -Infinity) {
        this.nonFinite();
        return;
      }
      if (a !== a) {
        m.anomalies++;
        if (this.tracing) this.dropped.push({ bet: this.dBet[i]!, reason: 'null' });
        continue;
      }
      const fl = Math.floor(a);
      if (fl <= 0) {
        if (this.tracing)
          this.dropped.push({ bet: this.dBet[i]!, reason: fl === 0 ? 'zero' : 'negative' });
        continue;
      }
      if (n !== i) {
        this.dBet[n] = this.dBet[i]!;
        this.dMask[n] = this.dMask[i]!;
        this.dSrc[n] = this.dSrc[i]!;
        this.dParent[n] = this.dParent[i];
        this.dWorking[n] = this.dWorking[i];
      }
      this.dAmt[n] = fl;
      n++;
    }
    this.dN = n;
  }

  private add(
    bet: string,
    amt: number,
    mask: number,
    src: number,
    parent: string | undefined,
    working: LayoutEntry['working'] | undefined,
  ): void {
    if (this.dN >= D_CAP) return;
    const n = this.dN++;
    this.dBet[n] = bet;
    this.dAmt[n] = amt;
    this.dMask[n] = mask;
    this.dSrc[n] = src;
    this.dParent[n] = parent;
    this.dWorking[n] = working;
  }

  private removeAt(j: number): void {
    for (let i = j; i < this.dN - 1; i++) {
      this.dBet[i] = this.dBet[i + 1]!;
      this.dAmt[i] = this.dAmt[i + 1]!;
      this.dMask[i] = this.dMask[i + 1]!;
      this.dSrc[i] = this.dSrc[i + 1]!;
      this.dParent[i] = this.dParent[i + 1];
      this.dWorking[i] = this.dWorking[i + 1];
    }
    this.dN--;
  }

  /** Arming (§7.2, step 4.6). */
  private arm(m: Mem, obs: Observation): void {
    const f = m.prog;
    for (let i = 0; i < this.progs.length; i++) {
      const p = this.progs[i]!;
      if (p.trackKind === 0 || p.always) continue;
      const o = i * STRIDE;
      const bit = 1 << i;
      let armed = f[o + F_ARMED] as number;
      if (p.trackKind === 1) {
        let any = false;
        for (let e = 0; e < this.dN; e++)
          if (this.dSrc[e] !== 2 && (this.dMask[e]! & bit) !== 0) any = true;
        armed = any ? 1 : 0;
      } else {
        for (let b = 0; b < p.bets.length; b++) {
          const name = p.bets[b]!;
          const j = this.find(name);
          if (j >= 0 && this.dSrc[j] !== 2) {
            const mask = this.dMask[j]!;
            if (mask === -1) continue;
            armed = (mask & bit) !== 0 ? armed | (1 << b) : armed & ~(1 << b);
          } else if (this.amountOnTable(obs, name) <= 0) armed &= ~(1 << b);
        }
      }
      f[o + F_ARMED] = armed;
    }
  }

  private amountOn(b: string): number {
    return this.amountOnTable(this.E.obs, b);
  }

  private amountOnTable(obs: Observation, b: string): number {
    const t = obs.table;
    for (let i = 0; i < t.length; i++) if (t[i]!.bet === b) return t[i]!.amount;
    return 0;
  }

  // ---------------------------------------------------------------- trace

  private traceObs(): Record<string, number | string | boolean | null> {
    const out: Record<string, number | string | boolean | null> = {};
    for (const t of this.d.traceFacts) out[t.key] = t.read();
    for (const v of [...this.d.varTrace].sort()) {
      const slot = this.d.varNames.indexOf(v);
      out[`var.${v}`] = this.E.mem.vars[slot] as number;
    }
    for (const h of this.d.histTrace) out[h.key] = h.read();
    return out;
  }

  private buildTrace(
    m: Mem,
    obs: Observation,
    startStage: number,
    traceObs: Record<string, number | string | boolean | null>,
    fed: Record<string, string>,
  ): TraceWindow {
    const prog: TraceWindow['prog'] = {};
    for (let i = 0; i < this.progs.length; i++) {
      const p = this.progs[i]!;
      const o = i * STRIDE;
      const events: ('cap' | 'done')[] = [];
      if (m.prog[o + F_EVCAP]) events.push('cap');
      if (m.prog[o + F_EVDONE]) events.push('done');
      const amt = amountOf(p.params, m.prog, o, m.lines);
      const rec: TraceWindow['prog'][string] = {
        fed: (fed[p.name] ?? 'none') as 'win' | 'loss' | 'push' | 'none' | 'unarmed',
        state: traceState(p.params, m.prog, o, m.lines),
        amount: Number.isFinite(amt) ? amt : 0,
      };
      if (events.length > 0) rec.events = events;
      prog[p.name] = rec;
    }
    const desired: TraceWindow['desired'] = [];
    if (this.stopReason === null && this.error === null)
      for (let i = 0; i < this.dN; i++) {
        const e: TraceWindow['desired'][number] = {
          bet: this.dBet[i]!,
          amount: this.dAmt[i]!,
          source: (['layout', 'patch', 'keep'] as const)[this.dSrc[i]!]!,
        };
        if (this.dParent[i] !== undefined) e.parent = this.dParent[i]!;
        desired.push(e);
      }
    const rec: TraceWindow = {
      w: obs.window,
      stage: this.stages[startStage]!.id,
      obs: traceObs,
      prog,
      fired: this.tFired,
      effects: this.tEffects,
      desired,
      equity: obs.session.equity,
    };
    if (this.gotoStage >= 0) rec.stageAfter = this.stages[this.gotoStage]!.id;
    if (this.dropped.length > 0) rec.dropped = this.dropped.slice();
    if (this.acts.length > 0 && this.stopReason === null && this.error === null)
      rec.acts = this.acts.map((a) => ({ ...a }));
    if (this.skip) rec.skip = true;
    if (this.stopReason !== null) rec.stop = this.stopReason;
    if (this.error !== null) rec.error = { code: this.error.code, message: this.error.message };
    return rec;
  }
}

const EMPTY_ACTS: readonly { act: string; args?: Record<string, string | number> }[] = [];

// ------------------------------------------------------------------ stepPure

/** Clones memory first; for tests (strategy.md §11.3). */
export function stepPure(
  rt: StrategyRuntime,
  mem: StrategyMemory,
  obs: Observation,
): { mem: StrategyMemory; out: StepOutput; trace: TraceWindow | null } {
  const m = (mem as unknown as Mem).clone();
  const out: StepOutput = { stage: 0, desired: [], acts: [], stop: null, error: null };
  let trace: TraceWindow | null = null;
  rt.step(m, obs, out, {
    window: (rec) => {
      trace = rec;
    },
  });
  const copy: StepOutput = {
    stage: out.stage,
    desired: out.desired.map((e) => ({ ...e })),
    acts: out.acts.map((a) => ({ ...a })),
    stop: out.stop,
    error: out.error ? { ...out.error } : null,
  };
  return { mem: m, out: copy, trace };
}
