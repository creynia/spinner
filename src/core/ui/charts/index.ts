// Hand-rolled SVG charts (architecture.md §7). Inputs are analysis outputs, never raw sessions.
// Components and their prop/data types only; geometry helpers stay internal to this folder.
export { Histogram } from './Histogram';
export type { HistogramProps } from './Histogram';
export { OverlayHistogram } from './OverlayHistogram';
export type { OverlayHistogramProps, OverlaySeries } from './OverlayHistogram';
export { FanChart } from './FanChart';
export type { FanChartProps, FanOverlay } from './FanChart';
export { SurvivalChart } from './SurvivalChart';
export type { SurvivalChartProps } from './SurvivalChart';
export { LineBand } from './LineBand';
export type { LineBandProps, LineBandSeries, LineBandRef } from './LineBand';
export { ConvergenceChart } from './ConvergenceChart';
export type { ConvergenceChartProps } from './ConvergenceChart';
export { SweepChart } from './SweepChart';
export type { SweepChartProps } from './SweepChart';
export { Bars, categoryRows, stageRows } from './Bars';
export type { BarRow, BarsProps } from './Bars';
export { Sparkline } from './Sparkline';
export type { SparklineProps } from './Sparkline';
export { ChartFrame, ChartSvg, DataTable, Legend } from './ChartFrame';
export type { ChartFrameProps, LegendItem, TableSpec, TooltipSpec } from './ChartFrame';
