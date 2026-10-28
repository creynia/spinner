// Settings (architecture.md §6.3): theme, money framing, default pace, storage, export/import all,
// updates, About with the decisions #11 disclaimer.
import { useEffect, useRef, useState } from 'preact/hooks';
import { CORE_VERSION } from '@core/contracts/version';
import { Button, Card, Segmented, Sheet, showToast } from '@core/ui';
import { game } from '../../services/game';
import {
  ImportError,
  getRepo,
  parseAllData,
  readUsage,
  requestPersist,
  type StorageUsage,
} from '../../services/db';
import {
  settingsStore,
  updateSettings,
  type Framing,
  type PacePreset,
  type Theme,
} from '../../services/settings';
import { checkForUpdates } from '../../services/updates';
import { useStore } from '../../state/store';
import { refreshLibrary } from '../../state/library';
import type { ScreenProps } from '../types';

/** Decisions #11, verbatim. Shown only here (and in the README). */
export const DISCLAIMER =
  'Every roulette bet has a house edge; no betting system changes it. This is a simulation for understanding risk, not advice. If gambling is a problem for you, seek help (e.g. a national gambling helpline).';

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;
const FRAMINGS = [
  { value: 'session', label: 'Per session' },
  { value: 'hour', label: 'Per hour' },
  { value: 'per100', label: 'Per 100 rounds' },
] as const;
const PACES = [
  { value: 'live', label: 'Live wheel, 40/h' },
  { value: 'electronic', label: 'Electronic, 100/h' },
] as const;

export function formatBytes(n: number | null): string {
  if (n === null) return 'unknown';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Settings({ query }: ScreenProps) {
  const s = useStore(settingsStore, (v) => v);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const aboutRef = useRef<HTMLElement>(null);

  const refreshUsage = () => void readUsage().then(setUsage);
  useEffect(refreshUsage, []);
  useEffect(() => {
    if (query.get('section') === 'about') aboutRef.current?.scrollIntoView?.();
  }, [query]);

  const exportAll = async () => {
    try {
      const data = await (await getRepo()).exportAll();
      download(`spinner-export-${data.exportedAt.slice(0, 10)}.json`, JSON.stringify(data));
      showToast('Exported everything on this device.');
    } catch (e) {
      showToast(`Export failed: ${(e as Error).message}`, { tone: 'error' });
    }
  };
  const importAll = async (file: File) => {
    try {
      const data = parseAllData(await file.text());
      const repo = await getRepo();
      const n = await repo.importAll(data);
      if (data.settings) await repo.putSettings(data.settings);
      void refreshLibrary();
      refreshUsage();
      showToast(`Imported ${n.definitions} definitions and ${n.runs} runs.`);
    } catch (e) {
      const msg = e instanceof ImportError ? e.message : `Import failed: ${(e as Error).message}`;
      showToast(msg, { tone: 'error' });
    }
  };
  const persist = async () => {
    const ok = await requestPersist();
    showToast(ok ? 'Storage is now persistent.' : 'The browser did not grant persistent storage.', {
      tone: ok ? 'info' : 'error',
    });
    refreshUsage();
  };
  const deleteAll = async () => {
    setConfirmDelete(false);
    try {
      await (await getRepo()).deleteAll();
      void refreshLibrary();
      refreshUsage();
      showToast('Deleted all local data.');
    } catch (e) {
      showToast(`Delete failed: ${(e as Error).message}`, { tone: 'error' });
    }
  };
  const check = async () => {
    setUpdateMsg('Checking');
    const r = await checkForUpdates();
    setUpdateMsg(
      r === 'available'
        ? 'An update is available. Reload to use it.'
        : r === 'current'
          ? 'You have the latest version.'
          : 'Updates are not available in this browser.',
    );
  };

  return (
    <>
      <h1>Settings</h1>

      <Card title="Appearance">
        <Segmented<Theme>
          label="Theme"
          value={s.theme}
          options={THEMES}
          onChange={(theme) => updateSettings({ theme })}
        />
      </Card>

      <Card title="Money framing">
        <p class="muted">
          How money figures are shown everywhere: per session, per hour or per 100 rounds.
        </p>
        <Segmented<Framing>
          label="Money framing"
          value={s.framing}
          options={FRAMINGS}
          onChange={(framing) => updateSettings({ framing })}
        />
      </Card>

      <Card title="Default pace">
        <p class="muted">Rounds per hour used to convert hours to rounds in new experiments.</p>
        <Segmented<PacePreset>
          label="Default pace"
          value={s.pace}
          options={PACES}
          onChange={(pace) => updateSettings({ pace })}
        />
      </Card>

      <Card title="Storage">
        <dl class="facts">
          <dt>Used</dt>
          <dd data-testid="storage-used">{formatBytes(usage?.usage ?? null)}</dd>
          <dt>Available</dt>
          <dd>{formatBytes(usage?.quota ?? null)}</dd>
          <dt>Persistent</dt>
          <dd>
            {usage?.persisted === null || usage === null
              ? 'unknown'
              : usage.persisted
                ? 'Yes'
                : 'No'}
          </dd>
        </dl>
        <div class="actions">
          <Button onClick={persist}>Request persistent storage</Button>
          <Button onClick={exportAll}>Export all</Button>
          <Button onClick={() => fileRef.current?.click()}>Import all</Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete all data
          </Button>
        </div>
        <input
          ref={fileRef}
          class="visually-hidden"
          type="file"
          accept="application/json,.json"
          aria-label="Choose an export file to import"
          tabIndex={-1}
          onChange={(e) => {
            const f = (e.currentTarget as HTMLInputElement).files?.[0];
            if (f) void importAll(f);
            (e.currentTarget as HTMLInputElement).value = '';
          }}
        />
      </Card>

      <Card title="Updates">
        <div class="actions">
          <Button onClick={check}>Check for updates</Button>
        </div>
        <p class="muted" role="status" data-update-status>
          {updateMsg}
        </p>
        <p>
          <a href="#/settings/benchmark">Benchmark this device</a>
        </p>
      </Card>

      <section class="card" id="about" ref={aboutRef} aria-labelledby="about-h">
        <div class="card-head">
          <h2 id="about-h">About</h2>
        </div>
        <dl class="facts">
          <dt>App version</dt>
          <dd>{__APP_VERSION__}</dd>
          <dt>Build</dt>
          <dd>{__BUILD_SHA__}</dd>
          <dt>Core</dt>
          <dd>{CORE_VERSION}</dd>
          <dt>Game</dt>
          <dd>
            {game.plugin.id} {game.plugin.version}
          </dd>
          <dt>License</dt>
          <dd>MIT</dd>
        </dl>
        <p data-disclaimer>{DISCLAIMER}</p>
      </section>

      <Sheet open={confirmDelete} title="Delete all data?" onClose={() => setConfirmDelete(false)}>
        <p>
          This removes every definition and run stored on this device. Export first if you want to
          keep them.
        </p>
        <div class="actions">
          <Button variant="danger" onClick={deleteAll}>
            Delete everything
          </Button>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
        </div>
      </Sheet>
    </>
  );
}
