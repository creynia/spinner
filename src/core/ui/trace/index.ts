// Trace replay components (strategy.md §12; architecture.md §6.3 Watch). Game-agnostic: the table
// and the outcome glyph come from the game's `GameUi`.
export { TraceReplay, type TraceReplayProps } from './TraceReplay';
export { TraceList, type TraceListProps } from './TraceList';
export { WindowDetail, type WindowDetailProps } from './WindowDetail';
export { Stepper, type StepperProps } from './Stepper';
export { EquityLine, type EquityLineProps } from './EquityLine';
export { SPEEDS, isSpeedId, type SpeedId } from './usePlayback';
