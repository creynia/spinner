import type {
  ExperimentDefinition,
  Json,
  NormalizeContext,
  NormalizedDefinition,
  NormalizeResult,
} from '../contracts/experiment';
import type { CompileContext, Diagnostic, StrategyDefinition } from '../contracts/strategy';
import { normalizeStrategy, validateStrategy } from '../strategy';
import { DefinitionFormatError, migrateDefinition, migrateStrategy } from './migrate';

/** The strategy-language functions `normalizeDefinition` calls (injectable: reconciliation E2). */
export interface StrategyHooks {
  normalizeStrategy(def: StrategyDefinition): StrategyDefinition;
  validateStrategy(def: unknown, ctx: CompileContext | null): Diagnostic[];
}

function stubSafe<A extends unknown[], T>(fn: (...a: A) => T, fallback: (...a: A) => T) {
  return (...a: A): T => {
    try {
      return fn(...a);
    } catch (e) {
      // core-strategy has not merged yet: its functions still throw `TODO(core-strategy)`.
      if (e instanceof Error && e.message.startsWith('TODO(')) return fallback(...a);
      throw e;
    }
  };
}

/** `core/strategy`'s functions, with the WP0 throwing stubs degraded to identity / no diagnostics. */
export const defaultStrategyHooks: StrategyHooks = {
  normalizeStrategy: stubSafe(normalizeStrategy, (d) => d),
  validateStrategy: stubSafe(validateStrategy, () => []),
};

export const DEFINITION_LIMITS = {
  maxSessions: 100_000,
  maxRounds: 100_000,
  maxBankroll: 100_000_000,
  maxSampleSessions: 100,
  maxWork: 500_000_000,
  maxCustomCheckpoints: 512,
  maxCheckpointBytes: 33_554_432,
} as const;

const err = (
  code: string,
  path: string,
  message: string,
  params?: Diagnostic['params'],
): Diagnostic => ({
  code,
  severity: 'error',
  path,
  message,
  ...(params ? { params } : {}),
});

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Replaces `-0` by `0`; reports every non-finite number. */
function cleanNumbers(v: unknown, path: string, errors: Diagnostic[]): unknown {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      errors.push(err('E_NOT_FINITE', path, 'numbers must be finite'));
      return 0;
    }
    return Object.is(v, -0) ? 0 : v;
  }
  if (Array.isArray(v)) return v.map((x, i) => cleanNumbers(x, `${path}/${i}`, errors));
  if (isObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      if (v[k] === undefined) continue;
      out[k] = cleanNumbers(v[k], `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, errors);
    }
    return out;
  }
  return v;
}

function intField(
  o: Record<string, unknown>,
  key: string,
  path: string,
  min: number,
  max: number,
  errors: Diagnostic[],
  required: boolean,
): number | undefined {
  const v = o[key];
  if (v === undefined) {
    if (required) errors.push(err('E_REQUIRED', `${path}/${key}`, `${key} is required`));
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    errors.push(err('not-integer', `${path}/${key}`, `${key} must be an integer`));
    return undefined;
  }
  if (v < min || v > max) {
    errors.push(
      err('E_RANGE', `${path}/${key}`, `${key} must be between ${min} and ${max}`, { min, max }),
    );
    return undefined;
  }
  return v;
}

/** Sorted, deduplicated, clipped to `[0, maxRounds]`, with 0 and `maxRounds` always present. */
function normalizeSchedule(
  spec: unknown,
  maxRounds: number | undefined,
  sessions: number | undefined,
  errors: Diagnostic[],
): 'auto' | number[] {
  const path = '/run/checkpointSchedule';
  if (spec === undefined || spec === 'auto') return 'auto';
  if (
    !Array.isArray(spec) ||
    !spec.every((x) => typeof x === 'number' && Number.isSafeInteger(x))
  ) {
    errors.push(err('E_TYPE', path, "checkpointSchedule must be 'auto' or a list of integers"));
    return 'auto';
  }
  if (maxRounds === undefined) return 'auto';
  const set = new Set<number>([0, maxRounds]);
  for (const x of spec as number[]) if (x >= 0 && x <= maxRounds) set.add(x);
  const list = [...set].sort((a, b) => a - b);
  if (
    list.length > DEFINITION_LIMITS.maxCustomCheckpoints ||
    (sessions !== undefined && sessions * list.length * 4 > DEFINITION_LIMITS.maxCheckpointBytes)
  ) {
    errors.push(err('checkpoints-too-many', path, 'too many checkpoints'));
  }
  return list;
}

/**
 * Normalization before hashing, storing or running (harness-data-analysis.md §8.1, in order):
 * migrate (definition and strategy); inline `{ ref }`; `normalizeStrategy` (reconciliation E2);
 * rules as a pruned `RulesRef` (E1); explicit defaults; tags and notes; numbers; validation
 * (harness checks plus the strategy validator with the plugin's `CompileContext`).
 * `hooks` default to `core/strategy`; tests inject their own.
 */
export function normalizeDefinition(
  d: ExperimentDefinition,
  ctx: NormalizeContext,
  hooks: StrategyHooks = defaultStrategyHooks,
): NormalizeResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];

  // 1. migrate
  let doc: ExperimentDefinition;
  try {
    doc = migrateDefinition(d);
  } catch (e) {
    if (e instanceof DefinitionFormatError) {
      return { ok: false, errors: [err('E_FORMAT', '', e.message)], warnings };
    }
    throw e;
  }
  const src = cleanNumbers(doc, '', errors) as Record<string, unknown>;
  const plugin = ctx.plugin;

  // game
  const game = isObject(src.game) ? src.game : {};
  if (game.id !== plugin.id) {
    errors.push(
      err('E_GAME', '/game/id', `this definition is for "${String(game.id)}", not "${plugin.id}"`),
    );
  }
  let rules: NormalizedDefinition['game']['rules'] | undefined;
  let resolvedRules: unknown;
  if (game.id === plugin.id) {
    try {
      const raw = game.rules as string | { preset: string; overrides: Record<string, Json> };
      rules = plugin.rules.normalize(raw);
      resolvedRules = plugin.rules.resolve(rules);
    } catch (e) {
      errors.push(err('E_RULES', '/game/rules', e instanceof Error ? e.message : 'invalid rules'));
    }
  }

  // 2. strategy
  let strategy: StrategyDefinition | undefined;
  const sraw = src.strategy;
  if (isObject(sraw) && typeof sraw.ref === 'string' && !('stages' in sraw)) {
    strategy = ctx.resolveStrategyRef(sraw.ref);
    if (!strategy) {
      errors.push(
        err('E_STRATEGY_REF', '/strategy/ref', `no strategy "${sraw.ref}" in the library`),
      );
    } else {
      strategy = cleanNumbers(structuredClone(strategy), '/strategy', errors) as StrategyDefinition;
    }
  } else if (isObject(sraw)) {
    strategy = sraw as unknown as StrategyDefinition;
  } else {
    errors.push(err('E_REQUIRED', '/strategy', 'strategy is required'));
  }
  if (strategy) {
    try {
      strategy = migrateStrategy(strategy);
    } catch (e) {
      errors.push(
        err('E_FORMAT', '/strategy', e instanceof Error ? e.message : 'invalid strategy'),
      );
    }
    strategy = hooks.normalizeStrategy(strategy);
  }

  // session and run
  const session = isObject(src.session) ? src.session : {};
  const run = isObject(src.run) ? src.run : {};
  const bankroll = intField(
    session,
    'bankroll',
    '/session',
    1,
    DEFINITION_LIMITS.maxBankroll,
    errors,
    true,
  );
  const maxRounds = intField(
    session,
    'maxRounds',
    '/session',
    1,
    DEFINITION_LIMITS.maxRounds,
    errors,
    true,
  );
  const stopWin = intField(
    session,
    'stopWin',
    '/session',
    1,
    Number.MAX_SAFE_INTEGER,
    errors,
    false,
  );
  const stopLoss = intField(
    session,
    'stopLoss',
    '/session',
    1,
    Number.MAX_SAFE_INTEGER,
    errors,
    false,
  );
  let roundsPerHour = session.roundsPerHour as number | undefined;
  if (roundsPerHour === undefined && resolvedRules !== undefined) {
    roundsPerHour = plugin.pace(resolvedRules).roundsPerHour;
  }
  if (roundsPerHour !== undefined && (typeof roundsPerHour !== 'number' || !(roundsPerHour > 0))) {
    errors.push(err('E_RANGE', '/session/roundsPerHour', 'roundsPerHour must be positive'));
  }
  const sessions = intField(
    run,
    'sessions',
    '/run',
    1,
    DEFINITION_LIMITS.maxSessions,
    errors,
    true,
  );
  const seed = intField(run, 'seed', '/run', 0, 0xffffffff, errors, true);
  const sampleSessions = intField(
    run,
    'sampleSessions',
    '/run',
    0,
    DEFINITION_LIMITS.maxSampleSessions,
    errors,
    false,
  );
  if (
    sessions !== undefined &&
    maxRounds !== undefined &&
    sessions * maxRounds > DEFINITION_LIMITS.maxWork
  ) {
    errors.push(
      err('E_LIMIT', '/run/sessions', 'sessions x maxRounds is too large', {
        max: DEFINITION_LIMITS.maxWork,
      }),
    );
  }
  const checkpointSchedule = normalizeSchedule(run.checkpointSchedule, maxRounds, sessions, errors);

  // 5. name, notes, tags
  const name = typeof src.name === 'string' ? src.name.trim() : '';
  if (typeof src.name !== 'string') errors.push(err('E_REQUIRED', '/name', 'name is required'));
  const notes = typeof src.notes === 'string' ? src.notes.trim() : '';
  const tagList = Array.isArray(src.tags) ? src.tags : [];
  const tags = [
    ...new Set(
      tagList
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].sort();

  // 7. strategy validator (needs rules and a strategy)
  if (strategy && resolvedRules !== undefined && game.id === plugin.id) {
    if (strategy.game !== plugin.id) {
      errors.push(
        err('E_GAME', '/strategy/game', `strategy is for "${strategy.game}", not "${plugin.id}"`),
      );
    }
    const r = resolvedRules;
    const cctx: CompileContext = {
      catalog: plugin.bets.catalog(r),
      parseBet: (id) => plugin.bets.parse(id),
      facts: plugin.facts,
      rules: r,
      limits: (b, rr, view) => plugin.limits(b, rr, view),
      compileFact: (ref, rr) => plugin.compileFact(ref, rr),
      ...(plugin.compileHistory
        ? { compileHistory: (p, rr) => plugin.compileHistory?.(p, rr) ?? null }
        : {}),
    };
    for (const diag of hooks.validateStrategy(strategy, cctx)) {
      const shifted = { ...diag, path: `/strategy${diag.path}` };
      (diag.severity === 'error' ? errors : warnings).push(shifted);
    }
  }

  if (errors.length > 0 || !strategy || !rules) return { ok: false, errors, warnings };

  const sessionOut: NormalizedDefinition['session'] = {
    bankroll: bankroll as number,
    maxRounds: maxRounds as number,
    ...(stopWin !== undefined ? { stopWin } : {}),
    ...(stopLoss !== undefined ? { stopLoss } : {}),
    roundsPerHour: roundsPerHour as number,
  };
  const definition: NormalizedDefinition = {
    schema: 1,
    name,
    ...(notes ? { notes } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    game: { id: plugin.id, rules },
    strategy,
    session: sessionOut,
    run: {
      sessions: sessions as number,
      seed: seed as number,
      checkpointSchedule,
      sampleSessions: sampleSessions ?? 24,
    },
  };
  return { ok: true, definition, warnings };
}
