// Session facts (strategy.md §8.2) and fact-ref resolution shared by validate and compile.
import type { CompileContext } from '../contracts/strategy';
import type { FactDecl, FactParam, FactType } from '../contracts/facts';

export type Scope = 'round' | 'state';

export interface SessionFactInfo {
  scope: Scope;
  value: FactType;
}

const MONEY: FactType = { type: 'number', unit: 'money', integer: true };
const COUNT: FactType = { type: 'number', unit: 'count', integer: true, min: 0 };

/** Session and strategy facts every game gets (strategy.md §8.2). `stage` values are dynamic. */
export const SESSION_FACTS: Readonly<Record<string, SessionFactInfo>> = {
  start: { scope: 'state', value: MONEY },
  bankroll: { scope: 'state', value: MONEY },
  equity: { scope: 'state', value: MONEY },
  net: { scope: 'state', value: MONEY },
  peak: { scope: 'state', value: MONEY },
  drawdown: { scope: 'state', value: MONEY },
  exposure: { scope: 'state', value: MONEY },
  wagered: { scope: 'state', value: MONEY },
  round: { scope: 'state', value: COUNT },
  roundsInStage: { scope: 'state', value: COUNT },
  roundsWagered: { scope: 'state', value: COUNT },
  lastNet: { scope: 'round', value: MONEY },
  lastResult: { scope: 'round', value: { type: 'enum', values: ['win', 'loss', 'push', 'none'] } },
  winStreak: { scope: 'state', value: COUNT },
  lossStreak: { scope: 'state', value: COUNT },
  stage: { scope: 'state', value: { type: 'enum', values: [] } },
};

export const CORE_EVENTS = ['bet-won', 'bet-lost', 'bet-push', 'prog-cap', 'prog-done'] as const;
export const BET_EVENTS: readonly string[] = ['bet-won', 'bet-lost', 'bet-push'];
export const PROG_EVENTS: readonly string[] = ['prog-cap', 'prog-done'];

export interface ResolvedFact {
  /** Canonical ref (arguments canonicalised): the key used in traces and diagnostics. */
  canonical: string;
  session: boolean;
  name: string;
  scope: Scope;
  value: FactType;
  decl: FactDecl | null;
}
export interface FactError {
  code: 'E_UNKNOWN_FACT' | 'E_FACT_ARGS' | 'E_UNKNOWN_BET';
  detail: string;
}

/**
 * Resolves `ref` against the session facts and the plugin's fact schema. `stageIds` supplies the
 * members of the `stage` enum.
 */
export function resolveFact(
  ref: string,
  ctx: CompileContext,
  stageIds: readonly string[],
): ResolvedFact | FactError {
  const colon = ref.indexOf(':');
  const name = colon < 0 ? ref : ref.slice(0, colon);
  const rest = colon < 0 ? undefined : ref.slice(colon + 1);
  const sess = Object.prototype.hasOwnProperty.call(SESSION_FACTS, name)
    ? SESSION_FACTS[name]
    : undefined;
  if (sess) {
    if (rest !== undefined) return { code: 'E_FACT_ARGS', detail: 'takes no arguments' };
    const value: FactType = name === 'stage' ? { type: 'enum', values: stageIds } : sess.value;
    return { canonical: name, session: true, name, scope: sess.scope, value, decl: null };
  }
  const decl = ctx.facts.facts.find((f) => f.name === name);
  if (!decl) return { code: 'E_UNKNOWN_FACT', detail: name };
  const params = decl.params ?? [];
  const tokens: string[] = [];
  let remaining = rest;
  for (let i = 0; i < params.length; i++) {
    const p = params[i] as FactParam;
    if (remaining === undefined || remaining === '')
      return { code: 'E_FACT_ARGS', detail: `missing argument ${p.name}` };
    const greedy = i === params.length - 1 && (p.type === 'bet' || p.type === 'target');
    let tok: string;
    if (greedy || i === params.length - 1) {
      tok = remaining;
      remaining = undefined;
    } else {
      const c = remaining.indexOf(':');
      if (c < 0) return { code: 'E_FACT_ARGS', detail: `missing argument after ${p.name}` };
      tok = remaining.slice(0, c);
      remaining = remaining.slice(c + 1);
    }
    if (p.type === 'number') {
      if (!/^-?\d+(\.\d+)?$/.test(tok))
        return { code: 'E_FACT_ARGS', detail: `${p.name} must be a number` };
      const n = Number(tok);
      if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max))
        return { code: 'E_FACT_ARGS', detail: `${p.name} out of range` };
      tokens.push(tok);
    } else if (p.type === 'enum') {
      const hit = (p.values ?? []).find((v) => String(v) === tok);
      if (hit === undefined) return { code: 'E_FACT_ARGS', detail: `${p.name} not allowed` };
      tokens.push(tok);
    } else {
      const parsed = ctx.parseBet(tok);
      if (parsed !== null) tokens.push(parsed);
      else if (p.type === 'target' && (p.values ?? []).some((v) => String(v) === tok))
        tokens.push(tok);
      else if (p.type === 'target' && acceptsRef(ctx, ref)) tokens.push(tok);
      else return { code: 'E_UNKNOWN_BET', detail: tok };
    }
  }
  if (remaining !== undefined && remaining !== '')
    return { code: 'E_FACT_ARGS', detail: 'too many arguments' };
  if (params.length === 0 && rest !== undefined)
    return { code: 'E_FACT_ARGS', detail: 'takes no arguments' };
  const canonical = tokens.length ? `${name}:${tokens.join(':')}` : name;
  return { canonical, session: false, name, scope: decl.scope, value: decl.value, decl };
}

/** Last resort for plugin-declared extra targets (`zero`, `green`): ask the plugin itself. */
function acceptsRef(ctx: CompileContext, ref: string): boolean {
  try {
    ctx.compileFact(ref, ctx.rules);
    return true;
  } catch {
    return false;
  }
}

export function isFactError(r: ResolvedFact | FactError): r is FactError {
  return 'detail' in r;
}
