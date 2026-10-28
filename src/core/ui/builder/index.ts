// The strategy builder (owner: ui-define). Game-agnostic: the game arrives through `BuilderEnv`.
export { Builder, type BuilderProps } from './Builder';
export { StrategyEditor, builderBlockers, type StrategyEditorProps } from './StrategyEditor';
export { fromJson, toJson, emptyStrategy, type BuilderModel } from './model';
export { allFacts, type BuilderEnv } from './env';
export { describeCondition, describeEffect, describeAmount } from './describe';
