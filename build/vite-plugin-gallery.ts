import type { Plugin } from 'vite';

/** Stub (WP0). The infra WP fills in the gallery index and bundle copying (architecture.md §9). */
export function galleryPlugin(): Plugin {
  return { name: 'spinner-gallery' };
}
