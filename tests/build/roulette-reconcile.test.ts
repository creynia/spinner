// "reconcile never emits an action that apply rejects" (PLAYBOOK §4, §12) over full runs: every
// strategy preset, 2,000 sessions x 500 rounds on the default rules, plus rule variants. An apply
// rejection surfaces in the harness as a session `error` with code `apply-rejected`, so the
// assertion is: no session ends with `error`, no `apply-rejected` error is recorded. Reconcile-level
// `rejected` entries (e.g. unaffordable near a bust, bets not on this wheel) are expected and are
// only checked for known reason codes. `FULL=1` runs every variant for every preset.
import { describe, expect, it, vi } from 'vitest';
import { ENDED_BY } from '@core/contracts/run';
import type { Json } from '@core/contracts/game';
import { PRESET_IDS, rouletteDef, runAll, type RulesInput } from './roulette-helpers';

vi.setConfig({ testTimeout: 600_000 });

const FULL = process.env.FULL === '1';
const SESSIONS = 2000;
// Variants use fewer sessions in CI; FULL=1 runs 2,000 everywhere.
const VARIANT_SESSIONS = FULL ? SESSIONS : 500;
const CLAMP_PRESETS = ['martingale-red', 'grand-martingale-red', 'two-dozens-martingale'];
const ROUNDS = 500;

// ReconcileCode and AdjustCode from game/roulette/types.ts.
const REJECT_CODES = new Set([
  'unknown-bet',
  'not-on-wheel',
  'not-placeable',
  'invalid-amount',
  'below-min',
  'over-max',
  'unaffordable',
  'inside-min-total',
  'table-max',
]);
const ADJUST_CODES = new Set(['merged', 'rounded', 'clamped', 'reduced', 'skipped-zero']);

interface Variant {
  name: string;
  rules: RulesInput;
  bankroll?: number;
  presets: readonly string[];
  sessions?: number;
}
const o = (overrides: Record<string, Json>, preset = 'european'): RulesInput => ({
  preset,
  overrides,
});
const SOME = ['martingale-red', 'james-bond', 'two-dozens-martingale', 'red-mart-then-flat'];

const VARIANTS: Variant[] = [
  { name: 'european', rules: 'european', presets: PRESET_IDS, sessions: 2000 },
  { name: 'american', rules: 'american', presets: FULL ? PRESET_IDS : SOME },
  { name: 'triple-zero', rules: 'triple-zero', presets: FULL ? PRESET_IDS : SOME },
  { name: 'la partage', rules: o({ laPartage: true }), presets: FULL ? PRESET_IDS : SOME },
  { name: 'en prison', rules: o({ enPrison: true }), presets: FULL ? PRESET_IDS : SOME },
  {
    name: 'low bankroll ($100)',
    rules: 'european',
    bankroll: 10_000,
    presets: FULL ? PRESET_IDS : SOME,
  },
];

describe('zero apply rejections over full runs', () => {
  for (const v of VARIANTS)
    for (const preset of v.presets) {
      const N = v.sessions ?? VARIANT_SESSIONS;
      it(`${preset} on ${v.name}: ${N} x ${ROUNDS}`, () => {
        const def = rouletteDef(preset, {
          rules: v.rules,
          bankroll: v.bankroll,
          sessions: N,
          maxRounds: ROUNDS,
        });
        let sessions = 0;
        let errors = 0;
        let rejectedEntries = 0;
        let adjustedEntries = 0;
        const rejectedByReason: Record<string, number> = {};
        const unknown: string[] = [];
        const traceEvery = Array.from({ length: 40 }, (_, i) => i * 50);
        const runner = runAll(
          def,
          (out) => {
            sessions += out.count;
            for (let i = 0; i < out.count; i++) {
              if (out.table.endedBy[i] === ENDED_BY.error) errors++;
              rejectedEntries += out.table.rejected[i]!;
              adjustedEntries += out.table.adjusted[i]!;
            }
            for (const c of out.chunks) {
              for (const e of c.errors) unknown.push(`${e.code}: ${e.message}`);
              for (const [k, n] of Object.entries(c.rejectedByReason)) {
                rejectedByReason[k] = (rejectedByReason[k] ?? 0) + n;
                if (!REJECT_CODES.has(k)) unknown.push(`unknown reject code ${k}`);
              }
            }
            for (const s of out.samples)
              for (const w of s.trace) {
                for (const r of w.reconcile?.rejected ?? [])
                  if (!REJECT_CODES.has(r.reason)) unknown.push(`unknown reject ${r.reason}`);
                for (const a of w.reconcile?.adjusted ?? [])
                  if (!ADJUST_CODES.has(a.reason)) unknown.push(`unknown adjust ${a.reason}`);
              }
          },
          traceEvery,
        );
        expect(runner.labels.stages.length).toBeGreaterThan(0);
        expect(sessions).toBe(N);
        expect(unknown).toEqual([]); // includes any `apply-rejected` session error
        expect(errors).toBe(0);
        console.info(
          `${preset} / ${v.name}: rejected entries ${rejectedEntries} ${JSON.stringify(rejectedByReason)}, adjusted ${adjustedEntries}`,
        );
      });
    }
});

// With a $5,000 bankroll affordability binds before the outside maximum, so the clamp path
// (reconcile step 5) needs its own variants: a low `outside.max` override (with and without a huge bankroll; the presets' own caps stay below the default $5,000 maximum).
describe('over-max clamp path (deterministic)', () => {
  const CLAMP_VARIANTS: { name: string; rules: RulesInput; bankroll: number }[] = [
    {
      name: 'outside.max $1,000, bankroll $500,000',
      rules: { preset: 'european', overrides: { limits: { outside: { max: 100_000 } } } },
      bankroll: 50_000_000,
    },
    {
      name: 'outside.max $200',
      rules: { preset: 'european', overrides: { limits: { outside: { max: 20_000 } } } },
      bankroll: 500_000,
    },
  ];
  for (const v of CLAMP_VARIANTS)
    for (const preset of CLAMP_PRESETS)
      it(`${preset} with ${v.name} records clamped adjustments and no apply rejection`, () => {
        const def = rouletteDef(preset, {
          rules: v.rules,
          bankroll: v.bankroll,
          sessions: 200,
          maxRounds: ROUNDS,
        });
        let clamped = 0;
        const bad: string[] = [];
        const all = Array.from({ length: 200 }, (_, i) => i);
        runAll(
          def,
          (out) => {
            for (const c of out.chunks) for (const e of c.errors) bad.push(e.code);
            for (const smp of out.samples)
              for (const w of smp.trace)
                for (const a of w.reconcile?.adjusted ?? []) if (a.reason === 'clamped') clamped++;
          },
          all,
        );
        expect(bad).toEqual([]);
        expect(clamped).toBeGreaterThan(0);
      });
});
