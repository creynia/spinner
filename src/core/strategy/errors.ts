import type { Diagnostic } from '../contracts/strategy';

/** Thrown by `compileStrategy` when `validateStrategy` reports any error (strategy.md §2). */
export class StrategyCompileError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super(
      `strategy has ${diagnostics.length} error(s): ${diagnostics.map((d) => `${d.code} ${d.path}`).join(', ')}`,
    );
    this.name = 'StrategyCompileError';
  }
}
