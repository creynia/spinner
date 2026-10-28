// validateStrategy (strategy.md §9): every diagnostic, in document order, never throws.
import type { BetCatalogEntry } from '../contracts/game';
import type { CompileContext, Diagnostic } from '../contracts/strategy';
import { MAX_STOP_REASONS, RESERVED_STOP_REASONS } from '../contracts/strategy';
import { diagnostic } from './messages';
import {
  BET_EVENTS,
  CORE_EVENTS,
  PROG_EVENTS,
  isFactError,
  resolveFact,
  type ResolvedFact,
} from './facts';

/** `CompileContext` plus the plugin id, so `E_GAME_MISMATCH` can be reported (additive, optional). */
export type ValidationContext = CompileContext & { gameId?: string };

const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const VARNAME = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const MAX_CENTS = 2 ** 31 - 1;

type Obj = Record<string, unknown>;
type Kind = 'money' | 'count' | 'scalar';

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const esc = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');
const at = (path: string, key: string | number): string => `${path}/${esc(String(key))}`;
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const ROOT_KEYS = [
  'schema',
  'kind',
  'id',
  'name',
  'game',
  'notes',
  'tags',
  'unit',
  'vars',
  'progressions',
  'stages',
];
const STAGE_KEYS = ['id', 'label', 'extends', 'layout', 'onEnter', 'onExit', 'rules'];
const LAYOUT_KEYS = ['bet', 'amount', 'when', 'parent', 'working', 'label'];
const RULE_KEYS = ['id', 'label', 'enabled', 'when', 'then', 'once', 'cooldown'];

const EXPR_KEYS = [
  'units',
  'fact',
  'var',
  'prog',
  'progStep',
  'progCaps',
  'stageEntries',
  'amountOn',
  'lastAmount',
  'lastProfit',
  'pctOfBankroll',
  'tableMin',
  'tableMax',
  'streakLen',
  'countInLast',
  'roundsSince',
  'add',
  'times',
  'max',
  'min',
  'sub',
  'div',
  'floorTo',
  'abs',
  'if',
];
const COND_KEYS: Record<string, string[]> = {
  always: [],
  all: [],
  any: [],
  not: [],
  cmp: [],
  fact: [],
  event: ['bet', 'prog', 'args'],
  onTable: [],
  streak: [],
  countInLast: [],
  since: [],
  everyN: ['offset', 'of'],
  chance: [],
};
const EFFECT_KEYS: Record<string, string[]> = {
  bet: ['amount', 'parent', 'working'],
  remove: [],
  clear: [],
  press: ['by', 'cap'],
  set: ['to'],
  inc: ['by'],
  goto: ['reenter'],
  prog: ['do'],
  stop: [],
  skipRound: [],
  act: ['args'],
};
const CMP_OPS = ['<', '<=', '==', '!=', '>=', '>'];
const FACT_OPS = [...CMP_OPS, 'in', 'notIn'];
const CAP_POLICIES = ['reset', 'stay', 'stop'];
const SEQ_STEPS = ['advance', 'back', 'reset', 'stay'];

const PROG_COMMON = ['kind', 'track', 'feed', 'base', 'maxAmount', 'onCap'];
const PROG_KEYS: Record<string, string[]> = {
  flat: [],
  martingale: ['maxSteps', 'multiplier'],
  'grand-martingale': ['maxSteps'],
  fibonacci: ['maxSteps', 'back'],
  dalembert: ['maxSteps', 'step'],
  paroli: ['maxSteps', 'multiplier'],
  '1-3-2-6': [],
  'oscars-grind': ['maxSteps'],
  labouchere: ['line', 'onEmpty', 'maxLength'],
  sequence: ['amounts', 'onWin', 'onLoss', 'onPush'],
};
const ALL_PROG_KEYS = new Set([...PROG_COMMON, ...Object.values(PROG_KEYS).flat()]);

/** Default `onCap` per kind (strategy.md §7.4). */
export const DEFAULT_ON_CAP: Record<string, string> = {
  flat: 'reset',
  martingale: 'reset',
  'grand-martingale': 'reset',
  fibonacci: 'reset',
  dalembert: 'stay',
  paroli: 'reset',
  '1-3-2-6': 'reset',
  'oscars-grind': 'stay',
  labouchere: 'reset',
  sequence: 'stay',
};

function combine(a: Kind, b: Kind): Kind {
  if (a === b) return a;
  if (a === 'scalar') return b;
  if (b === 'scalar') return a;
  return 'money'; // money vs count: the caller warns
}

interface LayoutInfo {
  path: string;
  bet: string | null;
  entry: BetCatalogEntry | null;
  constAmount: number | null;
  progs: string[];
  keep: boolean;
}

interface StageInfo {
  id: string;
  index: number;
  extendsId: string | null;
  layout: LayoutInfo[];
  ruleThenCounts: number[];
  onEnter: number;
  onExit: number;
  gotos: string[];
  ownRules: number;
}

interface ProgInfo {
  name: string;
  path: string;
  kind: string;
  track: string[] | 'round' | 'manual' | null;
  trackPath: string;
  top: number | null;
  edges: { to: string; path: string }[];
  onCap: string;
  onEmpty: string;
}

class Validator {
  readonly diags: Diagnostic[] = [];
  private nodes = 0;
  private readonly stageIds: string[] = [];
  private readonly varNames = new Set<string>();
  private readonly progNames = new Set<string>();
  private readonly ruleIds = new Set<string>();
  private readonly predicates = new Set<string>();
  private readonly stopReasons = new Set<string>();
  private readonly catalog = new Map<string, BetCatalogEntry>();
  private unit = 0;
  // analysis
  private readonly stages: StageInfo[] = [];
  private readonly progs = new Map<string, ProgInfo>();
  private readonly varReads = new Set<string>();
  private readonly progReads = new Set<string>();
  private readonly gotoTargets = new Set<string>();
  private hasBetEffect = false;
  private curStage: StageInfo | null = null;
  private curProgEdges: { to: string; path: string }[] | null = null;
  private progOwner = '';

  constructor(
    private readonly def: unknown,
    private readonly ctx: ValidationContext | null,
  ) {
    if (ctx) for (const e of ctx.catalog) this.catalog.set(e.id, e);
  }

  private err(code: string, path: string, params?: Record<string, string | number>): void {
    this.diags.push(diagnostic(code, path, params));
  }

  private typeErr(path: string, expected: string): void {
    this.err('E_TYPE', path, { expected });
  }

  run(): Diagnostic[] {
    const d = this.def;
    if (!isObj(d)) {
      this.typeErr('', 'object');
      return this.diags;
    }
    try {
      if (JSON.stringify(d).length > 65536)
        this.err('E_LIMIT', '', { detail: 'canonical JSON over 64 KiB' });
    } catch {
      this.typeErr('', 'JSON-serialisable object');
    }
    // Pre-pass: symbol tables, so forward references resolve.
    if (Array.isArray(d.stages))
      for (const s of d.stages) if (isObj(s) && typeof s.id === 'string') this.stageIds.push(s.id);
    if (isObj(d.vars)) for (const k of Object.keys(d.vars)) this.varNames.add(k);
    if (isObj(d.progressions)) for (const k of Object.keys(d.progressions)) this.progNames.add(k);

    this.keys(d, '', ROOT_KEYS);
    this.root(d);
    this.finish();
    if (this.nodes > 4096) this.err('E_LIMIT', '', { detail: 'more than 4096 AST nodes' });
    return this.diags;
  }

  // ------------------------------------------------------------------ helpers

  private keys(o: Obj, path: string, allowed: readonly string[]): void {
    for (const k of Object.keys(o)) {
      if (k.startsWith('x-') || allowed.includes(k)) continue;
      this.err('E_UNKNOWN_KEY', at(path, k), { key: k });
    }
  }

  private slug(v: unknown, path: string, what = 'slug'): v is string {
    if (typeof v !== 'string') {
      this.typeErr(path, 'string');
      return false;
    }
    if (!SLUG.test(v)) {
      this.err('E_ID_FORMAT', path, { value: v, what });
      return false;
    }
    return true;
  }

  private int(v: unknown, path: string, min: number, max: number): v is number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.typeErr(path, 'number');
      return false;
    }
    if (!Number.isInteger(v)) {
      this.err('E_NOT_INTEGER', path);
      return false;
    }
    if (v < min || v > max) {
      this.err('E_RANGE', path, { detail: `${min}..${max}` });
      return false;
    }
    return true;
  }

  private bool(v: unknown, path: string): void {
    if (typeof v !== 'boolean') this.typeErr(path, 'boolean');
  }

  private oneOf(v: unknown, path: string, allowed: readonly string[]): boolean {
    if (typeof v !== 'string' || !allowed.includes(v)) {
      this.err('E_ONE_OF', path, { detail: allowed.join(' | ') });
      return false;
    }
    return true;
  }

  /** Looks a bet up in the catalog (parameterised ids match their base entry). */
  private entryOf(id: string): BetCatalogEntry | null {
    const direct = this.catalog.get(id);
    if (direct) return direct;
    const base = this.catalog.get(id.split(':')[0] as string);
    return base && base.parameters ? base : null;
  }

  /** Reports E_UNKNOWN_BET / E_BET_UNAVAILABLE. Returns the canonical id and catalog entry. */
  private bet(v: unknown, path: string): { id: string; entry: BetCatalogEntry | null } | null {
    if (typeof v !== 'string') {
      this.typeErr(path, 'string');
      return null;
    }
    if (!this.ctx) return { id: v, entry: null };
    const parsed = this.ctx.parseBet(v);
    if (parsed === null) {
      this.err('E_UNKNOWN_BET', path, { value: v });
      return null;
    }
    const entry = this.entryOf(parsed);
    if (!entry) {
      this.err('E_BET_UNAVAILABLE', path, { value: parsed });
      return { id: parsed, entry: null };
    }
    return { id: parsed, entry };
  }

  private stageRef(v: unknown, path: string): void {
    if (typeof v !== 'string') this.typeErr(path, 'string');
    else if (!this.stageIds.includes(v)) this.err('E_UNKNOWN_STAGE', path, { value: v });
  }

  private progRef(v: unknown, path: string): v is string {
    if (typeof v !== 'string') {
      this.typeErr(path, 'string');
      return false;
    }
    if (!this.progNames.has(v)) {
      this.err('E_UNKNOWN_PROG', path, { value: v });
      return false;
    }
    return true;
  }

  private varRef(v: unknown, path: string): void {
    if (typeof v !== 'string') this.typeErr(path, 'string');
    else if (!this.varNames.has(v)) this.err('E_UNKNOWN_VAR', path, { value: v });
  }

  private fact(ref: unknown, path: string): ResolvedFact | null {
    if (typeof ref !== 'string') {
      this.typeErr(path, 'string');
      return null;
    }
    if (!this.ctx) return null;
    const r = resolveFact(ref, this.ctx, this.stageIds);
    if (isFactError(r)) {
      if (r.code === 'E_UNKNOWN_FACT') this.err('E_UNKNOWN_FACT', path, { value: ref });
      else if (r.code === 'E_UNKNOWN_BET') this.err('E_UNKNOWN_BET', path, { value: r.detail });
      else this.err('E_FACT_ARGS', path, { value: ref, detail: r.detail });
      return null;
    }
    return r;
  }

  // ------------------------------------------------------------------ root

  private root(d: Obj): void {
    if (d.schema === undefined) this.err('E_REQUIRED', '/schema', { key: 'schema' });
    else if (d.schema !== 1)
      this.err('E_SCHEMA_VERSION', '/schema', { got: JSON.stringify(d.schema) });
    if (d.kind !== undefined) {
      if (d.kind === 'code') this.err('E_DEFERRED', '/kind', { value: 'kind: code' });
      else this.oneOf(d.kind, '/kind', ['rules']);
    }
    if (d.id === undefined) this.err('E_REQUIRED', '/id', { key: 'id' });
    else this.slug(d.id, '/id', 'slug');
    if (d.name === undefined) this.err('E_REQUIRED', '/name', { key: 'name' });
    else if (typeof d.name !== 'string') this.typeErr('/name', 'string');
    else if (d.name.length < 1 || d.name.length > 80)
      this.err('E_RANGE', '/name', { detail: '1..80 characters' });
    if (d.game === undefined) this.err('E_REQUIRED', '/game', { key: 'game' });
    else if (typeof d.game !== 'string') this.typeErr('/game', 'string');
    else if (this.ctx?.gameId !== undefined && d.game !== this.ctx.gameId)
      this.err('E_GAME_MISMATCH', '/game', { value: d.game, plugin: this.ctx.gameId });
    if (d.notes !== undefined) {
      if (typeof d.notes !== 'string') this.typeErr('/notes', 'string');
      else if (d.notes.length > 4000)
        this.err('E_RANGE', '/notes', { detail: '<= 4000 characters' });
    }
    if (d.tags !== undefined) {
      if (!Array.isArray(d.tags)) this.typeErr('/tags', 'array');
      else {
        if (d.tags.length > 16) this.err('E_LIMIT', '/tags', { detail: 'at most 16 tags' });
        d.tags.forEach((t, i) => this.slug(t, at('/tags', i), 'tag'));
      }
    }
    if (d.unit === undefined) this.err('E_REQUIRED', '/unit', { key: 'unit' });
    else if (this.int(d.unit, '/unit', 1, Number.MAX_SAFE_INTEGER)) this.unit = d.unit;
    if (d.vars !== undefined) this.varsBlock(d.vars);
    if (d.progressions !== undefined) this.progressionsBlock(d.progressions);
    if (d.stages === undefined) this.err('E_REQUIRED', '/stages', { key: 'stages' });
    else this.stagesBlock(d.stages);
  }

  private varsBlock(v: unknown): void {
    if (!isObj(v)) return this.typeErr('/vars', 'object');
    const names = Object.keys(v);
    if (names.length > 64) this.err('E_LIMIT', '/vars', { detail: 'at most 64 vars' });
    for (const k of names) {
      const p = at('/vars', k);
      if (!VARNAME.test(k)) this.err('E_ID_FORMAT', p, { value: k, what: 'var name' });
      if (!num(v[k])) this.typeErr(p, 'finite number');
    }
  }

  // ------------------------------------------------------------------ progressions

  private progressionsBlock(v: unknown): void {
    if (!isObj(v)) return this.typeErr('/progressions', 'object');
    const names = Object.keys(v);
    if (names.length > 16) this.err('E_LIMIT', '/progressions', { detail: 'at most 16' });
    for (const k of names) {
      const p = at('/progressions', k);
      if (!SLUG.test(k)) this.err('E_ID_FORMAT', p, { value: k, what: 'progression name' });
      this.progression(k, v[k], p);
    }
  }

  private trackOf(v: unknown, path: string): ProgInfo['track'] {
    if (v === undefined) {
      this.err('E_REQUIRED', path, { key: 'track' });
      return null;
    }
    if (v === 'round' || v === 'manual') return v;
    if (typeof v === 'string') {
      const b = this.bet(v, path);
      return b ? [b.id] : null;
    }
    if (isObj(v)) {
      this.keys(v, path, ['bets']);
      const bets = v.bets;
      if (!Array.isArray(bets)) {
        this.typeErr(at(path, 'bets'), 'array');
        return null;
      }
      if (bets.length < 1 || bets.length > 16)
        this.err('E_RANGE', at(path, 'bets'), { detail: '1..16 bets' });
      const out: string[] = [];
      bets.forEach((b, i) => {
        const r = this.bet(b, at(at(path, 'bets'), i));
        if (r) out.push(r.id);
      });
      return out;
    }
    this.typeErr(path, "'round' | 'manual' | bet id | { bets }");
    return null;
  }

  private progression(name: string, spec: unknown, path: string): void {
    if (!isObj(spec)) return this.typeErr(path, 'object');
    const kind = spec.kind;
    const kinds = Object.keys(PROG_KEYS);
    if (kind === undefined) return this.err('E_REQUIRED', at(path, 'kind'), { key: 'kind' });
    if (typeof kind !== 'string' || !kinds.includes(kind)) {
      this.err('E_ONE_OF', at(path, 'kind'), { detail: kinds.join(' | ') });
      return;
    }
    const allowed = [
      ...PROG_COMMON.filter((k) => !(kind === 'sequence' && k === 'base')),
      ...(PROG_KEYS[kind] as string[]),
    ];
    for (const k of Object.keys(spec)) {
      if (k.startsWith('x-') || allowed.includes(k)) continue;
      if (ALL_PROG_KEYS.has(k)) {
        this.err('E_PROG_SPEC', at(path, k), { detail: `${k} does not apply to ${kind}` });
      } else this.err('E_UNKNOWN_KEY', at(path, k), { key: k });
    }
    if (kind === 'sequence' && spec.base !== undefined) {
      // already reported as E_PROG_SPEC above (base is not allowed on sequence)
    }
    const info: ProgInfo = {
      name,
      path,
      kind,
      track: null,
      trackPath: at(path, 'track'),
      top: null,
      edges: [],
      onCap: DEFAULT_ON_CAP[kind] as string,
      onEmpty: 'reset',
    };
    this.progs.set(name, info);
    info.track = this.trackOf(spec.track, at(path, 'track'));
    if (spec.feed !== undefined) this.oneOf(spec.feed, at(path, 'feed'), ['sized', 'always']);
    this.progOwner = name;
    this.curProgEdges = info.edges;
    let baseConst: number | null = this.unit || null;
    if (spec.base !== undefined && kind !== 'sequence') {
      this.amountExpr(spec.base, at(path, 'base'));
      baseConst = this.constEval(spec.base);
    }
    if (spec.maxAmount !== undefined) this.amountExpr(spec.maxAmount, at(path, 'maxAmount'));
    if (spec.onCap !== undefined) {
      if (this.oneOf(spec.onCap, at(path, 'onCap'), CAP_POLICIES))
        info.onCap = spec.onCap as string;
    } else if (kind === 'martingale' || kind === 'grand-martingale')
      this.err('E_REQUIRED', at(path, 'onCap'), { key: 'onCap' });
    const L = (key: string, min: number, max: number, required: boolean): number | null => {
      const v = spec[key];
      if (v === undefined) {
        if (required) this.err('E_REQUIRED', at(path, key), { key });
        return null;
      }
      return this.int(v, at(path, key), min, max) ? v : null;
    };
    let top: number | null = null; // multiplier of the top level, in bases
    switch (kind) {
      case 'martingale': {
        const n = L('maxSteps', 1, 30, true);
        const m = L('multiplier', 2, 10, false) ?? 2;
        if (n !== null) top = m ** (n - 1);
        break;
      }
      case 'grand-martingale': {
        const n = L('maxSteps', 1, 29, true);
        if (n !== null) top = 2 ** n - 1;
        break;
      }
      case 'fibonacci': {
        const n = L('maxSteps', 1, 40, false) ?? 20;
        L('back', 1, 40, false);
        let a = 1;
        let b = 1;
        for (let i = 2; i < n; i++) [a, b] = [b, a + b];
        top = n <= 2 ? 1 : b;
        break;
      }
      case 'dalembert': {
        const n = L('maxSteps', 1, 1000, false) ?? 50;
        if (spec.step !== undefined) this.amountExpr(spec.step, at(path, 'step'));
        const step = spec.step !== undefined ? this.constEval(spec.step) : baseConst;
        top = baseConst !== null && step !== null ? 1 + ((n - 1) * step) / baseConst : null;
        break;
      }
      case 'paroli': {
        const n = L('maxSteps', 1, 20, false) ?? 3;
        const m = L('multiplier', 2, 10, false) ?? 2;
        top = m ** (n - 1);
        break;
      }
      case '1-3-2-6':
        top = 6;
        break;
      case 'oscars-grind': {
        top = L('maxSteps', 1, 1000, false) ?? 20;
        break;
      }
      case 'labouchere':
        this.labouchere(spec, path, info);
        break;
      case 'sequence':
        this.sequence(spec, path, info);
        break;
      default:
        break;
    }
    if (top !== null && baseConst !== null) {
      info.top = top * baseConst;
      if (info.top > MAX_CENTS) this.err('E_PROG_OVERFLOW', path, { value: info.top });
    } else if (kind === 'sequence') {
      // set by sequence()
    }
    this.curProgEdges = null;
    this.progOwner = '';
  }

  private labouchere(spec: Obj, path: string, info: ProgInfo): void {
    const lp = at(path, 'line');
    if (spec.line === undefined) this.err('E_REQUIRED', lp, { key: 'line' });
    else if (!Array.isArray(spec.line)) this.typeErr(lp, 'array');
    else {
      if (spec.line.length < 1 || spec.line.length > 64)
        this.err('E_RANGE', lp, { detail: '1..64 numbers' });
      spec.line.forEach((n, i) => {
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1)
          this.err('E_PROG_SPEC', at(lp, i), { detail: 'line numbers are positive integers' });
      });
    }
    if (spec.maxLength !== undefined) this.int(spec.maxLength, at(path, 'maxLength'), 1, 256);
    if (spec.onEmpty !== undefined) {
      if (this.oneOf(spec.onEmpty, at(path, 'onEmpty'), ['reset', 'stop']))
        info.onEmpty = spec.onEmpty as string;
    }
  }

  private sequence(spec: Obj, path: string, info: ProgInfo): void {
    const ap = at(path, 'amounts');
    if (spec.amounts === undefined) this.err('E_REQUIRED', ap, { key: 'amounts' });
    else if (!Array.isArray(spec.amounts)) this.typeErr(ap, 'array');
    else {
      if (spec.amounts.length < 1 || spec.amounts.length > 64)
        this.err('E_RANGE', ap, { detail: '1..64 amounts' });
      let top: number | null = 0;
      spec.amounts.forEach((a, i) => {
        this.amountExpr(a, at(ap, i));
        const c = this.constEval(a);
        top = top === null || c === null ? null : Math.max(top, c);
      });
      info.top = top;
      if (top !== null && top > MAX_CENTS) this.err('E_PROG_OVERFLOW', path, { value: top });
    }
    for (const k of ['onWin', 'onLoss'] as const) {
      if (spec[k] === undefined) this.err('E_REQUIRED', at(path, k), { key: k });
      else this.oneOf(spec[k], at(path, k), SEQ_STEPS);
    }
    if (spec.onPush !== undefined) this.oneOf(spec.onPush, at(path, 'onPush'), SEQ_STEPS);
  }

  // ------------------------------------------------------------------ stages

  private stagesBlock(v: unknown): void {
    if (!Array.isArray(v)) return this.typeErr('/stages', 'array');
    if (v.length < 1) this.err('E_RANGE', '/stages', { detail: 'at least 1 stage' });
    if (v.length > 32) this.err('E_LIMIT', '/stages', { detail: 'at most 32 stages' });
    const seen = new Set<string>();
    v.forEach((s, i) => this.stage(s, at('/stages', i), i, seen));
  }

  private stage(s: unknown, path: string, index: number, seen: Set<string>): void {
    if (!isObj(s)) return this.typeErr(path, 'object');
    this.keys(s, path, STAGE_KEYS);
    const info: StageInfo = {
      id: typeof s.id === 'string' ? s.id : '',
      index,
      extendsId: typeof s.extends === 'string' ? s.extends : null,
      layout: [],
      ruleThenCounts: [],
      onEnter: 0,
      onExit: 0,
      gotos: [],
      ownRules: 0,
    };
    this.stages.push(info);
    this.curStage = info;
    if (s.id === undefined) this.err('E_REQUIRED', at(path, 'id'), { key: 'id' });
    else if (this.slug(s.id, at(path, 'id'), 'stage id')) {
      if (seen.has(s.id)) this.err('E_DUPLICATE_ID', at(path, 'id'), { value: s.id });
      seen.add(s.id);
    }
    if (s.label !== undefined && typeof s.label !== 'string')
      this.typeErr(at(path, 'label'), 'string');
    if (s.extends !== undefined) this.stageRef(s.extends, at(path, 'extends'));
    if (s.layout !== undefined) {
      if (!Array.isArray(s.layout)) this.typeErr(at(path, 'layout'), 'array');
      else {
        if (s.layout.length > 64)
          this.err('E_LIMIT', at(path, 'layout'), { detail: 'at most 64 entries' });
        s.layout.forEach((l, i) => this.layoutEntry(l, at(at(path, 'layout'), i)));
      }
    }
    for (const hook of ['onEnter', 'onExit'] as const) {
      if (s[hook] === undefined) continue;
      const n = this.effects(s[hook], at(path, hook), hook);
      info[hook] = n;
    }
    if (s.rules !== undefined) {
      if (!Array.isArray(s.rules)) this.typeErr(at(path, 'rules'), 'array');
      else {
        info.ownRules = s.rules.length;
        if (s.rules.length > 64)
          this.err('E_LIMIT', at(path, 'rules'), { detail: 'at most 64 rules' });
        s.rules.forEach((r, i) => this.rule(r, at(at(path, 'rules'), i)));
      }
    }
    this.curStage = null;
  }

  private layoutEntry(l: unknown, path: string): void {
    if (!isObj(l)) return this.typeErr(path, 'object');
    this.nodes++;
    this.keys(l, path, LAYOUT_KEYS);
    const info: LayoutInfo = {
      path,
      bet: null,
      entry: null,
      constAmount: null,
      progs: [],
      keep: false,
    };
    if (l.bet === undefined) this.err('E_REQUIRED', at(path, 'bet'), { key: 'bet' });
    else {
      const b = this.bet(l.bet, at(path, 'bet'));
      if (b) {
        info.bet = b.id;
        info.entry = b.entry;
      }
    }
    if (l.amount === undefined) this.err('E_REQUIRED', at(path, 'amount'), { key: 'amount' });
    else this.amountPosition(l.amount, at(path, 'amount'), info);
    if (l.when !== undefined) this.cond(l.when, at(path, 'when'), 1);
    if (l.parent !== undefined) this.bet(l.parent, at(path, 'parent'));
    if (l.working !== undefined) this.oneOf(l.working, at(path, 'working'), ['auto', 'on', 'off']);
    if (l.label !== undefined && typeof l.label !== 'string')
      this.typeErr(at(path, 'label'), 'string');
    this.curStage?.layout.push(info);
    if (info.entry && info.keep && !info.entry.persistent)
      this.err('W_KEEP_NON_PERSISTENT', at(path, 'amount'), { value: info.bet ?? '' });
  }

  /** An amount in a layout entry or `bet` effect: checks keepOr, constants and limits. */
  private amountPosition(a: unknown, path: string, info: LayoutInfo): void {
    this.amountExpr(a, path);
    let inner = a;
    if (isObj(a) && 'keepOr' in a) {
      info.keep = true;
      inner = a.keepOr;
    }
    info.constAmount = this.constEval(inner);
    const progs = new Set<string>();
    scanProgs(inner, progs);
    info.progs = [...progs];
    for (const p of progs) {
      if (info.bet) {
        const set = this.layoutProgBets.get(p) ?? new Set<string>();
        set.add(info.bet);
        this.layoutProgBets.set(p, set);
      }
    }
    const c = info.constAmount;
    if (c !== null && info.entry && this.ctx && c > 0) {
      const amount = Math.floor(c);
      const lim = this.ctx.limits(info.entry.id, this.ctx.rules);
      if (lim && amount < lim.min) {
        if (info.entry.limitClass === 'outside')
          this.err('E_BELOW_MIN', path, { value: info.entry.id, amount, min: lim.min });
        else this.err('W_BELOW_MIN_POSSIBLE', path, { amount, min: lim.min });
      }
    }
  }
  private readonly layoutProgBets = new Map<string, Set<string>>();

  private amountExpr(a: unknown, path: string): void {
    if (isObj(a) && 'keepOr' in a) {
      this.nodes++;
      this.keys(a, path, ['keepOr']);
      const kind = this.expr(a.keepOr, at(path, 'keepOr'), 1, true);
      this.amountKind(kind, at(path, 'keepOr'));
      return;
    }
    const kind = this.expr(a, path, 1, true);
    this.amountKind(kind, path);
  }

  private amountKind(kind: Kind | null, path: string): void {
    if (kind === 'count') this.err('W_UNIT_MIX', path);
  }

  // ------------------------------------------------------------------ rules and effects

  private rule(r: unknown, path: string): void {
    if (!isObj(r)) return this.typeErr(path, 'object');
    this.keys(r, path, RULE_KEYS);
    if (r.id !== undefined && this.slug(r.id, at(path, 'id'), 'rule id')) {
      if (this.ruleIds.has(r.id)) this.err('E_DUPLICATE_ID', at(path, 'id'), { value: r.id });
      this.ruleIds.add(r.id);
    }
    if (r.label !== undefined && typeof r.label !== 'string')
      this.typeErr(at(path, 'label'), 'string');
    if (r.enabled !== undefined) this.bool(r.enabled, at(path, 'enabled'));
    if (r.when === undefined) this.err('E_REQUIRED', at(path, 'when'), { key: 'when' });
    else this.cond(r.when, at(path, 'when'), 1);
    if (r.once !== undefined && r.once !== true && r.once !== false && r.once !== 'stage')
      this.err('E_ONE_OF', at(path, 'once'), { detail: 'true | false | stage' });
    if (r.cooldown !== undefined)
      this.int(r.cooldown, at(path, 'cooldown'), 1, Number.MAX_SAFE_INTEGER);
    let count = 0;
    if (r.then === undefined) this.err('E_REQUIRED', at(path, 'then'), { key: 'then' });
    else {
      count = this.effects(r.then, at(path, 'then'), null);
      if (Array.isArray(r.then) && r.then.length === 0)
        this.err('E_RANGE', at(path, 'then'), { detail: '1..16 effects' });
    }
    this.curStage?.ruleThenCounts.push(count);
    // goto to itself, reenter, under always
    if (
      this.curStage &&
      isObj(r.when) &&
      r.when.always === true &&
      !r.once &&
      r.cooldown === undefined &&
      Array.isArray(r.then)
    ) {
      r.then.forEach((e: unknown) => {
        if (isObj(e) && e.goto === this.curStage?.id && e.reenter === true)
          this.err('E_GOTO_SELF_ALWAYS', path);
      });
    }
  }

  /** Returns the number of effects in the list. */
  private effects(list: unknown, path: string, hook: 'onEnter' | 'onExit' | null): number {
    if (!Array.isArray(list)) {
      this.typeErr(path, 'array');
      return 0;
    }
    if (list.length > 16) this.err('E_EFFECT_CAP', path);
    let terminated = false;
    list.forEach((e, i) => {
      const p = at(path, i);
      if (terminated && !this.reportedUnreachable.has(path)) {
        this.reportedUnreachable.add(path);
        this.err('E_UNREACHABLE_EFFECT', p);
      }
      const t = this.effect(e, p, hook);
      if (t) terminated = true;
    });
    return list.length;
  }
  private readonly reportedUnreachable = new Set<string>();

  /** Returns true when the effect ends the list (goto to another stage, stop). */
  private effect(e: unknown, path: string, hook: 'onEnter' | 'onExit' | null): boolean {
    if (!isObj(e)) {
      this.typeErr(path, 'object');
      return false;
    }
    this.nodes++;
    const present = Object.keys(EFFECT_KEYS).filter((k) => k in e);
    if (present.length !== 1) {
      this.err('E_ONE_OF', path, { detail: Object.keys(EFFECT_KEYS).join(' | ') });
      return false;
    }
    const op = present[0] as string;
    this.keys(e, path, [op, ...(EFFECT_KEYS[op] as string[])]);
    const p = (k: string): string => at(path, k);
    switch (op) {
      case 'bet': {
        this.hasBetEffect = true;
        const b = this.bet(e.bet, p('bet'));
        const info: LayoutInfo = {
          path,
          bet: b?.id ?? null,
          entry: b?.entry ?? null,
          constAmount: null,
          progs: [],
          keep: false,
        };
        if (e.amount === undefined) this.err('E_REQUIRED', p('amount'), { key: 'amount' });
        else {
          const kind = this.expr(e.amount, p('amount'), 1, true);
          this.amountKind(kind, p('amount'));
          const c = this.constEval(e.amount);
          if (c !== null && b?.entry && this.ctx && c > 0 && Math.floor(c) < this.minOf(b.entry)) {
            if (b.entry.limitClass === 'outside')
              this.err('E_BELOW_MIN', p('amount'), {
                value: b.entry.id,
                amount: Math.floor(c),
                min: this.minOf(b.entry),
              });
          }
          const progs = new Set<string>();
          scanProgs(e.amount, progs);
          for (const pr of progs) {
            if (b) {
              const set = this.layoutProgBets.get(pr) ?? new Set<string>();
              set.add(b.id);
              this.layoutProgBets.set(pr, set);
            }
          }
          void info;
        }
        if (e.parent !== undefined) this.bet(e.parent, p('parent'));
        if (e.working !== undefined) this.oneOf(e.working, p('working'), ['auto', 'on', 'off']);
        return false;
      }
      case 'remove': {
        const b = this.bet(e.remove, p('remove'));
        if (b?.entry?.contract) this.err('E_REMOVE_CONTRACT', p('remove'), { value: b.id });
        return false;
      }
      case 'clear':
        if (e.clear !== true) this.err('E_ONE_OF', p('clear'), { detail: 'true' });
        return false;
      case 'press': {
        const b = this.bet(e.press, p('press'));
        if (b?.entry && !b.entry.persistent)
          this.err('E_PRESS_NON_PERSISTENT', p('press'), { value: b.id });
        if (e.by === undefined) this.err('E_REQUIRED', p('by'), { key: 'by' });
        else this.amountKind(this.expr(e.by, p('by'), 1, true), p('by'));
        if (e.cap !== undefined) this.amountKind(this.expr(e.cap, p('cap'), 1, true), p('cap'));
        return false;
      }
      case 'set':
        this.varRef(e.set, p('set'));
        if (e.to === undefined) this.err('E_REQUIRED', p('to'), { key: 'to' });
        else this.expr(e.to, p('to'), 1, false);
        return false;
      case 'inc':
        this.varRef(e.inc, p('inc'));
        if (e.by !== undefined) this.expr(e.by, p('by'), 1, false);
        return false;
      case 'goto': {
        this.stageRef(e.goto, p('goto'));
        if (e.reenter !== undefined) this.bool(e.reenter, p('reenter'));
        if (typeof e.goto === 'string') {
          this.gotoTargets.add(e.goto);
          this.curStage?.gotos.push(e.goto);
        }
        if (hook) {
          this.err('E_GOTO_IN_HOOK', path);
          return false;
        }
        const self = this.curStage && e.goto === this.curStage.id && e.reenter !== true;
        return !self;
      }
      case 'prog': {
        const ok = this.progRef(e.prog, p('prog'));
        if (e.do === undefined) this.err('E_REQUIRED', p('do'), { key: 'do' });
        else if (this.oneOf(e.do, p('do'), ['win', 'loss', 'push', 'reset', 'advance', 'back'])) {
          if (ok && (e.do === 'advance' || e.do === 'back')) {
            const k = this.progs.get(e.prog as string)?.kind ?? this.progKindOf(e.prog as string);
            if (k === 'labouchere' || k === 'oscars-grind')
              this.err('E_PROG_OP_UNSUPPORTED', p('do'), { value: k });
          }
        }
        return false;
      }
      case 'stop': {
        const r = e.stop;
        if (!this.slug(r, p('stop'), 'stop reason')) return true;
        if (
          r.startsWith('cap-') ||
          r.startsWith('done-') ||
          (RESERVED_STOP_REASONS as readonly string[]).includes(r)
        )
          this.err('E_RESERVED_REASON', p('stop'), { value: r });
        if (!this.stopReasons.has(r)) {
          this.stopReasons.add(r);
          if (this.stopReasons.size === MAX_STOP_REASONS + 1)
            this.err('E_LIMIT', p('stop'), {
              detail: `more than ${MAX_STOP_REASONS} distinct stop reasons`,
            });
        }
        return true;
      }
      case 'skipRound':
        if (e.skipRound !== true) this.err('E_ONE_OF', p('skipRound'), { detail: 'true' });
        return false;
      case 'act': {
        if (typeof e.act !== 'string') this.typeErr(p('act'), 'string');
        else if (this.ctx && !(this.ctx.facts.actions ?? []).some((a) => a.name === e.act))
          this.err('E_UNKNOWN_ACT', p('act'), { value: e.act });
        if (e.args !== undefined) this.argsObj(e.args, p('args'));
        return false;
      }
      default:
        return false;
    }
  }

  private minOf(entry: BetCatalogEntry): number {
    return this.ctx?.limits(entry.id, this.ctx.rules)?.min ?? 0;
  }

  private progKindOf(name: string): string | null {
    const specs = isObj(this.def) && isObj(this.def.progressions) ? this.def.progressions : null;
    const s = specs?.[name];
    return isObj(s) && typeof s.kind === 'string' ? s.kind : null;
  }

  private argsObj(a: unknown, path: string): void {
    if (!isObj(a)) return this.typeErr(path, 'object');
    for (const k of Object.keys(a)) {
      const v = a[k];
      if (typeof v !== 'string' && !num(v)) this.typeErr(at(path, k), 'string | number');
    }
  }

  // ------------------------------------------------------------------ conditions

  private cond(c: unknown, path: string, depth: number): void {
    if (!isObj(c)) return this.typeErr(path, 'object');
    this.nodes++;
    if (depth > 16) return this.err('E_LIMIT', path, { detail: 'depth over 16' });
    const present = Object.keys(COND_KEYS).filter((k) => k in c);
    if (present.length !== 1) {
      this.err('E_ONE_OF', path, { detail: Object.keys(COND_KEYS).join(' | ') });
      return;
    }
    const op = present[0] as string;
    const p = (k: string): string => at(path, k);
    this.keys(c, path, [op, ...(COND_KEYS[op] as string[])]);
    switch (op) {
      case 'always':
        if (c.always !== true) this.err('E_ONE_OF', p('always'), { detail: 'true' });
        return;
      case 'all':
      case 'any': {
        const list = c[op];
        if (!Array.isArray(list)) return this.typeErr(p(op), 'array');
        if (list.length === 0) this.err('W_EMPTY_GROUP', p(op));
        list.forEach((x, i) => this.cond(x, at(p(op), i), depth + 1));
        return;
      }
      case 'not':
        this.cond(c.not, p('not'), depth + 1);
        return;
      case 'cmp': {
        const t = c.cmp;
        if (!Array.isArray(t) || t.length !== 3) return this.typeErr(p('cmp'), '[expr, op, expr]');
        const a: unknown = t[0];
        const b: unknown = t[2];
        this.expr(a, at(p('cmp'), 0), depth + 1, false);
        this.oneOf(t[1], at(p('cmp'), 1), CMP_OPS);
        this.expr(b, at(p('cmp'), 2), depth + 1, false);
        if (num(a) && num(b)) this.err('W_CONST_CONDITION', p('cmp'));
        return;
      }
      case 'fact':
        return this.factCond(c.fact, p('fact'));
      case 'event':
        return this.eventCond(c, path);
      case 'onTable':
        this.bet(c.onTable, p('onTable'));
        return;
      case 'streak': {
        const h = c.streak;
        if (!isObj(h)) return this.typeErr(p('streak'), 'history predicate with atLeast');
        this.historyLike(h, p('streak'), ['atLeast']);
        if (h.atLeast === undefined)
          this.err('E_REQUIRED', at(p('streak'), 'atLeast'), { key: 'atLeast' });
        else this.int(h.atLeast, at(p('streak'), 'atLeast'), 1, 1_000_000);
        return;
      }
      case 'countInLast': {
        const h = c.countInLast;
        if (!isObj(h)) return this.typeErr(p('countInLast'), 'history predicate with n');
        const hp = p('countInLast');
        this.historyLike(h, hp, ['n', 'atLeast', 'atMost', 'partial']);
        this.countN(h, hp);
        if (h.atLeast !== undefined) this.int(h.atLeast, at(hp, 'atLeast'), 0, 1000);
        if (h.atMost !== undefined) this.int(h.atMost, at(hp, 'atMost'), 0, 1000);
        if (h.partial !== undefined) this.bool(h.partial, at(hp, 'partial'));
        if (h.atLeast === undefined && h.atMost === undefined) this.err('E_HISTORY_BOUND', hp);
        return;
      }
      case 'since': {
        const h = c.since;
        if (!isObj(h)) return this.typeErr(p('since'), 'history predicate with bounds');
        const hp = p('since');
        this.historyLike(h, hp, ['atLeast', 'atMost']);
        if (h.atLeast !== undefined) this.int(h.atLeast, at(hp, 'atLeast'), 0, 1_000_000);
        if (h.atMost !== undefined) this.int(h.atMost, at(hp, 'atMost'), 0, 1_000_000);
        if (h.atLeast === undefined && h.atMost === undefined) this.err('E_HISTORY_BOUND', hp);
        return;
      }
      case 'everyN':
        this.int(c.everyN, p('everyN'), 1, Number.MAX_SAFE_INTEGER);
        if (c.offset !== undefined) this.int(c.offset, p('offset'), 0, Number.MAX_SAFE_INTEGER);
        if (c.of !== undefined) this.oneOf(c.of, p('of'), ['round', 'stage']);
        return;
      case 'chance':
        this.err('E_DEFERRED', p('chance'), { value: 'chance' });
        return;
      default:
        return;
    }
  }

  private countN(c: Obj, path: string): void {
    if (c.n === undefined) this.err('E_REQUIRED', at(path, 'n'), { key: 'n' });
    else this.int(c.n, at(path, 'n'), 1, 1000);
  }

  /**
   * Validates a history predicate object `c` (exactly one of the forms `{ fact, equals }` /
   * `{ event, bet?, args? }`) plus the `extras` keys of the surrounding condition/expression.
   */
  private historyLike(c: Obj, path: string, extras: string[]): void {
    if ('fact' in c || 'equals' in c) {
      this.keys(c, path, ['fact', 'equals', ...extras]);
      if (c.fact === undefined) this.err('E_REQUIRED', at(path, 'fact'), { key: 'fact' });
      if (c.equals === undefined) this.err('E_REQUIRED', at(path, 'equals'), { key: 'equals' });
      if ('event' in c)
        this.err('E_ONE_OF', path, { detail: '{ fact, equals } | { event, bet?, args? }' });
      const r = this.fact(c.fact, at(path, 'fact'));
      if (r) {
        if (r.scope !== 'round')
          this.err('E_HISTORY_FACT', at(path, 'fact'), { value: String(c.fact) });
        if (c.equals !== undefined) this.checkFactValue(r, c.equals, at(path, 'equals'), 'equals');
      }
    } else if ('event' in c) {
      this.keys(c, path, ['event', 'bet', 'args', ...extras]);
      this.eventCond(c, path);
    } else {
      this.err('E_ONE_OF', path, { detail: '{ fact, equals } | { event, bet?, args? }' });
      this.keys(c, path, extras);
    }
    const key = JSON.stringify(
      Object.fromEntries(
        Object.entries(c).filter(([k]) => ['fact', 'equals', 'event', 'bet', 'args'].includes(k)),
      ),
    );
    if (!this.predicates.has(key)) {
      this.predicates.add(key);
      if (this.predicates.size === 33)
        this.err('E_LIMIT', path, { detail: 'more than 32 distinct history predicates' });
    }
  }

  private eventCond(c: Obj, path: string): void {
    const name = c.event;
    const p = (k: string): string => at(path, k);
    if (typeof name !== 'string') return this.typeErr(p('event'), 'string');
    const isCore = (CORE_EVENTS as readonly string[]).includes(name);
    const decl = this.ctx?.facts.events.find((e) => e.name === name);
    if (this.ctx && !isCore && !decl) this.err('E_UNKNOWN_EVENT', p('event'), { value: name });
    if (c.bet !== undefined) {
      this.bet(c.bet, p('bet'));
      const supported =
        BET_EVENTS.includes(name) ||
        (decl?.params ?? []).some(
          (q) => q.name === 'bet' && (q.type === 'bet' || q.type === 'target'),
        );
      if (this.ctx && !supported)
        this.err('E_EVENT_FILTER', p('bet'), { event: name, value: 'bet' });
    }
    if (c.prog !== undefined) {
      this.progRef(c.prog, p('prog'));
      if (typeof c.prog === 'string') this.progReads.add(c.prog);
      if (this.ctx && !PROG_EVENTS.includes(name))
        this.err('E_EVENT_FILTER', p('prog'), { event: name, value: 'prog' });
    }
    if (c.args !== undefined) {
      this.argsObj(c.args, p('args'));
      if (this.ctx && isObj(c.args)) {
        const declared = new Set((decl?.params ?? []).map((q) => q.name));
        for (const k of Object.keys(c.args))
          if (!declared.has(k))
            this.err('E_EVENT_FILTER', at(p('args'), k), { event: name, value: k });
      }
    }
  }

  private factCond(t: unknown, path: string): void {
    if (!Array.isArray(t) || t.length !== 3) return this.typeErr(path, '[fact, op, value]');
    const r = this.fact(t[0], at(path, 0));
    if (!this.oneOf(t[1], at(path, 1), FACT_OPS)) return;
    const op = t[1] as string;
    if (t[0] === 'stage' || (r && r.name === 'stage')) {
      const vals = Array.isArray(t[2]) ? t[2] : [t[2]];
      vals.forEach((v, i) => {
        if (typeof v !== 'string' || !this.stageIds.includes(v))
          this.err('E_UNKNOWN_STAGE', Array.isArray(t[2]) ? at(at(path, 2), i) : at(path, 2), {
            value: String(v),
          });
      });
      return;
    }
    if (!r) return;
    const ft = r.value;
    const allowed =
      ft.type === 'boolean'
        ? ['==', '!=']
        : ft.type === 'enum'
          ? ['==', '!=', 'in', 'notIn']
          : FACT_OPS;
    if (!allowed.includes(op)) {
      this.err('E_FACT_TYPE', at(path, 1), { detail: `operator ${op} on a ${ft.type} fact` });
      return;
    }
    this.checkFactValue(r, t[2], at(path, 2), op === 'in' || op === 'notIn' ? 'in' : 'cmp');
  }

  /** `in`: array required; `cmp`: single member; `equals` (history): either. */
  private checkFactValue(
    r: ResolvedFact,
    v: unknown,
    path: string,
    mode: 'in' | 'cmp' | 'equals',
  ): void {
    const ft = r.value;
    const one = (x: unknown, p: string): void => {
      if (ft.type === 'boolean') {
        if (typeof x !== 'boolean')
          this.err('E_FACT_VALUE', p, { detail: 'expected true or false' });
      } else if (ft.type === 'number') {
        if (!num(x)) this.err('E_FACT_VALUE', p, { detail: 'expected a number' });
      } else if (!ft.values.some((m) => m === x)) {
        this.err('E_FACT_VALUE', p, { detail: `${String(x)} is not a member` });
      }
    };
    if (Array.isArray(v)) {
      if (mode === 'cmp')
        return this.err('E_FACT_VALUE', path, { detail: 'array only with in / notIn' });
      v.forEach((x, i) => one(x, at(path, i)));
    } else if (mode === 'in') {
      this.err('E_FACT_VALUE', path, { detail: 'expected an array' });
    } else one(v, path);
  }

  // ------------------------------------------------------------------ expressions

  /** Returns the unit kind, or null when the expression is not well formed. */
  private expr(e: unknown, path: string, depth: number, amount: boolean): Kind | null {
    this.nodes++;
    if (depth > 16) {
      this.err('E_LIMIT', path, { detail: 'depth over 16' });
      return null;
    }
    if (typeof e === 'number') {
      if (!Number.isFinite(e)) {
        this.typeErr(path, 'finite number');
        return null;
      }
      if (amount && depth === 1 && !Number.isInteger(e)) this.err('E_NOT_INTEGER', path);
      return 'scalar';
    }
    if (typeof e === 'string') return this.factExpr(e, path);
    if (!isObj(e)) {
      this.typeErr(path, 'expression');
      return null;
    }
    const present = EXPR_KEYS.filter((k) => k in e);
    if (present.length !== 1) {
      this.err('E_ONE_OF', path, { detail: EXPR_KEYS.join(' | ') });
      return null;
    }
    const op = present[0] as string;
    const p = (k: string): string => at(path, k);
    const sub = (x: unknown, pp: string): Kind | null => this.expr(x, pp, depth + 1, false);
    this.keys(e, path, [op]);
    switch (op) {
      case 'units':
        if (!num(e.units)) this.typeErr(p('units'), 'finite number');
        return 'money';
      case 'fact':
        return this.factExpr(e.fact, p('fact'));
      case 'var':
        this.varRef(e.var, p('var'));
        if (typeof e.var === 'string') this.varReads.add(e.var);
        return 'scalar';
      case 'prog':
        this.progRef(e.prog, p('prog'));
        if (typeof e.prog === 'string') {
          this.progReads.add(e.prog);
          if (this.curProgEdges && this.progOwner)
            this.curProgEdges.push({ to: e.prog, path: p('prog') });
        }
        return 'money';
      case 'progStep':
      case 'progCaps':
        this.progRef(e[op], p(op));
        if (typeof e[op] === 'string') {
          this.progReads.add(e[op]);
          if (this.curProgEdges && op === 'progStep')
            this.curProgEdges.push({ to: e[op], path: p(op) });
        }
        return 'count';
      case 'stageEntries':
        this.stageRef(e.stageEntries, p('stageEntries'));
        return 'count';
      case 'amountOn':
      case 'lastAmount':
      case 'lastProfit':
        this.bet(e[op], p(op));
        return 'money';
      case 'pctOfBankroll':
        if (!num(e.pctOfBankroll)) this.typeErr(p('pctOfBankroll'), 'finite number');
        return 'money';
      case 'tableMin':
      case 'tableMax': {
        const v = e[op];
        if (typeof v !== 'string') {
          this.typeErr(p(op), 'string');
        } else if (this.ctx) {
          const parsed = this.ctx.parseBet(v);
          if (parsed === null) {
            let lim: { min: number; max: number } | null;
            try {
              lim = this.ctx.limits(v, this.ctx.rules);
            } catch {
              lim = null;
            }
            if (lim === null) this.err('E_UNKNOWN_LIMIT_CLASS', p(op), { value: v });
          } else if (!this.entryOf(parsed)) this.err('E_BET_UNAVAILABLE', p(op), { value: parsed });
        }
        return 'money';
      }
      case 'streakLen':
      case 'roundsSince':
        if (!isObj(e[op])) {
          this.typeErr(p(op), 'history predicate');
        } else {
          this.historyLike(e[op], p(op), []);
        }
        return 'count';
      case 'countInLast': {
        const h = e.countInLast;
        if (!isObj(h)) {
          this.typeErr(p(op), 'history predicate with n');
        } else {
          this.historyLike(h, p(op), ['n']);
          this.countN(h, p(op));
        }
        return 'count';
      }
      case 'add':
      case 'times':
      case 'max':
      case 'min': {
        const list = e[op];
        if (!Array.isArray(list)) {
          this.typeErr(p(op), 'array');
          return null;
        }
        if (list.length < 2 || list.length > 8)
          this.err('E_RANGE', p(op), { detail: '2..8 operands' });
        let kind: Kind = 'scalar';
        let money = false;
        let count = false;
        list.forEach((x, i) => {
          const k = sub(x, at(p(op), i));
          if (k === 'money') money = true;
          if (k === 'count') count = true;
          if (k) kind = combine(kind, k);
        });
        if (money && count && op !== 'times') this.err('W_UNIT_MIX', path);
        return kind;
      }
      case 'sub': {
        const t = e.sub;
        if (!Array.isArray(t) || t.length !== 2) {
          this.typeErr(p('sub'), '[expr, expr]');
          return null;
        }
        const a = sub(t[0], at(p('sub'), 0));
        const b = sub(t[1], at(p('sub'), 1));
        if ((a === 'money' && b === 'count') || (a === 'count' && b === 'money'))
          this.err('W_UNIT_MIX', path);
        return a && b ? combine(a, b) : null;
      }
      case 'div':
      case 'floorTo': {
        const t = e[op];
        if (!Array.isArray(t) || t.length !== 2) {
          this.typeErr(p(op), '[expr, expr]');
          return null;
        }
        const a = sub(t[0], at(p(op), 0));
        sub(t[1], at(p(op), 1));
        const d: unknown = t[1];
        if (typeof d === 'number' && (op === 'div' ? d === 0 : d <= 0))
          this.err('E_DIV_ZERO_LITERAL', at(p(op), 1));
        return op === 'div' ? (a === 'money' ? 'scalar' : (a ?? 'scalar')) : a;
      }
      case 'abs':
        return sub(e.abs, p('abs'));
      case 'if': {
        const t = e.if;
        if (!Array.isArray(t) || t.length !== 3) {
          this.typeErr(p('if'), '[condition, expr, expr]');
          return null;
        }
        this.cond(t[0], at(p('if'), 0), depth + 1);
        const a = sub(t[1], at(p('if'), 1));
        const b = sub(t[2], at(p('if'), 2));
        if ((a === 'money' && b === 'count') || (a === 'count' && b === 'money'))
          this.err('W_UNIT_MIX', path);
        return a && b ? combine(a, b) : (a ?? b);
      }
      default:
        return null;
    }
  }

  private factExpr(ref: unknown, path: string): Kind | null {
    const r = this.fact(ref, path);
    if (!r) return null;
    if (r.value.type !== 'number') {
      this.err('E_FACT_TYPE', path, { detail: `${String(ref)} is not numeric` });
      return null;
    }
    return r.value.unit;
  }

  /** Constant value of an expression with literals/units only; null when not constant. */
  private constEval(e: unknown): number | null {
    if (typeof e === 'number') return Number.isFinite(e) ? e : null;
    if (!isObj(e)) return null;
    if ('units' in e) return num(e.units) && this.unit ? e.units * this.unit : null;
    const list = (k: string): number[] | null => {
      const v = e[k];
      if (!Array.isArray(v)) return null;
      const out: number[] = [];
      for (const x of v) {
        const c = this.constEval(x);
        if (c === null) return null;
        out.push(c);
      }
      return out;
    };
    for (const k of ['add', 'times', 'max', 'min'] as const) {
      if (k in e) {
        const xs = list(k);
        if (!xs || xs.length === 0) return null;
        if (k === 'add') return xs.reduce((a, b) => a + b, 0);
        if (k === 'times') return xs.reduce((a, b) => a * b, 1);
        return k === 'max' ? Math.max(...xs) : Math.min(...xs);
      }
    }
    if ('sub' in e) {
      const xs = list('sub');
      return xs && xs.length === 2 ? (xs[0] as number) - (xs[1] as number) : null;
    }
    if ('div' in e) {
      const xs = list('div');
      return xs && xs.length === 2 && xs[1] !== 0 ? (xs[0] as number) / (xs[1] as number) : null;
    }
    if ('floorTo' in e) {
      const xs = list('floorTo');
      return xs && xs.length === 2 && (xs[1] as number) > 0
        ? Math.floor((xs[0] as number) / (xs[1] as number)) * (xs[1] as number)
        : null;
    }
    if ('abs' in e) {
      const c = this.constEval(e.abs);
      return c === null ? null : Math.abs(c);
    }
    return null;
  }

  // ------------------------------------------------------------------ cross checks and warnings

  private finish(): void {
    const byId = new Map<string, StageInfo>();
    for (const s of this.stages) if (!byId.has(s.id)) byId.set(s.id, s);
    // extends: cycles and depth
    const cycleReported = new Set<number>();
    const chainOf = (s: StageInfo): { chain: StageInfo[]; cycle: StageInfo[] | null } => {
      const chain: StageInfo[] = [s];
      let cur = s;
      while (cur.extendsId !== null) {
        const next = byId.get(cur.extendsId);
        if (!next) break;
        const at0 = chain.indexOf(next);
        if (at0 >= 0) return { chain, cycle: chain.slice(at0) };
        chain.push(next);
        cur = next;
      }
      return { chain, cycle: null };
    };
    const chains = new Map<number, StageInfo[]>();
    for (const s of this.stages) {
      const { chain, cycle } = chainOf(s);
      if (cycle) {
        const first = cycle.reduce((a, b) => (b.index < a.index ? b : a));
        if (!cycleReported.has(first.index)) {
          for (const m of cycle) cycleReported.add(m.index);
          this.err('E_EXTENDS_CYCLE', at(at('/stages', first.index), 'extends'), {
            value: first.id,
          });
        }
        continue;
      }
      chains.set(s.index, chain);
      if (chain.length - 1 > 4) this.err('E_EXTENDS_DEPTH', at(at('/stages', s.index), 'extends'));
      const layouts = chain.reduce((n, c) => n + c.layout.length, 0);
      const rules = chain.reduce((n, c) => n + c.ownRules, 0);
      if (layouts > 64 && chain.length > 1)
        this.err('E_LIMIT', at(at('/stages', s.index), 'layout'), {
          detail: 'more than 64 layout entries after extends',
        });
      if (rules > 128 && chain.length > 1)
        this.err('E_LIMIT', at(at('/stages', s.index), 'rules'), {
          detail: 'more than 128 rules after extends',
        });
    }
    // progression expression cycles
    this.exprCycles();
    this.warnings(byId, chains);
  }

  private exprCycles(): void {
    const state = new Map<string, number>(); // 1 visiting, 2 done
    const reported = new Set<string>();
    const visit = (name: string): void => {
      state.set(name, 1);
      const info = this.progs.get(name);
      for (const edge of info?.edges ?? []) {
        if (!this.progs.has(edge.to)) continue;
        const st = state.get(edge.to);
        if (st === 1) {
          if (!reported.has(edge.path)) {
            reported.add(edge.path);
            this.err('E_EXPR_CYCLE', edge.path, { value: edge.to });
          }
        } else if (st === undefined) visit(edge.to);
      }
      state.set(name, 2);
    };
    for (const name of this.progs.keys()) if (!state.has(name)) visit(name);
  }

  private warnings(byId: Map<string, StageInfo>, chains: Map<number, StageInfo[]>): void {
    if (!isObj(this.def)) return;
    const extended = new Set(this.stages.map((s) => s.extendsId).filter((x) => x !== null));
    // unreachable stages
    for (const s of this.stages) {
      if (s.index === 0 || !s.id) continue;
      if (!this.gotoTargets.has(s.id) && !extended.has(s.id))
        this.err('W_UNREACHABLE_STAGE', at(at('/stages', s.index), 'id'), { value: s.id });
    }
    // effect cap worst case
    for (const s of this.stages) {
      const chain = chains.get(s.index);
      if (!chain) continue;
      const rules = chain.reduce((n, c) => n + c.ruleThenCounts.reduce((a, b) => a + b, 0), 0);
      let pair = 0;
      for (const c of chain)
        for (const g of c.gotos) {
          const t = byId.get(g);
          if (t) pair = Math.max(pair, s.onExit + t.onEnter);
        }
      const total = rules + pair + (s.index === 0 ? s.onEnter : 0);
      if (total > 16)
        this.err('W_EFFECT_CAP_POSSIBLE', at(at('/stages', s.index), 'rules'), { value: total });
    }
    // unused vars and progressions
    for (const v of this.varNames)
      if (!this.varReads.has(v)) this.err('W_UNUSED_VAR', at('/vars', v), { value: v });
    for (const p of this.progNames)
      if (!this.progReads.has(p)) this.err('W_UNUSED_PROG', at('/progressions', p), { value: p });
    // track mismatch, table max
    for (const info of this.progs.values()) {
      const sized = this.layoutProgBets.get(info.name);
      if (
        Array.isArray(info.track) &&
        sized &&
        sized.size > 0 &&
        !info.track.some((b) => sized.has(b))
      )
        this.err('W_TRACK_MISMATCH', info.trackPath, { value: info.name });
      if (sized && info.top !== null && this.ctx) {
        for (const b of sized) {
          const max = this.ctx.limits(b, this.ctx.rules)?.max;
          if (max !== undefined && info.top > max) {
            this.err('W_PROG_ABOVE_TABLE_MAX', info.path, {
              value: info.name,
              amount: info.top,
              max,
            });
            break;
          }
        }
      }
    }
    // no layout
    const anyLayout = this.stages.some((s) => s.layout.length > 0);
    if (!anyLayout && !this.hasBetEffect) this.err('W_NO_LAYOUT', '/stages');
    // needs parent, inside totals
    if (this.ctx) {
      for (const s of this.stages) {
        const chain = chains.get(s.index) ?? [s];
        const entries = chain.flatMap((c) => c.layout);
        const present = new Set(entries.map((l) => l.bet));
        for (const l of s.layout) {
          const np = l.entry?.needsParent;
          if (np && np.length > 0 && !np.some((x) => present.has(x)))
            this.err('W_NEEDS_PARENT', l.path, { value: l.bet ?? '' });
        }
        const perClass = new Map<string, number>();
        for (const l of entries) {
          if (!l.entry || l.entry.limitClass === 'outside' || l.constAmount === null) continue;
          perClass.set(
            l.entry.limitClass,
            (perClass.get(l.entry.limitClass) ?? 0) + Math.floor(l.constAmount),
          );
        }
        for (const [cls, total] of perClass) {
          const lim = this.ctx.limits(cls, this.ctx.rules);
          const allConst = entries
            .filter((l) => l.entry?.limitClass === cls)
            .every((l) => l.constAmount !== null);
          if (lim && allConst && total > 0 && total < lim.min)
            this.err('W_BELOW_MIN_POSSIBLE', at(at('/stages', s.index), 'layout'), {
              amount: total,
              min: lim.min,
            });
        }
      }
    }
  }
}

/** Names of progressions read through `{ prog }` anywhere inside `x`. */
function scanProgs(x: unknown, out: Set<string>): void {
  if (Array.isArray(x)) {
    for (const y of x) scanProgs(y, out);
  } else if (isObj(x)) {
    if (typeof x.prog === 'string' && !('do' in x)) out.add(x.prog);
    for (const k of Object.keys(x)) if (!k.startsWith('x-')) scanProgs(x[k], out);
  }
}

/**
 * `ctx` null = structural checks only; with `ctx` = full checks (strategy.md §9). Never throws:
 * every problem is a diagnostic, in document order.
 */
export function validateStrategy(def: unknown, ctx: CompileContext | null): Diagnostic[] {
  try {
    return new Validator(def, ctx).run();
  } catch (e) {
    return [diagnostic('E_INTERNAL', '', { detail: e instanceof Error ? e.message : String(e) })];
  }
}

/** `W_NO_EXIT` (experiment level): no strategy `stop` and no session `stopWin`/`stopLoss`. */
export function noExitWarning(def: unknown, sessionHasStops: boolean): Diagnostic | null {
  if (sessionHasStops) return null;
  let found = false;
  const walk = (x: unknown): void => {
    if (found) return;
    if (Array.isArray(x)) x.forEach(walk);
    else if (isObj(x)) {
      if (typeof x.stop === 'string') found = true;
      else Object.values(x).forEach(walk);
    }
  };
  walk(def);
  return found ? null : diagnostic('W_NO_EXIT', '');
}
