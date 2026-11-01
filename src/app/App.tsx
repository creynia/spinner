// The app shell (architecture.md §6.1): TopBar, NavRail or TabBar, storage banner, the route outlet,
// toasts. Boots the repo and settings once; screens never wait for them.
import { useEffect } from 'preact/hooks';
import { ToastHost } from '@core/ui';
import { UpdateToast } from '../pwa/UpdateToast';
import { pagePath, trackPage } from './analytics';
import { NavRail, TabBar } from './components/Nav';
import { RouteBoundary } from './components/RouteBoundary';
import { StorageBanner } from './components/StorageBanner';
import { TopBar } from './components/TopBar';
import { resolveRoute } from './routes';
import { useRoute } from './router';
import { getRepo } from './services/db';
import { loadSettings } from './services/settings';

export function App() {
  const { path, query, hash } = useRoute();
  const { screen: Screen, params, pattern } = resolveRoute(path);
  useEffect(() => {
    void getRepo().then(loadSettings);
  }, []);
  // One anonymous page view per route pattern (docs/analytics.md): ids and queries never leave.
  useEffect(() => trackPage(pagePath(location.pathname, pattern)), [pattern]);
  return (
    <div class="shell">
      <TopBar path={path} />
      <NavRail path={path} />
      <main id="main" class="content">
        <StorageBanner />
        <RouteBoundary key={hash}>
          <Screen params={params} query={query} />
        </RouteBoundary>
      </main>
      <TabBar path={path} />
      <ToastHost />
      <UpdateToast />
    </div>
  );
}
