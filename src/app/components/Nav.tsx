// Navigation skeleton (architecture.md §6.1): the bottom TabBar on phones, the NavRail from 768px.
// CSS decides which one shows; the other is display:none. Owned by app-shell.
export const NAV_ITEMS = [
  { href: '#/', path: '/', label: 'Home', icon: '⌂' },
  { href: '#/define', path: '/define', label: 'Define', icon: '✎' },
  { href: '#/library', path: '/library', label: 'Library', icon: '☰' },
  { href: '#/more', path: '/more', label: 'More', icon: '⋯' },
] as const;

function isCurrent(itemPath: string, path: string): boolean {
  return itemPath === '/' ? path === '/' : path === itemPath || path.startsWith(`${itemPath}/`);
}

function Items({ path }: { path: string }) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <a
          class="nav-link"
          href={item.href}
          aria-current={isCurrent(item.path, path) ? 'page' : undefined}
        >
          <span aria-hidden="true">{item.icon}</span>
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
