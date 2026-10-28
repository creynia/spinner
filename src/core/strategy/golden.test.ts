/* eslint-disable @typescript-eslint/no-explicit-any */
// Golden traces (strategy.md §12, §17.7) of the strategy.md goldens on the fake `coin` plugin.
// Roulette goldens are produced in integration. Update with UPDATE_GOLDEN=1 and review the diff.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GOLDEN_SEED, coinCtx, jsonl, runCoin } from './__fixtures__/coin-runner';
import { validateStrategy } from './index';

type J = Record<string, any>;
const dir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'golden');
const H = 'heads';
const U = 1000;
const mk = (id: string, stages: J[], extra: J = {}): J => ({
  schema: 1,
  id,
  name: id,
  game: 'coin',
  unit: U,
  stages,
  ...extra,
});
const play = (amount: unknown, extra: J = {}): J => ({ bet: H, amount, ...extra });
const prog = (spec: J): J => ({ track: H, ...spec });

const GOLDENS: J[] = [
  mk('flat', [{ id: 'play', layout: [play({ units: 1 })] }]),
  mk('martingale', [{ id: 'play', layout: [play({ prog: 'm' })] }], {
    progressions: { m: prog({ kind: 'martingale', maxSteps: 5, onCap: 'reset' }) },
  }),
  mk('grand-martingale-stop', [{ id: 'play', layout: [play({ prog: 'g' })] }], {
    progressions: { g: prog({ kind: 'grand-martingale', maxSteps: 4, onCap: 'stop' }) },
  }),
  mk('fibonacci', [{ id: 'play', layout: [play({ prog: 'f' })] }], {
    progressions: { f: prog({ kind: 'fibonacci', maxSteps: 8, onCap: 'reset' }) },
  }),
  mk('dalembert', [{ id: 'play', layout: [play({ prog: 'd' })] }], {
    progressions: { d: prog({ kind: 'dalembert', maxSteps: 10, onCap: 'stay' }) },
  }),
  mk(
    'labouchere',
    [
      {
        id: 'play',
        layout: [play({ prog: 'l' })],
        rules: [
          { id: 'count-line', when: { event: 'prog-done', prog: 'l' }, then: [{ inc: 'lines' }] },
          {
            id: 'enough',
            when: { cmp: [{ var: 'lines' }, '>=', 3] },
            then: [{ stop: 'three-lines' }],
          },
        ],
      },
    ],
    {
      vars: { lines: 0 },
      progressions: {
        l: prog({
          kind: 'labouchere',
          line: [1, 2, 3, 4],
          maxAmount: { units: 30 },
          onCap: 'reset',
        }),
      },
    },
  ),
  mk('paroli', [{ id: 'play', layout: [play({ prog: 'p' })] }], {
    progressions: { p: prog({ kind: 'paroli', maxSteps: 3 }) },
  }),
  mk('one-three-two-six', [{ id: 'play', layout: [play({ prog: 's' })] }], {
    progressions: { s: prog({ kind: '1-3-2-6' }) },
  }),
  mk('oscars-grind', [{ id: 'play', layout: [play({ prog: 'o' })] }], {
    progressions: { o: prog({ kind: 'oscars-grind', maxSteps: 6 }) },
  }),
  mk('sequence-stop', [{ id: 'play', layout: [play({ prog: 'q' })] }], {
    progressions: {
      q: prog({
        kind: 'sequence',
        onWin: 'reset',
        onLoss: 'advance',
        onCap: 'stop',
        amounts: [{ units: 1 }, { units: 2 }, { units: 4 }, { units: 8 }],
      }),
    },
  }),
  mk(
    'mart-then-flat',
    [
      {
        id: 'mart',
        layout: [play({ prog: 'm' })],
        rules: [
          { when: { cmp: ['net', '>=', 1000] }, then: [{ goto: 'flat' }] },
          { when: { cmp: ['net', '<=', -100000] }, then: [{ stop: 'loss-limit' }] },
        ],
      },
      {
        id: 'flat',
        layout: [play({ units: 1 })],
        rules: [{ when: { cmp: ['roundsInStage', '>=', 20] }, then: [{ stop: 'plan-complete' }] }],
      },
    ],
    { progressions: { m: prog({ kind: 'martingale', maxSteps: 5, onCap: 'reset' }) } },
  ),
  mk(
    'wait-for-streak',
    [
      {
        id: 'watch',
        rules: [
          {
            when: { streak: { fact: 'lastHeads', equals: true, atLeast: 2 } },
            then: [{ goto: 'bet' }],
          },
        ],
      },
      {
        id: 'bet',
        onEnter: [{ prog: 'm', do: 'reset' }],
        layout: [play({ prog: 'm' })],
        rules: [
          { when: { event: 'bet-won', bet: H }, then: [{ goto: 'watch' }] },
          { when: { event: 'prog-cap', prog: 'm' }, then: [{ goto: 'watch' }] },
        ],
      },
    ],
    { progressions: { m: prog({ kind: 'martingale', maxSteps: 3, onCap: 'reset' }) } },
  ),
  mk(
    'trailing-stop',
    [
      {
        id: 'play',
        layout: [play({ units: 1 })],
        rules: [
          {
            id: 'arm',
            once: true,
            when: { cmp: ['net', '>=', 3000] },
            then: [
              { set: 'armed', to: 1 },
              { set: 'lock', to: { sub: ['net', 2000] } },
            ],
          },
          {
            id: 'raise',
            when: {
              all: [
                { cmp: [{ var: 'armed' }, '==', 1] },
                { cmp: [{ sub: ['net', 2000] }, '>', { var: 'lock' }] },
              ],
            },
            then: [{ set: 'lock', to: { sub: ['net', 2000] } }],
          },
          {
            id: 'hit',
            when: {
              all: [{ cmp: [{ var: 'armed' }, '==', 1] }, { cmp: ['net', '<=', { var: 'lock' }] }],
            },
            then: [{ stop: 'trailing-stop' }],
          },
        ],
      },
    ],
    { vars: { armed: 0, lock: 0 } },
  ),
  mk(
    'boost-extends',
    [
      {
        id: 'base',
        layout: [play({ units: 1 })],
        rules: [
          {
            id: 'enough',
            when: { cmp: [{ var: 'boosts' }, '>=', 4] },
            then: [{ stop: 'four-boosts' }],
          },
          {
            id: 'boost-on',
            cooldown: 10,
            when: { countInLast: { fact: 'lastHeads', equals: false, n: 5, atLeast: 4 } },
            then: [{ goto: 'boost' }],
          },
        ],
      },
      {
        id: 'boost',
        extends: 'base',
        onEnter: [{ inc: 'boosts' }],
        layout: [play({ units: 2 })],
        rules: [
          { id: 'boost-off', when: { cmp: ['roundsInStage', '>=', 5] }, then: [{ goto: 'base' }] },
        ],
      },
    ],
    { vars: { boosts: 0 } },
  ),
  mk(
    'cooldown-pause',
    [
      {
        id: 'play',
        layout: [play({ units: 1 })],
        rules: [
          {
            id: 'start-pause',
            cooldown: 15,
            when: { cmp: ['lossStreak', '>=', 2] },
            then: [{ set: 'pause', to: 3 }],
          },
          {
            id: 'sit-out',
            when: { cmp: [{ var: 'pause' }, '>', 0] },
            then: [{ skipRound: true }, { inc: 'pause', by: -1 }],
          },
        ],
      },
    ],
    { vars: { pause: 0 } },
  ),
  mk(
    'streak-follower',
    [
      {
        id: 'play',
        layout: [play({ if: [{ fact: ['lastHeads', '==', true] }, { units: 2 }, { units: 1 }] })],
        rules: [
          { when: { cmp: ['headsStreak', '>=', 4] }, then: [{ remove: H }] },
          { when: { cmp: [{ progStep: 'p' }, '>=', 3] }, then: [{ prog: 'p', do: 'reset' }] },
        ],
      },
    ],
    {
      progressions: { p: prog({ kind: 'martingale', maxSteps: 6, onCap: 'stay', feed: 'always' }) },
    },
  ),
];

describe('golden traces on coin (seed 20261028, session 0, $5,000)', () => {
  it.each(GOLDENS.map((g) => [g.id as string, g] as const))('%s', (id, def) => {
    expect(validateStrategy(def, coinCtx()).filter((d) => d.severity === 'error')).toEqual([]);
    const run = runCoin(def);
    expect(run.rejected).toBe(0); // zero reconcile rejections at the golden rules
    expect(run.trace.length).toBeGreaterThan(0);
    const text = jsonl(run.trace);
    expect(jsonl(runCoin(def).trace)).toBe(text); // deterministic
    const file = join(dir, `${id}.seed${GOLDEN_SEED}.jsonl`);
    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, text);
    }
    expect(existsSync(file), `missing ${file}: run with UPDATE_GOLDEN=1`).toBe(true);
    expect(text).toBe(readFileSync(file, 'utf8'));
  });

  it('exercises the features the goldens are meant to pin', () => {
    const endings = Object.fromEntries(
      GOLDENS.map((g) => [g.id as string, runCoin(g)] as const).map(([id, r]) => [id, r.endedBy]),
    );
    expect(endings['sequence-stop']).toBe('strategy:cap-q');
    expect(Object.values(endings).some((e) => e.startsWith('strategy:'))).toBe(true);
    const mt = runCoin(GOLDENS.find((g) => g.id === 'mart-then-flat'));
    expect(mt.trace.some((r) => r.stageAfter === 'flat')).toBe(true);
    const cp = runCoin(GOLDENS.find((g) => g.id === 'cooldown-pause'));
    expect(cp.trace.some((r) => r.skip)).toBe(true);
    const bx = runCoin(GOLDENS.find((g) => g.id === 'boost-extends'));
    expect(bx.trace.some((r) => r.fired.includes('@enter:boost'))).toBe(true);
  });
});
