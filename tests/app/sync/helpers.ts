import type { GisOauth2 } from '../../../src/app/services/sync/gis';
import { installGisFake, type GisFakeControls } from './fakes';

/** Installs the fake GIS on the happy-dom window and returns its controls and API object. */
export function freshGis(): { ctl: GisFakeControls; api: GisOauth2 } {
  delete (window as { google?: unknown }).google;
  const ctl = installGisFake();
  return { ctl, api: window.google!.accounts!.oauth2! };
}

export function bytes(n: number, seed = 1): Uint8Array {
  const b = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) b[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
  return b;
}

/** Compare large buffers by length and a cheap checksum (never `toEqual` on multi-MB arrays). */
export function sum(b: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 16777619) >>> 0;
  return `${b.length}:${h}`;
}
