// Settings (architecture.md §6.4): kept in the `settings` store through the repo, with `theme`
// mirrored to localStorage['spinner:theme'] (main.tsx reads it synchronously). All access in try/catch.
import { showToast } from '@core/ui';
import { createStore } from '../state/store';
import type { Repo } from './db';

export type Theme = 'light' | 'dark' | 'system';
/** Money framing (PLAYBOOK §9.5): figures per session, per hour or per 100 rounds; global. */
export type Framing = 'session' | 'hour' | 'per100';
export type PacePreset = 'live' | 'electronic';

export interface Settings {
  theme: Theme;
  framing: Framing;
  pace: PacePreset;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system', framing: 'session', pace: 'live' };
export const THEME_KEY = 'spinner:theme';
const SETTING_KEYS = ['theme', 'framing', 'pace'] as const;

export const settingsStore = createStore<Settings>(DEFAULT_SETTINGS);

const isTheme = (x: unknown): x is Theme => x === 'light' || x === 'dark' || x === 'system';
const isFraming = (x: unknown): x is Framing => x === 'session' || x === 'hour' || x === 'per100';
const isPace = (x: unknown): x is PacePreset => x === 'live' || x === 'electronic';

/** Keep only known, valid fields (stored data may be old or hand-edited). */
export function sanitizeSettings(x: unknown): Settings {
  const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
  return {
    theme: isTheme(o.theme) ? o.theme : DEFAULT_SETTINGS.theme,
    framing: isFraming(o.framing) ? o.framing : DEFAULT_SETTINGS.framing,
    pace: isPace(o.pace) ? o.pace : DEFAULT_SETTINGS.pace,
  };
}

/** Apply the theme to the document and mirror it for the next first paint. */
export function applyTheme(theme: Theme): void {
  try {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  } catch {
    // no document
  }
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage unavailable: the choice still applies for this page view
  }
}

const COPY_KEY = 'spinner:settings';
function readLocalCopy(): unknown {
  try {
    const raw = localStorage.getItem(COPY_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}
function writeLocalCopy(s: Settings): void {
  try {
    localStorage.setItem(COPY_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable
  }
}

let repo: Repo | null = null;

/** Load persisted settings (one `{ key, value }` record each) and apply the theme. Never throws. */
export async function loadSettings(r: Repo): Promise<Settings> {
  repo = r;
  const stored: Record<string, unknown> = {};
  try {
    for (const key of SETTING_KEYS) stored[key] = await r.getSetting(key);
  } catch (e) {
    reportError('Could not read saved settings', e);
  }
  // A memory-only repo forgets on reload, so the localStorage copy fills in what it lacks.
  const local = readLocalCopy() as Record<string, unknown> | null;
  const merged: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) merged[key] = stored[key] ?? local?.[key];
  settingsStore.set(sanitizeSettings(merged));
  applyTheme(settingsStore.get().theme);
  return settingsStore.get();
}

function reportError(message: string, e: unknown): void {
  console.error(message, e);
  showToast(`${message}.`, { tone: 'error' });
}

export function updateSettings(patch: Partial<Settings>): void {
  const prev = settingsStore.get();
  const next = sanitizeSettings({ ...prev, ...patch });
  settingsStore.set(next);
  writeLocalCopy(next);
  if (patch.theme !== undefined) applyTheme(next.theme);
  for (const key of SETTING_KEYS) {
    if (next[key] === prev[key]) continue;
    repo
      ?.setSetting(key, next[key])
      .catch((e: unknown) => reportError('Could not save a setting', e));
  }
}
