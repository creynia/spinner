// The Define screen's document: everything the four cards edit, and how it becomes an
// `ExperimentDefinition`, plus the analysis (validation + normalization) that feeds the panel.
import type { ExperimentDefinition, Json, NormalizedDefinition } from '@core/contracts/experiment';
import type { RulesRef } from '@core/contracts/game';
import type { CompileContext, Diagnostic, StrategyDefinition } from '@core/contracts/strategy';
import { canonicalJson, normalizeDefinition, noExitWarning, validateStrategy } from '@core';
import type { ChipLayout, StageChips } from '@core/contracts/layout';
import { normalizeStrategy, withStageChips } from '@core/strategy';
import { STRATEGY_PRESETS, type RouletteRules } from '@game/roulette';
import { game } from '../../services/game';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

export const DEFAULT_SEED = 20261028;

export interface DefineDoc {
  name: string;
  notes?: string;
  tags?: string[];
  preset: string;
  /** Rule overrides as they appear in the definition (`laPartage`, `limits`, `pace`, ...). */
  overrides: Record<string, Json>;
  /** The strategy document; may be invalid while editing. */
  strategy: unknown;
  /** Where the strategy came from, for the card's summary. */
  source: { kind: 'preset' | 'library' | 'custom' | 'link'; id?: string };
  bankroll: number;
  maxRounds: number;
  stopWin?: number;
  stopLoss?: number;
  sessions: number;
  seed: number;
  sampleSessions: number;
  roundsPerHourExplicit?: number;
  derivedFrom?: string;
}

// ------------------------------------------------------------------ presets

const presetFiles = import.meta.glob<StrategyDefinition>('../../../game/roulette/presets/*.json', {
  eager: true,
  import: 'default',
});

const byId = new Map<string, StrategyDefinition>();
for (const [path, def] of Object.entries(presetFiles)) {
  byId.set(
    path
      .split('/')
      .pop()!
      .replace(/\.json$/, ''),
    def,
  );
}

export const PRESET_LIST: readonly { id: string; name: string }[] = STRATEGY_PRESETS.map((p) => ({
  id: p.id,
  name: p.name,
}));

export function presetStrategy(id: string): StrategyDefinition | null {
  const d = byId.get(id);
  return d ? structuredClone(d) : null;
}

export function defaultDoc(): DefineDoc {
  const s = presetStrategy('flat-red') ?? undefined;
  return {
    name: 'Flat: red',
    preset: 'european',
    overrides: {},
    strategy: s,
    source: { kind: 'preset', id: 'flat-red' },
    bankroll: 500_000,
    maxRounds: 500,
    sessions: 10_000,
    seed: DEFAULT_SEED,
    sampleSessions: 24,
  };
}

export function docWithStrategy(
  doc: DefineDoc,
  strategy: StrategyDefinition,
  source: DefineDoc['source'],
): DefineDoc {
  const s = structuredClone(strategy);
  return {
    ...doc,
    strategy: s,
    source,
    name: source.kind === 'preset' || doc.name === '' ? s.name : doc.name,
  };
}

// ------------------------------------------------------------------ rules overrides

export function getOverride(ov: Record<string, Json>, path: string[]): Json | undefined {
  let cur: Json | undefined = ov;
  for (const k of path) {
    if (!isObj(cur)) return undefined;
    cur = (cur as Record<string, Json>)[k];
  }
  return cur;
}

/** Sets (or, with `undefined`, removes) a nested override, pruning objects left empty. */
export function setOverride(
  ov: Record<string, Json>,
  path: string[],
  value: Json | undefined,
): Record<string, Json> {
  const root = structuredClone(ov);
  const walk = (o: Record<string, Json>, i: number): void => {
    const k = path[i]!;
    if (i === path.length - 1) {
      if (value === undefined) delete o[k];
      else o[k] = value;
      return;
    }
    const child = o[k];
    const next: Record<string, Json> = isObj(child) ? child : {};
    o[k] = next;
    walk(next, i + 1);
    if (Object.keys(next).length === 0) delete o[k];
  };
  walk(root, 0);
  return root;
}

export function rulesRef(doc: DefineDoc): RulesRef {
  return { preset: doc.preset, overrides: doc.overrides };
}

export function resolveRulesSafe(doc: DefineDoc): {
  rules: RouletteRules | null;
  error: string | null;
} {
  try {
    return { rules: game.plugin.rules.resolve(rulesRef(doc)), error: null };
  } catch (e) {
    return { rules: null, error: e instanceof Error ? e.message : 'Invalid rules' };
  }
}

// ------------------------------------------------------------------ definition

export function docToDefinition(doc: DefineDoc): ExperimentDefinition {
  const strategy = doc.strategy as StrategyDefinition;
  const session: ExperimentDefinition['session'] = {
    bankroll: doc.bankroll,
    maxRounds: doc.maxRounds,
  };
  if (doc.stopWin !== undefined) session.stopWin = doc.stopWin;
  if (doc.stopLoss !== undefined) session.stopLoss = doc.stopLoss;
  if (doc.roundsPerHourExplicit !== undefined) session.roundsPerHour = doc.roundsPerHourExplicit;
  const d: ExperimentDefinition = {
    schema: 1,
    name: doc.name,
    game: { id: 'roulette', rules: rulesRef(doc) },
    strategy,
    session,
    run: { sessions: doc.sessions, seed: doc.seed, sampleSessions: doc.sampleSessions },
  };
  if (doc.notes) d.notes = doc.notes;
  if (doc.tags?.length) d.tags = doc.tags;
  return d;
}

export function definitionToDoc(d: ExperimentDefinition, source: DefineDoc['source']): DefineDoc {
  const rules =
    typeof d.game.rules === 'string' ? { preset: d.game.rules, overrides: {} } : d.game.rules;
  const doc: DefineDoc = {
    name: d.name,
    preset: rules.preset,
    overrides: structuredClone(rules.overrides ?? {}),
    strategy:
      'ref' in d.strategy && !('stages' in d.strategy) ? undefined : structuredClone(d.strategy),
    source,
    bankroll: d.session.bankroll,
    maxRounds: d.session.maxRounds,
    sessions: d.run.sessions,
    seed: d.run.seed,
    sampleSessions: d.run.sampleSessions ?? 24,
  };
  if (d.notes) doc.notes = d.notes;
  if (d.tags) doc.tags = d.tags;
  if (d.session.stopWin !== undefined) doc.stopWin = d.session.stopWin;
  if (d.session.stopLoss !== undefined) doc.stopLoss = d.session.stopLoss;
  if (d.session.roundsPerHour !== undefined) doc.roundsPerHourExplicit = d.session.roundsPerHour;
  return doc;
}

/** The compile context the validator needs, for one set of resolved rules. */
export function validationContext(rules: RouletteRules): CompileContext & { gameId: string } {
  const plugin = game.plugin;
  return {
    gameId: plugin.id,
    catalog: plugin.bets.catalog(rules),
    parseBet: (id) => plugin.bets.parse(id),
    facts: plugin.facts,
    rules,
    limits: (b, r, v) => plugin.limits(b, r as RouletteRules, v as never),
    compileFact: (ref, r) => plugin.compileFact(ref, r as RouletteRules),
  };
}

// ------------------------------------------------------------------ analysis

export interface Analysis {
  rules: RouletteRules | null;
  rulesError: string | null;
  /** Structural-only diagnostics (gate for the builder). */
  structural: Diagnostic[];
  /** Strategy diagnostics with the plugin context, plus the no-exit warning; strategy paths. */
  strategy: Diagnostic[];
  /** Everything else (`/session/...`, `/run/...`, `/game/...`), definition paths. */
  definition: Diagnostic[];
  normalized: NormalizedDefinition | null;
  errorCount: number;
  warningCount: number;
}

export function analyze(doc: DefineDoc): Analysis {
  const { rules, error } = resolveRulesSafe(doc);
  const structural = validateStrategy(doc.strategy, null);
  let strategy: Diagnostic[] = structural;
  if (rules) {
    strategy = validateStrategy(doc.strategy, validationContext(rules));
    const exit = noExitWarning(
      doc.strategy,
      doc.stopWin !== undefined || doc.stopLoss !== undefined,
    );
    if (exit) strategy = [...strategy, exit];
  }
  const definition: Diagnostic[] = [];
  let normalized: NormalizedDefinition | null = null;
  if (error) {
    definition.push({ code: 'E_RULES', severity: 'error', path: '/game/rules', message: error });
  }
  if (isObj(doc.strategy)) {
    const res = normalizeDefinition(docToDefinition(doc), {
      plugin: game.plugin,
      resolveStrategyRef: () => undefined,
    });
    for (const d of [...(res.ok ? [] : res.errors), ...res.warnings]) {
      if (d.path.startsWith('/strategy') || d.path === '/game/rules') continue;
      definition.push(d);
    }
    if (res.ok) normalized = res.definition;
  } else {
    definition.push({
      code: 'E_REQUIRED',
      severity: 'error',
      path: '/strategy',
      message: 'Choose or write a strategy.',
    });
  }
  const all = [...strategy, ...definition];
  return {
    rules,
    rulesError: error,
    structural,
    strategy,
    definition,
    normalized: normalized && !all.some((d) => d.severity === 'error') ? normalized : null,
    errorCount: all.filter((d) => d.severity === 'error').length,
    warningCount: all.filter((d) => d.severity === 'warning').length,
  };
}

/** Which card a definition-level diagnostic belongs to. */
export function cardOf(path: string): 'game' | 'strategy' | 'session' | 'run' {
  if (path.startsWith('/session')) return 'session';
  if (path.startsWith('/run')) return 'run';
  if (path.startsWith('/game')) return 'game';
  return 'strategy';
}

/** Sets the strategy unit (cents) on an object strategy; leaves other values alone. */
export function withUnit(strategy: unknown, unit: number): unknown {
  return isObj(strategy) ? { ...strategy, unit } : strategy;
}

export function strategyUnit(strategy: unknown): number {
  return isObj(strategy) && typeof strategy.unit === 'number' ? strategy.unit : 2500;
}

/**
 * A strategy that plays `layout` (`#/define?layout=<id>`, layouts.md §4.7).
 *
 * - Untouched start (the default Flat red, `base` still equal to `fresh`): the layout becomes the
 *   strategy's only stage, `play`, so a new experiment is one tap from running.
 * - Anything else: a new last stage `layout-<n>` holding a copy of the layout is appended. It has
 *   no transition into it yet (the user adds one), and the builder's reachability warning says so.
 *
 * Either way the stage carries a copy of the spots at `chip` cents, with `from` pointing at the
 * library entry.
 */
export function strategyWithLayout(
  base: unknown,
  fresh: unknown,
  layout: ChipLayout,
  from: NonNullable<StageChips['from']>,
  chip: number,
): { strategy: unknown; appended: boolean } {
  const chips: StageChips = {
    v: 1,
    chip,
    spots: layout.spots.map((x) => ({ ...x })),
    from,
  };
  const pristine = !isObj(base) || JSON.stringify(base) === JSON.stringify(fresh);
  if (pristine) {
    const src = isObj(base) ? base : {};
    const stage = withStageChips({ id: 'play' }, chips) as unknown as Obj;
    return {
      strategy: {
        ...src,
        name: layout.name,
        id: `${layout.id}-strategy`.slice(0, 40),
        stages: [stage],
      },
      appended: false,
    };
  }
  const src = base;
  const stages = Array.isArray(src.stages) ? [...(src.stages as Obj[])] : [];
  const ids = new Set(stages.map((x) => String(x.id)));
  let n = stages.length + 1;
  while (ids.has(`layout-${n}`)) n++;
  const stage = withStageChips({ id: `layout-${n}` }, chips) as unknown as Obj;
  return { strategy: { ...src, stages: [...stages, stage] }, appended: true };
}

/** Whether two strategy documents normalize to the same thing (key order and defaults aside). */
export function isSameStrategy(a: unknown, b: unknown): boolean {
  try {
    return (
      canonicalJson(normalizeStrategy(a as StrategyDefinition) as unknown as Json) ===
      canonicalJson(normalizeStrategy(b as StrategyDefinition) as unknown as Json)
    );
  } catch {
    return false;
  }
}
