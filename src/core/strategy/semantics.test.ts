/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { describe, expect, it } from 'vitest';
import { Driver, outcome } from './__fixtures__/driver';
import { StrategyCompileError, compileStrategy, stepPure } from './index';
import { makeCtx } from './__fixtures__/stub-ctx';
import type { StrategyDefinition } from '../contracts/strategy';

type J = Record<string, any>;

const mk = (stages: J[], o: J = {}): J => ({
  schema: 1,
  id: 't',
  name: 'T',
  game: 'stub',
  unit: 100,
  stages,
  ...o,
});
const bet = (b: string, amount: unknown, extra: J = {}): J => ({ bet: b, amount, ...extra });
const rule = (when: unknown, ...then: J[]): J => ({ when, then });
const always = { always: true };
const nets = (n: number): ReturnType<typeof outcome> => outcome([['a', 100, n]]);

describe('phases', () => {
  it('progressions update before rules; rules see earlier effects; layout sees this window', () => {
    const d = new Driver(
      mk(
        [
          {
            id: 's',
            layout: [bet('a', { var: 'y' }), bet('b', { prog: 'p' })],
            rules: [
              rule({ cmp: [{ prog: 'p' }, '>=', 200] }, { set: 'x', to: { prog: 'p' } }),
              rule({ cmp: [{ var: 'x' }, '==', 200] }, { set: 'y', to: 777 }),
            ],
          },
        ],
        {
          vars: { x: 0, y: 5 },
          progressions: { p: { kind: 'martingale', track: 'b', maxSteps: 4, onCap: 'reset' } },
        },
      ),
    );
    expect(d.step().want).toEqual([
      ['a', 5],
      ['b', 100],
    ]);
    const r = d.step(outcome([['b', 100, -100]]));
    expect(r.want).toEqual([
      ['a', 777],
      ['b', 200],
    ]);
    expect(r.trace.fired).toEqual(['s#0', 's#1']);
  });

  it('window 0 runs the first stage onEnter and counts it toward the cap', () => {
    const d = new Driver(
      mk([{ id: 's', onEnter: [{ set: 'x', to: 3 }], layout: [bet('a', { var: 'x' })] }], {
        vars: { x: 0 },
      }),
    );
    const r = d.step();
    expect(r.want).toEqual([['a', 3]]);
    expect(r.trace.fired).toEqual(['@enter:s']);
    expect(d.step().trace.fired).toEqual([]);
  });
});

describe('goto', () => {
  const def = (): J =>
    mk(
      [
        {
          id: 's1',
          onExit: [{ inc: 'exits' }],
          layout: [bet('a', 100)],
          rules: [
            rule({ cmp: ['round', '>=', 1] }, { goto: 's2' }),
            rule(always, { inc: 'after' }),
          ],
        },
        {
          id: 's2',
          onEnter: [{ inc: 'enters' }],
          layout: [bet('a', { add: [{ var: 'exits' }, { times: ['roundsInStage', 1000] }] })],
        },
      ],
      { vars: { exits: 0, enters: 0, after: 0 } },
    );

  it('runs onExit then onEnter, ends evaluation and uses the new stage layout at once', () => {
    const d = new Driver(def());
    d.step();
    const r = d.step(nets(0));
    expect(r.trace.fired).toEqual(['s1#0', '@exit:s1', '@enter:s2']);
    expect(r.trace.stage).toBe('s1');
    expect(r.trace.stageAfter).toBe('s2');
    expect(r.out.stage).toBe(1);
    expect(r.want).toEqual([['a', 1]]); // exits = 1, roundsInStage = 0 in the goto window
    const vars = Object.fromEntries(
      ['exits', 'enters', 'after'].map((n, i) => [n, (d.mem as any).vars[i]]),
    );
    expect(vars).toEqual({ exits: 1, enters: 1, after: 1 }); // `after` ran in window 0 only
    expect(d.step(nets(0)).want).toEqual([['a', 1001]]); // roundsInStage is 1
  });

  it('stageEntries counts the initial entry and every re-entry', () => {
    const d = new Driver(
      mk(
        [
          { id: 'x', rules: [rule({ cmp: ['round', '>=', 1] }, { goto: 'y' })] },
          {
            id: 'y',
            layout: [bet('a', { times: [{ stageEntries: 'y' }, 100] })],
            rules: [rule({ cmp: ['roundsInStage', '>=', 1] }, { goto: 'x' })],
          },
        ],
        {},
      ),
    );
    d.step();
    expect(d.step(nets(0)).want).toEqual([['a', 100]]);
    expect(d.step(nets(0)).want).toEqual([]); // y -> x
    expect(d.step(nets(0)).want).toEqual([['a', 200]]); // y entered a second time
  });

  it('goto to the current stage is a no-op that does not end evaluation, unless reenter', () => {
    const noop = new Driver(
      mk(
        [
          {
            id: 's',
            layout: [bet('a', { var: 'v' })],
            rules: [rule(always, { goto: 's' }), rule(always, { set: 'v', to: 9 })],
          },
        ],
        { vars: { v: 1 } },
      ),
    );
    const r = noop.step();
    expect(r.want).toEqual([['a', 9]]);
    expect(r.trace.effects[0]).toMatchObject({ op: 'goto', note: 'no-op' });
    expect(r.trace.stageAfter).toBeUndefined();

    const re = new Driver(
      mk(
        [
          {
            id: 's',
            onEnter: [{ inc: 'n' }],
            layout: [bet('a', { var: 'n' })],
            rules: [
              { when: always, once: 'stage', then: [{ goto: 's', reenter: true }] },
              rule(always, { set: 'v', to: 9 }),
            ],
          },
        ],
        { vars: { n: 0, v: 1 } },
      ),
    );
    const w0 = re.step();
    // onEnter n=1 (window 0), reenter -> onEnter n=2, evaluation ends (the v rule did not run)
    expect(w0.want).toEqual([['a', 2]]);
    expect(w0.trace.fired).toEqual(['@enter:s', 's#0', '@enter:s']);
  });

  it('a no-op goto still counts toward the effect cap', () => {
    const d = new Driver(
      mk([
        { id: 's', rules: [rule(always, ...Array.from({ length: 16 }, () => ({ goto: 's' })))] },
      ]),
    );
    expect(d.step().out.error).toBeNull();
  });
});

describe('stop and errors', () => {
  it('stop ends the window: no layout, no onExit, no further effects', () => {
    const d = new Driver(
      mk(
        [
          {
            id: 's',
            onExit: [{ inc: 'x' }],
            layout: [bet('a', 100)],
            rules: [rule(always, { stop: 'done' }), rule(always, { inc: 'x' })],
          },
        ],
        { vars: { x: 0 } },
      ),
    );
    const r = d.step();
    expect(r.out.stop).toBe('done');
    expect(r.out.desired).toHaveLength(0);
    expect(r.trace.stop).toBe('done');
    expect((d.mem as any).vars[0]).toBe(0);
    expect(d.rt.stopReasons).toEqual(['done']);
  });

  it('a stop from a cap in phase 2 skips the rules', () => {
    const d = new Driver(
      mk([{ id: 's', layout: [bet('a', { prog: 'p' })], rules: [rule(always, { inc: 'x' })] }], {
        vars: { x: 0 },
        progressions: { p: { kind: 'martingale', track: 'a', maxSteps: 1, onCap: 'stop' } },
      }),
    );
    d.step();
    const r = d.step(outcome([['a', 100, -100]]));
    expect(r.out.stop).toBe('cap-p');
    expect(r.trace.fired).toEqual([]);
  });

  it('16 effects run; the 17th is a runtime error; hooks count', () => {
    const effects = (n: number): J[] => Array.from({ length: n }, () => ({ inc: 'x' }));
    const ok = new Driver(
      mk([{ id: 's', rules: [rule(always, ...effects(16))] }], { vars: { x: 0 } }),
    );
    expect(ok.step().out.error).toBeNull();
    const over = new Driver(
      mk(
        [
          { id: 's', rules: [rule(always, ...effects(10), { goto: 't' })] },
          { id: 't', onEnter: effects(6) },
        ],
        { vars: { x: 0 } },
      ),
    );
    const r = over.step(); // 10 + goto + 6 enter = 17
    expect(r.out.error?.code).toBe('E_RT_EFFECT_CAP');
    expect(r.out.desired).toHaveLength(0);
    expect(r.trace.error?.code).toBe('E_RT_EFFECT_CAP');
    // window 0 onEnter counts too
    const w0 = new Driver(
      mk([{ id: 's', onEnter: effects(8), rules: [rule(always, ...effects(9))] }], {
        vars: { x: 0 },
      }),
    );
    expect(w0.step().out.error?.code).toBe('E_RT_EFFECT_CAP');
  });

  it('infinite amounts are a runtime error; null amounts are dropped and counted', () => {
    const inf = new Driver(mk([{ id: 's', layout: [bet('a', { times: [1e308, 1e308] })] }]));
    expect(inf.step().out.error?.code).toBe('E_RT_NONFINITE');
    const nul = new Driver(
      mk(
        [{ id: 's', layout: [bet('a', { div: [100, { var: 'z' }] }), bet('b', 0), bet('c', -5)] }],
        {
          vars: { z: 0 },
        },
      ),
    );
    const r = nul.step();
    expect(r.want).toEqual([]);
    expect(r.out.anomalies).toBe(1); // only the null amount counts
    expect(nul.step().out.anomalies).toBe(1); // reset every step
    expect(r.trace.dropped).toEqual([
      { bet: 'a', reason: 'null' },
      { bet: 'b', reason: 'zero' },
      { bet: 'c', reason: 'negative' },
    ]);
  });
});

describe('once, cooldown, enabled', () => {
  it('once: true fires once per session and survives goto', () => {
    const d = new Driver(
      mk(
        [
          {
            id: 'a1',
            layout: [bet('a', { var: 'x' })],
            rules: [
              { when: always, once: true, then: [{ inc: 'x' }] },
              rule({ cmp: ['round', '==', 1] }, { goto: 'a2' }),
            ],
          },
          {
            id: 'a2',
            layout: [bet('a', { var: 'x' })],
            rules: [rule({ cmp: ['round', '==', 2] }, { goto: 'a1' })],
          },
        ],
        { vars: { x: 0 } },
      ),
    );
    for (let i = 0; i < 5; i++) d.step(nets(0));
    expect((d.mem as any).vars[0]).toBe(1);
  });

  it("once: 'stage' re-arms on each stage entry", () => {
    const d = new Driver(
      mk(
        [
          {
            id: 'a1',
            layout: [bet('a', { var: 'x' })],
            rules: [
              { when: always, once: 'stage', then: [{ inc: 'x' }] },
              rule({ cmp: ['roundsInStage', '==', 2] }, { goto: 'a2' }),
            ],
          },
          { id: 'a2', rules: [rule(always, { goto: 'a1' })] },
        ],
        { vars: { x: 0 } },
      ),
    );
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      d.step(nets(0));
      seen.push((d.mem as any).vars[0]);
    }
    expect(seen).toEqual([1, 1, 1, 1, 2, 2, 2, 3]);
  });

  it('cooldown c skips exactly the next c windows, across stages and inherited copies', () => {
    const d = new Driver(
      mk(
        [
          {
            id: 'base',
            layout: [bet('a', 100)],
            rules: [
              { when: always, cooldown: 2, then: [{ inc: 'x' }] },
              rule({ cmp: ['round', '==', 3] }, { goto: 'kid' }),
            ],
          },
          { id: 'kid', extends: 'base' },
        ],
        { vars: { x: 0 } },
      ),
    );
    const fired: number[] = [];
    for (let i = 0; i < 9; i++) if (d.step(nets(0)).trace.fired.includes('base#0')) fired.push(i);
    expect(fired).toEqual([0, 3, 6]);
  });

  it('enabled: false rules never run', () => {
    const d = new Driver(
      mk(
        [
          {
            id: 's',
            layout: [bet('a', { var: 'x' })],
            rules: [{ when: always, enabled: false, then: [{ set: 'x', to: 5 }] }],
          },
        ],
        {
          vars: { x: 1 },
        },
      ),
    );
    expect(d.step().want).toEqual([['a', 1]]);
  });
});

describe('extends', () => {
  const def = (): J =>
    mk(
      [
        {
          id: 'base',
          onEnter: [{ inc: 'enters' }],
          layout: [bet('a', 100), bet('b', 200, { when: { cmp: [{ var: 'x' }, '==', 0] } })],
          rules: [rule(always, { inc: 'order' })],
        },
        {
          id: 'kid',
          extends: 'base',
          layout: [bet('a', 300, { when: { cmp: [{ var: 'x' }, '==', 1] } })],
          rules: [rule(always, { set: 'order', to: 10 })],
        },
      ],
      { vars: { x: 0, order: 0, enters: 0 } },
    );

  it('child rules run first, then the parent; rule ids name the declaring stage', () => {
    const d = new Driver({ ...def(), stages: [def().stages[1], def().stages[0]] });
    const r = d.step();
    expect(r.trace.stage).toBe('kid');
    expect(r.trace.fired).toEqual(['kid#0', 'base#0']);
    expect((d.mem as any).vars[1]).toBe(11);
  });

  it("a child entry overrides the parent's only while its `when` holds; hooks are not inherited", () => {
    const d = new Driver({ ...def(), stages: [def().stages[1], def().stages[0]] });
    expect(d.step().want).toEqual([
      ['a', 100],
      ['b', 200],
    ]);
    (d.mem as any).vars[2] = 1;
    expect(d.step(nets(0)).want).toEqual([['a', 300]]);
    expect((d.mem as any).vars[0]).toBe(0);
  });
});

describe('patches', () => {
  it('bet overrides the layout entry, remove drops it, clear then bet re-adds', () => {
    const base = (rules: J[]): J =>
      mk([{ id: 's', layout: [bet('a', 100), bet('b', 200)], rules }]);
    expect(new Driver(base([rule(always, { bet: 'a', amount: 700 })])).step().want).toEqual([
      ['a', 700],
      ['b', 200],
    ]);
    expect(new Driver(base([rule(always, { remove: 'a' })])).step().want).toEqual([['b', 200]]);
    expect(
      new Driver(base([rule(always, { clear: true }, { bet: 'in1', amount: 400 })])).step().want,
    ).toEqual([['in1', 400]]);
    const r = new Driver(
      base([rule(always, { bet: 'c', amount: 50, parent: 'b', working: 'off' })]),
    ).step();
    expect(r.out.desired[2]).toMatchObject({ bet: 'c', amount: 50, parent: 'b', working: 'off' });
    expect(r.trace.desired.map((e) => e.source)).toEqual(['layout', 'layout', 'patch']);
  });

  it('patches last one window only', () => {
    const d = new Driver(
      mk([
        {
          id: 's',
          layout: [bet('a', 100)],
          rules: [rule({ cmp: ['round', '==', 0] }, { bet: 'a', amount: 900 })],
        },
      ]),
    );
    expect(d.step().want).toEqual([['a', 900]]);
    expect(d.step(nets(0)).want).toEqual([['a', 100]]);
  });

  it('press raises a bet on the table, honours cap, is a traced no-op when absent; keepOr keeps it', () => {
    const d = new Driver(
      mk([
        {
          id: 's',
          layout: [bet('b', { keepOr: 1200 })],
          rules: [rule({ event: 'bet-won', bet: 'b' }, { press: 'b', by: 600, cap: 1800 })],
        },
      ]),
    );
    expect(d.step().want).toEqual([['b', 1200]]);
    const won = outcome([['b', 1200, 1200]]);
    let r = d.step(won, { table: [{ bet: 'b', amount: 1200 }] });
    expect(r.want).toEqual([['b', 1800]]);
    r = d.step(outcome([], [], ['b']), { table: [{ bet: 'b', amount: 1800 }] });
    expect(r.want).toEqual([['b', 1800]]); // keepOr keeps the pressed amount
    r = d.step(won, { table: [{ bet: 'b', amount: 1800 }] });
    expect(r.want).toEqual([['b', 1800]]); // capped
    r = d.step(won, { table: [] });
    expect(r.trace.effects[0]).toMatchObject({ op: 'press', note: 'not-on-table' });
    expect(r.want).toEqual([['b', 1200]]);
  });
});

describe('skipRound and implicit keeps', () => {
  it('skipRound: desired is the table, later patches are ignored and traced, rules keep running', () => {
    const d = new Driver(
      mk(
        [
          {
            id: 's',
            layout: [bet('a', 100)],
            rules: [
              rule(always, { skipRound: true }),
              rule(always, { bet: 'in1', amount: 500 }, { inc: 'x' }),
            ],
          },
        ],
        { vars: { x: 0 } },
      ),
    );
    const r = d.step(null, { table: [{ bet: 'b', amount: 300 }] });
    expect(r.want).toEqual([['b', 300]]);
    expect(r.trace.skip).toBe(true);
    expect(r.trace.effects.filter((e) => e.note === 'ignored-skip').map((e) => e.op)).toEqual([
      'bet',
    ]);
    expect((d.mem as any).vars[0]).toBe(1);
    expect(d.step(nets(0)).want).toEqual([['b', 0]].slice(1).concat([]) as [string, number][]);
  });

  it('a contract bet left out of the layout is kept; removing one is a definition error', () => {
    const table = [{ bet: 'c', amount: 400 }];
    const kept = new Driver(mk([{ id: 's', layout: [bet('a', 100)] }])).step(null, { table });
    expect(kept.want).toEqual([
      ['a', 100],
      ['c', 400],
    ]);
    expect(kept.trace.desired[1]!.source).toBe('keep');
    expect(() => new Driver(mk([{ id: 's', rules: [rule(always, { remove: 'c' })] }]))).toThrow(
      StrategyCompileError,
    );
  });

  it('act passes through and is dropped on stop', () => {
    const d = new Driver(
      mk([
        {
          id: 's',
          layout: [bet('a', 100)],
          rules: [rule(always, { act: 'fold', args: { n: 1 } })],
        },
      ]),
    );
    expect(d.step().out.acts).toEqual([{ act: 'fold', args: { n: 1 } }]);
    const s = new Driver(mk([{ id: 's', rules: [rule(always, { act: 'fold' }, { stop: 'x' })] }]));
    expect(s.step().out.acts).toEqual([]);
  });
});

describe('expressions and conditions', () => {
  const amount = (expr: unknown, over: J = {}): number | undefined => {
    const d = new Driver(mk([{ id: 's', layout: [bet('a', expr)] }], over.def ?? {}));
    return d.step(over.last ?? null, over.step).want[0]?.[1];
  };

  it('evaluates each form', () => {
    expect(amount({ units: 2.5 })).toBe(250);
    expect(amount({ add: [1, 2, 3] })).toBe(6);
    expect(amount({ times: [2, 3, 4] })).toBe(24);
    expect(amount({ max: [1, 9, 3] })).toBe(9);
    expect(amount({ min: [7, 9, 3] })).toBe(3);
    expect(amount({ sub: [10, 3] })).toBe(7);
    expect(amount({ div: [10, 4] })).toBe(2); // floored at the boundary
    expect(amount({ floorTo: [1050, 100] })).toBe(1000);
    expect(amount({ abs: { sub: [3, 10] } })).toBe(7);
    expect(amount({ pctOfBankroll: 2 })).toBe(10_000);
    expect(amount({ tableMin: 'a' })).toBe(1);
    expect(amount({ tableMax: 'outside' })).toBe(1e12);
    expect(amount('equity')).toBe(500_000);
    expect(amount({ add: [{ fact: 'net' }, 5] })).toBe(5);
    expect(amount({ if: [{ always: true }, 5, 6] })).toBe(5);
    expect(amount({ amountOn: 'b' }, { step: { table: [{ bet: 'b', amount: 33 }] } })).toBe(33);
    const last = outcome([['b', 40, -40]]);
    expect(amount({ add: [{ lastAmount: 'b' }, 1000] }, { last })).toBe(1040);
    expect(amount({ add: [{ lastProfit: 'b' }, 1000] }, { last })).toBe(960);
  });

  it('null propagates and drops the entry; lastAmount is null at window 0', () => {
    expect(amount({ lastAmount: 'b' })).toBeUndefined();
    expect(amount({ add: [1, 'score'] })).toBeUndefined();
    const z = { def: { vars: { z: 0 } } };
    expect(amount({ div: [1, { var: 'z' }] }, z)).toBeUndefined();
    expect(amount({ floorTo: [1, { var: 'z' }] }, z)).toBeUndefined();
    expect(amount({ if: [always, 'score', 5] })).toBeUndefined();
    expect(amount({ lastAmount: 'b' }, { last: outcome([]) })).toBeUndefined(); // 0 -> dropped as zero
  });

  it('cmp with a null side is false for every operator including !=', () => {
    for (const op of ['<', '<=', '==', '!=', '>=', '>']) {
      const d = new Driver(
        mk([{ id: 's', layout: [bet('a', 100, { when: { cmp: ['score', op, 5] } })] }]),
      );
      expect(d.step(null).want).toEqual([]);
      d.view.score = 3;
      d.step(outcome([]));
    }
    const d = new Driver(
      mk([{ id: 's', layout: [bet('a', 100, { when: { cmp: ['score', '!=', 5] } })] }]),
    );
    d.step();
    expect(d.step(outcome([]), { view: { score: 3 } }).want).toEqual([['a', 100]]);
    expect(d.step(outcome([]), { view: { score: 5 } }).want).toEqual([]);
  });

  it('`if` evaluates only the chosen branch for arming', () => {
    const d = new Driver(
      mk(
        [
          {
            id: 's',
            layout: [bet('a', { if: [{ cmp: ['round', '==', 0] }, { units: 1 }, { prog: 'p' }] })],
          },
        ],
        {
          progressions: { p: { kind: 'martingale', track: 'a', maxSteps: 5, onCap: 'reset' } },
        },
      ),
    );
    d.step(); // chose units: not armed
    const r = d.step(outcome([['a', 100, -100]]));
    expect(r.trace.prog.p!.fed).toBe('unarmed');
  });

  it('fact conditions per type, with null facts false', () => {
    const cond = (c: unknown, view: J, last = outcome([])): boolean => {
      const d = new Driver(mk([{ id: 's', layout: [bet('a', 100, { when: c })] }]));
      d.step();
      return d.step(last, { view }).want.length === 1;
    };
    expect(cond({ fact: ['color', '==', 'red'] }, { color: 'red' })).toBe(true);
    expect(cond({ fact: ['color', '!=', 'red'] }, { color: 'black' })).toBe(true);
    expect(cond({ fact: ['color', '!=', 'red'] }, { color: null })).toBe(false);
    expect(cond({ fact: ['color', 'in', ['red', 'green']] }, { color: 'green' })).toBe(true);
    expect(cond({ fact: ['color', 'notIn', ['red', 'green']] }, { color: 'black' })).toBe(true);
    expect(cond({ fact: ['dozen', 'in', [1, 2]] }, { dozen: 2 })).toBe(true);
    expect(cond({ fact: ['hot', '==', true] }, { hot: true })).toBe(true);
    expect(cond({ fact: ['level', '>=', 3] }, { level: 3 })).toBe(true);
    expect(cond({ fact: ['level', '<', 3] }, { level: 3 })).toBe(false);
    expect(cond({ fact: ['lastResult', '==', 'loss'] }, {}, outcome([['a', 1, -1]]))).toBe(true);
    expect(cond({ fact: ['lastResult', '==', 'push'] }, {}, outcome([['a', 1, 0]]))).toBe(true);
    expect(cond({ fact: ['lastResult', '==', 'none'] }, {}, outcome([]))).toBe(true);
    expect(cond({ fact: ['stage', '==', 's'] }, {})).toBe(true);
    expect(cond({ not: { fact: ['color', '==', 'red'] } }, { color: 'black' })).toBe(true);
    expect(cond({ all: [always, { any: [{ onTable: 'b' }, always] }] }, {})).toBe(true);
  });

  it('round-scoped facts are null at window 0', () => {
    const d = new Driver(
      mk([{ id: 's', layout: [bet('a', 100, { when: { fact: ['color', '!=', 'red'] } })] }]),
    );
    expect(d.step(null, { view: { color: 'black' } }).want).toEqual([]);
  });

  it('short-circuits all/any', () => {
    const d = new Driver(
      mk(
        [
          {
            id: 's',
            layout: [bet('a', 100)],
            rules: [rule({ any: [always, { cmp: [{ prog: 'p' }, '>', 0] }] }, { inc: 'x' })],
          },
        ],
        { vars: { x: 0 }, progressions: { p: { kind: 'flat', track: 'manual' } } },
      ),
    );
    expect(d.step().out.error).toBeNull();
  });

  it('everyN with offset and of: stage; streakLen and friends', () => {
    const d = new Driver(
      mk([
        {
          id: 's',
          layout: [
            bet('a', 100, { when: { everyN: 3, offset: 1 } }),
            bet('b', 100, { when: { everyN: 2, of: 'stage' } }),
          ],
        },
      ]),
    );
    const rows: string[][] = [];
    for (let i = 0; i < 8; i++) rows.push(d.step(nets(0)).want.map((e) => e[0]));
    expect(rows.map((r) => r.join(''))).toEqual(['b', 'a', 'b', '', 'ab', '', 'b', 'a']);
  });

  it('event filters: plugin events with args, core events by profit sign, prog events', () => {
    const d = new Driver(
      mk(
        [
          {
            id: 's',
            layout: [bet('a', 100)],
            rules: [
              rule({ event: 'hit', bet: 'a', args: { k: 2 } }, { inc: 'hits' }),
              rule({ event: 'bet-lost', bet: 'in1' }, { inc: 'lost' }),
              rule({ event: 'bet-push' }, { inc: 'pushes' }),
              rule({ event: 'bet-won', bet: 'a' }, { inc: 'won' }),
              rule({ event: 'prog-cap', prog: 'p' }, { inc: 'caps' }),
            ],
          },
        ],
        {
          vars: { hits: 0, lost: 0, pushes: 0, won: 0, caps: 0 },
          progressions: { p: { kind: 'martingale', track: 'in1', maxSteps: 1, onCap: 'reset' } },
        },
      ),
    );
    const v = (): number[] => Array.from((d.mem as any).vars as Float64Array);
    d.step();
    d.step(
      outcome(
        [
          ['a', 100, 100],
          ['in1', 100, -100],
        ],
        [{ type: 'hit', bet: 'a', k: 2 }],
      ),
    );
    expect(v()).toEqual([0, 1, 1, 0, 1]); // slots are sorted: caps hits lost pushes won
  });
});

describe('history trackers match a brute-force recomputation', () => {
  it('streakLen, countInLast (with and without partial) and roundsSince', () => {
    const colors = ['red', 'black', 'green'];
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const seq = Array.from({ length: 120 }, () => colors[Math.floor(rnd() * 3)] as string);
    const h = { fact: 'color', equals: 'red' };
    const d = new Driver(
      mk([
        {
          id: 's',
          layout: [
            bet('a', { add: [1000, { streakLen: h }] }),
            bet('b', { add: [1000, { countInLast: { ...h, n: 5 } }] }),
            bet('c', { add: [1000, { roundsSince: h }] }),
            bet('in1', 100, { when: { countInLast: { ...h, n: 5, atLeast: 2 } } }),
            bet('odds', 100, { when: { countInLast: { ...h, n: 5, atLeast: 2, partial: true } } }),
          ],
        },
      ]),
    );
    for (let w = 0; w < seq.length; w++) {
      const r = d.step(w === 0 ? null : nets(0), {
        view: { color: w === 0 ? null : seq[w - 1] },
      });
      const held = seq.slice(0, w).map((c) => c === 'red');
      let streak = 0;
      for (let i = held.length - 1; i >= 0 && held[i]; i--) streak++;
      const lastN = held.slice(-5);
      const count = lastN.filter(Boolean).length;
      const idx = held.lastIndexOf(true);
      const since = idx < 0 ? w : w - 1 - idx;
      const got = Object.fromEntries(r.want);
      expect(got.a).toBe(1000 + streak);
      expect(got.b).toBe(1000 + count);
      expect(got.c).toBe(1000 + since);
      expect('in1' in got).toBe(w >= 5 && count >= 2);
      expect('odds' in got).toBe(count >= 2);
    }
  });

  it('streak, since and event predicates as conditions', () => {
    const d = new Driver(
      mk([
        {
          id: 's',
          layout: [
            bet('a', 100, { when: { streak: { fact: 'color', equals: 'red', atLeast: 2 } } }),
            bet('b', 100, { when: { since: { event: 'zero', atLeast: 2 } } }),
            bet('c', 100, { when: { countInLast: { event: 'zero', n: 3, atMost: 0 } } }),
          ],
        },
      ]),
    );
    d.step();
    let r = d.step(outcome([], [{ type: 'zero' }]), { view: { color: 'red' } });
    expect(r.want).toEqual([]); // streak 1; zero just hit; window count < n
    r = d.step(outcome([]), { view: { color: 'red' } });
    expect(r.want.map((e) => e[0])).toEqual(['a']);
    r = d.step(outcome([]), { view: { color: 'black' } });
    expect(r.want.map((e) => e[0])).toEqual(['b']);
    r = d.step(outcome([]), { view: { color: 'black' } });
    expect(r.want.map((e) => e[0])).toEqual(['b', 'c']);
  });
});

describe('determinism, normalization and compile errors', () => {
  const rich = (): J =>
    mk(
      [
        {
          id: 'base',
          layout: [bet('a', { prog: 'p' }), bet('b', { keepOr: 200 })],
          rules: [
            rule({ cmp: ['lossStreak', '>=', 2] }, { inc: 'x' }),
            rule({ cmp: [{ var: 'x' }, '>=', 2] }, { goto: 'kid' }),
          ],
        },
        {
          id: 'kid',
          extends: 'base',
          layout: [bet('a', 300)],
          rules: [rule({ cmp: ['roundsInStage', '>=', 3] }, { goto: 'base' })],
        },
      ],
      {
        vars: { x: 0, y: 1 },
        progressions: {
          q: { kind: 'fibonacci', track: 'round', maxSteps: 6 },
          p: { kind: 'martingale', track: 'a', maxSteps: 5, onCap: 'reset' },
        },
      },
    );

  const script = (n: number): ReturnType<typeof outcome>[] => {
    let seed = 99;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    return Array.from({ length: n }, () => {
      const x = rnd();
      return outcome([['a', 100, x < 0.45 ? 100 : x < 0.5 ? 0 : -100]]);
    });
  };

  it('the same run twice gives byte-identical traces', () => {
    const run = (): string => {
      const d = new Driver(rich());
      d.step();
      for (const o of script(200)) d.step(o);
      return JSON.stringify(d.traces);
    };
    expect(run()).toBe(run());
  });

  it('vars and progressions written in any key order behave identically', () => {
    const a = rich();
    const b = rich();
    b.vars = { y: 1, x: 0 };
    b.progressions = { p: a.progressions.p, q: a.progressions.q };
    const trace = (def: J): string => {
      const d = new Driver(def);
      d.step();
      for (const o of script(100)) d.step(o);
      return JSON.stringify(d.traces);
    };
    expect(trace(a)).toBe(trace(b));
  });

  it('stepPure agrees with in-place step over 2,000 windows', () => {
    const d = new Driver(rich());
    const rt = compileStrategy(
      rich() as StrategyDefinition,
      makeCtx({ limits: () => ({ min: 1, max: 1e12 }) }),
    );
    let mem = rt.createMemory();
    rt.reset(mem);
    const outs = script(2000);
    let net = 0;
    for (let w = 0; w <= outs.length; w++) {
      const last = w === 0 ? null : (outs[w - 1] as ReturnType<typeof outcome>);
      if (last) net += last.net;
      const obs = {
        window: w,
        session: {
          start: 5e5,
          bankroll: 5e5 + net,
          equity: 5e5 + net,
          net,
          peak: 5e5,
          drawdown: 0,
          wagered: 0,
          roundsWagered: 0,
          lastNet: last?.net ?? 0,
          exposure: 0,
        },
        table: [],
        last,
        state: {},
      };
      const ref = d.step(last);
      const p = stepPure(rt, mem, obs);
      mem = p.mem;
      expect(p.out.desired).toEqual(ref.out.desired);
      expect(p.out.stage).toBe(ref.out.stage);
      expect(p.trace).toEqual(ref.trace);
    }
  });

  it('stopReasons are sorted and include cap-/done- reasons', () => {
    const rt = compileStrategy(
      mk(
        [
          {
            id: 's',
            layout: [bet('a', { prog: 'z' })],
            rules: [rule(always, { stop: 'zzz' }), rule({ cmp: [1, '>', 2] }, { stop: 'aaa' })],
          },
        ],
        {
          progressions: {
            z: { kind: 'martingale', track: 'a', maxSteps: 3, onCap: 'stop' },
            l: { kind: 'labouchere', track: 'a', line: [1], onEmpty: 'stop' },
          },
        },
      ) as StrategyDefinition,
      makeCtx(),
    );
    expect(rt.stopReasons).toEqual(['aaa', 'cap-z', 'done-l', 'zzz']);
    expect(rt.stageIds).toEqual(['s']);
  });

  it('compileStrategy throws StrategyCompileError with the diagnostics', () => {
    try {
      compileStrategy(mk([{ id: 's', layout: [bet('zz', 100)] }]) as StrategyDefinition, makeCtx());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(StrategyCompileError);
      expect((e as StrategyCompileError).diagnostics[0]?.code).toBe('E_UNKNOWN_BET');
    }
  });
});
