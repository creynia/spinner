// Settings -> Account and sync (sync.md §8.1, §9, §7.10). Reads the sync app service's stores only;
// every action is a service call made inside the click handler (a popup needs the user gesture).
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Card, Segmented, Sheet, TextInput, relativeTime, showToast } from '@core/ui';
import { GOOGLE_CLIENT_ID } from '../../services/sync/config';
import * as sync from '../../services/sync';
import { checkForUpdates } from '../../services/updates';
import { useStore } from '../../state/store';
import { SyncGlyph, formatBytes, statusView } from '../../components/SyncIndicator';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const DOWNLOAD_OPTIONS = [
  { value: 'onOpen', label: 'When I open them' },
  { value: 'all', label: 'All, in the background' },
] as const;

/** Scoped to the Account card; the Settings screen mounts it first. */
export function Account({ query }: { query?: URLSearchParams }) {
  const st = useStore(sync.syncStatus, (v) => v);
  const auth = useStore(sync.syncAuth, (v) => v);
  const prefs = useStore(sync.syncPrefs, (v) => v);
  const notices = useStore(sync.conflictNotices, (v) => v);
  const devices = useStore(sync.syncDevices, (v) => v);
  const about = useStore(sync.syncAbout, (v) => v);

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [removing, setRemoving] = useState(false);
  const [showNotices, setShowNotices] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const [dl, setDl] = useState<{ done: number; total: number } | null>(null);
  const dlAbort = useRef<AbortController | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query?.get('account') === '1') cardRef.current?.scrollIntoView?.();
    if (query?.get('notices') === '1') openNotices();
  }, [query]);

  const configured = auth.state !== 'unconfigured';
  const signedIn = auth.state === 'signed-in' || auth.state === 'expired';
  const email =
    (auth.state === 'signed-in' || auth.state === 'expired' ? auth.email : undefined) ?? st.email;
  const view = statusView(st, auth);
  const disabled = st.disabledReason === 'memory-backend';
  const syncing = st.state === 'syncing';

  const openNotices = () => {
    setShowNotices(true);
    sync.markConflictsRead();
  };
  const showGate = (r: { email: string; files: number }) =>
    setTestMsg(`Signed in as ${r.email}. ${plural(r.files, 'file')} in the app folder.`);
  const showGateError = (e: unknown) => setTestMsg(`Sign-in test failed: ${(e as Error).message}`);
  const runTest = () => {
    setTesting(true);
    setTestMsg('');
    sync
      .testSignIn()
      .then(showGate)
      .catch(showGateError)
      .finally(() => setTesting(false));
  };
  const preloadEager = () => sync.preloadSignIn({ eager: true });
  const endTest = () => {
    void sync
      .endTestSignIn()
      .then(() =>
        setTestMsg(
          'Test ended. Signed out here; if you were offline, remove spinner at myaccount.google.com/permissions.',
        ),
      )
      .catch(showGateError);
  };
  // Back from the redirect round trip (the installed app): the page reloaded, so finish the gate
  // check here and show the result exactly as the popup path does.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    sync.preloadSignIn();
    let live = true;
    sync
      .resumeTestSignIn()
      .then((r) => {
        if (live && r) showGate(r);
      })
      .catch((e: unknown) => live && showGateError(e));
    return () => {
      live = false;
    };
  }, []);
  const downloadAll = () => {
    const ctl = new AbortController();
    dlAbort.current = ctl;
    setDl({ done: 0, total: st.remoteOnly.bytes });
    sync
      .downloadAllRemote((done, total) => setDl({ done, total }), ctl.signal)
      .then((r) =>
        showToast(
          ctl.signal.aborted
            ? `Stopped after ${plural(r.done, 'run')}.`
            : `Downloaded ${plural(r.done, 'run')}.`,
        ),
      )
      .catch((e: unknown) =>
        showToast(`Download failed: ${(e as Error).message}`, { tone: 'error' }),
      )
      .finally(() => setDl(null));
  };
  const checkUpdate = () =>
    void checkForUpdates().then((r) =>
      showToast(
        r === 'available'
          ? 'An update is available. Reload to use it.'
          : r === 'current'
            ? 'You have the latest version.'
            : 'Updates are not available in this browser.',
      ),
    );

  const reconnectPrimary = st.pending > 0;
  const action = (() => {
    switch (view.action) {
      case 'sync':
        return (
          <Button variant="primary" disabled={syncing} onClick={() => void sync.syncNow()}>
            Sync now
          </Button>
        );
      case 'reconnect':
        return (
          <Button
            variant={reconnectPrimary ? 'primary' : 'secondary'}
            onClick={() => void sync.reconnect()}
          >
            Reconnect
          </Button>
        );
      case 'signin':
        return (
          <Button variant="primary" onClick={() => void sync.signIn()}>
            Sign in
          </Button>
        );
      case 'update':
        return (
          <Button variant="primary" onClick={checkUpdate}>
            Check for updates
          </Button>
        );
      case 'library':
        return <Button href="#/library">Library › Runs</Button>;
      case 'link-drive':
        return (
          <>
            <a
              class="btn btn-secondary"
              href="https://one.google.com/storage"
              target="_blank"
              rel="noopener noreferrer"
            >
              Manage Google storage
            </a>
            <Button variant="primary" onClick={() => void sync.syncNow()}>
              Sync now
            </Button>
          </>
        );
      default:
        return null;
    }
  })();

  const unread = st.conflicts;
  const remoteOnly = st.remoteOnly;

  return (
    <div ref={cardRef} id="account">
      <Card title="Account and sync">
        {disabled ? (
          <div class="sync-warn" role="status" data-sync-disabled="memory-backend">
            <strong>Sync needs storage that persists.</strong>
            <br />
            This browser is keeping spinner's data in memory only, so there is nothing to sync. Use
            a browser that allows site storage.
          </div>
        ) : !configured ? (
          <p data-account="unconfigured">Sync is not set up in this build.</p>
        ) : !signedIn ? (
          <div data-account="signed-out">
            {st.state === 'error' ? (
              <p class="sync-status attention" role="status" data-sync-status="error">
                <span class="glyph">
                  <SyncGlyph tone="attention" />
                </span>
                <span>{view.text}</span>
              </p>
            ) : null}
            <p class="lead">
              Use your library and runs on all your devices. spinner keeps them in a hidden folder
              in your own Google Drive.
            </p>
            <div class="actions">
              <Button
                variant="primary"
                disabled={auth.state === 'redirecting'}
                onClick={() => void sync.signIn()}
              >
                {auth.state === 'redirecting' ? 'Opening Google…' : 'Sign in with Google'}
              </Button>
            </div>
            <p class="muted">spinner sees only its own folder, never your other files.</p>
            <details>
              <summary class="link-tap">How sync works</summary>
              <p class="muted">
                Your definitions, strategies, layouts and runs are copied to a hidden app folder in
                your Drive. Each device merges what the others wrote. There is no spinner server:
                your data goes only between this browser and Google. It is not end-to-end encrypted.
                To remove it, sign in and choose Remove my data from Drive.
              </p>
            </details>
          </div>
        ) : (
          <div data-account="signed-in">
            <p>
              <strong data-account-email>{email}</strong>
            </p>
            <p
              class={`sync-status${view.attention ? ' attention' : ''}`}
              role="status"
              data-sync-status={st.state}
            >
              <span class="glyph">
                <SyncGlyph tone={view.tone} />
              </span>
              <span>{view.text || 'Sync is off on this device'}</span>
            </p>
            {syncing && st.progress && st.progress.total > 0 ? (
              <progress
                class="sync-progress"
                max={st.progress.total}
                value={st.progress.done}
                aria-label="Sync progress"
              />
            ) : null}
            {st.clockSkewDevice ? (
              <p class="sync-warn" role="note" data-sync-skew>
                A device's clock looks wrong ({st.clockSkewDevice}). Check its date and time; its
                changes are still accepted.
              </p>
            ) : null}
            <p>
              This device: <strong data-device-name>{prefs.deviceName || 'Unnamed'}</strong>{' '}
              <Button
                variant="ghost"
                onClick={() => {
                  setNameDraft(prefs.deviceName);
                  setRenaming(true);
                }}
              >
                Rename
              </Button>
            </p>
            {action ? <div class="actions">{action}</div> : null}

            <dl class="facts" data-sync-usage>
              <dt>Google Drive</dt>
              <dd>
                {about
                  ? about.limit === null
                    ? `${formatBytes(about.usage)} used`
                    : `${formatBytes(about.usage)} of ${formatBytes(about.limit)}`
                  : 'Checking…'}
              </dd>
              <dt>This device</dt>
              <dd>{about ? formatBytes(about.deviceBytes) : 'Checking…'}</dd>
            </dl>
            {remoteOnly.runs > 0 ? (
              <>
                <p data-remote-only>
                  {plural(remoteOnly.runs, 'run')} only in Drive ({formatBytes(remoteOnly.bytes)})
                </p>
                {dl ? (
                  <>
                    <progress
                      class="sync-progress"
                      max={Math.max(dl.total, 1)}
                      value={dl.done}
                      aria-label="Download progress"
                    />
                    <p role="status">
                      Downloading {formatBytes(dl.done)} of {formatBytes(dl.total)}
                    </p>
                    <div class="actions">
                      <Button onClick={() => dlAbort.current?.abort()}>Cancel</Button>
                    </div>
                  </>
                ) : (
                  <div class="actions">
                    <Button disabled={st.state === 'offline'} onClick={downloadAll}>
                      Download all
                    </Button>
                  </div>
                )}
              </>
            ) : null}

            <Segmented<'all' | 'onOpen'>
              label="Download runs"
              value={prefs.runDownload}
              options={DOWNLOAD_OPTIONS}
              onChange={(runDownload) => void sync.setPrefs({ runDownload })}
            />

            {notices.length > 0 ? (
              <div class="actions">
                <Button
                  onClick={openNotices}
                  aria-label={`${plural(notices.length, 'notice')}${unread > 0 ? `, ${unread} unread` : ''}`}
                >
                  ⚠ {plural(notices.length, 'notice')} ›
                </Button>
              </div>
            ) : null}

            {devices.length > 0 ? (
              <>
                <h3>Devices</h3>
                <ul class="sync-list" data-sync-devices>
                  {devices.map((d) => (
                    <li key={d.id}>
                      <strong>{d.name}</strong>
                      {d.name === prefs.deviceName ? ' (this device)' : ''}
                      <br />
                      <span class="muted">
                        Synced {relativeTime(d.lastSyncedAt)} · spinner {d.appVersion}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <div class="actions">
              <Button onClick={() => void sync.signOut()}>Sign out</Button>
              <Button variant="ghost" onClick={() => setRemoving(true)}>
                Remove my data from Drive…
              </Button>
            </div>
          </div>
        )}

        {GOOGLE_CLIENT_ID && !disabled ? (
          <div
            class="sync-test"
            data-sync-test
            onPointerEnter={preloadEager}
            onFocusIn={preloadEager}
            onTouchStart={preloadEager}
          >
            <p class="muted">
              Test Google sign-in (checks the Google connection only). After Expire token now, tap
              Test Google sign-in again to try Reconnect. End test removes spinner's access.
            </p>
            <div class="actions">
              <Button disabled={testing} onClick={runTest}>
                Test Google sign-in
              </Button>
              <Button onClick={() => sync.expireTokenForTest()}>Expire token now</Button>
              <Button onClick={endTest}>End test</Button>
            </div>
            <p role="status" data-sync-test-result>
              {testMsg}
            </p>
          </div>
        ) : null}
      </Card>

      <Sheet open={renaming} title="Name this device" onClose={() => setRenaming(false)}>
        <label for="sync-device-name">Device name</label>
        <TextInput id="sync-device-name" value={nameDraft} onInput={setNameDraft} />
        <div class="sync-sheet-actions">
          <Button
            variant="primary"
            disabled={nameDraft.trim() === ''}
            onClick={() => {
              void sync.setPrefs({ deviceName: nameDraft.trim() });
              setRenaming(false);
            }}
          >
            Save
          </Button>
          <Button onClick={() => setRenaming(false)}>Cancel</Button>
        </div>
      </Sheet>

      <Sheet open={removing} title="Remove from Drive?" onClose={() => setRemoving(false)}>
        <p>
          Remove all spinner data from your Google Drive? It stays on this device. Your other
          devices stop syncing.
        </p>
        <div class="sync-sheet-actions">
          <Button
            variant="danger"
            onClick={() => {
              setRemoving(false);
              void sync.removeDriveData();
            }}
          >
            Remove from Drive
          </Button>
          <Button autoFocus onClick={() => setRemoving(false)}>
            Cancel
          </Button>
        </div>
      </Sheet>

      <Sheet open={showNotices} title="Notices" onClose={() => setShowNotices(false)}>
        {notices.length === 0 ? (
          <p>No notices.</p>
        ) : (
          <ul class="sync-list" data-sync-notices>
            {notices.map((n) => (
              <li key={n.id}>
                {n.message}
                <br />
                <span class="muted">{relativeTime(n.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
