// WP-L0: the frozen layout stubs and the additive GameUi.chips member (layouts.md §12).
// Later WPs replace the bodies; the "throws" tests are removed with them (each WP deletes only
// its own module's block), the type-level assertions stay.
import { describe, expect, it } from 'vitest';
import {
  ChipRack,
  LayoutEditor,
  LayoutThumb,
  SpotList,
  checkAtTable,
  defaultDenom,
  useChipHistory,
  type ChipsUi,
  type GameUi,
} from '@core/ui';
import * as chips from '@core/strategy';
import * as store from '@core/store';
import { rouletteUi } from '@game/roulette/ui';
import type { RouletteRules } from '@game/roulette';

describe('GameUi.chips is additive and optional', () => {
  it('rouletteUi satisfies GameUi without chips', () => {
    const ui: GameUi<RouletteRules> = rouletteUi;
    expect(ui.chips).toBeUndefined();
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

describe('WP-L1 stubs (core/strategy/chips.ts)', () => {
  const calls: [string, () => unknown][] = [
    ['chipAmount', () => chips.chipAmount(1, 500)],
    ['compileChips', () => chips.compileChips({ v: 1, spots: [], chip: 500 })],
    ['readStageChips', () => chips.readStageChips({})],
    ['splitStageLayout', () => chips.splitStageLayout({ id: 'a' })],
    ['withStageChips', () => chips.withStageChips({ id: 'a' }, null)],
    ['liftRows', () => chips.liftRows([])],
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

describe('WP-L2 stubs (core/store/layouts.ts)', () => {
  it.each([
    ['layoutHash', () => store.layoutHash({} as never)],
    ['allocLayoutId', () => store.allocLayoutId('x', new Set())],
    ['encodeLayoutFile', () => store.encodeLayoutFile([], { id: 'a', version: '0' })],
    ['decodeLayoutFile', () => store.decodeLayoutFile('{}')],
  ] as [string, () => unknown][])('%s throws not implemented (WP-L2)', (name, call) => {
    expect(call).toThrow(`not implemented (WP-L2): ${name}`);
  });
  it('LayoutFileError carries a code', () => {
    const e = new store.LayoutFileError('not-json', 'bad');
    expect([e.code, e.message, e instanceof Error]).toEqual(['not-json', 'bad', true]);
  });
});

describe('WP-L4 stubs (core/ui/layout)', () => {
  it('components render null', () => {
    const p = {} as never;
    expect([LayoutEditor(p), ChipRack(p), SpotList(p), LayoutThumb(p)]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
  it.each([
    ['useChipHistory', () => useChipHistory([])],
    ['checkAtTable', () => checkAtTable({} as never, {}, [], 0)],
    ['defaultDenom', () => defaultDenom({} as never, {}, [], [])],
  ] as [string, () => unknown][])('%s throws not implemented (WP-L4)', (name, call) => {
    expect(call).toThrow(`not implemented (WP-L4): ${name}`);
  });
});
