// The app shell (architecture.md §6.1): TopBar, NavRail or TabBar, the route outlet.
import { UpdateToast } from '../pwa/UpdateToast';
import { NavRail, TabBar } from './components/Nav';
import { RouteBoundary } from './components/RouteBoundary';
import { resolveRoute } from './routes';
import { useRoute } from './router';

export function App() {
  const { path, query, hash } = useRoute();
  const { screen: Screen, params } = resolveRoute(path);
  return (
    <div class="shell">
      <header class="topbar">
        <a href="#/">spinner</a>
      </header>
      <NavRail path={path} />
      <main id="main" class="content">
        <RouteBoundary key={hash}>
          <Screen params={params} query={query} />
        </RouteBoundary>
      </main>
      <TabBar path={path} />
      <UpdateToast />
    </div>
  );
}
