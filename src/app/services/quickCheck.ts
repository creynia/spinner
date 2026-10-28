// Quick check (architecture.md §6.4): 200 sessions through the same pool, nothing stored. The
// runner is injected so the Define screen works against a fake before core-harness lands.
import type { NormalizedDefinition } from '@core/contracts/experiment';
import type { VerdictInput } from './verdict';

export const QUICK_CHECK_SESSIONS = 200;
export type QuickCheckRunner = (
  definition: NormalizedDefinition,
  sessions: number,
) => Promise<VerdictInput>;

let runner: QuickCheckRunner = async () => {
  throw new Error('Quick check is not available yet.');
};
export function setQuickCheckRunner(r: QuickCheckRunner): void {
  runner = r;
}
export function quickCheck(definition: NormalizedDefinition): Promise<VerdictInput> {
  return runner(definition, QUICK_CHECK_SESSIONS);
}
