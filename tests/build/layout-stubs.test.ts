// WP-L0: the frozen layout stubs and the additive GameUi.chips member (layouts.md §12).
// Later WPs replace the bodies; the "throws" tests are removed with them (each WP deletes only
// its own module's block), the type-level assertions stay.
import { describe, expect, it } from 'vitest';
import {
  type BuilderChipsEnv,
  type ChipBoardProps,
  type ChipsUi,
  type LayoutThumbProps,
  type TableCheckSpot,
  type GameUi,
} from '@core/ui';
import * as chips from '@core/strategy';
import * as store from '@core/store';
import { rouletteUi } from '@game/roulette/ui';
import type { RouletteRules } from '@game/roulette';

describe('GameUi.chips is additive and optional', () => {
  it('rouletteUi satisfies GameUi and supplies chips (L3b)', () => {
    const ui: GameUi<RouletteRules> = rouletteUi;
    expect(ui.chips?.step('straight:0')).toBe(1);
  });
  it('accepts a ChipsUi', () => {
    const c: ChipsUi<RouletteRules> = {
      ChipBoard: () => null,
      step: () => 1,
      denominations: [100, 500],
    };
    const ui: GameUi<RouletteRules> = { ...rouletteUi, chips: c };
    expect(ui.chips?.denominations).toEqual([100, 500]);
  });
});

describe('review additions (types)', () => {
  it('type-checks the added optional members', () => {
    const board: ChipBoardProps = {
      rules: {},
      spots: [],
      tool: 'add',
      chipValue: null,
      onAdjust: () => {},
      readOnly: true,
      onStatus: () => {},
    };
    const spot: TableCheckSpot = {
      bet: 'red',
      asked: 500,
      placed: 0,
      status: 'rejected',
      code: 'below-min',
      reason: 'Below the minimum',
    };
    const thumb: Pick<LayoutThumbProps, 'ui'> = {
      ui: {
        TableView: () => null,
        chips: { ChipBoard: () => null, step: () => 1, denominations: [] },
      },
    };
    const save: BuilderChipsEnv['layouts']['save'] = (l) =>
      Promise.resolve({
        v: 1,
        id: l.id,
        layout: l,
        hash: '',
        createdAt: '',
        updatedAt: '',
        origin: 'user',
      });
    expect([board.readOnly, spot.code, thumb.ui.chips?.step('red'), typeof save]).toEqual([
      true,
      'below-min',
      1,
      'function',
    ]);
  });
});

describe('WP-L1 stubs (core/strategy/chips.ts)', () => {
  const calls: [string, () => unknown][] = [
    ['chipAmount', () => chips.chipAmount(1, 500)],
    ['compileChips', () => chips.compileChips({ v: 1, spots: [], chip: 500 })],
    ['readStageChips', () => chips.readStageChips({})],
    ['splitStageLayout', () => chips.splitStageLayout({ id: 'a' })],
    ['withStageChips', () => chips.withStageChips({ id: 'a' }, null)],
    ['liftRows', () => chips.liftRows([])],
    ['liftRows', () => chips.liftRows([], 500)],
    ['adjustSpot', () => chips.adjustSpot([], 'red', 1)],
    ['sameSpots', () => chips.sameSpots([], [])],
    ['validateChipLayout', () => chips.validateChipLayout({}, null)],
    [
      'validateStageChips',
      () => chips.validateStageChips({ schema: 1, id: 'a', name: 'a', stages: [] } as never),
    ],
    ['progressionTop', () => chips.progressionTop({ kind: 'flat', base: 1 } as never, 2500)],
    ['progressionBase', () => chips.progressionBase({ kind: 'flat', base: 1 } as never, 2500)],
    ['resolveChipValue', () => chips.resolveChipValue(500, { unit: 2500 })],
    ['isChipPath', () => chips.isChipPath('/strategy/stages/0/x-chips/chip')],
    ['recompileStageChips', () => chips.recompileStageChips({ stages: [] } as never, 0)],
  ];
  it.each(calls)('%s throws not implemented (WP-L1)', (name, call) => {
    expect(call).toThrow(`not implemented (WP-L1): ${name}`);
  });
});

describe('WP-L2 (core/store/layouts.ts)', () => {
  it('LayoutFileError carries a code', () => {
    const e = new store.LayoutFileError('not-json', 'bad');
    expect([e.code, e.message, e instanceof Error]).toEqual(['not-json', 'bad', true]);
  });
});
