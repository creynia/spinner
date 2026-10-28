// The core UI barrel (Preact, game-agnostic). Kit, charts, builder, results and trace components
// are added by their WPs; append exports only (architecture.md §11.2).
export type {
  BetPickerProps,
  ChipBoardProps,
  ChipsUi,
  GameUi,
  OutcomeGlyphProps,
  TableViewProps,
} from './game-ui';
export * from './kit';
export * from './charts';
export * from './builder';
export * from './results';
export * from './trace';
export * from './layout';
