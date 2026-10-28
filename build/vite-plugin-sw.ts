import type { Plugin } from 'vite';

/** Stub (WP0). The infra WP fills in the precache, `dist/sw.js` and manifest injection (architecture.md §8.1). */
export function swPlugin(): Plugin {
  return { name: 'spinner-sw' };
}
