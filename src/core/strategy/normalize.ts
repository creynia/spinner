// normalizeStrategy (strategy.md §13.4): the canonical form. Idempotent and semantics preserving;
// never reorders anything. Drops defaults, flattens all-of-all, unwraps one-element groups.
import type { StrategyDefinition } from '../contracts/strategy';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

function cond(c: unknown): unknown {
  if (!isObj(c)) return c;
  if (Array.isArray(c.all)) {
    const kids: unknown[] = [];
    for (const k of c.all as unknown[]) {
      const n = cond(k);
      if (isObj(n) && Array.isArray(n.all) && Object.keys(n).length === 1)
        kids.push(...(n.all as unknown[]));
      else kids.push(n);
    }
    if (kids.length === 0) return { always: true };
    if (kids.length === 1) return kids[0];
    return { ...c, all: kids };
  }
  if (Array.isArray(c.any)) {
    const kids = (c.any as unknown[]).map(cond);
    if (kids.length === 1) return kids[0];
    return { ...c, any: kids };
  }
  if ('not' in c) return { ...c, not: cond(c.not) };
  if (Array.isArray(c.cmp)) return { ...c, cmp: (c.cmp as unknown[]).map(expr) };
  return clone(c);
}

function expr(e: unknown): unknown {
  if (Array.isArray(e)) return e.map(expr);
  if (!isObj(e)) return e;
  if (Array.isArray(e.if) && e.if.length === 3) {
    const t = e.if as unknown[];
    return { ...e, if: [cond(t[0]), expr(t[1]), expr(t[2])] };
  }
  const out: Obj = {};
  for (const k of Object.keys(e)) out[k] = k.startsWith('x-') ? clone(e[k]) : expr(e[k]);
  return out;
}

function effect(e: unknown): unknown {
  if (!isObj(e)) return e;
  const out: Obj = {};
  for (const k of Object.keys(e)) {
    if (k.startsWith('x-')) out[k] = clone(e[k]);
    else if (k === 'working' && e[k] === 'auto') continue;
    else if (k === 'amount' || k === 'by' || k === 'cap' || k === 'to') out[k] = expr(e[k]);
    else out[k] = clone(e[k]);
  }
  return out;
}

function clone(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(clone);
  if (isObj(x)) {
    const o: Obj = {};
    for (const k of Object.keys(x)) o[k] = clone(x[k]);
    return o;
  }
  return x;
}

function layout(l: unknown): unknown {
  if (!isObj(l)) return l;
  const out: Obj = {};
  for (const k of Object.keys(l)) {
    if (k.startsWith('x-')) out[k] = clone(l[k]);
    else if (k === 'working' && l[k] === 'auto') continue;
    else if (k === 'when') out[k] = cond(l[k]);
    else if (k === 'amount') {
      const a = l[k];
      out[k] = isObj(a) && 'keepOr' in a ? { ...a, keepOr: expr(a.keepOr) } : expr(a);
    } else out[k] = clone(l[k]);
  }
  return out;
}

function rule(r: unknown): unknown {
  if (!isObj(r)) return r;
  const out: Obj = {};
  for (const k of Object.keys(r)) {
    const v = r[k];
    if (k.startsWith('x-')) out[k] = clone(v);
    else if (k === 'enabled' && v === true) continue;
    else if (k === 'once' && v === false) continue;
    else if (k === 'when') out[k] = cond(v);
    else if (k === 'then') out[k] = (v as unknown[]).map(effect);
    else out[k] = clone(v);
  }
  return out;
}

function stage(s: unknown): unknown {
  if (!isObj(s)) return s;
  const out: Obj = {};
  for (const k of Object.keys(s)) {
    const v = s[k];
    if (k.startsWith('x-')) out[k] = clone(v);
    else if (k === 'rules') {
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = (v as unknown[]).map(rule);
    } else if (k === 'layout') out[k] = (v as unknown[]).map(layout);
    else if (k === 'onEnter' || k === 'onExit') out[k] = (v as unknown[]).map(effect);
    else out[k] = clone(v);
  }
  return out;
}

function prog(p: unknown): unknown {
  if (!isObj(p)) return p;
  const out: Obj = {};
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (k.startsWith('x-')) out[k] = clone(v);
    else if (k === 'feed' && v === 'sized') continue;
    else if (k === 'base' || k === 'maxAmount' || k === 'step') out[k] = expr(v);
    else if (k === 'amounts') out[k] = (v as unknown[]).map(expr);
    else out[k] = clone(v);
  }
  return out;
}

/** Canonical form of a (valid) definition. Does not mutate its input. */
export function normalizeStrategy(def: StrategyDefinition): StrategyDefinition {
  const d = def as unknown as Obj;
  const out: Obj = {};
  for (const k of Object.keys(d)) {
    const v = d[k];
    if (k === 'stages') out[k] = (v as unknown[]).map(stage);
    else if (k === 'progressions' && isObj(v)) {
      const ps: Obj = {};
      for (const n of Object.keys(v)) ps[n] = prog(v[n]);
      out[k] = ps;
    } else out[k] = clone(v);
  }
  return out as unknown as StrategyDefinition;
}
