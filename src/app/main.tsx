// Entry: theme, registerSW, test hook, render. Shared file (baton): architecture.md §11.2.
import { render } from 'preact';
import { registerSW } from '../pwa/register';
import { App } from './App';
import { startSync } from './services/sync';
import { installTestHook } from './test-hook';
import './styles/tokens.css';
import './styles/app.css';

/** Read synchronously so the first paint already has the chosen theme (no flash). */
function applyStoredTheme(): void {
  try {
    const theme = localStorage.getItem('spinner:theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch {
    // storage unavailable: follow the OS
  }
}

applyStoredTheme();
installTestHook();
registerSW();
render(<App />, document.getElementById('app')!);
// Sync (sync.md §7.11): loads its state at once; the first cycle waits 3 s after this paint.
void startSync();
