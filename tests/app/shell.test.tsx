import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORE_NAMES, type Backend } from '@core';
import { clearToasts } from '@core/ui';
import { isCurrent } from '@app/components/Nav';
import { goBack, parentOf } from '@app/router';
import type { DefinitionRecord } from '@core/contracts/experiment';
import type { RunMeta } from '@core/contracts/run';
import { App } from '@app/App';
import { createStore, useStore } from '@app/state/store';
import {
  createBackendRepo,
  createMemoryRepo,
  keyOf,
  parseAllData,
  setRepoForTests,
  storageStatus,
  ImportError,
} from '@app/services/db';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  settingsStore,
  updateSettings,
  sanitizeSettings,
} from '@app/services/settings';
import { formatVerdict, pct } from '@app/services/verdict';
import { recentRuns, isResumable } from '@app/services/runs';
import { checkForUpdates, setUpdateChecker } from '@app/services/updates';
import { DISCLAIMER } from '@app/screens/Settings';
import { STORAGE_BANNER_TEXT } from '@app/components/StorageBanner';

const def = (id: string, name: string, updatedAt: string): DefinitionRecord =>
  ({
    v: 1,
    id,
    origin: 'user',
    createdAt: updatedAt,
    updatedAt,
    runIds: [],
    definition: { name, session: { maxRounds: 500 }, run: { sessions: 10000 } },
  }) as unknown as DefinitionRecord;
const run = (runId: string, status: RunMeta['status'], createdAt: string): RunMeta =>
  ({
    runId,
    definitionId: 'd1',
    status,
    createdAt,
    sessions: 1000,
    completedSessions: status === 'done' ? 1000 : 400,
  }) as unknown as RunMeta;

beforeEach(() => {
  setRepoForTests(createMemoryRepo());
  settingsStore.set(DEFAULT_SETTINGS);
  recentRuns.set([]);
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
  document.documentElement.removeAttribute('data-theme');
});

describe('store', () => {
  it('only notifies on identity change', () => {
    const s = createStore({ a: 1 });
    let calls = 0;
    s.subscribe(() => calls++);
    const v = s.get();
    s.set(v);
    s.set({ a: 2 });
    expect(calls).toBe(1);
  });
  it('useStore re-renders when the slice changes', async () => {
    const s = createStore(1);
    function C() {
      return <p>{useStore(s, (v) => v * 2)}</p>;
    }
    const { container } = render(<C />);
    expect(container.textContent).toBe('2');
    s.set(5);
    await waitFor(() => expect(container.textContent).toBe('10'));
  });
});

describe('verdict', () => {
  it('formats the one-line verdict', () => {
    expect(
      formatVerdict({ meanNet: -4100, halfWidth: 600, pAhead: 0.38, pBust: 0.02, n: 10000 }),
    ).toBe('mean -$41 ± $6 · P(ahead) 38% · bust 2%');
  });
  it('rescales to per hour and per 100 rounds', () => {
    const v = { meanNet: -5000, halfWidth: null, pAhead: 0.4, pBust: 0, n: 100 };
    expect(formatVerdict(v, 'per100', 500, 40)).toContain('-$10 per 100 rounds');
    expect(formatVerdict(v, 'hour', 500, 40)).toContain('-$4 per hour');
  });
  it('never rounds a nonzero probability to 0% or 100%', () => {
    expect(pct(0.001)).toBe('<1%');
    expect(pct(0)).toBe('0%');
    expect(pct(0.999)).toBe('>99%');
  });
});

describe('settings service', () => {
  it('sanitizes unknown values', () => {
    expect(sanitizeSettings({ theme: 'neon', framing: 'hour' })).toEqual({
      ...DEFAULT_SETTINGS,
      framing: 'hour',
    });
  });
  it('persists through the repo and mirrors the theme', async () => {
    const repo = createMemoryRepo();
    await loadSettings(repo);
    updateSettings({ theme: 'dark', framing: 'per100' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('spinner:theme')).toBe('dark');
    await waitFor(() => expect(repo.getSetting('framing')).resolves.toBe('per100'));
    updateSettings({ theme: 'system' });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('spinner:theme')).toBeNull();
  });
});

describe('export / import (definitions only)', () => {
  it('round-trips definitions and skips what is already there', async () => {
    const a = createMemoryRepo({
      definitions: [def('x', 'X', '2026-01-01')],
      runs: [run('r', 'done', '2026-01-01')],
    });
    await a.setSetting('theme', 'dark');
    const exported = await a.exportDefinitions();
    expect(exported.format).toBe('spinner-definitions');
    expect(exported).not.toHaveProperty('runs');
    const text = JSON.stringify(exported);
    const b = createMemoryRepo();
    expect(await b.importDefinitions(parseAllData(text))).toEqual({ definitions: 1 });
    expect(await b.importDefinitions(parseAllData(text))).toEqual({ definitions: 0 });
  });
  it('rejects foreign files with readable errors', () => {
    expect(() => parseAllData('nope')).toThrow(ImportError);
    expect(() => parseAllData('{"format":"x"}')).toThrow(/not a spinner definitions export/);
    expect(() => parseAllData('{"format":"spinner-definitions","v":2}')).toThrow(/newer/);
  });
});

/** A backend like core/store's that enforces each store's keyPath, as IndexedDB does. */
function strictBackend(): Backend & { dump(): Record<string, unknown[]> } {
  const data = new Map<string, Map<string, unknown>>(STORE_NAMES.map((n) => [n, new Map()]));
  const id = (k: IDBValidKey) => JSON.stringify(k);
  return {
    kind: 'memory',
    get: (st, key) => Promise.resolve(data.get(st)!.get(id(key)) as never),
    getAll: (st) => Promise.resolve([...data.get(st)!.values()] as never),
    getAllKeys: (st) =>
      Promise.resolve([...data.get(st)!.keys()].map((k) => JSON.parse(k) as IDBValidKey)),
    tx(stores, _mode, fn) {
      const ops: (() => void)[] = [];
      fn({
        put(st, value) {
          const key = keyOf(st, value as Record<string, unknown>);
          if ([key].flat().some((k) => k === undefined))
            throw new Error(`${st}: record lacks its keyPath`);
          ops.push(() => data.get(st)!.set(id(key), value));
        },
        delete: (st, key) => void ops.push(() => data.get(st)!.delete(id(key))),
      });
      ops.forEach((o) => o());
      void stores;
      return Promise.resolve();
    },
    dump: () => Object.fromEntries([...data].map(([k, v]) => [k, [...v.values()]])),
  };
}

describe('backend repo', () => {
  it('stores one { key, value } record per setting', async () => {
    const be = strictBackend();
    const repo = createBackendRepo(be);
    await repo.setSetting('theme', 'dark');
    expect(be.dump().settings).toEqual([{ key: 'theme', value: 'dark' }]);
    expect(await repo.getSetting('theme')).toBe('dark');
    expect(await repo.getSetting('framing')).toBeUndefined();
  });
  it('lists runs newest first', async () => {
    const be = strictBackend();
    await be.tx(['runs'], 'readwrite', (t) => {
      t.put('runs', run('a', 'done', '2026-01-01'));
      t.put('runs', run('b', 'done', '2026-03-01'));
    });
    expect((await createBackendRepo(be).listRuns()).map((r) => r.runId)).toEqual(['b', 'a']);
  });
  it('deleteAll clears every store, parts and settings included', async () => {
    const be = strictBackend();
    await be.tx([...STORE_NAMES], 'readwrite', (t) => {
      t.put('definitions', { id: 'd' });
      t.put('strategies', { id: 's' });
      t.put('runs', { runId: 'r' });
      t.put('runParts', { runId: 'r', firstChunk: 0 });
      t.put('summaries', { runId: 'r' });
      t.put('checkpoints', { runId: 'r' });
      t.put('breakdowns', { runId: 'r' });
      t.put('samples', { runId: 'r' });
      t.put('groups', { id: 'g' });
      t.put('settings', { key: 'theme', value: 'dark' });
    });
    await createBackendRepo(be).deleteAll();
    for (const [store, recs] of Object.entries(be.dump())) expect(recs, store).toEqual([]);
  });
  it('a failing put is reported, not swallowed', async () => {
    const repo = createMemoryRepo();
    repo.setSetting = () => Promise.reject(new Error('quota'));
    await loadSettings(repo);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    updateSettings({ framing: 'hour' });
    await waitFor(() => expect(err).toHaveBeenCalled());
    err.mockRestore();
    clearToasts();
  });
});

describe('updates hook', () => {
  it('delegates to the registered checker', async () => {
    setUpdateChecker(() => Promise.resolve('available'));
    expect(await checkForUpdates()).toBe('available');
    setUpdateChecker(null);
  });
});

describe('runs', () => {
  it('knows which runs can resume', () => {
    expect(isResumable({ status: 'paused', interrupted: false })).toBe(true);
    expect(isResumable({ status: 'running', interrupted: true })).toBe(true);
    expect(isResumable({ status: 'done', interrupted: false })).toBe(false);
  });
});

describe('shell structure', () => {
  it('has a top bar, one main, two navs and a live toast region', () => {
    window.location.hash = '#/';
    const { container } = render(<App />);
    expect(container.querySelector('header.topbar')).not.toBeNull();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('nav')).toHaveLength(2);
    expect(container.querySelector('.toasts[aria-live=polite]')).not.toBeNull();
  });
  it('shows a back button off the root only', () => {
    window.location.hash = '#/settings';
    const { container } = render(<App />);
    expect(container.querySelector('.topbar-back')).not.toBeNull();
  });
  it('shows the storage banner when storage is memory-only and lets it be dismissed', () => {
    storageStatus.set({ state: 'memory', dismissed: false });
    const { container } = render(<App />);
    const banner = container.querySelector('[data-storage-banner]')!;
    expect(banner.textContent).toContain(STORAGE_BANNER_TEXT);
    fireEvent.click(banner.querySelector('button')!);
    return waitFor(() => expect(container.querySelector('[data-storage-banner]')).toBeNull());
  });
});

describe('Home', () => {
  it('shows empty states, New experiment, Import and every preset', async () => {
    window.location.hash = '#/';
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelectorAll('[data-empty]')).toHaveLength(2));
    expect(container.querySelector('main a[href="#/define"]')).not.toBeNull();
    expect(container.querySelector('main a[href="#/import"]')).not.toBeNull();
    expect(container.querySelectorAll('ul[aria-label="Strategy presets"] a')).toHaveLength(12);
    expect(container.querySelector('a[href="#/define?preset=flat-red"]')).not.toBeNull();
    expect(container.querySelector('[data-disclaimer]')).toBeNull();
  });
  it('lists recent runs and definitions from the repo, linking to Analyze/Define', async () => {
    setRepoForTests(
      createMemoryRepo({
        definitions: [def('d1', 'Martingale on red', '2026-02-01')],
        runs: [run('r1', 'done', '2026-02-01'), run('r2', 'paused', '2026-02-02')],
      }),
    );
    window.location.hash = '#/';
    const { container } = render(<App />);
    await waitFor(() =>
      expect(container.querySelectorAll('ul[aria-label="Recent runs"] li')).toHaveLength(2),
    );
    expect(
      container.querySelector('ul[aria-label="Recent runs"] a[href="#/analyze/r1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('ul[aria-label="Recent runs"] a[href="#/run/r2"]'),
    ).not.toBeNull();
    expect(container.querySelector('.resume-card a[href="#/run/r2"]')).not.toBeNull();
    expect(container.querySelector('a[href="#/define/d1"]')?.textContent).toContain(
      'Martingale on red',
    );
  });
});

describe('Settings', () => {
  it('changes theme and framing through radio groups', async () => {
    window.location.hash = '#/settings';
    const { container } = render(<App />);
    const group = (label: string) =>
      container.querySelector(`[role=radiogroup][aria-label="${label}"]`)!;
    const pick = (label: string, text: string) =>
      fireEvent.click(
        [...group(label).querySelectorAll('[role=radio]')].find((b) => b.textContent === text)!,
      );
    pick('Theme', 'Dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    pick('Money framing', 'Per hour');
    expect(settingsStore.get().framing).toBe('hour');
    await waitFor(() =>
      expect(group('Money framing').querySelector('[aria-checked=true]')?.textContent).toBe(
        'Per hour',
      ),
    );
  });
  it('has the About card with the decisions #11 disclaimer verbatim, and only there', () => {
    window.location.hash = '#/settings';
    const { container } = render(<App />);
    expect(container.querySelector('#about [data-disclaimer]')!.textContent).toBe(DISCLAIMER);
    expect(DISCLAIMER).toBe(
      'Every roulette bet has a house edge; no betting system changes it. This is a simulation for understanding risk, not advice. If gambling is a problem for you, seek help (e.g. a national gambling helpline).',
    );
  });
  it('offers storage, export, import, delete (with confirm) and update check', async () => {
    window.location.hash = '#/settings';
    setUpdateChecker(() => Promise.resolve('current'));
    const { container, getByText } = render(<App />);
    for (const t of [
      'Request persistent storage',
      'Export definitions',
      'Import definitions',
      'Delete all data',
      'Check for updates',
    ])
      expect(getByText(t)).toBeTruthy();
    fireEvent.click(getByText('Delete all data'));
    expect(container.querySelector('[role=dialog]')).not.toBeNull();
    fireEvent.click(getByText('Cancel'));
    expect(container.querySelector('[role=dialog]')).toBeNull();
    fireEvent.click(getByText('Check for updates'));
    await waitFor(() =>
      expect(container.querySelector('[data-update-status]')?.textContent).toContain('latest'),
    );
    setUpdateChecker(null);
  });
});

describe('More and NotFound', () => {
  it('More lists Gallery, Import, Settings and About', () => {
    window.location.hash = '#/more';
    const { container } = render(<App />);
    const hrefs = [...container.querySelectorAll('ul[aria-label="More destinations"] a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual(['#/gallery', '#/import', '#/settings', '#/settings?section=about']);
  });
});

describe('settings survive a memory-only repo', () => {
  it('restores from the local copy', async () => {
    await loadSettings(createMemoryRepo());
    updateSettings({ framing: 'hour', theme: 'dark' });
    settingsStore.set(DEFAULT_SETTINGS);
    await loadSettings(createMemoryRepo());
    expect(settingsStore.get()).toMatchObject({ framing: 'hour', theme: 'dark' });
  });
});

describe('back navigation', () => {
  it('has explicit parents, none on tab roots', () => {
    for (const root of ['/', '/define', '/library', '/more']) expect(parentOf(root)).toBeNull();
    expect(parentOf('/settings')).toBe('/more');
    expect(parentOf('/gallery')).toBe('/more');
    expect(parentOf('/import')).toBe('/more');
    expect(parentOf('/run/r1')).toBe('/');
    expect(parentOf('/analyze/r1')).toBe('/');
    expect(parentOf('/define/abc')).toBe('/library');
  });
  it('shows Back only off the tab roots and goes to the parent without in-app history', () => {
    window.location.hash = '#/more';
    const { container, unmount } = render(<App />);
    expect(container.querySelector('.topbar-back')).toBeNull();
    unmount();
    window.location.hash = '#/import';
    const r = render(<App />);
    expect(r.container.querySelector('.topbar-back')).not.toBeNull();
    goBack('/import');
  });
});

describe('nav current page', () => {
  it('maps More children to More', () => {
    const more = { path: '/more', also: ['/settings', '/gallery', '/import'] };
    expect(isCurrent(more, '/settings')).toBe(true);
    expect(isCurrent(more, '/gallery/b1')).toBe(true);
    expect(isCurrent(more, '/library')).toBe(false);
    expect(isCurrent({ path: '/' }, '/settings')).toBe(false);
  });
});
