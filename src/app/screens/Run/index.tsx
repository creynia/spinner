// Run (architecture.md §6.3): progress, speed, ETA, pause/resume/cancel, live charts, storage used,
// Resume for paused or interrupted runs after a reload, Analyze when done.
import { useEffect, useState } from 'preact/hooks';
import { Button, LivePanel, ProgressCard, fmtBytes, fmtInt } from '@core/ui';
import { readUsage, type StorageUsage } from '../../services/db';
import { cancelRun, pauseRun, resumeStored } from '../../services/runs';
import type { ScreenProps } from '../types';
import { NotFoundCard } from '../Analyze/data';
import { installResultsHook } from './e2eHook';
import { LIVE_FAN_SESSIONS, useElapsed, useRun } from './useRun';

installResultsHook();

function useUsage(active: boolean): StorageUsage | null {
  const [u, setU] = useState<StorageUsage | null>(null);
  useEffect(() => {
    let on = true;
    const read = () => void readUsage().then((x) => on && setU(x));
    read();
    if (!active) return () => void (on = false);
    const t = setInterval(read, 3000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [active]);
  return u;
}

export function Run({ params }: ScreenProps) {
  const runId = params.runId ?? '';
  const { meta, progress, controller, live, refresh } = useRun(runId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = progress?.status === 'running' || progress?.status === 'queued';
  const usage = useUsage(running);
  const shown = controller && progress ? progress.status : meta?.status;
  const elapsedMs = useElapsed(meta?.timing.elapsedMs ?? 0, shown === 'running');

  if (meta === undefined) {
    return (
      <>
        <h1>Run</h1>
        <section class="card">
          <p class="muted" role="status">
            Loading the run...
          </p>
        </section>
      </>
    );
  }
  if (meta === null) {
    return (
      <>
        <h1>Run</h1>
        <NotFoundCard what="Run" />
      </>
    );
  }

  // The controller's word wins while this page owns the run; otherwise the stored meta.
  const status = controller && progress ? progress.status : meta.status;
  const completed = controller && progress ? progress.completedSessions : meta.completedSessions;
  const elsewhere = !controller && (meta.status === 'running' || meta.status === 'queued');
  const interrupted = meta.interrupted === true;
  const resumable =
    !elsewhere && (status === 'paused' || status === 'cancelled' || status === 'error');

  const act = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const actions = (
    <>
      {status === 'running' ? (
        <Button disabled={busy} onClick={() => void act(() => pauseRun(runId))()}>
          Pause
        </Button>
      ) : null}
      {resumable ? (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void act(() => resumeStored(runId))()}
        >
          {status === 'cancelled' ? 'Continue' : 'Resume'}
        </Button>
      ) : null}
      {(status === 'running' || status === 'paused' || status === 'queued') && !elsewhere ? (
        <Button variant="danger" disabled={busy} onClick={() => void act(() => cancelRun(runId))()}>
          Cancel
        </Button>
      ) : null}
      {status === 'done' ? (
        <Button variant="primary" href={`#/analyze/${encodeURIComponent(runId)}`}>
          Analyze
        </Button>
      ) : completed > 0 && !running ? (
        <Button href={`#/analyze/${encodeURIComponent(runId)}`}>Analyze what is done</Button>
      ) : null}
    </>
  );

  const message = (
    <>
      {elsewhere ? (
        <p class="warn-card" role="note" data-warning="elsewhere">
          This run is going in another tab. Controls are off here; this page follows its progress.
        </p>
      ) : null}
      {interrupted && status === 'paused' ? (
        <p class="warn-card" role="note" data-warning="interrupted">
          The page was closed or reloaded while this run was going. What was saved is safe: press
          Resume to carry on.
        </p>
      ) : null}
      {status === 'cancelled' ? (
        <p class="muted">
          Cancelled. The finished part is kept; Continue picks up where it stopped.
        </p>
      ) : null}
      {status === 'error' ? (
        <p class="warn-card" role="alert" data-warning="error">
          The run stopped:{' '}
          {meta.error ? `${meta.error.code}: ${meta.error.message}` : 'unknown error'}.
        </p>
      ) : null}
      {error ? (
        <p class="warn-card" role="alert" data-warning="action">
          {error}
        </p>
      ) : null}
    </>
  );

  return (
    <div class="results-screen">
      <h1>Run</h1>
      <ProgressCard
        status={status}
        interrupted={interrupted}
        completed={completed}
        total={meta.sessions}
        sessionsPerSec={controller && progress ? progress.sessionsPerSec : 0}
        etaMs={controller && progress ? progress.etaMs : null}
        elapsedMs={elapsedMs}
        message={message}
        actions={actions}
      />
      <LivePanel
        fan={live.fan}
        histogram={live.histogram}
        sessions={live.sessions}
        fanSessions={LIVE_FAN_SESSIONS}
      />
      <section class="card" aria-labelledby="storage-h">
        <h2 id="storage-h">Storage</h2>
        <p data-storage>
          {meta.storage === 'memory'
            ? 'Results are kept in memory only on this device. Export the run to keep it.'
            : usage && usage.usage !== null
              ? `spinner uses ${fmtBytes(usage.usage)}${usage.quota ? ` of about ${fmtBytes(usage.quota)} available` : ''}.`
              : 'Storage use is not available in this browser.'}{' '}
          {fmtInt(completed)} sessions saved.
        </p>
      </section>
    </div>
  );
}
