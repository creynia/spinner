import { useEffect, useState } from 'preact/hooks';

export interface ParsedHash {
  path: string;
  query: URLSearchParams;
}

/** '#/learn/abc?x=1' → { path: '/learn/abc', query }. Never throws. */
export function parseHash(hash: string): ParsedHash {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h.startsWith('/')) h = '/' + h;
  const q = h.indexOf('?');
  const rawPath = q >= 0 ? h.slice(0, q) : h;
  const query = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
  const segs = rawPath
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  return { path: '/' + segs.join('/'), query };
}

/** Match '/learn/:id' against a path; returns params or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = a[i]!;
    else if (seg !== a[i]) return null;
  }
  return params;
}

let freshNav = false;
/** True once after the app itself changed the hash (link/navigate), false for back/forward. */
export function consumeFreshNav(): boolean {
  const v = freshNav;
  freshNav = false;
  return v;
}
export function markFreshNav() {
  freshNav = true;
}

export function navigate(to: string) {
  const hash = to.startsWith('#') ? to : '#' + to;
  if (location.hash !== hash) {
    markFreshNav();
    location.hash = hash;
  }
}

export function href(path: string): string {
  return '#' + path;
}

export function useRoute(): ParsedHash & { hash: string } {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    on();
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return { ...parseHash(hash), hash };
}

// ---- Back navigation (architecture.md §6.1) ---------------------------------------------------

const TAB_ROOTS = new Set(['/', '/define', '/library', '/more']);

/** Explicit parent of a non-tab route, or null on a tab root (no Back button there). */
export function parentOf(path: string): string | null {
  if (TAB_ROOTS.has(path)) return null;
  const first = path.split('/').filter(Boolean)[0];
  switch (first) {
    case 'settings':
      return path === '/settings' ? '/more' : '/settings';
    case 'gallery':
      return path === '/gallery' ? '/more' : '/gallery';
    case 'import':
      return '/more';
    case 'define':
      return '/library';
    case 'run':
    case 'analyze':
    case 'watch':
    case 'compare':
    case 'sweep':
      return '/';
    default:
      return '/';
  }
}

/** In-app hash history seen by this page load; back/forward moves along it. */
const seen: string[] = typeof location === 'undefined' ? [] : [location.hash || '#/'];
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const h = location.hash || '#/';
    if (seen.length >= 2 && seen[seen.length - 2] === h) seen.pop();
    else seen.push(h);
  });
}

/** True when the previous history entry is a page of this app (not another site). */
export function hasInAppHistory(): boolean {
  return seen.length > 1;
}

/** Back: history.back() when the previous entry is in-app, else go to the explicit parent. */
export function goBack(path: string): void {
  if (hasInAppHistory()) history.back();
  else navigate(parentOf(path) ?? '/');
}
