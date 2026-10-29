// RemoteRunCard (sync.md §8.4): shown instead of Analyze or Watch for a run whose results are only
// in Drive. It downloads the run, with progress and Cancel, and says why when it cannot.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Card } from '@core/ui';
import { formatMoney } from '@core';
import type { RunStub } from '@core';
import { useStore } from '../state/store';
import * as sync from '../services/sync';
import { formatBytes } from './SyncIndicator';

export type RemoteRunPhase =
  'loading' | 'downloading' | 'done' | 'cancelled' | 'offline' | 'needs-auth' | 'missing';

export interface RemoteRunCardProps {
  runId: string;
  /** The experiment's name (`experimentName()`); the card never invents one. */
  name: string;
  /** Called once the run is on this device, so the screen can show it. */
  onDownloaded?: () => void;
}

function verdictLine(stub: RunStub): string | null {
  const v = stub.verdict;
  if (!v) return null;
  const half =
    v.halfWidth === null ? '' : ` ± ${formatMoney(Math.round(v.halfWidth)).replace('-', '')}`;
  return `mean ${formatMoney(Math.round(v.meanNet)).replace('-', '−')}${half} · P(ahead) ${Math.round(v.pAhead * 100)}%`;
}

export function RemoteRunCard({ runId, name, onDownloaded }: RemoteRunCardProps) {
  const [stub, setStub] = useState<RunStub | null>(null);
  const [phase, setPhase] = useState<RemoteRunPhase>('loading');
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const auth = useStore(sync.syncAuth, (a) => a.state);
  const devices = useStore(sync.syncDevices, (d) => d);
  const doneCb = useRef(onDownloaded);
  doneCb.current = onDownloaded;

  const start = () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase('downloading');
    setProgress([0, 0]);
    void sync
      .downloadRun(runId, (d, t) => alive.current && setProgress([d, t]), ctl.signal)
      .then((r) => {
        if (!alive.current || abort.current !== ctl) return;
        if (r === 'ok') {
          setPhase('done');
          doneCb.current?.();
        } else if (ctl.signal.aborted) setPhase('cancelled');
        else setPhase(r === 'corrupt' ? 'missing' : r);
      })
      .catch(
        () =>
          alive.current &&
          abort.current === ctl &&
          setPhase(ctl.signal.aborted ? 'cancelled' : 'missing'),
      );
  };

  useEffect(() => {
    alive.current = true;
    let live = true;
    void sync.remoteRun(runId).then((s) => live && setStub(s));
    start();
    return () => {
      live = false;
      alive.current = false;
      abort.current?.abort();
    };
  }, [runId]);

  // Back online or signed in again: try once more (the download itself needs no gesture).
  const online = useStore(sync.syncStatus, (s) => s.state !== 'offline');
  useEffect(() => {
    if ((phase === 'offline' && online) || (phase === 'needs-auth' && auth === 'signed-in'))
      start();
  }, [online, auth]);

  const pct = progress[1] > 0 ? Math.min(100, Math.round((progress[0] / progress[1]) * 100)) : 0;
  const bytes = stub?.bundle?.bytes;
  const madeOn = stub?.owner ? devices.find((d) => d.id === stub.owner)?.name : undefined;
  const verdict = stub ? verdictLine(stub) : null;

  return (
    <Card title={name} class="remote-run-card">
      <div data-remote-run={phase}>
        {verdict ? <p>{verdict}</p> : null}
        <p class="muted">
          In your Google Drive{bytes !== undefined ? ` (${formatBytes(bytes)})` : ''}
          {madeOn ? `, made on ${madeOn}` : ''}.
        </p>
        {phase === 'loading' || phase === 'downloading' ? (
          <>
            <progress
              class="sync-progress"
              max={100}
              value={progress[1] > 0 ? pct : undefined}
              aria-label="Download progress"
            />
            <p role="status">{progress[1] > 0 ? `Downloading ${pct}%` : 'Downloading…'}</p>
            <Button onClick={() => abort.current?.abort()}>Cancel</Button>
          </>
        ) : null}
        {phase === 'cancelled' ? (
          <>
            <p role="status">Download cancelled.</p>
            <Button variant="primary" onClick={start}>
              Download
            </Button>
          </>
        ) : null}
        {phase === 'offline' ? (
          <p role="status">It will download when you're back online.</p>
        ) : null}
        {phase === 'needs-auth' ? (
          <>
            <p role="status">Sign in again to download this run.</p>
            {/* `reconnect()` runs inside the click: a popup needs the user gesture. */}
            <Button variant="primary" onClick={() => void sync.reconnect()}>
              Reconnect and download
            </Button>
          </>
        ) : null}
        {phase === 'missing' ? (
          <p role="status">
            This run's file in Drive is damaged or missing. It is re-uploaded from the device that
            has it on its next sync.
          </p>
        ) : null}
        {phase === 'done' ? <p role="status">Downloaded.</p> : null}
      </div>
    </Card>
  );
}
