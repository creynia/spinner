/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { describe, expect, it } from 'vitest';
import { makeCtx } from './__fixtures__/stub-ctx';
import { noExitWarning, validateStrategy } from './index';

type J = Record<string, any>;

const base = (): J => ({
  schema: 1,
  id: 't',
  name: 'T',
  game: 'stub',
  unit: 2500,
  vars: { x: 0 },
  progressions: { m: { kind: 'martingale', track: 'a', maxSteps: 4, onCap: 'reset' } },
  stages: [
    {
      id: 's1',
      layout: [{ bet: 'a', amount: { prog: 'm' } }],
      rules: [{ when: { cmp: [{ var: 'x' }, '<', 3] }, then: [{ inc: 'x' }, { goto: 's2' }] }],
    },
    {
      id: 's2',
      layout: [{ bet: 'a', amount: { units: 1 } }],
      rules: [{ when: { always: true }, then: [{ goto: 's1' }], cooldown: 2 }],
    },
  ],
});

const ctx = makeCtx();
const errs = (d: unknown) =>
  validateStrategy(d, ctx)
    .filter((x) => x.severity === 'error')
    .map((x) => `${x.code} ${x.path}`);
const run = (d: unknown, c = ctx) => validateStrategy(d, c).map((x) => `${x.code} ${x.path}`);
const withRule = (when: unknown, then: unknown[] = [{ inc: 'x' }]): J => {
  const d = base();
  d.stages[0].rules = [{ when, then }];
  return d;
};
const withLayout = (...entries: unknown[]): J => {
  const d = base();
  d.stages[0].layout = entries;
  return d;
};
const withEffect = (e: unknown): J => withRule({ always: true }, [e]);
const withProg = (p: unknown): J => {
  const d = base();
  d.progressions = { m: p };
  return d;
};

describe('validateStrategy: baseline', () => {
  it('accepts the base strategy with no diagnostics (with and without a plugin)', () => {
    expect(run(base())).toEqual([]);
    expect(validateStrategy(base(), null)).toEqual([]);
  });
  it('reports severity, params and a generated message', () => {
    const d = validateStrategy({ ...base(), schema: 2 }, ctx);
    expect(d[0]).toMatchObject({ code: 'E_SCHEMA_VERSION', severity: 'error', path: '/schema' });
    expect(d[0]?.message).toContain('schema');
  });
  it('never throws on junk', () => {
    for (const x of [null, 1, 'x', [], {}, { stages: 5 }, { schema: 1, stages: [null, 1, []] }]) {
      expect(() => validateStrategy(x, ctx)).not.toThrow();
      expect(() => validateStrategy(x, null)).not.toThrow();
    }
    expect(run(null)).toEqual(['E_TYPE ']);
  });
});

describe('validateStrategy: structural errors (S)', () => {
  const cases: [string, J, string][] = [
    ['E_SCHEMA_VERSION', { ...base(), schema: 2 }, 'E_SCHEMA_VERSION /schema'],
    ['E_TYPE', { ...base(), unit: 'x' }, 'E_TYPE /unit'],
    [
      'E_REQUIRED',
      (() => {
        const d = base();
        delete d.name;
        return d;
      })(),
      'E_REQUIRED /name',
    ],
    ['E_UNKNOWN_KEY', { ...base(), foo: 1 }, 'E_UNKNOWN_KEY /foo'],
    ['E_ONE_OF cond', withRule({ cmp: [1, '<', 2], all: [] }), 'E_ONE_OF /stages/0/rules/0/when'],
    [
      'E_ONE_OF effect',
      withEffect({ set: 'x', to: 1, stop: 'y' }),
      'E_ONE_OF /stages/0/rules/0/then/0',
    ],
    ['E_ID_FORMAT', { ...base(), id: 'Bad Id' }, 'E_ID_FORMAT /id'],
    [
      'E_DUPLICATE_ID stage',
      (() => {
        const d = base();
        d.stages[1].id = 's1';
        return d;
      })(),
      'E_DUPLICATE_ID /stages/1/id',
    ],
    [
      'E_DUPLICATE_ID rule',
      (() => {
        const d = base();
        d.stages[0].rules[0].id = 'r';
        d.stages[1].rules[0].id = 'r';
        return d;
      })(),
      'E_DUPLICATE_ID /stages/1/rules/0/id',
    ],
    ['E_NOT_INTEGER', { ...base(), unit: 25.5 }, 'E_NOT_INTEGER /unit'],
    [
      'E_NOT_INTEGER literal amount',
      withLayout({ bet: 'a', amount: 2500.5 }),
      'E_NOT_INTEGER /stages/0/layout/0/amount',
    ],
    [
      'E_RANGE',
      withProg({ kind: 'martingale', track: 'a', maxSteps: 31, onCap: 'reset' }),
      'E_RANGE /progressions/m/maxSteps',
    ],
    [
      'E_LIMIT stages',
      { ...base(), stages: Array.from({ length: 33 }, (_, i) => ({ id: `s${i}` })) },
      'E_LIMIT /stages',
    ],
    [
      'E_EFFECT_CAP',
      withRule(
        { always: true },
        Array.from({ length: 17 }, () => ({ inc: 'x' })),
      ),
      'E_EFFECT_CAP /stages/0/rules/0/then',
    ],
    [
      'E_UNKNOWN_STAGE goto',
      withEffect({ goto: 'nope' }),
      'E_UNKNOWN_STAGE /stages/0/rules/0/then/0/goto',
    ],
    [
      'E_UNKNOWN_STAGE extends',
      (() => {
        const d = base();
        d.stages[1].extends = 'zz';
        return d;
      })(),
      'E_UNKNOWN_STAGE /stages/1/extends',
    ],
    [
      'E_UNKNOWN_STAGE stageEntries',
      withLayout({ bet: 'a', amount: { stageEntries: 'q' } }),
      'E_UNKNOWN_STAGE /stages/0/layout/0/amount/stageEntries',
    ],
    [
      'E_UNKNOWN_STAGE fact',
      withRule({ fact: ['stage', '==', 'q'] }),
      'E_UNKNOWN_STAGE /stages/0/rules/0/when/fact/2',
    ],
    [
      'E_UNKNOWN_VAR',
      withEffect({ set: 'nope', to: 1 }),
      'E_UNKNOWN_VAR /stages/0/rules/0/then/0/set',
    ],
    [
      'E_UNKNOWN_PROG',
      withLayout({ bet: 'a', amount: { prog: 'zz' } }),
      'E_UNKNOWN_PROG /stages/0/layout/0/amount/prog',
    ],
    [
      'E_EXTENDS_CYCLE',
      (() => {
        const d = base();
        d.stages[0].extends = 's2';
        d.stages[1].extends = 's1';
        return d;
      })(),
      'E_EXTENDS_CYCLE /stages/0/extends',
    ],
    [
      'E_EXTENDS_DEPTH',
      (() => {
        const d = base();
        d.stages = Array.from({ length: 7 }, (_, i) => ({
          id: `s${i}`,
          ...(i > 0 ? { extends: `s${i - 1}` } : {}),
          layout: [{ bet: 'a', amount: 2500 }],
        }));
        return d;
      })(),
      'E_EXTENDS_DEPTH /stages/5/extends',
    ],
    [
      'E_GOTO_IN_HOOK',
      (() => {
        const d = base();
        d.stages[0].onEnter = [{ goto: 's2' }];
        return d;
      })(),
      'E_GOTO_IN_HOOK /stages/0/onEnter/0',
    ],
    [
      'E_GOTO_SELF_ALWAYS',
      withEffect({ goto: 's1', reenter: true }),
      'E_GOTO_SELF_ALWAYS /stages/0/rules/0',
    ],
    [
      'E_UNREACHABLE_EFFECT',
      withRule({ always: true }, [{ goto: 's2' }, { inc: 'x' }]),
      'E_UNREACHABLE_EFFECT /stages/0/rules/0/then/1',
    ],
    [
      'E_UNREACHABLE_EFFECT stop',
      withRule({ always: true }, [{ stop: 'done' }, { inc: 'x' }]),
      'E_UNREACHABLE_EFFECT /stages/0/rules/0/then/1',
    ],
    [
      'E_RESERVED_REASON cap-',
      withEffect({ stop: 'cap-m' }),
      'E_RESERVED_REASON /stages/0/rules/0/then/0/stop',
    ],
    [
      'E_RESERVED_REASON done-',
      withEffect({ stop: 'done-m' }),
      'E_RESERVED_REASON /stages/0/rules/0/then/0/stop',
    ],
    [
      'E_RESERVED_REASON stop-win',
      withEffect({ stop: 'stop-win' }),
      'E_RESERVED_REASON /stages/0/rules/0/then/0/stop',
    ],
    [
      'E_RESERVED_REASON stop-loss',
      withEffect({ stop: 'stop-loss' }),
      'E_RESERVED_REASON /stages/0/rules/0/then/0/stop',
    ],
    [
      'E_RESERVED_REASON bust',
      withEffect({ stop: 'bust' }),
      'E_RESERVED_REASON /stages/0/rules/0/then/0/stop',
    ],
    [
      'E_RESERVED_REASON rounds',
      withEffect({ stop: 'rounds' }),
      'E_RESERVED_REASON /stages/0/rules/0/then/0/stop',
    ],
    [
      'E_RESERVED_REASON error',
      withEffect({ stop: 'error' }),
      'E_RESERVED_REASON /stages/0/rules/0/then/0/stop',
    ],
    [
      'E_EXPR_CYCLE self',
      withProg({ kind: 'martingale', track: 'a', maxSteps: 3, onCap: 'stay', base: { prog: 'm' } }),
      'E_EXPR_CYCLE /progressions/m/base/prog',
    ],
    [
      'E_DIV_ZERO_LITERAL',
      withLayout({ bet: 'a', amount: { div: [100, 0] } }),
      'E_DIV_ZERO_LITERAL /stages/0/layout/0/amount/div/1',
    ],
    [
      'E_DIV_ZERO_LITERAL floorTo',
      withLayout({ bet: 'a', amount: { floorTo: [100, 0] } }),
      'E_DIV_ZERO_LITERAL /stages/0/layout/0/amount/floorTo/1',
    ],
    [
      'E_HISTORY_BOUND',
      withRule({ countInLast: { fact: 'color', equals: 'red', n: 5 } }),
      'E_HISTORY_BOUND /stages/0/rules/0/when/countInLast',
    ],
    [
      'E_HISTORY_BOUND since',
      withRule({ since: { fact: 'color', equals: 'red' } }),
      'E_HISTORY_BOUND /stages/0/rules/0/when/since',
    ],
    [
      'E_PROG_SPEC line',
      withProg({ kind: 'labouchere', track: 'a', line: [1, 0, 3] }),
      'E_PROG_SPEC /progressions/m/line/1',
    ],
    [
      'E_PROG_SPEC base on sequence',
      withProg({
        kind: 'sequence',
        track: 'a',
        amounts: [1],
        onWin: 'reset',
        onLoss: 'advance',
        base: 1,
      }),
      'E_PROG_SPEC /progressions/m/base',
    ],
    [
      'E_PROG_SPEC onEmpty',
      withProg({ kind: 'martingale', track: 'a', maxSteps: 3, onCap: 'stay', onEmpty: 'stop' }),
      'E_PROG_SPEC /progressions/m/onEmpty',
    ],
    [
      'E_PROG_OP_UNSUPPORTED',
      (() => {
        const d = withEffect({ prog: 'm', do: 'advance' });
        d.progressions.m = { kind: 'labouchere', track: 'a', line: [1] };
        return d;
      })(),
      'E_PROG_OP_UNSUPPORTED /stages/0/rules/0/then/0/do',
    ],
    [
      'E_PROG_OVERFLOW',
      withProg({ kind: 'martingale', track: 'a', maxSteps: 30, onCap: 'stay' }),
      'E_PROG_OVERFLOW /progressions/m',
    ],
    ['E_DEFERRED chance', withRule({ chance: 0.5 }), 'E_DEFERRED /stages/0/rules/0/when/chance'],
    ['E_DEFERRED code', { ...base(), kind: 'code' }, 'E_DEFERRED /kind'],
  ];
  it.each(cases)('%s', (_n, d, expected) => {
    expect(run(d, ctx)).toContain(expected);
    // S-level codes are also reported without a plugin
    expect(validateStrategy(d, null).map((x) => `${x.code} ${x.path}`)).toContain(expected);
  });

  it('the >200 distinct stop reasons limit', () => {
    const d = base();
    d.stages[0].rules = Array.from({ length: 4 }, (_, r) => ({
      when: { always: true },
      then: Array.from({ length: 51 }, (_, i) => ({ stop: `r-${r}-${i}` })),
    }));
    // effects lists are capped at 16: use several stages instead
    const ok = base();
    ok.stages = Array.from({ length: 14 }, (_, s) => ({
      id: `s${s}`,
      layout: [{ bet: 'a', amount: 2500 }],
      rules: Array.from({ length: 15 }, (_, r) => ({
        when: { always: true },
        then: [{ stop: `r-${s}-${r}` }],
      })),
    }));
    // 14 * 15 = 210 distinct reasons, the 201st is flagged
    const codes = run(ok);
    expect(codes.filter((c) => c.startsWith('E_LIMIT')).length).toBe(1);
    ok.stages = ok.stages.slice(0, 13); // 195 reasons
    expect(run(ok).some((c) => c.startsWith('E_LIMIT'))).toBe(false);
  });

  it('checks limits at their boundaries', () => {
    const ok = base();
    ok.stages = Array.from({ length: 32 }, (_, i) => ({
      id: `s${i}`,
      layout: [{ bet: 'a', amount: 2500 }],
    }));
    expect(run(ok).filter((c) => c.startsWith('E_LIMIT'))).toEqual([]);
    const d = base();
    d.stages[0].layout = Array.from({ length: 65 }, () => ({ bet: 'a', amount: 2500 }));
    expect(run(d)).toContain('E_LIMIT /stages/0/layout');
    const e = base();
    e.vars = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`v${i}`, 0]));
    expect(run(e)).toContain('E_LIMIT /vars');
    const f = base();
    f.progressions = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [`p${i}`, { kind: 'flat', track: 'a' }]),
    );
    expect(run(f)).toContain('E_LIMIT /progressions');
    const g = base();
    g.stages[0].rules = Array.from({ length: 65 }, () => ({
      when: { always: true },
      then: [{ inc: 'x' }],
    }));
    expect(run(g)).toContain('E_LIMIT /stages/0/rules');
    const h = withLayout({ bet: 'a', amount: deep(17) });
    expect(run(h).some((c) => c.startsWith('E_LIMIT'))).toBe(true);
    const i = withLayout({ bet: 'a', amount: deep(10) });
    expect(errs(i)).toEqual([]);
    const j = withRule({ countInLast: { fact: 'color', equals: 'red', n: 1001, atLeast: 1 } });
    expect(run(j)).toContain('E_RANGE /stages/0/rules/0/when/countInLast/n');
    const k = withRule({ countInLast: { fact: 'color', equals: 'red', n: 1000, atLeast: 1 } });
    expect(errs(k)).toEqual([]);
  });

  it('flags history predicates beyond 32, nodes beyond 4096 and JSON beyond 64 KiB', () => {
    const preds = Array.from({ length: 33 }, (_, i) => ({
      streak: { fact: 'color', equals: `c${i}`, atLeast: 1 },
    }));
    const d = withRule({ any: preds });
    expect(run(d).some((c) => c.startsWith('E_LIMIT'))).toBe(true);
    const nodes = withRule({ any: Array.from({ length: 4100 }, () => ({ always: true })) });
    expect(run(nodes)).toContain('E_LIMIT ');
    const big = base();
    big.notes = 'x'.repeat(4000);
    big.stages[0].label = 'y'.repeat(70000);
    expect(run(big)).toContain('E_LIMIT ');
  });
});

function deep(n: number): unknown {
  let e: unknown = 2500;
  for (let i = 0; i < n; i++) e = { abs: e };
  return e;
}

describe('validateStrategy: plugin errors (R)', () => {
  const cases: [string, J, string][] = [
    ['E_GAME_MISMATCH', { ...base(), game: 'other' }, 'E_GAME_MISMATCH /game'],
    [
      'E_UNKNOWN_BET',
      withLayout({ bet: 'zz', amount: 2500 }),
      'E_UNKNOWN_BET /stages/0/layout/0/bet',
    ],
    [
      'E_UNKNOWN_BET onTable',
      withRule({ onTable: 'zz' }),
      'E_UNKNOWN_BET /stages/0/rules/0/when/onTable',
    ],
    [
      'E_UNKNOWN_BET track',
      withProg({ kind: 'flat', track: 'zz' }),
      'E_UNKNOWN_BET /progressions/m/track',
    ],
    [
      'E_UNKNOWN_FACT',
      withRule({ fact: ['nope', '==', 1] }),
      'E_UNKNOWN_FACT /stages/0/rules/0/when/fact/0',
    ],
    [
      'E_UNKNOWN_FACT expr',
      withLayout({ bet: 'a', amount: 'nope' }),
      'E_UNKNOWN_FACT /stages/0/layout/0/amount',
    ],
    [
      'E_FACT_ARGS missing',
      withRule({ cmp: ['count:5', '>', 1] }),
      'E_FACT_ARGS /stages/0/rules/0/when/cmp/0',
    ],
    [
      'E_FACT_ARGS range',
      withRule({ cmp: ['count:500:a', '>', 1] }),
      'E_FACT_ARGS /stages/0/rules/0/when/cmp/0',
    ],
    [
      'E_FACT_ARGS enum',
      withRule({ cmp: ['mode:z', '>', 1] }),
      'E_FACT_ARGS /stages/0/rules/0/when/cmp/0',
    ],
    [
      'E_FACT_ARGS extra',
      withRule({ cmp: ['level:3', '>', 1] }),
      'E_FACT_ARGS /stages/0/rules/0/when/cmp/0',
    ],
    [
      'E_FACT_TYPE non numeric',
      withRule({ cmp: ['color', '==', 1] }),
      'E_FACT_TYPE /stages/0/rules/0/when/cmp/0',
    ],
    [
      'E_FACT_TYPE op',
      withRule({ fact: ['color', '<', 'red'] }),
      'E_FACT_TYPE /stages/0/rules/0/when/fact/1',
    ],
    [
      'E_FACT_TYPE bool op',
      withRule({ fact: ['hot', 'in', [true]] }),
      'E_FACT_TYPE /stages/0/rules/0/when/fact/1',
    ],
    [
      'E_FACT_VALUE',
      withRule({ fact: ['color', '==', 'purple'] }),
      'E_FACT_VALUE /stages/0/rules/0/when/fact/2',
    ],
    [
      'E_FACT_VALUE in',
      withRule({ fact: ['color', 'in', ['red', 'pink']] }),
      'E_FACT_VALUE /stages/0/rules/0/when/fact/2/1',
    ],
    [
      'E_FACT_VALUE in not array',
      withRule({ fact: ['color', 'in', 'red'] }),
      'E_FACT_VALUE /stages/0/rules/0/when/fact/2',
    ],
    [
      'E_FACT_VALUE bool',
      withRule({ fact: ['hot', '==', 'yes'] }),
      'E_FACT_VALUE /stages/0/rules/0/when/fact/2',
    ],
    [
      'E_HISTORY_FACT',
      withRule({ streak: { fact: 'hot', equals: true, atLeast: 2 } }),
      'E_HISTORY_FACT /stages/0/rules/0/when/streak/fact',
    ],
    [
      'E_UNKNOWN_EVENT',
      withRule({ event: 'nope' }),
      'E_UNKNOWN_EVENT /stages/0/rules/0/when/event',
    ],
    [
      'E_EVENT_FILTER bet',
      withRule({ event: 'zero', bet: 'a' }),
      'E_EVENT_FILTER /stages/0/rules/0/when/bet',
    ],
    [
      'E_EVENT_FILTER prog',
      withRule({ event: 'bet-won', prog: 'm' }),
      'E_EVENT_FILTER /stages/0/rules/0/when/prog',
    ],
    [
      'E_EVENT_FILTER args',
      withRule({ event: 'hit', args: { q: 1 } }),
      'E_EVENT_FILTER /stages/0/rules/0/when/args/q',
    ],
    ['E_UNKNOWN_ACT', withEffect({ act: 'jump' }), 'E_UNKNOWN_ACT /stages/0/rules/0/then/0/act'],
    [
      'E_PRESS_NON_PERSISTENT',
      withEffect({ press: 'a', by: 100 }),
      'E_PRESS_NON_PERSISTENT /stages/0/rules/0/then/0/press',
    ],
    [
      'E_REMOVE_CONTRACT',
      withEffect({ remove: 'c' }),
      'E_REMOVE_CONTRACT /stages/0/rules/0/then/0/remove',
    ],
    [
      'E_UNKNOWN_LIMIT_CLASS',
      withLayout({ bet: 'a', amount: { tableMin: 'zzz' } }),
      'E_UNKNOWN_LIMIT_CLASS /stages/0/layout/0/amount/tableMin',
    ],
    ['E_BELOW_MIN', withLayout({ bet: 'a', amount: 100 }), 'E_BELOW_MIN /stages/0/layout/0/amount'],
    [
      'E_BELOW_MIN units',
      withLayout({ bet: 'a', amount: { units: 0.5 } }),
      'E_BELOW_MIN /stages/0/layout/0/amount',
    ],
    [
      'E_BELOW_MIN effect',
      withEffect({ bet: 'a', amount: 100 }),
      'E_BELOW_MIN /stages/0/rules/0/then/0/amount',
    ],
  ];
  it.each(cases)('%s', (_n, d, expected) => {
    expect(run(d)).toContain(expected);
    // R-level codes are not reported in structural-only mode
    expect(validateStrategy(d, null).map((x) => x.code)).not.toContain(expected.split(' ')[0]);
  });

  it('accepts plugin extras (target params) and parameterised facts', () => {
    expect(errs(withRule({ cmp: ['since:zero', '>=', 5] }))).toEqual([]);
    expect(errs(withRule({ cmp: ['count:10:a', '>=', 5] }))).toEqual([]);
    expect(errs(withRule({ fact: ['dozen', 'in', [1, 2]] }))).toEqual([]);
    expect(errs(withRule({ fact: ['color', '!=', 'red'] }))).toEqual([]);
    expect(errs(withRule({ event: 'hit', bet: 'a', args: { k: 1 } }))).toEqual([]);
    expect(errs(withRule({ event: 'bet-won', bet: 'A' }))).toEqual([]);
    expect(errs(withRule({ cmp: [{ tableMin: 'outside' }, '<=', { tableMax: 'a' }] }))).toEqual([]);
    expect(errs(withEffect({ act: 'fold' }))).toEqual([]);
  });

  it('E_BET_UNAVAILABLE when the parser accepts a bet the catalog lacks', () => {
    const c = makeCtx({ parseBet: (id) => (id === 'ghost' ? 'ghost' : id) });
    expect(run(withLayout({ bet: 'ghost', amount: 2500 }), c)).toContain(
      'E_BET_UNAVAILABLE /stages/0/layout/0/bet',
    );
  });
});

describe('validateStrategy: warnings', () => {
  const warns = (d: J) =>
    validateStrategy(d, ctx)
      .filter((x) => x.severity === 'warning' && !/^W_UNUSED|^W_UNREACHABLE/.test(x.code))
      .map((x) => `${x.code} ${x.path}`);
  const allWarns = (d: J) =>
    validateStrategy(d, ctx)
      .filter((x) => x.severity === 'warning')
      .map((x) => `${x.code} ${x.path}`);
  it('W_UNREACHABLE_STAGE', () => {
    const d = base();
    d.stages[0].rules = [];
    d.stages[1].rules = [];
    expect(allWarns(d)).toContain('W_UNREACHABLE_STAGE /stages/1/id');
  });
  it('a pure extends parent is not unreachable', () => {
    const d = base();
    d.stages[0].rules = [];
    d.stages[0].extends = 's2';
    d.stages[1].rules = [];
    expect(allWarns(d).some((w) => w.startsWith('W_UNREACHABLE_STAGE'))).toBe(false);
  });
  it('W_EFFECT_CAP_POSSIBLE', () => {
    const d = base();
    d.stages[0].rules = Array.from({ length: 3 }, () => ({
      when: { always: true },
      then: Array.from({ length: 6 }, () => ({ inc: 'x' })),
    }));
    expect(warns(d)).toContain('W_EFFECT_CAP_POSSIBLE /stages/0/rules');
  });
  it('W_UNUSED_VAR and W_UNUSED_PROG', () => {
    const d = base();
    d.vars.y = 1;
    d.progressions.n = { kind: 'flat', track: 'a' };
    expect(allWarns(d)).toEqual(['W_UNUSED_VAR /vars/y', 'W_UNUSED_PROG /progressions/n']);
  });
  it('W_TRACK_MISMATCH', () => {
    const d = base();
    d.progressions.m.track = 'b';
    expect(warns(d)).toContain('W_TRACK_MISMATCH /progressions/m/track');
  });
  it('W_PROG_ABOVE_TABLE_MAX', () => {
    const d = base();
    d.progressions.m.maxSteps = 9; // 2^8 * 2500 = 640,000 > 500,000
    expect(warns(d)).toContain('W_PROG_ABOVE_TABLE_MAX /progressions/m');
  });
  it('W_BELOW_MIN_POSSIBLE for inside chips and inside totals', () => {
    expect(warns(withLayout({ bet: 'in1', amount: 50 }))).toContain(
      'W_BELOW_MIN_POSSIBLE /stages/0/layout/0/amount',
    );
    expect(warns(withLayout({ bet: 'in1', amount: 1000 }))).toContain(
      'W_BELOW_MIN_POSSIBLE /stages/0/layout',
    );
    expect(warns(withLayout({ bet: 'in1', amount: 2500 }))).toEqual([]);
  });
  it('W_KEEP_NON_PERSISTENT', () => {
    expect(warns(withLayout({ bet: 'a', amount: { keepOr: 2500 } }))).toContain(
      'W_KEEP_NON_PERSISTENT /stages/0/layout/0/amount',
    );
    expect(warns(withLayout({ bet: 'b', amount: { keepOr: 2500 } }))).toEqual([]);
  });
  it('W_NO_LAYOUT', () => {
    const d = base();
    d.stages = [{ id: 's1' }];
    d.vars = {};
    d.progressions = {};
    expect(warns(d)).toEqual(['W_NO_LAYOUT /stages']);
    d.stages = [
      { id: 's1', rules: [{ when: { always: true }, then: [{ bet: 'a', amount: 2500 }] }] },
    ];
    expect(warns(d)).toEqual([]);
  });
  it('W_NO_EXIT is an experiment-level helper', () => {
    expect(noExitWarning(base(), false)?.code).toBe('W_NO_EXIT');
    expect(noExitWarning(base(), true)).toBeNull();
    expect(noExitWarning(withEffect({ stop: 'done' }), false)).toBeNull();
  });
  it('W_UNIT_MIX', () => {
    expect(warns(withLayout({ bet: 'a', amount: { add: ['net', 'round'] } }))).toContain(
      'W_UNIT_MIX /stages/0/layout/0/amount',
    );
    expect(warns(withLayout({ bet: 'a', amount: 'round' }))).toContain(
      'W_UNIT_MIX /stages/0/layout/0/amount',
    );
    expect(warns(withLayout({ bet: 'a', amount: { times: ['round', { units: 1 }] } }))).toEqual([]);
  });
  it('W_EMPTY_GROUP and W_CONST_CONDITION', () => {
    expect(warns(withRule({ all: [] }))).toContain('W_EMPTY_GROUP /stages/0/rules/0/when/all');
    expect(warns(withRule({ cmp: [1, '<', 2] }))).toContain(
      'W_CONST_CONDITION /stages/0/rules/0/when/cmp',
    );
  });
  it('W_NEEDS_PARENT', () => {
    expect(warns(withLayout({ bet: 'odds', amount: 2500 }))).toContain(
      'W_NEEDS_PARENT /stages/0/layout/0',
    );
    expect(warns(withLayout({ bet: 'odds', amount: 2500 }, { bet: 'b', amount: 2500 }))).toEqual(
      [],
    );
  });
});

describe('validateStrategy: robustness', () => {
  it('a 100k-deep expression is E_LIMIT, not E_INTERNAL', () => {
    let e: unknown = 1;
    for (let i = 0; i < 100_000; i++) e = { abs: e };
    const out = validateStrategy(withLayout({ bet: 'a', amount: e }), ctx);
    expect(out.some((x) => x.code === 'E_INTERNAL')).toBe(false);
    expect(out.some((x) => x.code === 'E_LIMIT')).toBe(true);
    let c: unknown = { always: true };
    for (let i = 0; i < 100_000; i++) c = { not: c };
    expect(validateStrategy(withRule(c), ctx).some((x) => x.code === 'E_INTERNAL')).toBe(false);
  });

  it('survives random mutations of a rich definition', () => {
    const rich = withRule(
      { all: [{ streak: { fact: 'color', equals: 'red', atLeast: 2 } }, { event: 'zero' }] },
      [{ press: 'b', by: 100 }, { goto: 's2' }],
    );
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const junk = [null, 0, -1, 1.5, 'x', '', true, [], {}, [1], { a: 1 }, 1e308, 'red'];
    for (let n = 0; n < 400; n++) {
      const d = JSON.parse(JSON.stringify(rich));
      for (let m = 0; m < 3; m++) {
        const paths: (string | number)[][] = [];
        const walk = (x: any, p: (string | number)[]) => {
          paths.push(p);
          if (x && typeof x === 'object') for (const k of Object.keys(x)) walk(x[k], [...p, k]);
        };
        walk(d, []);
        const p = paths[Math.floor(rnd() * paths.length)] as (string | number)[];
        if (p.length === 0) continue;
        let parent: any = d;
        for (const k of p.slice(0, -1)) parent = parent[k];
        const last = p[p.length - 1] as string | number;
        if (rnd() < 0.2) delete parent[last];
        else parent[last] = structuredClone(junk[Math.floor(rnd() * junk.length)]);
      }
      const out = validateStrategy(d, ctx);
      expect(out.some((x) => x.code === 'E_INTERNAL')).toBe(false);
      expect(() => validateStrategy(d, null)).not.toThrow();
    }
  });
});
