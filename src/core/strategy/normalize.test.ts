/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { describe, expect, it } from 'vitest';
import { normalizeStrategy } from './index';
import type { StrategyDefinition } from '../contracts/strategy';
import { jsonl, runCoin } from './__fixtures__/coin-runner';

type J = Record<string, any>;
const N = (d: J): J => normalizeStrategy(d as unknown as StrategyDefinition);

const messy = (): J => ({
  schema: 1,
  id: 'n',
  name: 'N',
  game: 'coin',
  unit: 1000,
  'x-ui': { pos: [1, 2] },
  progressions: {
    m: { kind: 'martingale', track: 'heads', maxSteps: 4, onCap: 'reset', feed: 'sized' },
  },
  stages: [
    {
      id: 's',
      rules: [],
      layout: [
        {
          bet: 'heads',
          amount: { prog: 'm' },
          working: 'auto',
          when: { all: [{ all: [{ cmp: ['net', '>', -5000] }] }] },
        },
      ],
    },
    {
      id: 't',
      layout: [{ bet: 'heads', amount: 1000 }],
      rules: [
        {
          enabled: true,
          once: false,
          when: {
            all: [
              { all: [{ always: true }, { cmp: ['round', '>=', 3] }] },
              { any: [{ fact: ['lastHeads', '==', true] }] },
            ],
          },
          then: [{ bet: 'heads', amount: 1000, working: 'auto' }],
        },
        { when: { all: [] }, then: [{ inc: 'v' }] },
      ],
    },
  ],
  vars: { v: 0 },
});

describe('normalizeStrategy', () => {
  it('drops defaults, flattens all-of-all, unwraps one-element groups, keeps x-* keys', () => {
    const n = N(messy());
    expect(n['x-ui']).toEqual({ pos: [1, 2] });
    expect(n.progressions.m.feed).toBeUndefined();
    expect(n.stages[0].rules).toBeUndefined();
    expect(n.stages[0].layout[0]).toEqual({
      bet: 'heads',
      amount: { prog: 'm' },
      when: { cmp: ['net', '>', -5000] },
    });
    const r = n.stages[1].rules;
    expect(r[0]).toEqual({
      when: {
        all: [{ always: true }, { cmp: ['round', '>=', 3] }, { fact: ['lastHeads', '==', true] }],
      },
      then: [{ bet: 'heads', amount: 1000 }],
    });
    expect(r[1].when).toEqual({ always: true });
  });

  it('is idempotent, does not mutate its input and never reorders', () => {
    const d = messy();
    const copy = JSON.stringify(d);
    const n = N(d);
    expect(JSON.stringify(d)).toBe(copy);
    expect(N(n)).toEqual(n);
    expect(n.stages.map((s: J) => s.id)).toEqual(['s', 't']);
    expect(Object.keys(n)).toEqual(Object.keys(d));
  });

  it('keeps {any: []} (false) and nested conditions inside `if` expressions', () => {
    const d = messy();
    d.stages[1].rules[1].when = { any: [] };
    d.stages[0].layout[0].amount = { if: [{ all: [{ all: [{ always: true }] }] }, 1000, 2000] };
    const n = N(d);
    expect(n.stages[1].rules[1].when).toEqual({ any: [] });
    expect(n.stages[0].layout[0].amount).toEqual({ if: [{ always: true }, 1000, 2000] });
  });

  it('is semantically equivalent: same trace as the original', () => {
    const d: J = {
      schema: 1,
      id: 'e',
      name: 'E',
      game: 'coin',
      unit: 1000,
      progressions: {
        m: { kind: 'martingale', track: 'heads', maxSteps: 4, onCap: 'reset', feed: 'sized' },
      },
      stages: [
        {
          id: 'p',
          rules: [],
          layout: [
            {
              bet: 'heads',
              amount: { prog: 'm' },
              working: 'auto',
              when: { all: [{ all: [{ cmp: ['round', '>=', 1] }, { always: true }] }] },
            },
          ],
        },
      ],
    };
    expect(jsonl(runCoin(N(d)).trace)).toBe(jsonl(runCoin(d).trace));
  });
});
