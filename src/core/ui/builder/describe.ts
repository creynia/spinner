// Chip text (strategy.md §13.2): sentences generated from JSON and the fact schema labels.
import { str, betLabel, factByName, money, type BuilderEnv } from './env';
import type { AmountModel, ConditionChip, ConditionChips } from './model';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

const OP_TEXT: Record<string, string> = {
  '<': '<',
  '<=': '≤',
  '==': '=',
  '!=': '≠',
  '>=': '≥',
  '>': '>',
};

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

/** "net" -> "net result"; "spinsSince:red" -> "spins since red". */
export function factText(ref: string, env: BuilderEnv): string {
  const [name, ...args] = ref.split(':');
  const info = factByName(env, name!);
  const label = info?.label ?? name!;
  if (args.length === 0) return label;
  const params = info?.params ?? [];
  const parts = args.map((a, i) => {
    const p = params[i];
    return p && (p.type === 'bet' || (p.type as string) === 'target') ? betLabel(env, a) : a;
  });
  if (name === 'count')
    return `${label.replace('n spins', `${parts[0]} spins`)} (${parts.slice(1).join(' ')})`;
  return `${label} ${parts.join(' ')}`;
}

function valueText(ref: string, v: unknown, env: BuilderEnv): string {
  const info = factByName(env, ref.split(':')[0]!);
  if (typeof v === 'number' && info?.value.type === 'number' && info.value.unit === 'money')
    return money(v);
  if (info?.value.type === 'enum' && info.value.labels) {
    const i = info.value.values.indexOf(v as string | number);
    if (i >= 0) return info.value.labels[i] ?? str(v);
  }
  if (info?.name.startsWith('lastDozen') || info?.name === 'lastColumn') {
    const n = Number(v);
    if (n >= 1 && n <= 3) return ['1st', '2nd', '3rd'][n - 1]!;
  }
  return str(v);
}

export function describeExpr(e: unknown, env: BuilderEnv): string {
  if (typeof e === 'number') return money(e);
  if (typeof e === 'string') return factText(e, env);
  if (!isObj(e)) return str(e);
  if ('units' in e) return `${str(e.units)} unit${e.units === 1 ? '' : 's'}`;
  if ('fact' in e) return factText(str(e.fact), env);
  if ('var' in e) return str(e.var);
  if ('prog' in e) return `progression ${str(e.prog)}`;
  if ('pctOfBankroll' in e) return `${str(e.pctOfBankroll)}% of bankroll`;
  if ('tableMin' in e) return `table min ${str(e.tableMin)}`;
  if ('tableMax' in e) return `table max ${str(e.tableMax)}`;
  if ('keepOr' in e) return `keep, else ${describeExpr(e.keepOr, env)}`;
  const k = Object.keys(e)[0];
  return k ? `${k}(…)` : '?';
}

export function describeAmount(a: AmountModel, env: BuilderEnv): string {
  switch (a.kind) {
    case 'units':
      return `${a.n} unit${a.n === 1 ? '' : 's'} (${money(Math.round(a.n * env.unit))})`;
    case 'cents':
      return money(a.cents);
    case 'prog':
      return `progression ${a.name}`;
    case 'pct':
      return `${a.p}% of bankroll`;
    case 'tableMin':
      return `table minimum (${a.of})`;
    case 'keep':
      return `keep, else ${describeAmount(a.inner, env)}`;
    case 'formula':
      return `formula ${describeExpr(a.expr, env)}`;
  }
}

function histText(h: Obj, env: BuilderEnv): string {
  if (typeof h.fact === 'string') {
    const eq = Array.isArray(h.equals) ? h.equals : [h.equals];
    return eq.map((v) => valueText(h.fact as string, v, env)).join(' or ');
  }
  return eventText(str(h.event), h, env);
}

function eventText(name: string, c: Obj, env: BuilderEnv): string {
  const decl = env.facts.events.find((e) => e.name === name);
  const bet = typeof c.bet === 'string' ? betLabel(env, c.bet) : null;
  if (name === 'bet-won') return `${bet ?? 'a bet'} won`;
  if (name === 'bet-lost') return `${bet ?? 'a bet'} lost`;
  if (name === 'bet-push') return `${bet ?? 'a bet'} pushed`;
  if (name === 'prog-cap') return `progression ${str(c.prog ?? '?')} hit its cap`;
  if (name === 'prog-done') return `progression ${str(c.prog ?? '?')} finished`;
  return `${decl?.label ?? name}${bet ? ` (${bet})` : ''}`;
}

export function describeCondition(c: unknown, env: BuilderEnv): string {
  if (!isObj(c)) return str(c);
  if (c.always === true) return 'always';
  if (Array.isArray(c.cmp)) {
    const [l, op, r] = c.cmp as unknown[];
    return `${describeExpr(l, env)} ${OP_TEXT[str(op)] ?? str(op)} ${describeExpr(r, env)}`;
  }
  if (Array.isArray(c.fact)) {
    const [ref, op, v] = c.fact as [string, string, unknown];
    const vs = Array.isArray(v)
      ? v.map((x) => valueText(ref, x, env)).join(' or ')
      : valueText(ref, v, env);
    const verb =
      op === 'in' || op === '=='
        ? 'is'
        : op === 'notIn' || op === '!='
          ? 'is not'
          : (OP_TEXT[op] ?? op);
    return `${factText(ref, env)} ${verb} ${vs}`;
  }
  if (typeof c.event === 'string') return eventText(c.event, c, env);
  if (typeof c.onTable === 'string') return `${betLabel(env, c.onTable)} is on the table`;
  if (isObj(c.streak)) return `${histText(c.streak, env)} ${str(c.streak.atLeast)}+ times in a row`;
  if (isObj(c.countInLast)) {
    const h = c.countInLast;
    const lo = h.atLeast !== undefined ? `≥ ${str(h.atLeast)}` : '';
    const hi = h.atMost !== undefined ? `≤ ${str(h.atMost)}` : '';
    return `${histText(h, env)} ${[lo, hi].filter(Boolean).join(' and ')} of the last ${str(h.n)}`;
  }
  if (isObj(c.since)) {
    const h = c.since;
    return h.atLeast !== undefined
      ? `${histText(h, env)} not seen for ${str(h.atLeast)}+ ${env.roundWord}s`
      : `${histText(h, env)} seen within ${str(h.atMost)} ${env.roundWord}s`;
  }
  if (typeof c.everyN === 'number')
    return `every ${c.everyN} ${c.of === 'stage' ? `${env.roundWord}s in the stage` : 'rounds'}`;
  if (isObj(c.not) || 'not' in c) return `not (${describeCondition(c.not, env)})`;
  if (Array.isArray(c.all)) return c.all.map((x) => describeCondition(x, env)).join(' and ');
  if (Array.isArray(c.any)) return c.any.map((x) => describeCondition(x, env)).join(' or ');
  return JSON.stringify(c);
}

export function describeChip(c: ConditionChip, env: BuilderEnv): string {
  switch (c.kind) {
    case 'leaf':
    case 'raw':
      return describeCondition(c.cond, env);
    case 'not':
      return `not ${describeChip(c.chip, env)}`;
    case 'group':
      return `(${c.group.chips.map((x) => describeChip(x, env)).join(c.group.mode === 'any' ? ' or ' : ' and ')})`;
  }
}

export function describeWhen(w: ConditionChips, env: BuilderEnv): string {
  return w.chips.length === 0
    ? 'always'
    : w.chips.map((c) => describeChip(c, env)).join(w.mode === 'any' ? ' or ' : ' and ');
}

export function describeEffect(e: unknown, env: BuilderEnv): string {
  if (!isObj(e)) return str(e);
  if ('clear' in e) return 'take all bets down';
  if ('skipRound' in e) return `sit out this ${env.roundWord}`;
  if (typeof e.goto === 'string') return `go to stage ${e.goto}${e.reenter ? ' (restart)' : ''}`;
  if (typeof e.stop === 'string') return `stop (${e.stop})`;
  if (typeof e.remove === 'string') return `remove ${betLabel(env, e.remove)}`;
  if (typeof e.press === 'string')
    return `press ${betLabel(env, e.press)} by ${describeExpr(e.by, env)}${e.cap !== undefined ? ` (cap ${describeExpr(e.cap, env)})` : ''}`;
  if (typeof e.set === 'string') return `set ${e.set} to ${describeExpr(e.to, env)}`;
  if (typeof e.inc === 'string')
    return `add ${e.by === undefined ? '1' : describeExpr(e.by, env)} to ${e.inc}`;
  if (typeof e.prog === 'string') {
    const verb: Record<string, string> = {
      win: 'count a win on',
      loss: 'count a loss on',
      push: 'count a push on',
      reset: 'reset',
      advance: 'advance',
      back: 'step back',
    };
    return `${verb[str(e.do)] ?? str(e.do)} ${e.prog}`;
  }
  if (typeof e.bet === 'string')
    return `bet ${describeExpr(e.amount, env)} on ${betLabel(env, e.bet)}`;
  if (typeof e.act === 'string') return `do ${e.act}`;
  return JSON.stringify(e);
}

export { plural };
