import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DefinitionRecord } from '@core/contracts/experiment';
import type { RunMeta } from '@core/contracts/run';
import { App } from '@app/App';
import { createStore, useStore } from '@app/state/store';
import {
  createMemoryRepo,
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
    await waitFor(async () => expect((await repo.getSettings())?.framing).toBe('per100'));
    updateSettings({ theme: 'system' });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('spinner:theme')).toBeNull();
  });
});

describe('export / import', () => {
  it('round-trips and skips what is already there', async () => {
    const a = createMemoryRepo({
      definitions: [def('x', 'X', '2026-01-01')],
      runs: [run('r', 'done', '2026-01-01')],
    });
    const text = JSON.stringify(await a.exportAll());
    const b = createMemoryRepo();
    expect(await b.importAll(parseAllData(text))).toEqual({ definitions: 1, runs: 1 });
    expect(await b.importAll(parseAllData(text))).toEqual({ definitions: 0, runs: 0 });
  });
  it('rejects foreign files with readable errors', () => {
    expect(() => parseAllData('nope')).toThrow(ImportError);
    expect(() => parseAllData('{"format":"x"}')).toThrow(/not a spinner export/);
    expect(() => parseAllData('{"format":"spinner-all","v":2}')).toThrow(/newer/);
  });
});

describe('updates hook', () => {
  it('delegates to the registered checker', async () => {
    setUpdateChecker(async () => 'available');
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
    setUpdateChecker(async () => 'current');
    const { container, getByText } = render(<App />);
    for (const t of [
      'Request persistent storage',
      'Export all',
      'Import all',
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
