import type { GameUi } from '@core/ui';
import type { RouletteRules } from '../types';
import { BetPicker } from './bet-picker';
import { ChipBoard } from './chip-board';
import { stepOf } from './chips';
import { OutcomeGlyph } from './glyph';
import { TableView } from './table-view';
import './ui.css';

export { BetPicker, ChipBoard, OutcomeGlyph, TableView };

/** Chip denominations for the rack, ascending, in cents (layouts.md §3.4). */
export const CHIP_DENOMINATIONS = [100, 500, 2500, 10000, 50000, 100000] as const;

/** The Preact side of the roulette plugin (decisions G5: composed with `roulette` by the app). */
export const rouletteUi: GameUi<RouletteRules> = {
  TableView,
  BetPicker,
  OutcomeGlyph,
  chips: { ChipBoard, step: stepOf, denominations: CHIP_DENOMINATIONS },
};
