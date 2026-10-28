// Navigation (architecture.md §6.1): the bottom TabBar on phones, the NavRail from 768px.
// CSS decides which one shows; the other is display:none. Owned by app-shell.
import type { JSX } from 'preact';

interface NavItem {
  href: string;
  path: string;
  label: string;
  /** Other top-level paths that belong under this tab (More holds Settings, Gallery, Import). */
  also?: readonly string[];
  icon: JSX.Element;
}

const svg = (d: string): JSX.Element => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d={d} />
  </svg>
);

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '#/', path: '/', label: 'Home', icon: svg('M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10') },
  {
    href: '#/define',
    path: '/define',
    label: 'Define',
    icon: svg('M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4'),
  },
  {
    href: '#/library',
    path: '/library',
    label: 'Library',
    icon: svg('M5 4h4v16H5zM11 4h4v16h-4zM17 6l3 1-3.5 13-3-1z'),
  },
  {
    href: '#/more',
    path: '/more',
    label: 'More',
    also: ['/settings', '/gallery', '/import'],
    icon: svg('M5 12h.01M12 12h.01M19 12h.01'),
  },
];

function under(base: string, path: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

export function isCurrent(item: Pick<NavItem, 'path' | 'also'>, path: string): boolean {
  if (item.path === '/') return path === '/';
  return under(item.path, path) || (item.also ?? []).some((a) => under(a, path));
}

function Items({ path }: { path: string }) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <a
          class="nav-link"
          href={item.href}
          aria-current={isCurrent(item, path) ? 'page' : undefined}
        >
          {item.icon}
          <span>{item.label}</span>
        </a>
      ))}
    </>
  );
}

export function TabBar({ path }: { path: string }) {
  return (
    <nav class="tabbar" aria-label="Main tabs">
      <Items path={path} />
    </nav>
  );
}

export function NavRail({ path }: { path: string }) {
  return (
    <nav class="navrail" aria-label="Main rail">
      <Items path={path} />
    </nav>
  );
}
