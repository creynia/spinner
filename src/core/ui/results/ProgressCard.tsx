// Progress of a run: bar, sessions done, sessions per second, ETA, a soft warning for long runs.
import type { ComponentChildren } from 'preact';
import type { RunStatus } from '../../contracts/run';
import { Card } from '../kit';
import { fmtDuration, fmtInt, fmtNum } from './format';

export const LONG_RUN_MS = 120_000;

export interface ProgressCardProps {
  status: RunStatus;
  interrupted?: boolean;
  completed: number;
  total: number;
  sessionsPerSec: number;
  etaMs: number | null;
  elapsedMs?: number;
  /** Buttons (Pause, Resume, Cancel, Analyze). */
  actions?: ComponentChildren;
  message?: ComponentChildren;
}

const STATUS_TEXT: Record<RunStatus, string> = {
  queued: 'Starting',
  running: 'Running',
  paused: 'Paused',
  done: 'Done',
  cancelled: 'Cancelled',
  error: 'Stopped by an error',
};

export function ProgressCard(p: ProgressCardProps) {
  const pct = p.total > 0 ? Math.min(100, Math.floor((p.completed / p.total) * 100)) : 0;
  const status = p.interrupted && p.status === 'paused' ? 'Interrupted' : STATUS_TEXT[p.status];
  const long =
    p.status === 'running' && p.etaMs !== null && (p.elapsedMs ?? 0) + p.etaMs > LONG_RUN_MS;
  return (
    <Card title="Progress" class="progress-card">
      <p class="progress-status" data-status={p.status}>
        <strong>{status}</strong> · {pct}%
      </p>
      <div
        class="bar"
        role="progressbar"
        aria-label="Run progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%, ${fmtInt(p.completed)} of ${fmtInt(p.total)} sessions`}
      >
        <div class="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <dl class="facts progress-facts">
        <dt>Sessions</dt>
        <dd data-field="sessions">
          {fmtInt(p.completed)} of {fmtInt(p.total)}
        </dd>
        <dt>Speed</dt>
        <dd data-field="rate">
          {p.sessionsPerSec > 0
            ? `${fmtNum(p.sessionsPerSec, p.sessionsPerSec < 100 ? 1 : 0)} sessions/s`
            : 'n/a'}
        </dd>
        <dt>Time left</dt>
        <dd data-field="eta">{p.status === 'running' ? fmtDuration(p.etaMs) : 'n/a'}</dd>
        {p.elapsedMs !== undefined ? (
          <>
            <dt>Time spent</dt>
            <dd>{fmtDuration(p.elapsedMs)}</dd>
          </>
        ) : null}
      </dl>
      {long ? (
        <p class="warn-card" role="note" data-warning="long">
          <strong>This will take a while</strong> (over 2 minutes). You can pause, or leave this
          page: the run keeps going.
        </p>
      ) : null}
      {p.message}
      <div class="actions">{p.actions}</div>
    </Card>
  );
}
