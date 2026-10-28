import type { RunProgress } from '@core/contracts/run';

/** "Running 43%": links to the run; shown whenever a run is active. */
export function RunningChip({ progress }: { progress: RunProgress }) {
  const pct = Math.min(
    100,
    Math.floor((progress.completedSessions / (progress.sessions || 1)) * 100),
  );
  return (
    <a class="running-chip" href={`#/run/${encodeURIComponent(progress.runId)}`}>
      Running {pct}%
    </a>
  );
}
