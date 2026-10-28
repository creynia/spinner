// The strategy builder (owner: ui-define). Game-agnostic: the game arrives through `BuilderEnv`.
export { Builder, type BuilderProps } from './Builder';
export { StrategyEditor, builderBlockers, type StrategyEditorProps } from './StrategyEditor';
export { fromJson, toJson, emptyStrategy, type BuilderModel } from './model';
export { allFacts, type BuilderEnv } from './env';
export { describeCondition, describeEffect, describeAmount } from './describe';

/** DOM id of the builder element that shows the diagnostic at this JSON pointer (for "jump to"). */
export function pathToElementId(path: string): string {
  const rule = /^\/stages\/(\d+)\/rules\/(\d+)/.exec(path);
  if (rule) return `b-rule-${rule[1]}-${rule[2]}`;
  const lay = /^\/stages\/(\d+)\/layout\/(\d+)/.exec(path);
  if (lay) return `b-lay-${lay[1]}-${lay[2]}`;
  const st = /^\/stages\/(\d+)/.exec(path);
  if (st) return `b-stage-${st[1]}`;
  if (path.startsWith('/progressions')) return 'b-prog-h';
  if (path.startsWith('/vars')) return 'b-vars-h';
  return 'b-stages-h';
}
