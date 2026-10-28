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
