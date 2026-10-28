// Gallery index (harness-data-analysis.md §15; reconciliation P1). The Vite plugin (infra) builds
// it, the Gallery screen reads it. Types and the deterministic serializer live here.
import type { Json } from '../contracts/game';
import { canonicalJson } from '../experiment';

export const GALLERY_FORMAT = 'casino-lab-gallery' as const;
export const GALLERY_MAX_BUNDLE_BYTES = 2_097_152;
export const GALLERY_MAX_TOTAL_BYTES = 20_971_520;

export interface GalleryEntry {
  /** File name under `gallery/` as committed (`<slug>-<sha8>.<ext>` in `dist/gallery/`, P1). */
  file: string;
  bytes: number;
  /** sha256 of the file as committed. */
  sha256: string;
  slug: string;
  title: string;
  notes?: string;
  tags: string[];
  game: { id: string; version: string };
  coreVersion: string;
  definitionId: string;
  runId: string;
  resultsDigest: string;
  trimmed: boolean;
  partial: boolean;
  sessions: number;
  maxRounds: number;
  bankroll: number;
  roundsPerHour: number;
  headline: {
    meanNet: number;
    seMean: number;
    pAhead: number;
    pAheadCI: [number, number];
    pBust: number;
    pBustCI: [number, number];
    expectedLossPerHour: number;
  };
}

export interface GalleryIndexV1 {
  format: typeof GALLERY_FORMAT;
  version: 1;
  app: { id: string; version: string };
  totalBytes: number;
  entries: GalleryEntry[];
}

/** Deterministic bytes of the index: canonical JSON, no timestamps. */
export function galleryIndexJson(index: GalleryIndexV1): string {
  return canonicalJson(index as unknown as Json);
}
