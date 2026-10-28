// The builder view model (strategy.md §13.1, §13.4): `fromJson(def)` and `toJson(model)`.
// Laws: toJson(fromJson(d)) deep-equals normalizeStrategy(d); fromJson(toJson(m)) equals m.
// Everything the builder has no form for is kept verbatim (raw chips, formula amounts, `extra`).
import type { LayoutSpot, StageChips } from '../../contracts/layout';
import type {
  Condition,
  Effect,
  Expr,
  LayoutSpec,
  ProgressionSpec,
  Rule,
  Stage,
  StrategyDefinition,
} from '../../contracts/strategy';
import { str } from './env';
import { compileChips, liftRows, normalizeStrategy, splitStageLayout } from '../../strategy';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const clone = <T>(x: T): T => structuredClone(x);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** Keys the model owns per object kind; everything else is carried in `extra`. */
function split(o: Obj, own: readonly string[]): { picked: Obj; extra: Obj } {
  const picked: Obj = {};
  const extra: Obj = {};
  for (const k of Object.keys(o)) (own.includes(k) ? picked : extra)[k] = o[k];
  return { picked, extra };
}

// ------------------------------------------------------------------ conditions

export type ConditionChip =
  | { kind: 'leaf'; cond: Condition }
  | { kind: 'not'; chip: ConditionChip }
  | { kind: 'group'; group: ConditionChips }
  | { kind: 'raw'; cond: Condition };
export interface ConditionChips {
  mode: 'all' | 'any';
  chips: ConditionChip[];
}

const LEAF_KEYS = [
  'cmp',
  'fact',
  'event',
  'onTable',
  'streak',
  'countInLast',
  'since',
  'everyN',
] as const;

function soleKey(c: Obj): string | null {
  const k = Object.keys(c);
  return k.length === 1 ? k[0]! : null;
}

function isLeaf(c: unknown): c is Condition {
  if (!isObj(c)) return false;
  // `event` carries sibling filter keys (bet, prog, args); the rest are single-key objects.
  if ('event' in c)
    return Object.keys(c).every((k) => ['event', 'bet', 'prog', 'args'].includes(k));
  if ('everyN' in c) return Object.keys(c).every((k) => ['everyN', 'offset', 'of'].includes(k));
  const k = soleKey(c);
  return k !== null && (LEAF_KEYS as readonly string[]).includes(k);
}

function toChip(c: unknown, depth: number): ConditionChip {
  if (isObj(c)) {
    if (isLeaf(c)) return { kind: 'leaf', cond: c };
    if (soleKey(c) === 'not' && isObj(c.not) && isLeaf(c.not)) {
      return { kind: 'not', chip: { kind: 'leaf', cond: c.not } };
    }
    if (
      depth === 0 &&
      soleKey(c) === 'any' &&
      arr(c.any).length > 0 &&
      arr(c.any).every(isLeafish)
    ) {
      return { kind: 'group', group: { mode: 'any', chips: arr(c.any).map((x) => toChip(x, 1)) } };
    }
    if (
      depth === 0 &&
      soleKey(c) === 'all' &&
      arr(c.all).length > 0 &&
      arr(c.all).every(isLeafish)
    ) {
      return { kind: 'group', group: { mode: 'all', chips: arr(c.all).map((x) => toChip(x, 1)) } };
    }
  }
  return { kind: 'raw', cond: clone(c) as Condition };
}
function isLeafish(c: unknown): boolean {
  return isLeaf(c) || (isObj(c) && soleKey(c) === 'not' && isObj(c.not) && isLeaf(c.not));
}

export function chipFromCond(c: unknown): ConditionChip {
  return toChip(c, 0);
}

export function chipToCondition(chip: ConditionChip): Condition {
  return chipToCond(chip);
}

export function condToChips(c: unknown): ConditionChips {
  if (isObj(c)) {
    const k = soleKey(c);
    if (k === 'always' && c.always === true) return { mode: 'all', chips: [] };
    if (k === 'all' && Array.isArray(c.all)) {
      return { mode: 'all', chips: c.all.map((x) => toChip(x, 0)) };
    }
    if (k === 'any' && Array.isArray(c.any)) {
      return { mode: 'any', chips: c.any.map((x) => toChip(x, 0)) };
    }
  }
  return { mode: 'all', chips: [toChip(c, 0)] };
}

function chipToCond(chip: ConditionChip): Condition {
  switch (chip.kind) {
    case 'leaf':
    case 'raw':
      return clone(chip.cond);
    case 'not':
      return { not: chipToCond(chip.chip) };
    case 'group':
      return chipsToCond(chip.group);
  }
}

export function chipsToCond(g: ConditionChips): Condition {
  if (g.chips.length === 0) return g.mode === 'all' ? { always: true } : { any: [] };
  if (g.chips.length === 1) return chipToCond(g.chips[0]!);
  return g.mode === 'all' ? { all: g.chips.map(chipToCond) } : { any: g.chips.map(chipToCond) };
}

// ------------------------------------------------------------------ amounts

export type AmountModel =
  | { kind: 'units'; n: number }
  | { kind: 'cents'; cents: number }
  | { kind: 'prog'; name: string }
  | { kind: 'pct'; p: number }
  | { kind: 'tableMin'; of: string }
  | { kind: 'keep'; inner: AmountModel }
  | { kind: 'formula'; expr: Expr };

export function amountFrom(e: unknown): AmountModel {
  if (typeof e === 'number' && Number.isInteger(e)) return { kind: 'cents', cents: e };
  if (isObj(e)) {
    const k = soleKey(e);
    if (k === 'units' && typeof e.units === 'number') return { kind: 'units', n: e.units };
    if (k === 'prog' && typeof e.prog === 'string') return { kind: 'prog', name: e.prog };
    if (k === 'pctOfBankroll' && typeof e.pctOfBankroll === 'number')
      return { kind: 'pct', p: e.pctOfBankroll };
    if (k === 'tableMin' && typeof e.tableMin === 'string')
      return { kind: 'tableMin', of: e.tableMin };
    if (k === 'keepOr') return { kind: 'keep', inner: amountFrom(e.keepOr) };
  }
  return { kind: 'formula', expr: clone(e) as Expr };
}

export function amountTo(a: AmountModel): unknown {
  switch (a.kind) {
    case 'units':
      return { units: a.n };
    case 'cents':
      return a.cents;
    case 'prog':
      return { prog: a.name };
    case 'pct':
      return { pctOfBankroll: a.p };
    case 'tableMin':
      return { tableMin: a.of };
    case 'keep':
      return { keepOr: amountTo(a.inner) };
    case 'formula':
      return clone(a.expr);
  }
}

// ------------------------------------------------------------------ model

export interface LayoutRow {
  bet: string;
  amount: AmountModel;
  /** Absent = always. */
  when?: ConditionChips;
  parent?: string;
  working?: 'on' | 'off';
  label?: string;
  extra: Obj;
}
export interface EffectChip {
  effect: Effect;
}
export interface RuleRow {
  id?: string;
  label?: string;
  enabled: boolean;
  when: ConditionChips;
  then: EffectChip[];
  once: false | true | 'stage';
  cooldown?: number;
  extra: Obj;
}
export interface StageCard {
  id: string;
  label?: string;
  extends?: string;
  /**
   * The manual rows ("Other bets"): the rows after the generated prefix, or every row when
   * `chipsStale` (layouts.md §7.1). With `chips` set and fresh, the prefix is not held here.
   */
  layout: LayoutRow[];
  /** The stage's `x-chips` block (a frozen copy of the spots plus the chip value); null when none. */
  chips: StageChips | null;
  /** The generated prefix no longer matches `chips`; every row is then in `layout`, verbatim. */
  chipsStale: boolean;
  onEnter: EffectChip[];
  onExit: EffectChip[];
  rules: RuleRow[];
  /** Which optional arrays the source had, so empty ones survive the round trip. */
  has: { layout: boolean; onEnter: boolean; onExit: boolean };
  extra: Obj;
}
export interface BuilderModel {
  head: { schema: 1; kind?: 'rules'; id: string; name: string; game: string; unit: number };
  notes?: string;
  tags?: string[];
  vars?: { name: string; initial: number }[];
  progressions?: { name: string; spec: ProgressionSpec }[];
  stages: StageCard[];
  extra: Obj;
}

const ROOT_OWN = [
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
const STAGE_OWN = ['id', 'label', 'extends', 'layout', 'onEnter', 'onExit', 'rules'];
const LAYOUT_OWN = ['bet', 'amount', 'when', 'parent', 'working', 'label'];
const RULE_OWN = ['id', 'label', 'enabled', 'when', 'then', 'once', 'cooldown'];

function layoutFrom(l: Obj): LayoutRow {
  const { picked, extra } = split(l, LAYOUT_OWN);
  const a = picked.amount;
  const row: LayoutRow = {
    bet: str(picked.bet),
    amount: amountFrom(a),
    extra: clone(extra),
  };
  if ('when' in picked) row.when = condToChips(picked.when);
  if ('parent' in picked) row.parent = str(picked.parent);
  if (picked.working === 'on' || picked.working === 'off') row.working = picked.working;
  if ('label' in picked) row.label = str(picked.label);
  return row;
}
function layoutTo(r: LayoutRow): LayoutSpec {
  const o: Obj = { bet: r.bet, amount: amountTo(r.amount) };
  if (r.when) o.when = chipsToCond(r.when);
  if (r.parent !== undefined) o.parent = r.parent;
  if (r.working) o.working = r.working;
  if (r.label !== undefined) o.label = r.label;
  return { ...clone(r.extra), ...o } as unknown as LayoutSpec;
}

function ruleFrom(r: Obj): RuleRow {
  const { picked, extra } = split(r, RULE_OWN);
  const row: RuleRow = {
    enabled: picked.enabled !== false,
    when: condToChips(picked.when),
    then: arr(picked.then).map((e) => ({ effect: clone(e) as Effect })),
    once: picked.once === true ? true : picked.once === 'stage' ? 'stage' : false,
    extra: clone(extra),
  };
  if ('id' in picked) row.id = str(picked.id);
  if ('label' in picked) row.label = str(picked.label);
  if ('cooldown' in picked) row.cooldown = Number(picked.cooldown);
  return row;
}
function ruleTo(r: RuleRow): Rule {
  const o: Obj = {};
  if (r.id !== undefined) o.id = r.id;
  if (r.label !== undefined) o.label = r.label;
  if (!r.enabled) o.enabled = false;
  o.when = chipsToCond(r.when);
  o.then = r.then.map((c) => clone(c.effect));
  if (r.once !== false) o.once = r.once;
  if (r.cooldown !== undefined) o.cooldown = r.cooldown;
  return { ...clone(r.extra), ...o } as unknown as Rule;
}

function normEffect(e: Effect): Effect {
  const o = clone(e) as unknown as Obj;
  if (o.working === 'auto') delete o.working;
  return o as unknown as Effect;
}

/**
 * Defensive: a document that passed the structural validator. Never throws on shaped input.
 * `opts.chips: false` is the chips-unaware builder (no `env.chips`): `x-chips` stays in `extra` and
 * `layout` holds every row, exactly as before chips existed.
 */
export function fromJson(source: StrategyDefinition, opts: { chips?: boolean } = {}): BuilderModel {
  const aware = opts.chips !== false;
  const d = normalizeStrategy(source) as unknown as Obj;
  const { picked, extra } = split(d, ROOT_OWN);
  const m: BuilderModel = {
    head: {
      schema: 1,
      id: str(picked.id ?? ''),
      name: str(picked.name ?? ''),
      game: str(picked.game ?? 'roulette'),
      unit: Number(picked.unit ?? 0),
    },
    stages: arr(picked.stages)
      .filter(isObj)
      .map((s): StageCard => {
        const sp = split(s, STAGE_OWN);
        const p = sp.picked;
        // A readable block leaves `extra` for the model; a malformed one stays there verbatim.
        const lay = aware ? splitStageLayout(s as unknown as Stage) : null;
        const chips = lay?.chips ?? null;
        if (chips) delete sp.extra['x-chips'];
        const rows = chips && lay ? lay.manual : arr(p.layout);
        const card: StageCard = {
          id: str(p.id ?? ''),
          layout: rows.filter(isObj).map(layoutFrom),
          chips,
          chipsStale: !!lay?.stale,
          onEnter: arr(p.onEnter).map((e) => ({ effect: normEffect(e as Effect) })),
          onExit: arr(p.onExit).map((e) => ({ effect: normEffect(e as Effect) })),
          rules: arr(p.rules).filter(isObj).map(ruleFrom),
          has: {
            layout: 'layout' in p,
            onEnter: 'onEnter' in p,
            onExit: 'onExit' in p,
          },
          extra: clone(sp.extra),
        };
        if ('label' in p) card.label = str(p.label);
        if ('extends' in p) card.extends = str(p.extends);
        return card;
      }),
    extra: clone(extra),
  };
  if (picked.kind === 'rules') m.head.kind = 'rules';
  if ('notes' in picked) m.notes = str(picked.notes);
  if (Array.isArray(picked.tags)) m.tags = picked.tags.map(String);
  if (isObj(picked.vars))
    m.vars = Object.entries(picked.vars).map(([name, initial]) => ({
      name,
      initial: Number(initial),
    }));
  if (isObj(picked.progressions))
    m.progressions = Object.entries(picked.progressions).map(([name, spec]) => ({
      name,
      spec: clone(spec) as ProgressionSpec,
    }));
  return m;
}

function normProg(spec: ProgressionSpec): ProgressionSpec {
  const o = clone(spec) as unknown as Obj;
  if (o.feed === 'sized') delete o.feed;
  return o as unknown as ProgressionSpec;
}

export function toJson(m: BuilderModel): StrategyDefinition {
  const o: Obj = { ...clone(m.extra) };
  o.schema = 1;
  if (m.head.kind) o.kind = m.head.kind;
  o.id = m.head.id;
  o.name = m.head.name;
  o.game = m.head.game;
  if (m.notes !== undefined) o.notes = m.notes;
  if (m.tags !== undefined) o.tags = [...m.tags];
  o.unit = m.head.unit;
  if (m.vars) o.vars = Object.fromEntries(m.vars.map((v) => [v.name, v.initial]));
  if (m.progressions)
    o.progressions = Object.fromEntries(m.progressions.map((p) => [p.name, normProg(p.spec)]));
  o.stages = m.stages.map((s): Stage => {
    const st: Obj = { ...clone(s.extra), id: s.id };
    if (s.label !== undefined) st.label = s.label;
    if (s.extends !== undefined) st.extends = s.extends;
    // A stale block is written back as it came, with every row verbatim (§7.1): regenerating the
    // prefix (`withStageChips`) would turn the old rows into manual ones and change the document.
    if (s.chips) st['x-chips'] = clone(s.chips);
    const rows = s.layout.map(layoutTo);
    const layout = s.chips && !s.chipsStale ? [...compileChips(s.chips), ...rows] : rows;
    if (layout.length > 0 || s.has.layout) st.layout = layout;
    if (s.onEnter.length > 0 || s.has.onEnter)
      st.onEnter = s.onEnter.map((c) => normEffect(c.effect));
    if (s.onExit.length > 0 || s.has.onExit) st.onExit = s.onExit.map((c) => normEffect(c.effect));
    if (s.rules.length > 0) st.rules = s.rules.map(ruleTo);
    return st as unknown as Stage;
  });
  // effects inside rules also drop `working: auto`
  for (const st of o.stages as { rules?: Rule[] }[]) {
    for (const r of st.rules ?? []) r.then = r.then.map(normEffect);
  }
  return o as unknown as StrategyDefinition;
}

// ------------------------------------------------------------------ editing helpers

/** Slug not yet used among `taken`, derived from `base`. */
export function freshSlug(base: string, taken: readonly string[]): string {
  const root =
    base
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^[^a-z]+/, 'x')
      .slice(0, 34) || 'x';
  if (!taken.includes(root)) return root;
  for (let i = 2; ; i++) if (!taken.includes(`${root}-${i}`)) return `${root}-${i}`;
}

export function emptyStage(taken: readonly string[]): StageCard {
  return {
    id: freshSlug('stage', taken),
    layout: [],
    chips: null,
    chipsStale: false,
    onEnter: [],
    onExit: [],
    rules: [],
    has: { layout: false, onEnter: false, onExit: false },
    extra: {},
  };
}

export function emptyStrategy(unit: number, game = 'roulette'): StrategyDefinition {
  return {
    schema: 1,
    id: 'my-strategy',
    name: 'My strategy',
    game,
    unit,
    stages: [{ id: 'play', layout: [{ bet: 'red', amount: { units: 1 } }] }],
  };
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

// ------------------------------------------------------------------ chips helpers (layouts.md §7)

/** Number of generated rows at the front of the stage's layout (0 when stale or without chips). */
export function generatedCount(card: StageCard): number {
  return card.chips && !card.chipsStale ? card.chips.spots.length : 0;
}

/** The chip-shaped rows of a stage without chips as a block, with `layout` unchanged (§5.1); null if none. */
export function liftableChips(card: StageCard): StageChips | null {
  if (card.chips) return null;
  return liftRows(card.layout.map(layoutTo));
}

/** Whether every row of a stage without chips is chip-shaped (the rows lift completely). */
export function liftsAll(card: StageCard): boolean {
  const lifted = liftableChips(card);
  return !!lifted && lifted.spots.length === card.layout.length;
}

/** Lifts the chip-shaped rows into `x-chips`; the generated prefix equals the rows it replaces, so the JSON `layout` is unchanged. */
export function liftCard(card: StageCard): StageChips | null {
  const lifted = liftableChips(card);
  if (!lifted) return null;
  card.layout = card.layout.slice(lifted.spots.length);
  card.chips = lifted;
  card.chipsStale = false;
  card.has.layout = true;
  return lifted;
}

/** Sets a fresh block (the prefix is regenerated on `toJson`); manual rows are kept. */
export function setCardChips(card: StageCard, chips: StageChips): void {
  card.chips = chips;
  card.chipsStale = false;
  card.has.layout = true;
}

/** Rebuilds a stale stage from its block: the old rows the block shadows are dropped, the rest stay manual. */
export function rebuildStale(card: StageCard): void {
  const c = card.chips;
  if (!c) return;
  const bets = new Set(c.spots.map((s) => s.bet));
  card.layout = card.layout.filter((r) => !bets.has(r.bet));
  card.chipsStale = false;
  card.has.layout = true;
}

/**
 * Forgets the block. A stale stage keeps every row (they are what runs). A fresh one keeps its
 * generated rows as plain bets with `keepRows`, else drops them (the chips were their source).
 */
export function forgetChips(card: StageCard, keepRows: boolean): void {
  const c = card.chips;
  if (!c) return;
  if (!card.chipsStale && keepRows) {
    const gen = compileChips(c).map((r) => layoutFrom(r as unknown as Obj));
    card.layout = [...gen, ...card.layout];
  }
  card.chips = null;
  card.chipsStale = false;
}

/** Replaces the spots of a fresh block, keeping `chip`, `from` and any `x-` keys. */
export function withSpots(chips: StageChips, spots: readonly LayoutSpot[]): StageChips {
  return { ...chips, spots: spots.map((s) => ({ ...s })) };
}
