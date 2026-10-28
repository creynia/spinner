import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamePlugin } from '../../contracts/game';
import type { StageChips } from '../../contracts/layout';
import type { ProgressionSpec } from '../../contracts/strategy';
import { COIN_BET, coin } from '../../testing';
import type { CoinRules } from '../../testing';
import * as layoutCheck from '../layout/check';
import type * as LayoutCheck from '../layout/check';
import { checkStageChips } from './chipsCheck';

vi.mock('../layout/check', async (orig) => {
  const m = await orig<typeof LayoutCheck>();
  return { ...m, checkAtTable: vi.fn(m.checkAtTable) };
});

const plugin = coin as unknown as GamePlugin<unknown, unknown, CoinRules, unknown>;
const rules = coin.rules.resolve();
const catalog = coin.bets.catalog(rules);
const { min, max } = coin.limits(COIN_BET, rules)!;
const calls = vi.mocked(layoutCheck.checkAtTable);

const run = (
  chips: StageChips,
  progressions: Record<string, ProgressionSpec> = {},
  over: Partial<Parameters<typeof checkStageChips<CoinRules>>[0]> = {},
) =>
  checkStageChips<CoinRules>({
    plugin,
    rules,
    chips,
    stage: 2,
    unit: min,
    progressions,
    bankroll: 100_000_000,
    catalog,
    ...over,
  });

beforeEach(() => {
  calls.mockClear();
});

describe('stage table check (S2): base and top levels', () => {
  it('checks once when base and top coincide (a literal or the unit)', () => {
    const r = run({ v: 1, chip: min, spots: [{ bet: COIN_BET, chips: 2 }] });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(r.atTop).toBeNull();
    expect(r.diagnostics).toEqual([]);
    expect(r.perRound).toBe(2 * min);
    expect(r.fits).toBe(true);
    run({ v: 1, chip: { units: 1 }, spots: [{ bet: COIN_BET, chips: 1 }] });
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('checks twice for a progression: the base level and the top level', () => {
    const m: ProgressionSpec = {
      kind: 'martingale',
      track: 'round',
      base: min,
      maxSteps: 12,
      onCap: 'reset',
    } as unknown as ProgressionSpec;
    const r = run({ v: 1, chip: { prog: 'm' }, spots: [{ bet: COIN_BET, chips: 1 }] }, { m });
    expect(calls).toHaveBeenCalledTimes(2);
    expect(r.value.base).toBe(min);
    expect(r.value.top!).toBeGreaterThan(max);
    expect(calls.mock.calls.map((c) => c[2][0]!.cents)).toEqual([min, r.value.top]);
    expect(r.atTop!.perSpot[0]!.code).toBe('clamped');
    expect(r.notes.join(' ')).toMatch(/top of the progression/);
    expect(r.diagnostics).toEqual([]);
  });

  it('warns W_CHIPS_TABLE when a spot is below the minimum at the BASE level', () => {
    const m: ProgressionSpec = {
      kind: 'martingale',
      track: 'round',
      base: min - 1,
      maxSteps: 3,
      onCap: 'reset',
    } as unknown as ProgressionSpec;
    const r = run({ v: 1, chip: { prog: 'm' }, spots: [{ bet: COIN_BET, chips: 1 }] }, { m });
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({
      code: 'W_CHIPS_TABLE',
      severity: 'warning',
      path: '/stages/2/x-chips',
    });
    expect(r.diagnostics[0]!.message).toMatch(/starting/);
    expect(r.diagnostics[0]!.message).toMatch(/until the progression rises/);
    expect(r.fits).toBe(false);
  });

  it('cannot preview a formula base, and runs no check', () => {
    const m = { kind: 'martingale', track: 'round', base: { pctOfBankroll: 2 } } as ProgressionSpec;
    const r = run({ v: 1, chip: { prog: 'm' }, spots: [{ bet: COIN_BET, chips: 1 }] }, { m });
    expect(calls).not.toHaveBeenCalled();
    expect(r.value).toEqual({ base: null, top: null });
    expect(r.atBase).toBeNull();
    expect(r.fits).toBe(false);
  });

  it('reports a spot above the maximum and short bankroll in words', () => {
    const over = run({ v: 1, chip: max, spots: [{ bet: COIN_BET, chips: 2 }] });
    expect(over.notes[0]).toMatch(/cut to/);
    const poor = run(
      {
        v: 1,
        chip: min,
        spots: [
          { bet: COIN_BET, chips: 1 },
          { bet: 'tails', chips: 1 },
        ],
      },
      {},
      { bankroll: min },
    );
    expect(poor.atBase!.affordable).toBeDefined();
  });

  it('flags call bets whose chips are not a multiple of the game step', () => {
    const r = run({ v: 1, chip: min, spots: [{ bet: COIN_BET, chips: 5 }] }, {}, { step: () => 4 });
    expect(r.notes[0]).toMatch(/steps of 4 chips/);
    expect(r.fits).toBe(false);
    const ok = run(
      { v: 1, chip: min, spots: [{ bet: COIN_BET, chips: 8 }] },
      {},
      { step: () => 4 },
    );
    expect(ok.notes).toEqual([]);
  });
});
