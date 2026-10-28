import { describe, expect, it } from 'vitest';
import { Driver, outcome } from './__fixtures__/driver';

const U = 100;
const def = (prog: unknown, extra: Record<string, unknown> = {}) => ({
  schema: 1,
  id: 't',
  name: 'T',
  game: 'stub',
  unit: U,
  progressions: { p: prog },
  stages: [{ id: 's', layout: [{ bet: 'a', amount: { prog: 'p' } }] }],
  ...extra,
});

/** Runs results (W/L/P) through one progression; returns amounts before each result and the next. */
function run(spec: Record<string, unknown>, results: string, extra = {}) {
  const d = new Driver(def({ track: 'a', ...spec }, extra));
  const amounts: number[] = [];
  let r = d.step();
  let stop: string | null = r.out.stop;
  for (const c of results) {
    if (stop) break;
    const amt = r.want[0]?.[1] ?? 0;
    amounts.push(amt);
    const profit = c === 'W' ? amt : c === 'L' ? -amt : 0;
    r = d.step(outcome([['a', amt, profit]]));
    stop = r.out.stop;
  }
  return { units: amounts.map((a) => a / U), next: (r.want[0]?.[1] ?? 0) / U, stop };
}

describe('progression reference sequences (strategy.md §7.7)', () => {
  it('martingale L=6 reset', () => {
    const r = run({ kind: 'martingale', maxSteps: 6, onCap: 'reset' }, 'LLLLLLLW');
    expect(r.units).toEqual([1, 2, 4, 8, 16, 32, 1, 2]);
    expect(r.next).toBe(1);
  });
  it('martingale L=6 stay', () => {
    const r = run({ kind: 'martingale', maxSteps: 6, onCap: 'stay' }, 'LLLLLLLW');
    expect(r.units).toEqual([1, 2, 4, 8, 16, 32, 32, 32]);
    expect(r.next).toBe(1);
  });
  it('martingale L=4 multiplier 3', () => {
    const r = run({ kind: 'martingale', maxSteps: 4, multiplier: 3, onCap: 'reset' }, 'LLLLW');
    expect(r.units).toEqual([1, 3, 9, 27, 1]);
    expect(r.next).toBe(1);
  });
  it('grand martingale L=6', () => {
    const r = run({ kind: 'grand-martingale', maxSteps: 6, onCap: 'reset' }, 'LLLLLLW');
    expect(r.units).toEqual([1, 3, 7, 15, 31, 63, 1]);
    expect(r.next).toBe(1);
  });
  it('fibonacci L=12 steps back two', () => {
    const r = run({ kind: 'fibonacci', maxSteps: 12 }, 'LLLLLWWLWWW');
    expect(r.units).toEqual([1, 1, 2, 3, 5, 8, 3, 1, 2, 1, 1]);
    expect(r.next).toBe(1);
  });
  it('dalembert', () => {
    const r = run({ kind: 'dalembert' }, 'LLLWLWWWW');
    expect(r.units).toEqual([1, 2, 3, 4, 3, 4, 3, 2, 1]);
    expect(r.next).toBe(1);
  });
  it('paroli L=3', () => {
    const r = run({ kind: 'paroli', maxSteps: 3 }, 'WWWWLW');
    expect(r.units).toEqual([1, 2, 4, 1, 2, 1]);
    expect(r.next).toBe(2);
  });
  it('1-3-2-6', () => {
    const r = run({ kind: '1-3-2-6' }, 'WWWWWLW');
    expect(r.units).toEqual([1, 3, 2, 6, 1, 3, 1]);
    expect(r.next).toBe(3);
  });
  it("oscar's grind (two sequences)", () => {
    let r = run({ kind: 'oscars-grind' }, 'LLWWWLW');
    expect(r.units).toEqual([1, 1, 1, 2, 1, 1, 1]);
    expect(r.next).toBe(1);
    r = run({ kind: 'oscars-grind' }, 'WLLLWWWW');
    expect(r.units).toEqual([1, 1, 1, 1, 1, 2, 1, 1]);
    expect(r.next).toBe(1);
  });
  it('labouchere [1,2,3,4]', () => {
    const r = run({ kind: 'labouchere', line: [1, 2, 3, 4] }, 'LWLWWW');
    expect(r.units).toEqual([5, 6, 6, 8, 7, 5]);
    expect(r.next).toBe(5);
  });
  it('sequence with cap stop', () => {
    const r = run(
      {
        kind: 'sequence',
        amounts: [{ units: 1 }, { units: 2 }, { units: 4 }, { units: 8 }],
        onWin: 'reset',
        onLoss: 'advance',
        onCap: 'stop',
      },
      'LLLL',
    );
    expect(r.units).toEqual([1, 2, 4, 8]);
    expect(r.stop).toBe('cap-p');
  });
});

describe('progression behaviours', () => {
  it('push and none leave every kind unchanged', () => {
    const kinds: Record<string, unknown>[] = [
      { kind: 'martingale', maxSteps: 5, onCap: 'reset' },
      { kind: 'fibonacci' },
      { kind: 'dalembert' },
      { kind: 'paroli' },
      { kind: '1-3-2-6' },
      { kind: 'oscars-grind' },
      { kind: 'labouchere', line: [1, 2, 3] },
      { kind: 'sequence', amounts: [1, 2, 3], onWin: 'reset', onLoss: 'advance' },
    ];
    for (const k of kinds) {
      const d = new Driver(def({ track: 'a', ...k }));
      const first = d.step();
      const amt = first.want[0]![1];
      const lost = d.step(outcome([['a', amt, -amt]]));
      const lostAmt = lost.want[0]![1];
      expect(d.step(outcome([['a', lostAmt, 0]])).want[0]![1]).toBe(lostAmt); // push
      expect(d.step(outcome([])).want[0]![1]).toBe(lostAmt); // sat out: none
      expect(d.step(outcome([], [], ['a'])).want[0]![1]).toBe(lostAmt); // stays: none
    }
  });

  it('a martingale that caps on its first loss (L=1) honours each policy', () => {
    const go = (onCap: string) => {
      const d = new Driver(def({ track: 'a', kind: 'martingale', maxSteps: 1, onCap }));
      d.step();
      return d.step(outcome([['a', 100, -100]]));
    };
    expect(go('reset').want[0]![1]).toBe(100);
    expect(go('stay').want[0]![1]).toBe(100);
    const s = go('stop');
    expect(s.out.stop).toBe('cap-p');
    expect(s.out.desired).toHaveLength(0);
    expect(s.trace.prog.p!.events).toEqual(['cap']);
  });

  it('maxAmount caps a transition into a larger amount', () => {
    const r = run(
      { kind: 'martingale', maxSteps: 10, onCap: 'reset', maxAmount: { units: 5 } },
      'LLLL',
    );
    expect(r.units).toEqual([1, 2, 4, 1]); // 8 > 5 is a cap -> reset
  });

  it('counts caps in progCaps and exposes progStep', () => {
    const d = new Driver({
      ...def({ track: 'a', kind: 'martingale', maxSteps: 2, onCap: 'reset' }),
      stages: [
        {
          id: 's',
          layout: [{ bet: 'a', amount: { prog: 'p' } }],
          rules: [
            {
              when: { cmp: [{ progCaps: 'p' }, '>=', 1] },
              then: [{ bet: 'in1', amount: { add: [{ progStep: 'p' }, 100] } }],
            },
          ],
        },
      ],
    });
    d.step();
    d.step(outcome([['a', 100, -100]]));
    const r = d.step(outcome([['a', 200, -200]]));
    expect(r.trace.prog.p!.events).toEqual(['cap']);
    expect(r.want).toContainEqual(['in1', 100]);
  });

  it('labouchere: onEmpty stop, prog-done event, maxLength cap', () => {
    const stop = run({ kind: 'labouchere', line: [1], onEmpty: 'stop' }, 'W');
    expect(stop.stop).toBe('done-p');
    const reset = new Driver(def({ track: 'a', kind: 'labouchere', line: [2] }));
    reset.step();
    const r = reset.step(outcome([['a', 200, 200]]));
    expect(r.trace.prog.p!.events).toEqual(['done']);
    expect(r.want[0]![1]).toBe(200);
    const cap = run({ kind: 'labouchere', line: [1, 2], maxLength: 3, onCap: 'stay' }, 'LLL');
    expect(cap.units).toEqual([3, 4, 4]); // [1,2] -> [1,2,3] -> capped, stays [1,2,3]
  });

  it('labouchere survives more appends than its buffer holds', () => {
    const d = new Driver(def({ track: 'a', kind: 'labouchere', line: [1, 2], maxLength: 256 }));
    let r = d.step();
    for (let i = 0; i < 3000; i++) {
      const amt = r.want[0]![1];
      r = d.step(outcome([['a', amt, i % 3 === 0 ? amt : -amt]]));
    }
    expect(r.want[0]![1]).toBeGreaterThan(0);
  });

  it('base is latched at cycle start (pctOfBankroll changes only on a fresh cycle)', () => {
    const d = new Driver(
      def({
        track: 'a',
        kind: 'martingale',
        maxSteps: 5,
        onCap: 'reset',
        base: { pctOfBankroll: 1 },
      }),
    );
    let r = d.step(); // bankroll 500000 -> 5000
    expect(r.want[0]![1]).toBe(5000);
    r = d.step(outcome([['a', 5000, -5000]])); // bankroll shrinks to 495000, base stays 5000
    expect(r.want[0]![1]).toBe(10_000);
    r = d.step(outcome([['a', 10_000, 10_000]])); // win: fresh cycle, base re-latched
    expect(r.want[0]![1]).toBe(Math.floor((d.net + 500_000) / 100));
  });

  it('dalembert step defaults to base and can be an expression', () => {
    const r = run({ kind: 'dalembert', step: { units: 3 } }, 'LL');
    expect(r.units).toEqual([1, 4]);
    expect(r.next).toBe(7);
  });

  it('manual feeds: win / loss / push / reset / advance / back', () => {
    const d = new Driver({
      ...def({ track: 'manual', kind: 'martingale', maxSteps: 6, onCap: 'reset' }),
      vars: { cmd: 0 },
      stages: [
        {
          id: 's',
          layout: [{ bet: 'a', amount: { prog: 'p' } }],
          rules: [
            { when: { cmp: [{ var: 'cmd' }, '==', 1] }, then: [{ prog: 'p', do: 'loss' }] },
            { when: { cmp: [{ var: 'cmd' }, '==', 2] }, then: [{ prog: 'p', do: 'win' }] },
            { when: { cmp: [{ var: 'cmd' }, '==', 3] }, then: [{ prog: 'p', do: 'advance' }] },
            { when: { cmp: [{ var: 'cmd' }, '==', 4] }, then: [{ prog: 'p', do: 'back' }] },
            { when: { cmp: [{ var: 'cmd' }, '==', 5] }, then: [{ prog: 'p', do: 'reset' }] },
            { when: { cmp: [{ var: 'cmd' }, '==', 6] }, then: [{ prog: 'p', do: 'push' }] },
            { when: { always: true }, then: [{ set: 'cmd', to: 0 }] },
          ],
        },
      ],
    });
    const seq: [number, number][] = [
      [1, 200],
      [1, 400],
      [3, 800],
      [4, 400],
      [6, 400],
      [2, 100],
      [3, 200],
      [5, 100],
    ];
    for (const [cmd, expected] of seq) {
      const m = d.mem as unknown as { vars: Float64Array };
      m.vars[0] = cmd;
      expect(d.step().want[0]![1]).toBe(expected);
    }
  });

  it('manual win on oscars-grind and labouchere is even money', () => {
    const d = new Driver({
      ...def({ track: 'manual', kind: 'labouchere', line: [1, 2, 3] }),
      stages: [
        {
          id: 's',
          layout: [{ bet: 'a', amount: { prog: 'p' } }],
          rules: [{ when: { event: 'zero' }, then: [{ prog: 'p', do: 'win' }] }],
        },
      ],
    });
    d.step();
    const r = d.step(outcome([], [{ type: 'zero' }]));
    expect(r.want[0]![1]).toBe(200); // [2] -> amount 2 units
  });
});

describe('feeding and arming (strategy.md §7.1, §7.2)', () => {
  const twoStage = (feed?: string) => ({
    ...def({
      track: 'a',
      kind: 'martingale',
      maxSteps: 6,
      onCap: 'reset',
      ...(feed ? { feed } : {}),
    }),
    stages: [
      {
        id: 'mart',
        layout: [{ bet: 'a', amount: { prog: 'p' } }],
        rules: [{ when: { cmp: ['round', '>=', 2] }, then: [{ goto: 'flat' }] }],
      },
      { id: 'flat', layout: [{ bet: 'a', amount: { units: 1 } }] },
    ],
  });

  it('a progression learns only from bets it sized (no drift in the flat stage)', () => {
    const d = new Driver(twoStage());
    d.step(); // w0 mart, p=1
    d.step(outcome([['a', 100, -100]])); // w1 p=2
    const g = d.step(outcome([['a', 200, -200]])); // w2: p=4 then goto flat
    expect(g.trace.stageAfter).toBe('flat');
    expect(g.want).toEqual([['a', 100]]);
    // lost in flat: the resolution is ignored ('unarmed')
    const f = d.step(outcome([['a', 100, -100]]));
    expect(f.trace.prog.p!.fed).toBe('unarmed');
    expect(f.trace.prog.p!.state).toEqual({ k: 2 });
  });

  it("feed: 'always' learns from every resolution", () => {
    const d = new Driver(twoStage('always'));
    d.step();
    d.step(outcome([['a', 100, -100]]));
    d.step(outcome([['a', 200, -200]]));
    const f = d.step(outcome([['a', 100, -100]]));
    expect(f.trace.prog.p!.fed).toBe('loss');
    expect(f.trace.prog.p!.state).toEqual({ k: 3 });
  });

  it('a persistent bet stays armed until it resolves', () => {
    const d = new Driver({
      ...def({ track: 'b', kind: 'martingale', maxSteps: 6, onCap: 'reset' }),
      stages: [{ id: 's', layout: [{ bet: 'b', amount: { keepOr: { prog: 'p' } } }] }],
    });
    d.step(); // places b at prog amount: armed
    // b rides on the table (no entry change), nothing resolves: still armed
    d.step(outcome([], [], ['b']), { table: [{ bet: 'b', amount: 100 }] });
    const lost = d.step(outcome([['b', 100, -100]]));
    expect(lost.trace.prog.p!.fed).toBe('loss');
    expect(lost.want).toEqual([['b', 200]]);
  });

  it('a group feeds by the sum of armed bets; an unarmed member is ignored', () => {
    const d = new Driver({
      ...def({ track: { bets: ['a', 'in1'] }, kind: 'martingale', maxSteps: 6, onCap: 'reset' }),
      stages: [
        {
          id: 's',
          layout: [
            { bet: 'a', amount: { prog: 'p' } },
            { bet: 'in1', amount: { units: 1 } }, // does not read p: disarmed
          ],
        },
      ],
    });
    d.step();
    // a loses 100, in1 wins 3500: the group sum would be a win, but only `a` is armed
    const r = d.step(
      outcome([
        ['a', 100, -100],
        ['in1', 100, 3500],
      ]),
    );
    expect(r.trace.prog.p!.fed).toBe('loss');
    expect(r.want[0]).toEqual(['a', 200]);
  });

  it("a 'round' progression feeds by last.net when armed", () => {
    const d = new Driver(def({ track: 'round', kind: 'martingale', maxSteps: 6, onCap: 'reset' }));
    d.step();
    const r = d.step(
      outcome([
        ['a', 100, 100],
        ['in1', 500, -500],
      ]),
    );
    expect(r.trace.prog.p!.fed).toBe('loss');
    expect(r.want[0]![1]).toBe(200);
  });

  it('processes progressions in sorted name order (two cap in one window)', () => {
    const d = new Driver({
      ...def({ track: 'a', kind: 'martingale', maxSteps: 1, onCap: 'reset' }),
      progressions: {
        zz: { track: 'a', kind: 'martingale', maxSteps: 1, onCap: 'stop' },
        aa: { track: 'a', kind: 'martingale', maxSteps: 1, onCap: 'stop' },
      },
      stages: [
        { id: 's', layout: [{ bet: 'a', amount: { add: [{ prog: 'aa' }, { prog: 'zz' }] } }] },
      ],
    });
    d.step();
    expect(d.step(outcome([['a', 200, -200]])).out.stop).toBe('cap-aa');
  });

  it('guards against amounts above 2^31 - 1 cents (cap)', () => {
    const d = new Driver(
      def(
        { track: 'a', kind: 'martingale', maxSteps: 30, onCap: 'stay', base: { var: 'big' } },
        { vars: { big: 1_000_000_000 } },
      ),
    );
    d.step();
    let r = d.step(outcome([['a', 1_000_000_000, -1]]));
    expect(r.want[0]![1]).toBe(2_000_000_000); // below 2^31 - 1 = 2,147,483,647
    r = d.step(outcome([['a', 2_000_000_000, -1]]));
    expect(r.want[0]![1]).toBe(2_000_000_000); // 4e9 would overflow: capped, stays
    expect(r.trace.prog.p!.events).toEqual(['cap']);
  });
});
