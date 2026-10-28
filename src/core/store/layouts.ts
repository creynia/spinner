/**
 * Layout store helpers (layouts.md §5.2; owner: WP-L2). FROZEN signatures. The repo methods
 * (`listLayouts`, `getLayout`, `putLayout`, `deleteLayout`) live in `repo.ts` (newest first by
 * `byUpdated`; `LayoutRecord` is in `contracts/layout.ts`).
 */
import type { Json } from '../contracts/game';
import { LAYOUT_FILE_FORMAT, type ChipLayout, type LayoutFileV1 } from '../contracts/layout';
import type { Slug } from '../contracts/strategy';
import { canonicalJson, sha256Hex } from '../experiment';

/** Why a layout file was refused. */
export type LayoutFileErrorCode =
  'not-json' | 'wrong-format' | 'newer-version' | 'bad-version' | 'bad-shape';

/** Thrown by `decodeLayoutFile`; `code` is stable, `message` is English for the Import screen. */
export class LayoutFileError extends Error {
  readonly code: LayoutFileErrorCode;
  constructor(code: LayoutFileErrorCode, message: string) {
    super(message);
    this.name = 'LayoutFileError';
    this.code = code;
  }
}

const MAX_FILE_LAYOUTS = 500;
const SLUG_MAX = 40;

/** sha256 hex of canonicalJson({ game, variant, spots sorted by bet }): placement order is ignored. */
export function layoutHash(l: ChipLayout): Promise<string> {
  const spots = l.spots
    .map((s) => ({ bet: s.bet, chips: s.chips }))
    .sort((a, b) => (a.bet < b.bet ? -1 : a.bet > b.bet ? 1 : 0));
  return sha256Hex(canonicalJson({ game: l.game, variant: l.variant, spots }));
}

function slugBase(name: string): string {
  let s = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(s)) s = s ? `layout-${s}` : 'layout';
  return s.slice(0, SLUG_MAX).replace(/-+$/g, '');
}

/** A slug from the name (`corners-and-red`, then `-2`, `-3` …) that is not in `taken`. */
export function allocLayoutId(name: string, taken: ReadonlySet<string>): Slug {
  const base = slugBase(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const id = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '') + suffix;
    if (!taken.has(id)) return id;
  }
}

/** The `<slug>.layout.json` text: a `LayoutFileV1` as canonical JSON (1..500 layouts). */
export function encodeLayoutFile(
  layouts: ChipLayout[],
  app: { id: string; version: string },
): string {
  const file: LayoutFileV1 = { format: LAYOUT_FILE_FORMAT, version: 1, app, layouts };
  return canonicalJson(file as unknown as Json);
}

/** Parses a layout file; throws `LayoutFileError`. Does not validate the layouts themselves. */
export function decodeLayoutFile(text: string): LayoutFileV1 {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    throw new LayoutFileError('not-json', 'That file is not valid JSON.');
  }
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.format !== LAYOUT_FILE_FORMAT) {
    throw new LayoutFileError('wrong-format', 'That file is not a chip layout file.');
  }
  const v = o.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new LayoutFileError('bad-version', 'That layout file has no valid version.');
  }
  if (v > 1) {
    throw new LayoutFileError('newer-version', 'That layout file was made with a newer version.');
  }
  const app = o.app as Record<string, unknown> | null;
  if (
    !app ||
    typeof app !== 'object' ||
    typeof app.id !== 'string' ||
    typeof app.version !== 'string'
  ) {
    throw new LayoutFileError('bad-shape', 'That layout file is missing its app block.');
  }
  const layouts = o.layouts;
  if (!Array.isArray(layouts) || layouts.length < 1 || layouts.length > MAX_FILE_LAYOUTS) {
    throw new LayoutFileError('bad-shape', `A layout file holds 1 to ${MAX_FILE_LAYOUTS} layouts.`);
  }
  for (const l of layouts) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) {
      throw new LayoutFileError('bad-shape', 'A layout in that file is not an object.');
    }
  }
  return {
    format: LAYOUT_FILE_FORMAT,
    version: 1,
    app: { id: app.id, version: app.version },
    layouts: layouts as ChipLayout[],
  };
}
