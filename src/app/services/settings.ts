// Settings (architecture.md §6.4): kept in the `settings` store through the repo, with `theme`
// mirrored to localStorage['spinner:theme'] (main.tsx reads it synchronously). All access in try/catch.
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
const SETTINGS_ID = 'app';

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

let repo: Repo | null = null;

/** Load persisted settings from the repo and apply the theme. Never throws. */
export async function loadSettings(r: Repo): Promise<Settings> {
  repo = r;
  try {
    const stored = await r.getSettings();
    const s = sanitizeSettings(stored);
    settingsStore.set(s);
  } catch {
    // keep defaults
  }
  applyTheme(settingsStore.get().theme);
  return settingsStore.get();
}

export function updateSettings(patch: Partial<Settings>): void {
  const next = sanitizeSettings({ ...settingsStore.get(), ...patch });
  settingsStore.set(next);
  if (patch.theme !== undefined) applyTheme(next.theme);
  void repo?.putSettings({ id: SETTINGS_ID, ...next }).catch(() => undefined);
}
