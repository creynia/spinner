// Sync sheets (sync.md §8.3, §7.10): the first-sync choice and the account-switch choice. Both are
// driven by service stores that are non-null while the sheet is due; closing a sheet is "Not now".
import { useEffect, useState } from 'preact/hooks';
import { Button, Sheet, relativeTime } from '@core/ui';
import type { FirstSyncPreview } from '@core';
import { useStore } from '../state/store';
import * as sync from '../services/sync';
import { formatBytes } from './SyncIndicator';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function counts(c: FirstSyncPreview['local']): { lib: string; runs: string } {
  return {
    lib: `${plural(c.experiments, 'experiment')} · ${plural(c.strategies, 'strategy', 'strategies')}${
      c.layouts > 0 ? ` · ${plural(c.layouts, 'layout')}` : ''
    }`,
    runs: `${plural(c.runs, 'run')}${c.runs > 0 ? ` (${formatBytes(c.runBytes)})` : ''}`,
  };
}

export function FirstSyncSheet() {
  const p = useStore(sync.firstSyncPrompt, (v) => v);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!p) {
      setConfirmReplace(false);
      setBusy(false);
    }
  }, [p]);
  if (!p) return null;
  const choose = (c: 'merge' | 'replace' | 'cancel') => {
    setBusy(true);
    void sync.chooseFirstSync(c).finally(() => setBusy(false));
  };
  const local = counts(p.local);
  if (p.remoteEmpty) {
    return (
      <Sheet open title="Upload this device's library?" onClose={() => choose('cancel')}>
        <p data-first-sync="empty">
          {local.lib}
          <br />
          {local.runs}
        </p>
        <p class="muted">Runs upload in the background.</p>
        <div class="sync-sheet-actions">
          <Button variant="primary" disabled={busy} onClick={() => choose('merge')}>
            Start syncing
          </Button>
          <Button autoFocus disabled={busy} onClick={() => choose('cancel')}>
            Not now
          </Button>
        </div>
      </Sheet>
    );
  }
  if (confirmReplace) {
    return (
      <Sheet open title="Replace this device's data?" onClose={() => setConfirmReplace(false)}>
        <p>
          Everything on this device ({local.lib}, {local.runs}) will be replaced with what is in
          your Google Drive. Anything only on this device is lost.
        </p>
        <div class="sync-sheet-actions">
          <Button variant="danger" disabled={busy} onClick={() => choose('replace')}>
            Replace this device's data
          </Button>
          <Button autoFocus disabled={busy} onClick={() => setConfirmReplace(false)}>
            Go back
          </Button>
        </div>
      </Sheet>
    );
  }
  const remote = counts(p.remote);
  return (
    <Sheet open title="Your Drive already has data" onClose={() => choose('cancel')}>
      <div data-first-sync="existing">
        <p>
          <strong>
            From {p.remote.fromName ?? 'another device'}
            {p.remote.syncedAt ? ` · synced ${relativeTime(p.remote.syncedAt)}` : ''}
          </strong>
          <br />
          {remote.lib}
          <br />
          {remote.runs}
        </p>
        <p>
          <strong>On this device</strong>
          <br />
          {local.lib}
          <br />
          {local.runs}
        </p>
      </div>
      <div class="sync-sheet-actions">
        <Button variant="primary" disabled={busy} onClick={() => choose('merge')}>
          Merge both (recommended)
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => setConfirmReplace(true)}>
          Replace this device's data
        </Button>
        <Button autoFocus disabled={busy} onClick={() => choose('cancel')}>
          Not now
        </Button>
      </div>
    </Sheet>
  );
}

export function AccountSwitchSheet() {
  const p = useStore(sync.accountSwitchPrompt, (v) => v);
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  const choose = (c: 'sync' | 'cancel') => {
    setBusy(true);
    void sync.chooseAccountSwitch(c).finally(() => setBusy(false));
  };
  return (
    <Sheet open title="Use a different Google account?" onClose={() => choose('cancel')}>
      <p data-account-switch>
        This device was syncing with {p.from}. You signed in as {p.to}.
      </p>
      <p class="muted">
        Syncing with {p.to} uploads this device's data to that account's Drive. Nothing on this
        device is deleted.
      </p>
      <div class="sync-sheet-actions">
        <Button variant="primary" disabled={busy} onClick={() => choose('sync')}>
          Sync this device's data to {p.to}
        </Button>
        <Button autoFocus disabled={busy} onClick={() => choose('cancel')}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

/** Mounted once, in the TopBar. */
export function SyncSheets() {
  return (
    <>
      <FirstSyncSheet />
      <AccountSwitchSheet />
    </>
  );
}
