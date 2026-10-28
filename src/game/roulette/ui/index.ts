import type { GameUi } from '@core/ui';
import type { RouletteRules } from '../types';
import { BetPicker } from './bet-picker';
import { OutcomeGlyph } from './glyph';
import { TableView } from './table-view';
import './ui.css';

export { BetPicker, OutcomeGlyph, TableView };

/** The Preact side of the roulette plugin (decisions G5: composed with `roulette` by the app). */
export const rouletteUi: GameUi<RouletteRules> = { TableView, BetPicker, OutcomeGlyph };
