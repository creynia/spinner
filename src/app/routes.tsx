// The complete route table (architecture.md §6.2, plus `#/settings/benchmark` from reconciliation
// P6). All routes exist from WP0 so screen WPs never edit this file; new routes only via main.
import type { ComponentType } from 'preact';
import { matchPath } from './router';
import { Analyze } from './screens/Analyze';
import { Compare } from './screens/Compare';
import { Define } from './screens/Define';
import { Gallery } from './screens/Gallery';
import { Home } from './screens/Home';
import { Import } from './screens/Import';
import { Library } from './screens/Library';
import { More } from './screens/More';
import { NotFound } from './screens/NotFound';
import { Run } from './screens/Run';
import { Benchmark } from './screens/Settings/Benchmark';
import { Settings } from './screens/Settings';
import { Sweep } from './screens/Sweep';
import { Watch } from './screens/Watch';
import type { ScreenProps } from './screens/types';

export interface Route {
  /** Path pattern; query strings are not part of it. */
  pattern: string;
  screen: ComponentType<ScreenProps>;
}

/** Order matters only between patterns of equal length (none overlap). */
export const routes: readonly Route[] = [
  { pattern: '/', screen: Home },
  { pattern: '/define', screen: Define },
  { pattern: '/define/:definitionId', screen: Define },
  { pattern: '/run/:runId', screen: Run },
  { pattern: '/analyze/:runId', screen: Analyze },
  { pattern: '/watch/:runId/:index', screen: Watch },
  { pattern: '/compare', screen: Compare },
  { pattern: '/sweep/:groupId', screen: Sweep },
  { pattern: '/library', screen: Library },
  { pattern: '/gallery', screen: Gallery },
  { pattern: '/gallery/:bundleId', screen: Gallery },
  { pattern: '/import', screen: Import },
  { pattern: '/settings', screen: Settings },
  { pattern: '/settings/benchmark', screen: Benchmark },
  { pattern: '/more', screen: More },
];

export interface Resolved {
  screen: ComponentType<ScreenProps>;
  params: Record<string, string>;
  /** False for the NotFound fallback. */
  found: boolean;
}

/** Match a parsed path (`/run/abc`) against the table; anything else is NotFound. */
export function resolveRoute(path: string): Resolved {
  for (const r of routes) {
    const params = matchPath(r.pattern, path);
    if (params) return { screen: r.screen, params, found: true };
  }
  return { screen: NotFound, params: {}, found: false };
}
