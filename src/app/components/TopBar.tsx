// TopBar (architecture.md §6.1): back, title, running-run chip. Phones show it above the content;
// from 768 px the NavRail sits beside it. The h1 belongs to the screen, so the title is a <p>.
import { useStore } from '../state/store';
import { activeRun } from '../services/runs';
import { RunningChip } from './RunningChip';

const TITLES: Record<string, string> = {
  '': 'spinner',
  define: 'Define',
  run: 'Run',
  analyze: 'Analyze',
  watch: 'Watch',
  compare: 'Compare',
  sweep: 'Sweep',
  library: 'Library',
  gallery: 'Gallery',
  import: 'Import',
  settings: 'Settings',
  more: 'More',
};

export function titleFor(path: string): string {
  return TITLES[path.split('/').filter(Boolean)[0] ?? ''] ?? 'spinner';
}

export function TopBar({ path }: { path: string }) {
  const run = useStore(activeRun, (r) => r);
  const atRoot = path === '/';
  return (
    <header class="topbar">
      {atRoot ? null : (
        <button type="button" class="topbar-back" onClick={() => history.back()}>
          <span aria-hidden="true">‹</span> Back
        </button>
      )}
      <a class="topbar-brand" href="#/">
        spinner
      </a>
      <p class="topbar-title">{atRoot ? '' : titleFor(path)}</p>
      {run ? <RunningChip progress={run} /> : null}
    </header>
  );
}
